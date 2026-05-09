param(
  [Parameter(Mandatory = $true)] [string]$Brand,
  [string]$Website = "",
  [string]$StrategyFile = "",
  [string]$OutputDir = "",
  [int]$TopN = 200,
  [int]$MaxExternalScorerCandidates = 300,
  [int]$LocationCode = 2840,
  [string]$LanguageCode = "en",
  [int]$KdCutoff = 30,
  [int[]]$FallbackLocationCodes = @(0),
  [switch]$SkipDataForSEO,
  [switch]$SemrushOnly,
  [string]$PositioningProfile = "",
  [bool]$SyncToFeishu = $true,
  [string]$FeishuConfig = "",
  [string]$FeishuTableId = "",
  [string]$FeishuTableMapPath = "",
  [string]$RestoreCsv = "",
  [string]$RestoreRunSummary = "",
  [switch]$RestoreOnly,
  [switch]$UpdateMaintenance,
  [string]$MaintenanceExistingCsv = "",
  [string]$MaintenancePoolCsv = "",
  [int]$MaintenanceDesiredCount = 50,
  [int]$MaintenanceMinVolume = 200,
  [int]$MaintenanceMaxKd = 45
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
. (Join-Path $script:RepoRoot 'scripts\lib\FeishuLarkCli.ps1')

function Get-SafeSlug([string]$value) {
  $s = $value.ToLowerInvariant()
  $s = ($s -replace "[^a-z0-9]+", "-").Trim("-")
  if ([string]::IsNullOrWhiteSpace($s)) { return "brand" }
  return $s
}

function Unique-Items([string[]]$items) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $out = @()
  foreach ($i in $items) {
    if ([string]::IsNullOrWhiteSpace($i)) { continue }
    $v = $i.Trim()
    if ($set.Add($v)) { $out += $v }
  }
  return $out
}

function Split-KeywordText([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return @() }
  $parts = $text -split "[,\|;/]"
  $out = @()
  foreach ($p in $parts) {
    $v = $p.Trim()
    if ($v.Length -lt 3) { continue }
    if ($v -notmatch "[A-Za-z]") { continue }
    $out += $v
  }
  return $out
}

function Is-CleanKeyword([string]$kw) {
  if ([string]::IsNullOrWhiteSpace($kw)) { return $false }
  $k = $kw.Trim()
  if ($k.Length -lt 4 -or $k.Length -gt 90) { return $false }
  if ($k -match '[\[\]\{\}]') { return $false }
  if ($k -match '[^ -~]') { return $false } # non-ASCII
  if ($k -match '\?{2,}') { return $false }
  if ($k -match '"') { return $false }
  if ($k -match 'schema|breadcrumb|aggregaterating|offer schema|faq \+|product \+') { return $false }
  if ($k -match '^[^A-Za-z0-9]+$') { return $false }
  $wordCount = @($k -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
  if ($wordCount -gt 9) { return $false }
  return $true
}

function Normalize-Keyword([string]$kw) {
  $k = $kw.Trim().ToLowerInvariant()
  $k = $k -replace '\s+', ' '
  $k = $k -replace '\b(vibrators)\b', 'vibrator'
  $k = $k -replace '\b(alternatives)\b', 'alternative'
  $k = $k -replace '\b(reviews)\b', 'review'
  return $k.Trim()
}

function Normalize-WebsiteIdentity([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  $s = $value.Trim().ToLowerInvariant()
  $s = ($s -replace '^https?://', '')
  $s = ($s -replace '^www\.', '')
  $s = $s.TrimEnd('/')
  return $s
}

function Get-WebsiteKeywordBusinessKey([string]$brand, [string]$website, [string]$keyword) {
  $brandNorm = Normalize-Keyword -kw $brand
  $websiteNorm = Normalize-WebsiteIdentity -value $website
  $keywordNorm = Normalize-Keyword -kw $keyword
  if ([string]::IsNullOrWhiteSpace($brandNorm) -or [string]::IsNullOrWhiteSpace($websiteNorm) -or [string]::IsNullOrWhiteSpace($keywordNorm)) { return '' }
  return ($brandNorm + '|' + $websiteNorm + '|' + $keywordNorm)
}

function Get-NichediggerKeywordKey([string]$brandSlug, [string]$website, [string]$keyword) {
  $websiteNorm = Normalize-WebsiteIdentity -value $website
  $keywordNorm = Normalize-Keyword -kw $keyword
  if ([string]::IsNullOrWhiteSpace($websiteNorm) -or [string]::IsNullOrWhiteSpace($keywordNorm)) { return '' }
  return ($brandSlug + '|' + $websiteNorm + '|' + $keywordNorm)
}

function Is-LowSignalArousenKeyword([string]$kw, [string]$brandName) {
  if ([string]::IsNullOrWhiteSpace($kw)) { return $true }
  $k = Normalize-Keyword -kw $kw
  if ($k -match '^(?<a>[a-z0-9-]+)\s+vs\s+\k<a>$') { return $true }
  if ($k -match '^(with lube|charge my vibrator)$') { return $true }
  if ($k -match '\b(checklist|challenge|template|generator|comparison chart|comparison tool|score|unboxing|first impressions)\b') { return $true }
  if ($k -match '^(5-day|30-day)\b') { return $true }
  if ($k -match ':') { return $true }
  if ($k -match '\b(small but mighty|hands-free pleasure|dual stimulation guide|complete guide|comprehensive guide|finding your perfect match|data from 10)\b') { return $true }
  $brandLower = $brandName.ToLowerInvariant()
  if ($k -match [regex]::Escape($brandLower) -and -not (Is-ArousenSiteComparisonKeyword -kw $kw -brandName $brandName) -and $k -notmatch ('^' + [regex]::Escape($brandLower) + '\s+(review|vs|about|story|mission|designed|commitment)\b')) {
    return $true
  }
  return $false
}

function Is-LowSignalSpinexKeyword([string]$kw) {
  if ([string]::IsNullOrWhiteSpace($kw)) { return $true }
  $k = Normalize-Keyword -kw $kw
  if ($k -match '^(doubles|singles|parents|regret|complaints|consistency|club|coach)$') { return $true }
  if ($k -match '^(worth it|alternative to|budget picks|school picks|beginner questions|paddle comparisons|australia buying guides|starter kits & gift guides|accessories & care|best paddles for)$') { return $true }
  if ($k -match '^(control|spin)\s+(review|alternative|vs spinexpickleball|discount code|complaints)$') { return $true }
  if ($k -match '^brands like\s+(control|spin)$') { return $true }
  if ($k -match '^(black friday)$') { return $true }
  return $false
}

function Get-PositioningProfile([string]$brandSlug, [string]$inputProfile) {
  if (-not [string]::IsNullOrWhiteSpace($inputProfile)) { return $inputProfile.Trim().ToLowerInvariant() }
  if ($brandSlug -eq "hakkoai") { return "game_scene" }
  if ($brandSlug -eq "arousen") { return "neutral_research" }
  if ($brandSlug -eq "leewow") { return "leewow_merch" }
  if ($brandSlug -eq "spinexpickleball") { return "spinex_au" }
  return "default"
}

function Get-SemrushApiKey {
  $k = $env:SEMRUSH_API_KEY
  if ([string]::IsNullOrWhiteSpace($k)) { $k = [Environment]::GetEnvironmentVariable("SEMRUSH_API_KEY", "User") }
  if ([string]::IsNullOrWhiteSpace($k)) { $k = $env:SEMRUSH_KEY }
  if ([string]::IsNullOrWhiteSpace($k)) { $k = [Environment]::GetEnvironmentVariable("SEMRUSH_KEY", "User") }
  return $k
}

function Resolve-SemrushDatabase([int]$Loc) {
  switch ($Loc) {
    2840 { return "us" }
    2826 { return "uk" }
    2124 { return "ca" }
    2036 { return "au" }
    2356 { return "in" }
    2276 { return "de" }
    2250 { return "fr" }
    2076 { return "br" }
    2484 { return "mx" }
    2392 { return "jp" }
    2410 { return "kr" }
    2724 { return "es" }
    2380 { return "it" }
    2528 { return "nl" }
    2752 { return "se" }
    2616 { return "pl" }
    default { return "us" }
  }
}

function Get-SemrushSafeUri([string]$Uri) {
  if ([string]::IsNullOrWhiteSpace($Uri)) { return "" }
  return ($Uri -replace '(?<=[?&]key=)[^&]+', '***')
}

function Get-HttpErrorDetails([System.Management.Automation.ErrorRecord]$ErrorRecord, [string]$RequestUri = "") {
  $statusCode = ""
  $body = ""
  $response = $ErrorRecord.Exception.Response
  if ($response) {
    try {
      if ($response.PSObject.Properties.Name -contains 'StatusCode' -and $null -ne $response.StatusCode) {
        $statusCode = [string][int]$response.StatusCode
      }
    } catch {}
    try {
      if ($response.GetResponseStream) {
        $stream = $response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $body = $reader.ReadToEnd()
          $reader.Dispose()
          $stream.Dispose()
        }
      }
    } catch {}
  }

  $parts = @("Semrush call failed")
  if (-not [string]::IsNullOrWhiteSpace($statusCode)) { $parts += "status=$statusCode" }
  $parts += "message=$($ErrorRecord.Exception.Message)"
  if (-not [string]::IsNullOrWhiteSpace($RequestUri)) { $parts += "uri=$(Get-SemrushSafeUri -Uri $RequestUri)" }
  if (-not [string]::IsNullOrWhiteSpace($body)) { $parts += "body=$body" }
  return ($parts -join ' :: ')
}

function Invoke-SemrushPhraseThis([string]$ApiKey, [string]$Database, [string]$Keyword) {
  if ([string]::IsNullOrWhiteSpace($ApiKey) -or [string]::IsNullOrWhiteSpace($Keyword)) { return $null }
  $query = @(
    "type=$([uri]::EscapeDataString('phrase_this'))"
    "key=$([uri]::EscapeDataString($ApiKey))"
    "phrase=$([uri]::EscapeDataString($Keyword))"
    "database=$([uri]::EscapeDataString($Database))"
    "export_columns=$([uri]::EscapeDataString('Ph,Nq,Co'))"
  ) -join "&"
  $uri = "https://api.semrush.com/?$query"
  try {
    $text = (Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 45).Content
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $lines = @($text -split "(`r`n|`n|`r)" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -lt 2) { return $null }
    $data = [string]$lines[1]
    if ($data.TrimStart().StartsWith("ERROR", [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Verbose ("[semrush] " + $data + " :: uri=" + (Get-SemrushSafeUri -Uri $uri))
      return $null
    }
    $parts = @($data -split ";")
    if ($parts.Count -lt 3) { return $null }
    $sv = [double]($parts[1] -replace ",", "")
    $co = [double]($parts[2] -replace ",", "")
    if ($co -ge 0 -and $co -le 1) { $co = $co * 100 }
    return [pscustomobject]@{
      keyword = [string]$parts[0]
      search_volume = $sv
      competition_index = [math]::Round($co, 2)
      source = "semrush_phrase_this"
    }
  } catch {
    Write-Verbose (Get-HttpErrorDetails -ErrorRecord $_ -RequestUri $uri)
    return $null
  }
}

function Get-GameSceneBackfillKeywords([int]$NeedCount, [string[]]$ExistingKeywords, [int]$Loc) {
  if ($NeedCount -le 0) { return @() }
  $apiKey = Get-SemrushApiKey
  if ([string]::IsNullOrWhiteSpace($apiKey)) { return @() }
  $db = Resolve-SemrushDatabase -Loc $Loc
  $games = @(
    "league of legends","valorant","minecraft","fortnite","counter strike 2","elden ring","genshin impact","dota 2","overwatch 2",
    "apex legends","call of duty warzone","stardew valley","world of warcraft","final fantasy xiv","honkai star rail",
    "path of exile 2","roblox","old school runescape"
  )
  $patterns = @(
    "{0} ai coach","{0} ai assistant","{0} ai helper","{0} coach","{0} assistant","{0} helper",
    "{0} build guide","{0} guide","{0} tips","{0} best build","{0} settings","{0} sensitivity","{0} tracker","{0} tier list","{0} strategy"
  )
  $existing = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($k in $ExistingKeywords) { if (-not [string]::IsNullOrWhiteSpace($k)) { [void]$existing.Add($k.Trim()) } }
  $candidateMap = @{}
  foreach ($g in $games) {
    foreach ($p in $patterns) {
      $kw = [string]::Format($p, $g)
      if ($existing.Contains($kw)) { continue }
      $hit = Invoke-SemrushPhraseThis -ApiKey $apiKey -Database $db -Keyword $kw
      if ($null -eq $hit) { continue }
      if ($hit.search_volume -le 0) { continue }
      if ($candidateMap.ContainsKey($hit.keyword)) { continue }
      $candidateMap[$hit.keyword] = $hit
    }
  }
  $ordered = @($candidateMap.Values | Sort-Object @{ Expression = { [double]$_.search_volume }; Descending = $true }, @{ Expression = { [string]$_.keyword }; Descending = $false })
  return @($ordered | Select-Object -First ([Math]::Max($NeedCount * 3, $NeedCount)))
}

function Get-NeutralAggregatorSites() {
  return @("bedbible","phallophile","allure","womenshealth","healthline","verywellmind")
}

function Is-ArousenSiteComparisonKeyword([string]$kw, [string]$brandName) {
  $k = $kw.ToLowerInvariant().Trim()
  $brandLower = $brandName.ToLowerInvariant()
  $sites = Get-NeutralAggregatorSites
  foreach ($s in $sites) {
    if ($k -match ("^" + [regex]::Escape($brandLower) + "\s+vs\s+" + [regex]::Escape($s) + "$")) { return $true }
    if ($k -match ("^" + [regex]::Escape($s) + "\s+vs\s+" + [regex]::Escape($brandLower) + "$")) { return $true }
  }
  return $false
}

function Is-ArousenBrandTermKeyword([string]$kw, [string]$brandName) {
  if ([string]::IsNullOrWhiteSpace($kw) -or [string]::IsNullOrWhiteSpace($brandName)) { return $false }
  $k = $kw.ToLowerInvariant().Trim()
  $brandLower = $brandName.ToLowerInvariant().Trim()
  if ($brandLower -ne 'arousen') { return $false }
  if ($k -notmatch [regex]::Escape($brandLower)) { return $false }
  if ($k -match ("^" + [regex]::Escape($brandLower) + "\s+vs\s+.+$")) { return $true }
  if ($k -match ("^.+\s+vs\s+" + [regex]::Escape($brandLower) + "$")) { return $true }
  if ($k -match ("^" + [regex]::Escape($brandLower) + "\s+(review|reviews|worth it|about|unboxing|experience|sexual wellness|medical grade silicone)\b")) { return $true }
  return $true
}

function Pass-PositioningGuard([string]$kw, [string]$profile, [string]$brandName) {
  if ([string]::IsNullOrWhiteSpace($kw)) { return $false }
  $k = $kw.ToLowerInvariant().Trim()
  $wordCount = @($k -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count

  if (Is-ArousenBrandTermKeyword -kw $kw -brandName $brandName) { return $false }

  if ($profile -eq "game_scene") {
    if ($wordCount -lt 3) { return $false }
    if ($k -notmatch '\bai\b') { return $false }
    $gameSignal = (
      $k -match "\b(elden ring|genshin impact|league of legends|lol|valorant|cs2|dota2|dota 2|stardew valley|ow2|overwatch|apex|fortnite|cod|warzone|poe2|path of exile|ff14|final fantasy xiv|hsr|honkai star rail|wow|world of warcraft|minecraft|roblox|osrs)\b"
    )
    $needSignal = (
      $k -match "\b(companion|assistant|coach|helper|guide|build|settings|training|tips|rank|route|pathing|rotation|team|combo|sensitivity|farm|mmr)\b"
    )
    if (-not $gameSignal) { return $false }
    if (-not $needSignal) { return $false }
    return $true
  }

  if ($profile -eq "leewow_merch") {
    if ($wordCount -lt 2) { return $false }
    if ($k -match "\b(ahrefs|entrepreneurship|authority stacking|gaming|shipping|follow|youtubers|best side hustles|quality control|passive income|fba)\b") { return $false }
    if ($k -match "^\s*(design|pets?|posters?|mugs?)\s*$") { return $false }
    if ($k -match "\bdiscount code\b") { return $false }

    $hasAiSignal = (
      $k -match "\b(ai|generative ai)\b"
    )
    $hasProductSignal = (
      $k -match "\b(custom|personalized|gift|print on demand|pod|merch|product creation|physical products?|t-?shirts?|hoodies?|scarf|pillows?|blankets?|mouse pad|tumbler|mugs?|neck pillow|wall art|phone case|backpack|sleep mask|laptop sleeve|tissue box)\b"
    )
    $hasCompetitorIntent = (
      $k -match "^(printful|printify|redbubble|etsy|gelato|teespring|society6|kittl)\s+(review|vs|alternative|alternatives)$"
    )
    if (-not (($hasAiSignal -and $hasProductSignal) -or $hasCompetitorIntent)) { return $false }

    if ($wordCount -lt 3) {
      if (-not $hasCompetitorIntent) {
        return $false
      }
    }
    return $true
  }

  if ($profile -eq "spinex_au") {
    if (Is-LowSignalSpinexKeyword -kw $kw) { return $false }
    if ($wordCount -lt 2) { return $false }
    $hasProductSignal = (
      $k -match '\b(pickleball|paddle|paddles|balls|grip|overgrip|edge guard|thermoformed|carbon fiber|starter set|starter kit|bundle|gear|equipment|gift|sweet spot|balance point)\b'
    )
    $hasBrandSignal = (
      $k -match '\b(spinex|joola|selkirk|crbn|six zero)\b'
    )
    $hasIntentSignal = (
      $k -match '\b(best|review|vs|alternative|worth it|guide|how|what|which|where|why|for|under|compare|comparison)\b'
    )
    if (-not ($hasProductSignal -or $hasBrandSignal)) { return $false }
    if ($wordCount -lt 3 -and -not ($hasBrandSignal -and $hasIntentSignal)) { return $false }
    return $true
  }

  if ($profile -ne "neutral_research") { return $true }

  if ($wordCount -lt 2) { return $false }
  if ($k -match '\b(click here|read more|article|blog|collection|story|testimonial|testimonials|issues|problems|cons|coupon|discount|promo|buy|deal|deals|black friday|cyber monday)\b') { return $false }
  if ($k -match '\b(chatgpt|ahrefs|semrush|hsts|javascript|http)\b') { return $false }

  $brandLower = $brandName.ToLowerInvariant()
  $hasBrand = ($k -match [regex]::Escape($brandLower))
  if ($hasBrand -and -not (Is-ArousenSiteComparisonKeyword -kw $kw -brandName $brandName)) {
    return $false
  }

  $hasCoreTopic = (
    $k -match "\b(vibrator|dildo|wand|rabbit|clitoral|g-spot|suction|bullet|sex toy|orgasm|masturbation|sexual wellness|women's health|female health|pelvic|kegel|lube|lubricant|intimacy|study|research)\b"
  )
  $hasCompetitorEntity = (
    $k -match "\b(lelo|lovense|satisfyer|we-vibe|dame|womanizer)\b"
  )
  $hasCompareIntent = (
    $k -match "\b(vs|comparison|review|best|top|guide)\b"
  )
  return [bool]($hasCoreTopic -or ($hasCompetitorEntity -and $hasCompareIntent) -or (Is-ArousenSiteComparisonKeyword -kw $kw -brandName $brandName))
}

function Get-NeutralSiteComparisonKeywords([string]$brandName) {
  $out = @()
  $sites = Get-NeutralAggregatorSites
  foreach ($s in $sites) {
    $name = (Get-Culture).TextInfo.ToTitleCase($s)
    $out += "$brandName vs $name"
    $out += "$name vs $brandName"
  }
  return $out
}

function Extract-QuotedPhrases([string]$line) {
  $out = @()
  $ms = [regex]::Matches($line, '"([^"]+)"')
  foreach ($m in $ms) {
    $v = [string]$m.Groups[1].Value
    if (-not [string]::IsNullOrWhiteSpace($v)) { $out += $v.Trim() }
  }
  return $out
}

function Get-StrategyKeywords([string]$path) {
  $lines = Get-Content -LiteralPath $path
  $out = @()
  foreach ($line in $lines) {
    $trim = $line.Trim()
    if ($trim -notmatch "^-") { continue }
    foreach ($q in (Extract-QuotedPhrases -line $trim)) {
      $out += (Split-KeywordText -text $q)
    }
    $plain = $trim.TrimStart("-").Trim()
    if ($plain -match "[A-Za-z]") {
      $out += (Split-KeywordText -text $plain)
    }
  }
  $clean = @($out | Where-Object { Is-CleanKeyword -kw $_ } | ForEach-Object { Normalize-Keyword -kw $_ })
  return Unique-Items -items $clean
}

function Get-AutoCompetitors([string[]]$keywords, [string]$brandName, [string]$strategyPath) {
  $stop = @(
    "best", "how", "why", "what", "where", "when", "which", "can", "is", "are", "the", "for", "with", "and", "buy", "brands",
    "safe", "toxic", "cheaper", "real", "unbiased", "better", "review", "reviews", "comparison", "guide", "truth", "fake",
    "honest", "most", "pro", "day", "clitoral", "g-spot",
    "product", "products", "creation", "design", "design-first", "ai-first", "on-demand", "fba", "placeit", "perplexity",
    "cons", "pros", "discount", "code", "shipping", "gaming", "youtubers", "podcasters", "musicians", "photographers",
    "control", "spin", "stability", "feel", "consistency", "balance", "power", "touch", "pickleball", "paddle", "paddles",
    "balls", "starter", "bundle", "gift", "gear", "equipment", "club", "coach", "school", "beginner", "beginners", "australia"
  )
  $brandLower = $brandName.ToLowerInvariant()
  $count = @{}

  if (Test-Path -LiteralPath $strategyPath) {
    $raw = Get-Content -LiteralPath $strategyPath
    foreach ($line in $raw) {
      $mReview = [regex]::Matches($line, "\b(?<name>[A-Z][A-Za-z0-9-]{2,})\b(?:\s+[A-Za-z0-9-]+)?\s+review")
      foreach ($m in $mReview) {
        $name = [string]$m.Groups["name"].Value
        $n = $name.ToLowerInvariant()
        if ($n -eq $brandLower -or ($stop -contains $n)) { continue }
        if (-not $count.ContainsKey($name)) { $count[$name] = 0 }
        $count[$name] = [int]$count[$name] + 2
      }

      $mVs = [regex]::Matches($line, "(?<a>[A-Z][A-Za-z0-9-]{2,})\s+vs\s+(?<b>[A-Z][A-Za-z0-9-]{2,})")
      foreach ($m in $mVs) {
        foreach ($g in @("a", "b")) {
          $name = [string]$m.Groups[$g].Value
          $n = $name.ToLowerInvariant()
          if ($n -eq $brandLower -or ($stop -contains $n)) { continue }
          if (-not $count.ContainsKey($name)) { $count[$name] = 0 }
          $count[$name] = [int]$count[$name] + 2
        }
      }
    }
  }

  foreach ($kw in $keywords) {
    $k = $kw.Trim()
    $m1 = [regex]::Match($k, "^(?<name>[A-Z][A-Za-z0-9-]{2,})\s+(review|vs|alternative|alternatives|coupon|discount|complaints|problems|issues)\b")
    if ($m1.Success) {
      $name = [string]$m1.Groups["name"].Value
      $n = $name.ToLowerInvariant()
      if ($n -ne $brandLower -and ($stop -notcontains $n)) {
        if (-not $count.ContainsKey($name)) { $count[$name] = 0 }
        $count[$name] = [int]$count[$name] + 1
      }
    }
  }

  if ($brandLower -match 'spinex') {
    foreach ($fallbackName in @('Joola', 'Selkirk', 'Six Zero', 'CRBN')) {
      if (-not $count.ContainsKey($fallbackName)) { $count[$fallbackName] = 1 }
    }
  }

  return @(
    $count.GetEnumerator() |
      Sort-Object @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { $_.Name }; Descending = $false } |
      Select-Object -First 20 |
      ForEach-Object { $_.Key }
  )
}

function Expand-ByCompetitors([string[]]$competitors, [string]$brandName, [string]$profile) {
  if ($profile -eq "game_scene") { return @() }
  $out = @()
  foreach ($c in $competitors) {
    $out += "$c review"
    $out += "$c alternatives"
    if ($profile -ne "neutral_research") {
      $out += "$c vs $brandName"
    } else {
      $out += "$c vs lovense"
      $out += "$c vs lelo"
      $out += "$c vs satisfyer"
      $out += "best $c products"
    }
    $out += "brands like $c"
    if ($profile -ne "neutral_research") {
      $out += "$c discount code"
    }
    $out += "$c complaints"
  }
  $clean = @($out | Where-Object { Is-CleanKeyword -kw $_ } | ForEach-Object { Normalize-Keyword -kw $_ })
  return Unique-Items -items $clean
}

function Get-IntentType([string]$kw, [string]$brandName, [string]$profile) {
  $k = $kw.ToLowerInvariant()
  if ($profile -eq "neutral_research" -and (Is-ArousenSiteComparisonKeyword -kw $kw -brandName $brandName)) { return "institutional_comparison" }
  if ($k -match [regex]::Escape($brandName.ToLowerInvariant())) { return "brand" }
  if ($k -match '\b(vs|comparison)\b') { return "comparison" }
  if ($k -match '\b(review)\b') { return "review" }
  if ($k -match '\b(alternative)\b') { return "alternative" }
  if ($k -match '\b(coupon|discount|promo|where to buy|buy)\b') { return "transactional" }
  if ($k -match '\b(best|top|under)\b') { return "bestof" }
  if ($k -match '\b(how to|guide|for beginners|tips)\b') { return "educational" }
  return "category"
}

function Get-PrimaryEntity([string]$kw, [string]$brandName, [string[]]$competitors) {
  $k = $kw.ToLowerInvariant()
  foreach ($c in $competitors) {
    $cl = $c.ToLowerInvariant()
    if ($k -match [regex]::Escape($cl)) { return $cl }
  }
  if ($k -match [regex]::Escape($brandName.ToLowerInvariant())) { return $brandName.ToLowerInvariant() }
  $stop = @("best","top","for","with","under","how","to","guide","the","and","vs","review","alternative","coupon","discount","buy")
  foreach ($t in ($k -split '\s+')) {
    if ($t.Length -lt 3) { continue }
    if ($stop -contains $t) { continue }
    return $t
  }
  return "generic"
}

function Get-StrategyLine([string]$kw, [string]$brandName, [string[]]$competitors, [string]$profile) {
  $k = $kw.ToLowerInvariant()
  if ($profile -eq "neutral_research") {
    if (Is-ArousenSiteComparisonKeyword -kw $kw -brandName $brandName) { return "site_comparison" }
    if ($k -match "\b(vs|comparison|review|best|top)\b") { return "neutral_review" }
    if ($k -match "\b(how to|guide|what is|tips|study|research|women|female|masturbation|health|wellness)\b") { return "education_research" }
    return "category_capture"
  }
  $hasCompetitor = $false
  foreach ($c in $competitors) {
    if ($k -match [regex]::Escape($c.ToLowerInvariant())) { $hasCompetitor = $true; break }
  }

  if ($hasCompetitor -and $k -match "\b(vs|review|alternative|alternatives|coupon|discount|complaints|problems|issues)\b") {
    return "intercept_competitor"
  }
  if ($k -match [regex]::Escape($brandName.ToLowerInvariant())) {
    return "brand_defense"
  }
  if ($k -match "\b(how to|guide|what is|tips|for beginners)\b") {
    return "education"
  }
  return "category_capture"
}

function Get-IntentScore([string]$kw, [string]$brandName, [string[]]$competitors, [string]$profile) {
  $k = $kw.ToLowerInvariant()
  $score = 0
  if ($k -match "\b(vs|review|alternative|alternatives|comparison)\b") { $score += 38 }
  if ($k -match "\b(best|top|under|worth it|coupon|discount|promo|buy)\b") { $score += 24 }
  if ($k -match "\b(for beginners|first time|guide|how to)\b") { $score += 12 }
  foreach ($c in $competitors) {
    if ($k -match [regex]::Escape($c.ToLowerInvariant())) {
      $score += 16
      break
    }
  }
  if ($profile -eq "neutral_research") {
    if (Is-ArousenSiteComparisonKeyword -kw $kw -brandName $brandName) { $score += 10 }
    if ($k -match "\b(study|research|women|female|masturbation|health|wellness)\b") { $score += 10 }
  } elseif ($k -match [regex]::Escape($brandName.ToLowerInvariant())) { $score += 10 }
  return $score
}

function Get-BrandScore([string]$kw, [string]$brandName, [string]$strategyLine, [string]$profile) {
  if ($profile -eq "neutral_research") {
    if ($strategyLine -eq "site_comparison") { return 8 }
    return 0
  }
  if ($strategyLine -eq "intercept_competitor") { return 0 }
  if ($kw.ToLowerInvariant() -match [regex]::Escape($brandName.ToLowerInvariant())) { return 18 }
  if ($strategyLine -eq "brand_defense") { return 12 }
  return 4
}

function Get-GapScore([string]$kw, [string[]]$competitors) {
  $k = $kw.ToLowerInvariant()
  $score = 0
  foreach ($c in $competitors) {
    if ($k -match [regex]::Escape($c.ToLowerInvariant())) { $score += 12; break }
  }
  if ($k -match "\b(vs|alternative|alternatives|comparison)\b") { $score += 8 }
  return $score
}

function Get-HeuristicKdScore([string]$kw, [string]$intentType) {
  $words = @($kw -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
  $score = 16
  if ($words -ge 4) { $score += 8 }
  elseif ($words -eq 3) { $score += 4 }
  elseif ($words -le 2) { $score -= 4 }

  if ($intentType -eq "bestof") { $score -= 6 }          # head-term usually harder
  if ($intentType -eq "comparison" -or $intentType -eq "review" -or $intentType -eq "alternative") { $score += 4 }
  if ($intentType -eq "educational") { $score += 2 }

  if ($kw -match '\b2026\b') { $score += 2 }
  if ($kw -match '\bfor beginners\b') { $score += 3 }
  if ($score -lt 6) { $score = 6 }
  if ($score -gt 35) { $score = 35 }
  return [int]$score
}

function Get-WeightedScore([string]$line, [int]$intentScore, [int]$kdScore, [int]$brandScore, [int]$gapScore, [string]$profile) {
  if ($profile -eq "game_scene") {
    return [int](0.42*$intentScore + 0.33*$kdScore + 0.10*$brandScore + 0.15*$gapScore)
  }
  if ($profile -eq "neutral_research") {
    switch ($line) {
      "site_comparison"    { return [int](0.42*$intentScore + 0.30*$kdScore + 0.20*$gapScore + 0.08*$brandScore) }
      "neutral_review"     { return [int](0.45*$intentScore + 0.35*$kdScore + 0.20*$gapScore + 0.00*$brandScore) }
      "education_research" { return [int](0.43*$intentScore + 0.37*$kdScore + 0.20*$gapScore + 0.00*$brandScore) }
      default              { return [int](0.40*$intentScore + 0.35*$kdScore + 0.25*$gapScore + 0.00*$brandScore) }
    }
  }
  switch ($line) {
    "intercept_competitor" { return [int](0.45*$intentScore + 0.35*$kdScore + 0.00*$brandScore + 0.20*$gapScore) }
    "brand_defense"        { return [int](0.30*$intentScore + 0.20*$kdScore + 0.35*$brandScore + 0.15*$gapScore) }
    "education"            { return [int](0.35*$intentScore + 0.30*$kdScore + 0.15*$brandScore + 0.20*$gapScore) }
    default                { return [int](0.40*$intentScore + 0.30*$kdScore + 0.10*$brandScore + 0.20*$gapScore) }
  }
}

function Read-JsonMap([string]$path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $map }
  try {
    $obj = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    if ($null -ne $obj) {
      foreach ($p in $obj.PSObject.Properties) { $map[[string]$p.Name] = [string]$p.Value }
    }
  } catch {}
  return $map
}

function Save-JsonMap([hashtable]$map, [string]$path) {
  if ($null -eq $map) { $map = @{} }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  ($map | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $path -Encoding UTF8
}

function Ensure-Directory([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return }
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

function New-NichediggerTraceIds([string]$brandSlug) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $runId = "$brandSlug-$stamp"
  return [ordered]@{
    orchestrator_task_id = "nichedigger-restore-$brandSlug"
    batch_id = "batch-$runId"
    run_id = "run-$runId"
  }
}

function ConvertTo-NichediggerTrackingRow([object]$row, [hashtable]$trace, [string]$action, [string]$tableId) {
  return [pscustomobject][ordered]@{
    brand = [string]$row.brand
    website = [string]$row.website
    keyword = [string]$row.keyword
    batch_id = [string]$trace.batch_id
    run_id = [string]$trace.run_id
    action = $action
    task_id = [string]$trace.orchestrator_task_id
    session_id = $tableId
    publish_url = ''
    unifuncs_url = ''
    unifuncs_code = ''
    unifuncs_message = ''
    request_id = [string]$row.keyword_key
    created_at = [string]$row.updated_at
    updated_at = (Get-Date).ToString('s')
    status = [string]$row.status
    removed_at = ''
    remove_code = ''
    remove_message = ''
    resolved_session_id = ''
  }
}

function Save-NichediggerMappingState([string]$mappingPath, [object[]]$currentRows, [hashtable]$trace, [string]$action, [string]$tableId) {
  $trackingRows = @()
  foreach ($row in @($currentRows)) {
    $trackingRows += ConvertTo-NichediggerTrackingRow -row $row -trace $trace -action $action -tableId $tableId
  }
  if ($trackingRows.Count -eq 0) { return @() }

  $merged = @{}
  if (Test-Path -LiteralPath $mappingPath) {
    try {
      $existingRows = Import-Csv -LiteralPath $mappingPath
      foreach ($ex in $existingRows) {
        $key = Get-WebsiteKeywordBusinessKey -brand ([string]$ex.brand) -website ([string]$ex.website) -keyword ([string]$ex.keyword)
        if (-not [string]::IsNullOrWhiteSpace($key)) { $merged[$key] = $ex }
      }
    } catch {}
  }

  foreach ($row in $trackingRows) {
    $key = Get-WebsiteKeywordBusinessKey -brand ([string]$row.brand) -website ([string]$row.website) -keyword ([string]$row.keyword)
    if (-not [string]::IsNullOrWhiteSpace($key)) { $merged[$key] = $row }
  }

  $finalRows = @($merged.Values | Sort-Object brand, website, keyword)
  $finalRows | Export-Csv -LiteralPath $mappingPath -NoTypeInformation -Encoding UTF8
  return $finalRows
}

function Append-NichediggerRunHistory([string]$historyPath, [object[]]$rows, [hashtable]$trace, [string]$eventName, [string]$action) {
  $entries = @()
  $now = (Get-Date).ToString('s')
  foreach ($r in @($rows)) {
    $entries += [pscustomobject][ordered]@{
      event_at = $now
      event = $eventName
      brand = [string]$r.brand
      website = [string]$r.website
      keyword = [string]$r.keyword
      batch_id = [string]$trace.batch_id
      run_id = [string]$trace.run_id
      action = $action
      task_id = [string]$trace.orchestrator_task_id
      session_id = ''
      status = [string]$r.status
      unifuncs_code = ''
      unifuncs_message = ''
      publish_url = ''
      updated_at = $now
    }
  }
  if ($entries.Count -eq 0) { return }
  if (Test-Path -LiteralPath $historyPath) {
    $entries | Export-Csv -LiteralPath $historyPath -NoTypeInformation -Encoding UTF8 -Append
  } else {
    $entries | Export-Csv -LiteralPath $historyPath -NoTypeInformation -Encoding UTF8
  }
}

function Write-NichediggerProgressSnapshot([string]$snapshotPath, [string]$mappingPath, [object[]]$allRows, [string]$brandValue, [string]$websiteValue, [hashtable]$trace, [string]$actionValue) {
  $statusCounts = @{}
  foreach ($r in @($allRows)) {
    $k = [string]$r.status
    if ([string]::IsNullOrWhiteSpace($k)) { $k = 'unknown' }
    if (-not $statusCounts.ContainsKey($k)) { $statusCounts[$k] = 0 }
    $statusCounts[$k] = [int]$statusCounts[$k] + 1
  }

  $snapshot = [ordered]@{
    generated_at = (Get-Date).ToString('s')
    brand = $brandValue
    website = $websiteValue
    mapping_csv = $mappingPath
    latest_batch_id = [string]$trace.batch_id
    latest_run_id = [string]$trace.run_id
    latest_action = $actionValue
    total = @($allRows).Count
    status_counts = $statusCounts
  }
  $snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
}

function Append-NichediggerEvent([string]$eventPath, [string]$eventType, [hashtable]$trace, [hashtable]$payload) {
  $entry = [ordered]@{
    ts = (Get-Date).ToString('s')
    type = $eventType
    trace = [ordered]@{
      orchestrator_task_id = [string]$trace.orchestrator_task_id
      batch_id = [string]$trace.batch_id
      run_id = [string]$trace.run_id
    }
    payload = $payload
  }
  Add-Content -LiteralPath $eventPath -Value (($entry | ConvertTo-Json -Depth 10 -Compress) + [Environment]::NewLine) -Encoding UTF8
}

function Convert-RowToComparableMap([object]$row) {
  return [ordered]@{
    keyword_key = [string]$row.keyword_key
    brand = [string]$row.brand
    website = [string]$row.website
    keyword = [string]$row.keyword
    data_source = [string]$row.data_source
    scoring_mode = [string]$row.scoring_mode
    semrush_volume = [string]$row.semrush_volume
    semrush_kd = [string]$row.semrush_kd
    semrush_competition = [string]$row.semrush_competition
    final_score = [string]$row.final_score
    est_monthly_views = [string]$row.est_monthly_views
    kd = [string]$row.kd
    cn_translation = [string]$row.cn_translation
    strategy_line = [string]$row.strategy_line
    intent_type = [string]$row.intent_type
    entity = [string]$row.entity
    score = [string]$row.score
    intent_score = [string]$row.intent_score
    kd_score = [string]$row.kd_score
    brand_score = [string]$row.brand_score
    gap_score = [string]$row.gap_score
    reviewer_label = [string]$row.reviewer_label
    auto_competitors = [string]$row.auto_competitors
    status = [string]$row.status
    content_status = [string]$row.content_status
    publish_status = [string]$row.publish_status
    data_status = [string]$row.data_status
    updated_at = [string]$row.updated_at
    notes = [string]$row.notes
  }
}

function Get-NichediggerDiffSummary([object[]]$beforeRows, [object[]]$afterRows, [object[]]$targetRows) {
  $beforeMap = @{}
  $afterMap = @{}
  $targetMap = @{}
  foreach ($r in @($beforeRows)) { if (-not [string]::IsNullOrWhiteSpace([string]$r.keyword_key)) { $beforeMap[[string]$r.keyword_key] = Convert-RowToComparableMap -row $r } }
  foreach ($r in @($afterRows)) { if (-not [string]::IsNullOrWhiteSpace([string]$r.keyword_key)) { $afterMap[[string]$r.keyword_key] = Convert-RowToComparableMap -row $r } }
  foreach ($r in @($targetRows)) { if (-not [string]::IsNullOrWhiteSpace([string]$r.keyword_key)) { $targetMap[[string]$r.keyword_key] = Convert-RowToComparableMap -row $r } }

  $created = 0
  $deleted = 0
  $changed = 0
  $mismatch = 0
  foreach ($key in $afterMap.Keys) {
    if (-not $beforeMap.ContainsKey($key)) { $created++ }
    elseif ((ConvertTo-Json $beforeMap[$key] -Compress) -ne (ConvertTo-Json $afterMap[$key] -Compress)) { $changed++ }
    if ($targetMap.ContainsKey($key)) {
      if ((ConvertTo-Json $afterMap[$key] -Compress) -ne (ConvertTo-Json $targetMap[$key] -Compress)) { $mismatch++ }
    } else {
      $mismatch++
    }
  }
  foreach ($key in $beforeMap.Keys) {
    if (-not $afterMap.ContainsKey($key)) { $deleted++ }
  }

  return [ordered]@{
    before_total = @($beforeRows).Count
    after_total = @($afterRows).Count
    target_total = @($targetRows).Count
    created = $created
    deleted = $deleted
    changed = $changed
    target_mismatch = $mismatch
  }
}

function Resolve-NichediggerRestoreRows([string]$restoreCsvPath, [string]$restoreRunSummaryPath, [string]$brandSlug, [string]$brandName, [string]$websiteValue) {
  if ([string]::IsNullOrWhiteSpace($restoreCsvPath)) {
    throw "RestoreOnly requires -RestoreCsv"
  }
  if (-not (Test-Path -LiteralPath $restoreCsvPath)) {
    throw "restore csv not found: $restoreCsvPath"
  }

  $rows = @(Import-Csv -LiteralPath $restoreCsvPath)
  if ($rows.Count -eq 0) {
    throw "restore csv has no rows: $restoreCsvPath"
  }

  $summaryObj = $null
  if (-not [string]::IsNullOrWhiteSpace($restoreRunSummaryPath) -and (Test-Path -LiteralPath $restoreRunSummaryPath)) {
    $summaryObj = Get-Content -Raw -LiteralPath $restoreRunSummaryPath | ConvertFrom-Json
  }

  $resolvedWebsite = $websiteValue
  if ([string]::IsNullOrWhiteSpace($resolvedWebsite) -and $null -ne $summaryObj -and $summaryObj.PSObject.Properties.Name -contains 'website') {
    $resolvedWebsite = [string]$summaryObj.website
  }

  $cleanRows = @()
  foreach ($row in $rows) {
    $keyword = [string]$row.keyword
    if ([string]::IsNullOrWhiteSpace($keyword)) { continue }
    $keywordKey = [string]$row.keyword_key
    if ([string]::IsNullOrWhiteSpace($keywordKey)) {
      $keywordKey = ($brandSlug + '|' + $keyword.ToLowerInvariant())
    }
    $cleanRows += [pscustomobject]@{
      keyword_key = $keywordKey
      brand = $(if ([string]::IsNullOrWhiteSpace([string]$row.brand)) { $brandName } else { [string]$row.brand })
      website = $(if ([string]::IsNullOrWhiteSpace([string]$row.website)) { $resolvedWebsite } else { [string]$row.website })
      keyword = $keyword
      data_source = [string]$row.data_source
      semrush_volume = [string]$row.semrush_volume
      semrush_kd = [string]$row.semrush_kd
      semrush_competition = [string]$row.semrush_competition
      final_score = [string]$row.final_score
      cn_translation = [string]$row.cn_translation
      strategy_line = [string]$row.strategy_line
      intent_type = [string]$row.intent_type
      entity = [string]$row.entity
      score = [string]$row.score
      intent_score = [string]$row.intent_score
      kd_score = [string]$row.kd_score
      brand_score = [string]$row.brand_score
      gap_score = [string]$row.gap_score
      kd = [string]$row.kd
      reviewer_label = [string]$row.reviewer_label
      scoring_mode = [string]$row.scoring_mode
      est_monthly_views = [string]$row.est_monthly_views
      status = $(if ([string]::IsNullOrWhiteSpace([string]$row.status)) { 'mined' } else { [string]$row.status })
      content_status = $(if ([string]::IsNullOrWhiteSpace([string]$row.content_status)) { 'todo' } else { [string]$row.content_status })
      publish_status = $(if ([string]::IsNullOrWhiteSpace([string]$row.publish_status)) { 'todo' } else { [string]$row.publish_status })
      data_status = $(if ([string]::IsNullOrWhiteSpace([string]$row.data_status)) { 'pending' } else { [string]$row.data_status })
      auto_competitors = [string]$row.auto_competitors
      updated_at = $(if ([string]::IsNullOrWhiteSpace([string]$row.updated_at)) { (Get-Date).ToString('s') } else { [string]$row.updated_at })
      notes = [string]$row.notes
    }
  }
  return @($cleanRows)
}

function Invoke-FeishuApi([string]$Method, [string]$Uri, [hashtable]$Headers, $Body = $null) {
  $baseToken = [string]($Headers.Authorization -replace '^Bearer\s+', '')
  $resp = Invoke-LarkCompatApi -Method $Method -Uri $Uri -BaseToken $baseToken -Body $Body
  if ($null -ne $resp -and $resp.PSObject.Properties.Name -contains 'code' -and [int]$resp.code -ne 0) {
    throw "Feishu API failed: $Method $Uri code=$($resp.code) msg=$($resp.msg)"
  }
  return $resp
}

function Get-FeishuTenantToken([string]$appId, [string]$appSecret) {
  return (Get-LarkBaseToken -RepoRoot $script:RepoRoot -Brand $Brand)
}

function Ensure-FeishuTable([string]$tenantToken, [string]$appToken, [string]$tableName, [string]$preferredTableId, [string]$tableMapPath) {
  if (-not [string]::IsNullOrWhiteSpace($preferredTableId)) { return $preferredTableId }
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  if ($tableName.Length -gt 50) { $tableName = $tableName.Substring(0, 50) }

  $map = Read-JsonMap -path $tableMapPath
  if ($map.ContainsKey($tableName) -and -not [string]::IsNullOrWhiteSpace([string]$map[$tableName])) {
    return [string]$map[$tableName]
  }

  $listUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables?page_size=200"
  $listResp = Invoke-FeishuApi -Method Get -Uri $listUri -Headers $headers
  $listItems = @()
  if ($null -ne $listResp -and $listResp.PSObject.Properties.Name -contains 'data' -and $null -ne $listResp.data) {
    if ($listResp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $listResp.data.items) {
      $listItems = @($listResp.data.items)
    }
  }
  if ($listItems.Count -gt 0) {
    foreach ($tb in $listItems) {
      if ([string]$tb.name -eq $tableName) {
        $map[$tableName] = [string]$tb.table_id
        Save-JsonMap -map $map -path $tableMapPath
        return [string]$tb.table_id
      }
    }
  }

  $createUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables"
  $createResp = Invoke-FeishuApi -Method Post -Uri $createUri -Headers $headers -Body @{ table = @{ name = $tableName } }
  $newId = [string]$createResp.data.table_id
  $map[$tableName] = $newId
  Save-JsonMap -map $map -path $tableMapPath
  return $newId
}

function Ensure-FeishuFields([string]$tenantToken, [string]$appToken, [string]$tableId) {
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  # User-facing Feishu model (data-first): keep this as the default schema for all brands.
  $needed = @(
    'data_source','semrush_volume','semrush_kd','semrush_competition',
    'final_score','est_monthly_views','kd','cn_translation',
    'strategy_line','intent_type','entity','score','intent_score','kd_score','brand_score','gap_score','reviewer_label','auto_competitors',
    'status','updated_at','notes',
    'website','brand','keyword_key','scoring_mode','content_status','publish_status','data_status'
  )
  $fieldUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/fields?page_size=500"
  $fieldResp = Invoke-FeishuApi -Method Get -Uri $fieldUri -Headers $headers
  $exists = @{}
  $primaryFieldName = ''
  $primaryFieldId = ''
  $fieldItems = @()
  if ($null -ne $fieldResp -and $fieldResp.PSObject.Properties.Name -contains 'data' -and $null -ne $fieldResp.data) {
    if ($fieldResp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $fieldResp.data.items) {
      $fieldItems = @($fieldResp.data.items)
    }
  }
  if ($fieldItems.Count -gt 0) {
    foreach ($f in $fieldItems) {
      $exists[[string]$f.field_name] = $true
      if ($f.PSObject.Properties.Name -contains 'is_primary' -and [bool]$f.is_primary) {
        $primaryFieldName = [string]$f.field_name
        if ($f.PSObject.Properties.Name -contains 'field_id') {
          $primaryFieldId = [string]$f.field_id
        }
      }
    }
    if ([string]::IsNullOrWhiteSpace($primaryFieldName) -and $fieldItems.Count -gt 0) {
      $primaryFieldName = [string]$fieldItems[0].field_name
      if ($fieldItems[0].PSObject.Properties.Name -contains 'field_id') {
        $primaryFieldId = [string]$fieldItems[0].field_id
      }
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($primaryFieldName) -and $primaryFieldName -match '[^\x00-\x7F]') {
    $asciiPrimary = 'primary_text'
    if (-not $exists.ContainsKey($asciiPrimary) -and -not [string]::IsNullOrWhiteSpace($primaryFieldId)) {
      $renameUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/fields/$primaryFieldId"
      Invoke-FeishuApi -Method Put -Uri $renameUri -Headers $headers -Body @{ field_name = $asciiPrimary; type = 1 } | Out-Null
      $primaryFieldName = $asciiPrimary
      $exists[$asciiPrimary] = $true
    }
  }
  foreach ($name in $needed) {
    if (-not $exists.ContainsKey($name)) {
      $createUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/fields"
      Invoke-FeishuApi -Method Post -Uri $createUri -Headers $headers -Body @{ field_name = $name; type = 1 } | Out-Null
    }
  }
  return $primaryFieldName
}

function Get-FeishuFieldNames([string]$tenantToken, [string]$appToken, [string]$tableId) {
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  $fieldUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/fields?page_size=500"
  $fieldResp = Invoke-FeishuApi -Method Get -Uri $fieldUri -Headers $headers
  $names = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  if ($null -ne $fieldResp -and $fieldResp.PSObject.Properties.Name -contains 'data' -and $null -ne $fieldResp.data) {
    if ($fieldResp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $fieldResp.data.items) {
      foreach ($f in @($fieldResp.data.items)) {
        if ($f.PSObject.Properties.Name -contains 'field_name') {
          [void]$names.Add([string]$f.field_name)
        }
      }
    }
  }
  return $names
}

function Get-StringFieldValue($fields, [string[]]$candidates) {
  if ($null -eq $fields) { return "" }
  foreach ($name in $candidates) {
    if ($fields -is [System.Collections.IDictionary]) {
      if ($fields.Contains($name)) {
        $v = [string]$fields[$name]
        if (-not [string]::IsNullOrWhiteSpace($v)) { return $v }
      }
      continue
    }
    $propNames = @($fields.PSObject.Properties | ForEach-Object { $_.Name })
    if ($propNames -contains $name) {
      $v = [string]$fields.$name
      if (-not [string]::IsNullOrWhiteSpace($v)) { return $v }
    }
  }
  return ""
}

function Convert-FeishuRecordToNichediggerRow([object]$record) {
  $fields = $record.fields
  return [pscustomobject]@{
    record_id = [string]$record.record_id
    keyword_key = Get-StringFieldValue -fields $fields -candidates @('keyword_key', 'keywordKey', 'Keyword Key')
    brand = Get-StringFieldValue -fields $fields -candidates @('brand', 'Brand')
    website = Get-StringFieldValue -fields $fields -candidates @('website', 'Website')
    keyword = Get-StringFieldValue -fields $fields -candidates @('keyword', 'primary_text', 'Keyword')
    data_source = Get-StringFieldValue -fields $fields -candidates @('data_source', 'Data Source')
    semrush_volume = Get-StringFieldValue -fields $fields -candidates @('semrush_volume', 'Semrush Volume')
    semrush_kd = Get-StringFieldValue -fields $fields -candidates @('semrush_kd', 'Semrush KD')
    semrush_competition = Get-StringFieldValue -fields $fields -candidates @('semrush_competition', 'Semrush Competition')
    final_score = Get-StringFieldValue -fields $fields -candidates @('final_score', 'Final Score')
    cn_translation = Get-StringFieldValue -fields $fields -candidates @('cn_translation', 'CN Translation')
    strategy_line = Get-StringFieldValue -fields $fields -candidates @('strategy_line', 'Strategy Line')
    intent_type = Get-StringFieldValue -fields $fields -candidates @('intent_type', 'Intent Type')
    entity = Get-StringFieldValue -fields $fields -candidates @('entity', 'Entity')
    score = Get-StringFieldValue -fields $fields -candidates @('score', 'Score')
    intent_score = Get-StringFieldValue -fields $fields -candidates @('intent_score', 'Intent Score')
    kd_score = Get-StringFieldValue -fields $fields -candidates @('kd_score', 'KD Score')
    brand_score = Get-StringFieldValue -fields $fields -candidates @('brand_score', 'Brand Score')
    gap_score = Get-StringFieldValue -fields $fields -candidates @('gap_score', 'Gap Score')
    kd = Get-StringFieldValue -fields $fields -candidates @('kd', 'KD')
    reviewer_label = Get-StringFieldValue -fields $fields -candidates @('reviewer_label', 'Reviewer Label')
    scoring_mode = Get-StringFieldValue -fields $fields -candidates @('scoring_mode', 'Scoring Mode')
    est_monthly_views = Get-StringFieldValue -fields $fields -candidates @('est_monthly_views', 'Estimated Monthly Views')
    status = Get-StringFieldValue -fields $fields -candidates @('status', 'Status')
    content_status = Get-StringFieldValue -fields $fields -candidates @('content_status', 'Content Status')
    publish_status = Get-StringFieldValue -fields $fields -candidates @('publish_status', 'Publish Status')
    data_status = Get-StringFieldValue -fields $fields -candidates @('data_status', 'Data Status')
    auto_competitors = Get-StringFieldValue -fields $fields -candidates @('auto_competitors', 'Auto Competitors')
    updated_at = Get-StringFieldValue -fields $fields -candidates @('updated_at', 'Updated At')
    notes = Get-StringFieldValue -fields $fields -candidates @('notes', 'Notes')
  }
}

function Get-AllFeishuRecords([string]$tenantToken, [string]$appToken, [string]$tableId) {
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  $recordUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records?page_size=500"
  $pageToken = ''
  $rows = @()
  do {
    $uri = if ([string]::IsNullOrWhiteSpace($pageToken)) { $recordUri } else { "$recordUri&page_token=$pageToken" }
    $resp = Invoke-FeishuApi -Method Get -Uri $uri -Headers $headers
    $recordItems = @()
    if ($null -ne $resp -and $resp.PSObject.Properties.Name -contains 'data' -and $null -ne $resp.data) {
      if ($resp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $resp.data.items) {
        $recordItems = @($resp.data.items)
      }
    }
    foreach ($item in $recordItems) {
      $rows += Convert-FeishuRecordToNichediggerRow -record $item
    }
    $hasMore = $false
    if ($resp.data.PSObject.Properties.Name -contains 'has_more') { $hasMore = [bool]$resp.data.has_more }
    $pageToken = if ($hasMore) { [string]$resp.data.page_token } else { '' }
  } while ($hasMore -and -not [string]::IsNullOrWhiteSpace($pageToken))
  return @($rows)
}

function Save-NichediggerJson([string]$path, $data) {
  Ensure-Directory -path (Split-Path -Parent $path)
  $data | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding UTF8
}

function Get-FeishuTableFields([string]$tenantToken, [string]$appToken, [string]$tableId) {
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  $fieldUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/fields?page_size=500"
  $fieldResp = Invoke-FeishuApi -Method Get -Uri $fieldUri -Headers $headers
  $fields = @()
  if ($null -ne $fieldResp -and $fieldResp.PSObject.Properties.Name -contains 'data' -and $null -ne $fieldResp.data) {
    if ($fieldResp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $fieldResp.data.items) {
      foreach ($f in @($fieldResp.data.items)) {
        $fields += [ordered]@{
          field_id = [string]$f.field_id
          field_name = [string]$f.field_name
          type = [string]$f.type
          is_primary = [bool]$f.is_primary
        }
      }
    }
  }
  return @($fields)
}

function Export-NichediggerFullTableBackup([string]$path, [string]$brandSlug, [string]$tableId, [hashtable]$trace, [string]$action, [object[]]$fields, [object[]]$rows) {
  $payload = [ordered]@{
    generated_at = (Get-Date).ToString('s')
    backup_type = 'full_table_backup'
    action = $action
    brand_slug = $brandSlug
    table_id = $tableId
    trace = $trace
    field_count = @($fields).Count
    record_count = @($rows).Count
    fields = @($fields)
    rows = @($rows)
  }
  Save-NichediggerJson -path $path -data $payload
}

function Export-NichediggerFeishuSnapshot([string]$path, [string]$brandSlug, [string]$tableId, [hashtable]$trace, [object[]]$rows, [string]$phase) {
  $payload = [ordered]@{
    generated_at = (Get-Date).ToString('s')
    phase = $phase
    brand_slug = $brandSlug
    table_id = $tableId
    trace = $trace
    total = @($rows).Count
    rows = @($rows)
  }
  Save-NichediggerJson -path $path -data $payload
}

function Remove-DirtyRowsFromFeishu([string]$tenantToken, [string]$appToken, [string]$tableId, [string]$brandSlug) {
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  $recordUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records?page_size=500"
  $pageToken = ''
  $deleted = 0
  do {
    $uri = if ([string]::IsNullOrWhiteSpace($pageToken)) { $recordUri } else { "$recordUri&page_token=$pageToken" }
    $resp = Invoke-FeishuApi -Method Get -Uri $uri -Headers $headers
    $recordItems = @()
    if ($null -ne $resp -and $resp.PSObject.Properties.Name -contains 'data' -and $null -ne $resp.data) {
      if ($resp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $resp.data.items) {
        $recordItems = @($resp.data.items)
      }
    }
    foreach ($it in $recordItems) {
      $fields = $it.fields
      $rid = [string]$it.record_id
      if ([string]::IsNullOrWhiteSpace($rid)) { continue }

      $keyword = Get-StringFieldValue -fields $fields -candidates @('keyword', 'keyword', 'primary_text')
      $keywordKey = Get-StringFieldValue -fields $fields -candidates @('keyword_key', 'keywordKey', 'Keyword Key')

      $isDirty = $false
      if (-not [string]::IsNullOrWhiteSpace($keyword) -and -not (Is-CleanKeyword -kw $keyword)) {
        $isDirty = $true
      }
      if (-not [string]::IsNullOrWhiteSpace($keywordKey) -and $keywordKey -notmatch ('^' + [regex]::Escape($brandSlug) + '\|')) {
        $isDirty = $true
      }
      if (-not [string]::IsNullOrWhiteSpace($keywordKey) -and ($keywordKey -match '[^ -~]' -or $keywordKey -match '[\[\]\{\}]')) {
        $isDirty = $true
      }

      if ($isDirty) {
        $deleteUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records/$rid"
        Invoke-FeishuApi -Method Delete -Uri $deleteUri -Headers $headers | Out-Null
        $deleted++
      }
    }

    $hasMore = $false
    if ($resp.data.PSObject.Properties.Name -contains 'has_more') { $hasMore = [bool]$resp.data.has_more }
    $pageToken = if ($hasMore) { [string]$resp.data.page_token } else { '' }
  } while ($hasMore -and -not [string]::IsNullOrWhiteSpace($pageToken))

  return $deleted
}

function Remove-StaleRowsFromFeishu([object[]]$rows, [string]$tenantToken, [string]$appToken, [string]$tableId, [string]$brandSlug) {
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  $recordUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records?page_size=500"
  $keep = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($r in $rows) {
    $k = [string]$r.keyword_key
    if (-not [string]::IsNullOrWhiteSpace($k)) { [void]$keep.Add($k) }
  }
  $deleted = 0
  $pageToken = ''
  do {
    $uri = if ([string]::IsNullOrWhiteSpace($pageToken)) { $recordUri } else { "$recordUri&page_token=$pageToken" }
    $resp = Invoke-FeishuApi -Method Get -Uri $uri -Headers $headers
    $recordItems = @()
    if ($null -ne $resp -and $resp.PSObject.Properties.Name -contains 'data' -and $null -ne $resp.data) {
      if ($resp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $resp.data.items) {
        $recordItems = @($resp.data.items)
      }
    }
    foreach ($it in $recordItems) {
      $rid = [string]$it.record_id
      if ([string]::IsNullOrWhiteSpace($rid)) { continue }
      $fields = $it.fields
      $keywordKey = Get-StringFieldValue -fields $fields -candidates @('keyword_key', 'keywordKey', 'Keyword Key')
      if ([string]::IsNullOrWhiteSpace($keywordKey)) {
        $deleteUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records/$rid"
        Invoke-FeishuApi -Method Delete -Uri $deleteUri -Headers $headers | Out-Null
        $deleted++
        continue
      }
      if ($keywordKey -notmatch ('^' + [regex]::Escape($brandSlug) + '\|')) { continue }
      if (-not $keep.Contains($keywordKey)) {
        $deleteUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records/$rid"
        Invoke-FeishuApi -Method Delete -Uri $deleteUri -Headers $headers | Out-Null
        $deleted++
      }
    }
    $hasMore = $false
    if ($resp.data.PSObject.Properties.Name -contains 'has_more') { $hasMore = [bool]$resp.data.has_more }
    $pageToken = if ($hasMore) { [string]$resp.data.page_token } else { '' }
  } while ($hasMore -and -not [string]::IsNullOrWhiteSpace($pageToken))

  return $deleted
}

function Upsert-KeywordRows([object[]]$rows, [string]$tenantToken, [string]$appToken, [string]$tableId, [string]$primaryFieldName, [System.Collections.Generic.HashSet[string]]$fieldNames) {
  $headers = @{ Authorization = "Bearer $tenantToken"; 'Content-Type' = 'application/json' }
  $recordUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records?page_size=500"
  $existing = @{}
  $pageToken = ''
  do {
    $uri = if ([string]::IsNullOrWhiteSpace($pageToken)) { $recordUri } else { "$recordUri&page_token=$pageToken" }
    $resp = Invoke-FeishuApi -Method Get -Uri $uri -Headers $headers
    $recordItems = @()
    if ($null -ne $resp -and $resp.PSObject.Properties.Name -contains 'data' -and $null -ne $resp.data) {
      if ($resp.data.PSObject.Properties.Name -contains 'items' -and $null -ne $resp.data.items) {
        $recordItems = @($resp.data.items)
      }
    }
    if ($recordItems.Count -gt 0) {
      foreach ($it in $recordItems) {
        $f = $it.fields
        $k = Get-StringFieldValue -fields $f -candidates @('keyword_key', 'keywordKey', 'Keyword Key')
        if (-not [string]::IsNullOrWhiteSpace($k)) {
          $existing[$k] = [pscustomobject]@{
            record_id = [string]$it.record_id
            row = Convert-FeishuRecordToNichediggerRow -record $it
          }
        }
      }
    }
    $hasMore = $false
    if ($resp.data.PSObject.Properties.Name -contains 'has_more') { $hasMore = [bool]$resp.data.has_more }
    $pageToken = if ($hasMore) { [string]$resp.data.page_token } else { '' }
  } while ($hasMore -and -not [string]::IsNullOrWhiteSpace($pageToken))

  $created = 0
  $updated = 0
  foreach ($r in $rows) {
    $key = [string]$r.keyword_key
    $rawFields = @{
      keyword = [string]$r.keyword
      data_source = [string]$r.data_source
      semrush_volume = [string]$r.semrush_volume
      semrush_kd = [string]$r.semrush_kd
      semrush_competition = [string]$r.semrush_competition
      final_score = [string]$r.final_score
      est_monthly_views = [string]$r.est_monthly_views
      kd = [string]$r.kd
      cn_translation = [string]$r.cn_translation
      strategy_line = [string]$r.strategy_line
      intent_type = [string]$r.intent_type
      entity = [string]$r.entity
      score = [string]$r.score
      intent_score = [string]$r.intent_score
      kd_score = [string]$r.kd_score
      brand_score = [string]$r.brand_score
      gap_score = [string]$r.gap_score
      reviewer_label = [string]$r.reviewer_label
      auto_competitors = [string]$r.auto_competitors
      status = [string]$r.status
      updated_at = [string]$r.updated_at
      notes = [string]$r.notes
      website = [string]$r.website
      brand = [string]$r.brand
      keyword_key = [string]$r.keyword_key
      scoring_mode = [string]$r.scoring_mode
      content_status = [string]$r.content_status
      publish_status = [string]$r.publish_status
      data_status = [string]$r.data_status
    }
    $fields = @{}
    foreach ($k in $rawFields.Keys) {
      if ($fieldNames.Contains([string]$k)) {
        $fields[[string]$k] = $rawFields[$k]
      }
    }
    if (-not [string]::IsNullOrWhiteSpace($primaryFieldName)) {
      if ($fieldNames.Contains($primaryFieldName)) {
        $fields[$primaryFieldName] = [string]$r.keyword
      }
    }
    if ($existing.ContainsKey($key)) {
      $current = $existing[$key]
      $currentComparable = ConvertTo-Json (Convert-RowToComparableMap -row $current.row) -Compress
      $targetComparable = ConvertTo-Json (Convert-RowToComparableMap -row $r) -Compress
      if ($currentComparable -eq $targetComparable) {
        continue
      }
      $rid = [string]$current.record_id
      $u = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records/$rid"
      Invoke-FeishuApi -Method Put -Uri $u -Headers $headers -Body @{ fields = $fields } | Out-Null
      $updated++
    } else {
      $c = "https://open.feishu.cn/open-apis/bitable/v1/apps/$appToken/tables/$tableId/records"
      Invoke-FeishuApi -Method Post -Uri $c -Headers $headers -Body @{ fields = $fields } | Out-Null
      $created++
    }
  }
  return [pscustomobject]@{ created = $created; updated = $updated; total = @($rows).Count }
}

function Get-NichediggerKdValue([object]$row) {
  if ($null -eq $row) { return $null }
  $text = [string]$row.kd
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $value = 0.0
  if ([double]::TryParse($text, [ref]$value)) { return $value }
  return $null
}

function Get-PseoSuccessRows([string]$mappingRoot, [string]$brandValue, [string]$websiteValue) {
  $brandNorm = Normalize-Keyword -kw $brandValue
  $websiteNorm = Normalize-WebsiteIdentity -value $websiteValue
  $successMap = @{}
  $brandRoot = Join-Path $mappingRoot 'brands'
  $files = @()
  if (Test-Path -LiteralPath $brandRoot) {
    $files += @(Get-ChildItem -LiteralPath $brandRoot -File -Recurse -Filter 'session-mapping.csv' -ErrorAction SilentlyContinue)
  }
  $files += @(Get-ChildItem -LiteralPath $mappingRoot -File -Filter '*-session-mapping.csv' -ErrorAction SilentlyContinue)
  foreach ($f in $files) {
    try {
      foreach ($row in @(Import-Csv -LiteralPath $f.FullName)) {
        $rowBrand = Normalize-Keyword -kw ([string]$row.brand)
        $rowWebsite = Normalize-WebsiteIdentity -value ([string]$row.website)
        $rowKeyword = Normalize-Keyword -kw ([string]$row.keyword)
        if ([string]::IsNullOrWhiteSpace($rowKeyword)) { continue }
        if ($rowBrand -ne $brandNorm -or $rowWebsite -ne $websiteNorm) { continue }
        $isSuccess = (
          [string]$row.status -eq 'success' -and
          [string]$row.unifuncs_code -eq '0' -and
          -not [string]::IsNullOrWhiteSpace([string]$row.task_id) -and
          -not [string]::IsNullOrWhiteSpace([string]$row.session_id)
        )
        if (-not $isSuccess) { continue }
        $current = $null
        if ($successMap.ContainsKey($rowKeyword)) { $current = $successMap[$rowKeyword] }
        if ($null -eq $current -or [string]$row.updated_at -gt [string]$current.updated_at) {
          $successMap[$rowKeyword] = [pscustomobject][ordered]@{
            brand = [string]$row.brand
            website = [string]$row.website
            keyword = [string]$row.keyword
            task_id = [string]$row.task_id
            session_id = [string]$row.session_id
            status = [string]$row.status
            unifuncs_code = [string]$row.unifuncs_code
            publish_url = [string]$row.publish_url
            updated_at = [string]$row.updated_at
          }
        }
      }
    } catch {}
  }
  return $successMap
}

function Merge-PseoNote([string]$existingNotes, [object]$pseoRow) {
  $prefix = 'pseo_sync:'
  $parts = @()
  foreach ($segment in @(([string]$existingNotes -split ';'))) {
    $trimmed = [string]$segment
    if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
    $trimmed = $trimmed.Trim()
    if ($trimmed -like ($prefix + '*')) { continue }
    $parts += $trimmed
  }
  $syncNote = ($prefix + 'status=success,task_id=' + [string]$pseoRow.task_id + ',session_id=' + [string]$pseoRow.session_id)
  if (-not [string]::IsNullOrWhiteSpace([string]$pseoRow.publish_url)) {
    $syncNote += (',publish_url=' + [string]$pseoRow.publish_url)
  }
  $parts += $syncNote
  return ($parts -join '; ')
}

function Apply-PseoSuccessAlignment([object[]]$rows, [string]$mappingRoot, [string]$brandValue, [string]$websiteValue) {
  $successRows = Get-PseoSuccessRows -mappingRoot $mappingRoot -brandValue $brandValue -websiteValue $websiteValue
  $aligned = @()
  $matched = 0
  $changed = 0
  foreach ($row in @($rows)) {
    $kwNorm = Normalize-Keyword -kw ([string]$row.keyword)
    $updatedRow = $row
    if (-not [string]::IsNullOrWhiteSpace($kwNorm) -and $successRows.ContainsKey($kwNorm)) {
      $matched++
      $pseoRow = $successRows[$kwNorm]
      $nextNotes = Merge-PseoNote -existingNotes ([string]$row.notes) -pseoRow $pseoRow
      $updatedRow = [pscustomobject]@{}
      foreach ($prop in $row.PSObject.Properties) {
        $updatedRow | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value
      }
      $updatedRow.status = 'finish'
      $updatedRow.content_status = 'article_exists'
      $updatedRow.publish_status = 'published'
      $updatedRow.data_status = 'synced_from_pseo'
      $updatedRow.notes = $nextNotes
      $shouldChange = (
        [string]$row.status -ne [string]$updatedRow.status -or
        [string]$row.content_status -ne [string]$updatedRow.content_status -or
        [string]$row.publish_status -ne [string]$updatedRow.publish_status -or
        [string]$row.data_status -ne [string]$updatedRow.data_status -or
        [string]$row.notes -ne [string]$updatedRow.notes
      )
      if ($shouldChange) {
        $candidateTimes = @(
          [string]$row.updated_at,
          [string]$pseoRow.updated_at
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        if (@($candidateTimes).Count -gt 0) {
          $updatedRow.updated_at = (@($candidateTimes) | Sort-Object | Select-Object -Last 1)
        }
        $changed++
      }
    }
    $aligned += $updatedRow
  }
  return [pscustomobject]@{
    rows = @($aligned)
    matched = $matched
    changed = $changed
    success_total = $successRows.Count
  }
}

function Order-NichediggerRowsForFeishu([object[]]$rows) {
  if ($null -eq $rows) { return @() }
  $partitioned = @()
  foreach ($row in $rows) {
    $kdValue = Get-NichediggerKdValue -row $row
    $group = if ($kdValue -eq $null) { 'nodata' } elseif ($kdValue -lt 30) { 'low' } else { 'high' }
    $score = if ($null -eq $row.final_score) { 0 } else { [int]$row.final_score }
    $partitioned += [pscustomobject]@{ row = $row; kd = $kdValue; group = $group; final_score = $score }
  }
  $grpLow = $partitioned |
    Where-Object { $_.group -eq 'low' } |
    Sort-Object @{ Expression = { [double]$_.kd }; Ascending = $true }, @{ Expression = { if ($null -eq $_.row.keyword) { '' } else { $_.row.keyword } }; Ascending = $true }
  $grpNoData = $partitioned |
    Where-Object { $_.group -eq 'nodata' } |
    Sort-Object @{ Expression = { $_.final_score }; Descending = $true }, @{ Expression = { if ($null -eq $_.row.keyword) { '' } else { $_.row.keyword } }; Ascending = $true }
  $grpHigh = $partitioned |
    Where-Object { $_.group -eq 'high' } |
    Sort-Object @{ Expression = { [double]$_.kd }; Ascending = $true }, @{ Expression = { if ($null -eq $_.row.keyword) { '' } else { $_.row.keyword } }; Ascending = $true }
  return @($grpLow + $grpNoData + $grpHigh) | ForEach-Object { $_.row }
}

function Sync-KeywordsToFeishu([object[]]$rows, [string]$brandSlug) {
  if (-not $SyncToFeishu) { return [pscustomobject]@{ enabled = $false; reason = "disabled" } }
  $rows = Order-NichediggerRowsForFeishu -rows $rows
  $userHome = [Environment]::GetFolderPath('UserProfile')
  $mappingRoot = Join-Path $userHome ".openclaw\pseo-mappings"
  if ([string]::IsNullOrWhiteSpace($FeishuConfig)) {
    $FeishuConfig = Join-Path $mappingRoot "feishu-config.json"
  }
  if (-not (Test-Path -LiteralPath $FeishuConfig)) {
    return [pscustomobject]@{ enabled = $true; synced = $false; reason = "missing_feishu_config"; config = $FeishuConfig }
  }
  if ([string]::IsNullOrWhiteSpace($FeishuTableMapPath)) {
    $FeishuTableMapPath = Join-Path $mappingRoot ("brands\" + $brandSlug + "\feishu-table-map.json")
  }
  $cfg = Get-Content -Raw -LiteralPath $FeishuConfig | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$cfg.app_token) -or [string]::IsNullOrWhiteSpace([string]$cfg.app_id) -or [string]::IsNullOrWhiteSpace([string]$cfg.app_secret)) {
    return [pscustomobject]@{ enabled = $true; synced = $false; reason = "invalid_feishu_config" }
  }

  $alignment = Apply-PseoSuccessAlignment -rows $rows -mappingRoot $mappingRoot -brandValue $Brand -websiteValue $Website
  $rows = Order-NichediggerRowsForFeishu -rows $alignment.rows

  $tenant = Get-FeishuTenantToken -appId ([string]$cfg.app_id) -appSecret ([string]$cfg.app_secret)
  $tableName = "nichedigger-" + $brandSlug
  $tableId = Ensure-FeishuTable -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableName $tableName -preferredTableId $FeishuTableId -tableMapPath $FeishuTableMapPath

  $trace = New-NichediggerTraceIds -brandSlug $brandSlug
  $action = $(if ($RestoreOnly) { 'restore' } else { 'sync' })
  $brandStateRoot = Join-Path $OutputDir ".openclaw\nichedigger\$brandSlug"
  $snapshotDir = Join-Path $brandStateRoot "snapshots"
  $stateDir = Join-Path $brandStateRoot "state"
  $eventDir = Join-Path $brandStateRoot "events"
  $backupDir = Join-Path $brandStateRoot "backups"
  Ensure-Directory -path $snapshotDir
  Ensure-Directory -path $stateDir
  Ensure-Directory -path $eventDir
  Ensure-Directory -path $backupDir

  $beforeRows = @(Get-AllFeishuRecords -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId)
  $tableFields = @(Get-FeishuTableFields -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId)
  $beforeSnapshotPath = Join-Path $snapshotDir ("before-" + $trace.run_id + ".json")
  $afterSnapshotPath = Join-Path $snapshotDir ("after-" + $trace.run_id + ".json")
  $targetSnapshotPath = Join-Path $snapshotDir ("target-" + $trace.run_id + ".json")
  $fullBackupPath = Join-Path $backupDir ("full-table-" + $trace.run_id + ".json")
  $historyPath = Join-Path $stateDir "run-history.csv"
  $mappingPath = Join-Path $stateDir "session-mapping.csv"
  $progressPath = Join-Path $stateDir "progress-latest.json"
  $summaryPath = Join-Path $stateDir ("restore-summary-" + $trace.run_id + ".json")
  $eventPath = Join-Path $eventDir "events.jsonl"

  try {
    Export-NichediggerFullTableBackup -path $fullBackupPath -brandSlug $brandSlug -tableId $tableId -trace $trace -action $action -fields $tableFields -rows $beforeRows
    Append-NichediggerEvent -eventPath $eventPath -eventType 'full_backup.complete' -trace $trace -payload @{
      action = $action
      table_name = $tableName
      table_id = $tableId
      backup_path = $fullBackupPath
      field_count = @($tableFields).Count
      record_count = @($beforeRows).Count
    }
  } catch {
    Append-NichediggerEvent -eventPath $eventPath -eventType 'full_backup.failed' -trace $trace -payload @{
      action = $action
      table_name = $tableName
      table_id = $tableId
      backup_path = $fullBackupPath
      error = $_.Exception.Message
    }
    throw
  }

  $primary = Ensure-FeishuFields -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId
  $fieldNames = Get-FeishuFieldNames -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId

  Export-NichediggerFeishuSnapshot -path $beforeSnapshotPath -brandSlug $brandSlug -tableId $tableId -trace $trace -rows $beforeRows -phase 'before'
  Export-NichediggerFeishuSnapshot -path $targetSnapshotPath -brandSlug $brandSlug -tableId $tableId -trace $trace -rows $rows -phase 'target'
  Append-NichediggerEvent -eventPath $eventPath -eventType 'restore.begin' -trace $trace -payload @{
    action = $action
    table_name = $tableName
    table_id = $tableId
    before_total = @($beforeRows).Count
    target_total = @($rows).Count
    restore_only = [bool]$RestoreOnly
    restore_csv = $RestoreCsv
    restore_run_summary = $RestoreRunSummary
    pseo_alignment = @{
      success_total = [int]$alignment.success_total
      matched = [int]$alignment.matched
      changed = [int]$alignment.changed
    }
    full_backup_path = $fullBackupPath
  }

  $deletedDirty = $(if ($RestoreOnly) { 0 } else { Remove-DirtyRowsFromFeishu -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId -brandSlug $brandSlug })
  $deletedStale = Remove-StaleRowsFromFeishu -rows $rows -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId -brandSlug $brandSlug
  $up = Upsert-KeywordRows -rows $rows -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId -primaryFieldName $primary -fieldNames $fieldNames

  $afterRows = @(Get-AllFeishuRecords -tenantToken $tenant -appToken ([string]$cfg.app_token) -tableId $tableId)
  Export-NichediggerFeishuSnapshot -path $afterSnapshotPath -brandSlug $brandSlug -tableId $tableId -trace $trace -rows $afterRows -phase 'after'

  $mappingRows = Save-NichediggerMappingState -mappingPath $mappingPath -currentRows $rows -trace $trace -action $action -tableId $tableId
  Append-NichediggerRunHistory -historyPath $historyPath -rows $rows -trace $trace -eventName 'feishu_write' -action $action
  Write-NichediggerProgressSnapshot -snapshotPath $progressPath -mappingPath $mappingPath -allRows $mappingRows -brandValue $Brand -websiteValue $Website -trace $trace -actionValue $action

  $diffSummary = Get-NichediggerDiffSummary -beforeRows $beforeRows -afterRows $afterRows -targetRows $rows
  $restoreSummary = [ordered]@{
    generated_at = (Get-Date).ToString('s')
    action = $action
    restore_only = [bool]$RestoreOnly
    brand = $Brand
    brand_slug = $brandSlug
    website = $Website
    table_name = $tableName
    table_id = $tableId
    trace = $trace
    restore_sources = [ordered]@{
      csv = $RestoreCsv
      run_summary = $RestoreRunSummary
    }
    snapshots = [ordered]@{
      before = $beforeSnapshotPath
      target = $targetSnapshotPath
      after = $afterSnapshotPath
    }
    backups = [ordered]@{
      full_table = $fullBackupPath
    }
    state_files = [ordered]@{
      mapping = $mappingPath
      history = $historyPath
      progress = $progressPath
      events = $eventPath
    }
    pseo_alignment = [ordered]@{
      success_total = [int]$alignment.success_total
      matched = [int]$alignment.matched
      changed = [int]$alignment.changed
    }
    feishu_sync = [ordered]@{
      deleted_dirty = $deletedDirty
      deleted_stale = $deletedStale
      created = $up.created
      updated = $up.updated
      total = $up.total
    }
    diff = $diffSummary
  }
  Save-NichediggerJson -path $summaryPath -data $restoreSummary
  Append-NichediggerEvent -eventPath $eventPath -eventType 'restore.complete' -trace $trace -payload @{
    action = $action
    summary_path = $summaryPath
    full_backup_path = $fullBackupPath
    pseo_alignment = @{
      success_total = [int]$alignment.success_total
      matched = [int]$alignment.matched
      changed = [int]$alignment.changed
    }
    diff = $diffSummary
    feishu_sync = @{
      deleted_dirty = $deletedDirty
      deleted_stale = $deletedStale
      created = $up.created
      updated = $up.updated
      total = $up.total
    }
  }

  return [pscustomobject]@{
    enabled = $true
    synced = $true
    table_name = $tableName
    table_id = $tableId
    deleted_dirty = $deletedDirty
    deleted_stale = $deletedStale
    created = $up.created
    updated = $up.updated
    total = $up.total
    action = $action
    restore_summary = $summaryPath
    full_table_backup = $fullBackupPath
    before_snapshot = $beforeSnapshotPath
    after_snapshot = $afterSnapshotPath
    target_snapshot = $targetSnapshotPath
    mapping_state = $mappingPath
    progress_snapshot = $progressPath
    event_log = $eventPath
    pseo_alignment = [pscustomobject]@{
      success_total = [int]$alignment.success_total
      matched = [int]$alignment.matched
      changed = [int]$alignment.changed
    }
    diff = $diffSummary
  }
}

if (-not $RestoreOnly) {
  if ([string]::IsNullOrWhiteSpace($StrategyFile)) {
    $StrategyFile = Join-Path $PSScriptRoot ("..\..\..\workspace\seo-strategy\brands\" + (Get-SafeSlug -value $Brand) + "\" + (Get-SafeSlug -value $Brand) + "-seo-strategy.md")
  }
  $StrategyFile = [System.IO.Path]::GetFullPath($StrategyFile)
  if (-not (Test-Path -LiteralPath $StrategyFile)) {
    throw "strategy file not found: $StrategyFile"
  }
} elseif (-not [string]::IsNullOrWhiteSpace($StrategyFile)) {
  $StrategyFile = [System.IO.Path]::GetFullPath($StrategyFile)
}

$brandSlug = Get-SafeSlug -value $Brand
$profile = Get-PositioningProfile -brandSlug $brandSlug -inputProfile $PositioningProfile
$brandContextDir = Join-Path $PSScriptRoot ("..\..\..\workspace\brand-marketing-context\brands\" + $brandSlug)
$brandContextFile = Join-Path $brandContextDir "context.md"
if (-not (Test-Path -LiteralPath $brandContextFile)) {
  throw "Missing brand context file: $brandContextFile"
}
$null = Get-Content -LiteralPath $brandContextFile -TotalCount 1
if ([string]::IsNullOrWhiteSpace($StrategyFile) -or -not (Test-Path -LiteralPath $StrategyFile)) {
  throw "Missing strategy file: $StrategyFile"
}
$null = Get-Content -LiteralPath $StrategyFile -TotalCount 1
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $PSScriptRoot ("..\..\..\workspace\keyword-mining\" + $brandSlug)
}

if ($UpdateMaintenance) {
  if ([string]::IsNullOrWhiteSpace($MaintenanceExistingCsv)) {
    $MaintenanceExistingCsv = Join-Path $OutputDir "keywords-top200.csv"
  }
  if ([string]::IsNullOrWhiteSpace($MaintenancePoolCsv)) {
    $MaintenancePoolCsv = Join-Path $OutputDir "keywords-candidates.csv"
  }
  $MaintenanceExistingCsv = [System.IO.Path]::GetFullPath($MaintenanceExistingCsv)
  $MaintenancePoolCsv = [System.IO.Path]::GetFullPath($MaintenancePoolCsv)
  if (-not (Test-Path -LiteralPath $MaintenanceExistingCsv)) {
    throw "UpdateMaintenance requires existing keywords csv: $MaintenanceExistingCsv"
  }
  if (-not (Test-Path -LiteralPath $MaintenancePoolCsv)) {
    throw "UpdateMaintenance requires candidate pool csv: $MaintenancePoolCsv"
  }

  $maintenanceDir = Join-Path $OutputDir "maintenance"
  $maintainerScript = Join-Path $PSScriptRoot "..\..\..\scripts\nichedigger-update-maintainer.ps1"
  $maintenanceJson = & $maintainerScript `
    -ExistingCsv $MaintenanceExistingCsv `
    -PoolCsv $MaintenancePoolCsv `
    -OutputDir $maintenanceDir `
    -DesiredCount $MaintenanceDesiredCount `
    -MinVolume $MaintenanceMinVolume `
    -MaxKd $MaintenanceMaxKd | Out-String
  $maintenance = $maintenanceJson | ConvertFrom-Json
  $targetCsv = [string]$maintenance.output_files.target_csv
  if ([string]::IsNullOrWhiteSpace($targetCsv) -or -not (Test-Path -LiteralPath $targetCsv)) {
    throw "UpdateMaintenance did not produce target csv."
  }

  $targetRows = @(Import-Csv -LiteralPath $targetCsv)
  $topPath = Join-Path $OutputDir "keywords-top200.csv"
  $summaryPath = Join-Path $OutputDir "run-summary.json"
  $targetRows | Export-Csv -LiteralPath $topPath -NoTypeInformation -Encoding UTF8

  $feishuResult = Sync-KeywordsToFeishu -rows $targetRows -brandSlug $brandSlug

  [ordered]@{
    bundle = "nichedigger"
    brand = $Brand
    website = $Website
    brand_context_file = $brandContextFile
    strategy_file = $StrategyFile
    output_dir = $OutputDir
    scoring_mode = "update-maintenance"
    update_maintenance = $true
    maintenance = $maintenance
    top_n = @($targetRows).Count
    feishu_sync = $feishuResult
    output_files = [ordered]@{
      top200 = $topPath
      maintenance_dir = $maintenanceDir
      audit_csv = [string]$maintenance.output_files.audit_csv
      replacement_plan_csv = [string]$maintenance.output_files.replacement_plan_csv
      target_csv = $targetCsv
      maintenance_summary = [string]$maintenance.output_files.summary_json
      restore_summary = $(if ($feishuResult.PSObject.Properties.Name -contains 'restore_summary') { [string]$feishuResult.restore_summary } else { "" })
    }
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

  [ordered]@{
    success = $true
    bundle = "nichedigger"
    brand = $Brand
    output_dir = $OutputDir
    update_maintenance = $true
    feishu_sync = $feishuResult
    top200_file = $topPath
    summary_file = $summaryPath
    maintenance_summary = [string]$maintenance.output_files.summary_json
  } | ConvertTo-Json -Depth 8
  return
}

function Get-EstimatedMonthlyViews([object]$reviewRow, [int]$score) {
  if ($null -ne $reviewRow) {
    if ($reviewRow.PSObject.Properties.Name -contains 'search_volume' -and "$($reviewRow.search_volume)" -ne "") {
      return [int]([double]$reviewRow.search_volume)
    }
    # In DFS mode, missing volume should stay as 0 instead of heuristic guessing.
    return 0
  }
  if ($score -ge 32) { return 3000 }
  if ($score -ge 24) { return 1500 }
  if ($score -ge 16) { return 700 }
  if ($score -ge 10) { return 250 }
  return 80
}

function Get-DataSource([object]$reviewRow) {
  if ($null -eq $reviewRow) { return "" }
  $svs = [string]$reviewRow.search_volume_source
  $kds = [string]$reviewRow.kd_source
  if ($svs -like "semrush*" -or $kds -like "semrush*") { return "semrush" }
  if ($svs -like "dataforseo*" -or $kds -like "dataforseo*") { return "dataforseo" }
  return ""
}

function Get-FinalScore([int]$baseScore, [int]$views, [object]$kd) {
  $volumeScore = 0
  if ($views -ge 100000) { $volumeScore = 40 }
  elseif ($views -ge 50000) { $volumeScore = 34 }
  elseif ($views -ge 10000) { $volumeScore = 28 }
  elseif ($views -ge 5000) { $volumeScore = 22 }
  elseif ($views -ge 1000) { $volumeScore = 16 }
  elseif ($views -ge 200) { $volumeScore = 12 }
  elseif ($views -ge 50) { $volumeScore = 8 }
  elseif ($views -ge 10) { $volumeScore = 4 }

  $kdScore = 8
  if ($null -ne $kd -and "$kd" -ne "") {
    $k = [double]$kd
    if ($k -le 10) { $kdScore = 20 }
    elseif ($k -le 20) { $kdScore = 16 }
    elseif ($k -le 30) { $kdScore = 12 }
    elseif ($k -le 45) { $kdScore = 8 }
    elseif ($k -le 60) { $kdScore = 4 }
    else { $kdScore = 0 }
  }

  $final = [int][Math]::Round(($baseScore * 0.6) + $volumeScore + $kdScore)
  if ($final -lt 1) { $final = 1 }
  if ($final -gt 100) { $final = 100 }
  return $final
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

if ($RestoreOnly) {
  $restoreRows = Resolve-NichediggerRestoreRows -restoreCsvPath $RestoreCsv -restoreRunSummaryPath $RestoreRunSummary -brandSlug $brandSlug -brandName $Brand -websiteValue $Website
  if ($restoreRows.Count -gt 0) {
    $restoreWebsite = [string]$restoreRows[0].website
    if (-not [string]::IsNullOrWhiteSpace($restoreWebsite)) {
      $Website = $restoreWebsite
    }
  }

  $restoreTopPath = Join-Path $OutputDir "keywords-top200.csv"
  $restoreSummaryPath = Join-Path $OutputDir "run-summary.json"
  $restoreRows | Export-Csv -LiteralPath $restoreTopPath -NoTypeInformation -Encoding UTF8
  $feishuResult = Sync-KeywordsToFeishu -rows $restoreRows -brandSlug $brandSlug

  [ordered]@{
    bundle = "nichedigger"
    brand = $Brand
    website = $Website
    brand_context_file = $brandContextFile
    strategy_file = $StrategyFile
    output_dir = $OutputDir
    scoring_mode = $(if (-not [string]::IsNullOrWhiteSpace($RestoreRunSummary) -and (Test-Path -LiteralPath $RestoreRunSummary)) { try { ([string]((Get-Content -Raw -LiteralPath $RestoreRunSummary | ConvertFrom-Json).scoring_mode)) } catch { "restore-only" } } else { "restore-only" })
    restore_only = $true
    restore_sources = [ordered]@{
      csv = $RestoreCsv
      run_summary = $RestoreRunSummary
    }
    top_n = @($restoreRows).Count
    feishu_sync = $feishuResult
    output_files = [ordered]@{
      top200 = $restoreTopPath
      restore_summary = $feishuResult.restore_summary
    }
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $restoreSummaryPath -Encoding UTF8

  [ordered]@{
    success = $true
    bundle = "nichedigger"
    brand = $Brand
    output_dir = $OutputDir
    restore_only = $true
    feishu_sync = $feishuResult
    top200_file = $restoreTopPath
    summary_file = $restoreSummaryPath
  } | ConvertTo-Json -Depth 8
  return
}

$seedKeywords = Get-StrategyKeywords -path $StrategyFile
$autoCompetitors = Get-AutoCompetitors -keywords $seedKeywords -brandName $Brand -strategyPath $StrategyFile
$expandedKeywords = Expand-ByCompetitors -competitors $autoCompetitors -brandName $Brand -profile $profile
$neutralSiteCompare = @()
if ($profile -eq "neutral_research") {
  $neutralSiteCompare = Get-NeutralSiteComparisonKeywords -brandName $Brand
}
$allCandidates = Unique-Items -items @($seedKeywords + $expandedKeywords + $neutralSiteCompare)
$filteredCandidates = @(
  $allCandidates |
    Where-Object { Is-CleanKeyword -kw $_ } |
    Where-Object { Pass-PositioningGuard -kw $_ -profile $profile -brandName $Brand }
)
# Control external API cost: score only a bounded candidate pool.
if ($MaxExternalScorerCandidates -gt 0 -and $filteredCandidates.Count -gt $MaxExternalScorerCandidates) {
  $filteredCandidates = @($filteredCandidates | Select-Object -First $MaxExternalScorerCandidates)
}

$reviewerMap = @{}
$scoringMode = "heuristic"
$dfsError = ""
$semrushError = ""
$semrushUsed = $false
$semrushDatabase = Resolve-SemrushDatabase -Loc $LocationCode
$dfsLogin = $env:DATAFORSEO_LOGIN
$dfsPassword = $env:DATAFORSEO_PASSWORD
$semrushKey = $env:SEMRUSH_API_KEY
if ([string]::IsNullOrWhiteSpace($dfsLogin)) { $dfsLogin = [Environment]::GetEnvironmentVariable("DATAFORSEO_LOGIN", "User") }
if ([string]::IsNullOrWhiteSpace($dfsPassword)) { $dfsPassword = [Environment]::GetEnvironmentVariable("DATAFORSEO_PASSWORD", "User") }
if ([string]::IsNullOrWhiteSpace($semrushKey)) { $semrushKey = [Environment]::GetEnvironmentVariable("SEMRUSH_API_KEY", "User") }
if ($SemrushOnly -and [string]::IsNullOrWhiteSpace($semrushKey)) {
  throw "SemrushOnly mode requires SEMRUSH_API_KEY."
}
if ($SemrushOnly) {
  $dfsLogin = ""
  $dfsPassword = ""
}
$canRunExternalScorer = (-not $SkipDataForSEO) -and (
  -not [string]::IsNullOrWhiteSpace($semrushKey) -or
  (-not [string]::IsNullOrWhiteSpace($dfsLogin) -and -not [string]::IsNullOrWhiteSpace($dfsPassword))
)
if ($canRunExternalScorer) {
  try {
    $env:DATAFORSEO_LOGIN = $dfsLogin
    $env:DATAFORSEO_PASSWORD = $dfsPassword
    $env:SEMRUSH_API_KEY = $semrushKey
    $kwFile = Join-Path $OutputDir "keywords-input.txt"
    Set-Content -LiteralPath $kwFile -Value ($filteredCandidates -join "`n") -Encoding UTF8
    $reviewerScript = Join-Path $PSScriptRoot "..\..\..\scripts\keyword-value-reviewer\classify-keywords-dataforseo.ps1"
    $jsonText = & $reviewerScript -File $kwFile -KdCutoff $KdCutoff -LocationCode $LocationCode -LanguageCode $LanguageCode -FallbackLocationCodes $FallbackLocationCodes -SemrushOnly:$SemrushOnly 2>$null | Out-String
    $obj = $jsonText | ConvertFrom-Json
    if ($null -ne $obj -and $obj.results) {
      foreach ($r in $obj.results) { $reviewerMap[[string]$r.keyword] = $r }
      if ($obj.PSObject.Properties.Name -contains "semrush" -and $null -ne $obj.semrush) {
        if ($obj.semrush.PSObject.Properties.Name -contains "used") { $semrushUsed = [bool]$obj.semrush.used }
        if ($obj.semrush.PSObject.Properties.Name -contains "database" -and -not [string]::IsNullOrWhiteSpace([string]$obj.semrush.database)) {
          $semrushDatabase = [string]$obj.semrush.database
        }
        if ($obj.semrush.PSObject.Properties.Name -contains "error" -and -not [string]::IsNullOrWhiteSpace([string]$obj.semrush.error)) {
          $semrushError = [string]$obj.semrush.error
        }
      }
      if ($obj.PSObject.Properties.Name -contains "semrush" -and $obj.semrush.used -eq $true) {
        if ($SemrushOnly) {
          $scoringMode = "heuristic+semrush-only"
        } else {
        $scoringMode = "heuristic+semrush+dataforseo-fallback"
        }
      } else {
        $scoringMode = "heuristic+dataforseo-fallback"
      }
    }
  } catch {
    if ($SemrushOnly) { throw }
    $scoringMode = "heuristic"
    $dfsError = $_.Exception.Message
  }
}

$rows = @()
$now = (Get-Date).ToString("s")
foreach ($kw in $filteredCandidates) {
  if (-not (Is-CleanKeyword -kw $kw)) { continue }
  if (-not (Pass-PositioningGuard -kw $kw -profile $profile -brandName $Brand)) { continue }
  $line = Get-StrategyLine -kw $kw -brandName $Brand -competitors $autoCompetitors -profile $profile
  $intentType = Get-IntentType -kw $kw -brandName $Brand -profile $profile
  $entity = Get-PrimaryEntity -kw $kw -brandName $Brand -competitors $autoCompetitors
  $intentScore = Get-IntentScore -kw $kw -brandName $Brand -competitors $autoCompetitors -profile $profile
  $brandScore = Get-BrandScore -kw $kw -brandName $Brand -strategyLine $line -profile $profile
  $gapScore = Get-GapScore -kw $kw -competitors $autoCompetitors
  $kd = $null
  $label = ""
  $estMonthly = $null
  $dataSource = "heuristic"
  $semrushVolume = $null
  $semrushKd = $null
  $semrushCompetition = $null
  $kdScore = Get-HeuristicKdScore -kw $kw -intentType $intentType
  if ($reviewerMap.ContainsKey($kw)) {
    $r = $reviewerMap[$kw]
    $label = [string]$r.label
    $dataSource = Get-DataSource -reviewRow $r
    if ($r.PSObject.Properties.Name -contains "kd" -and $null -ne $r.kd -and "$($r.kd)" -ne "") {
      $kd = [double]$r.kd
      $kdScore = [Math]::Max(0, 40 - [int]$kd)
    } else {
      $kdScore = 12
    }
    $estMonthly = Get-EstimatedMonthlyViews -reviewRow $r -score 0
    if ($r.PSObject.Properties.Name -contains "search_volume_source" -and [string]$r.search_volume_source -like "semrush*") {
      $semrushVolume = $r.search_volume
      if ($r.PSObject.Properties.Name -contains "competition_index" -and "$($r.competition_index)" -ne "") {
        $semrushCompetition = $r.competition_index
      }
    }
    if ($r.PSObject.Properties.Name -contains "kd_source" -and [string]$r.kd_source -like "semrush*") {
      $semrushKd = $r.kd
    }
  }
  $score = Get-WeightedScore -line $line -intentScore $intentScore -kdScore $kdScore -brandScore $brandScore -gapScore $gapScore -profile $profile
  if ($null -eq $estMonthly) {
    $estMonthly = Get-EstimatedMonthlyViews -reviewRow $null -score $score
  }
  $finalScore = Get-FinalScore -baseScore $score -views ([int]$estMonthly) -kd $kd
  $keywordKey = Get-NichediggerKeywordKey -brandSlug $brandSlug -website $Website -keyword $kw
  if ([string]::IsNullOrWhiteSpace($keywordKey)) {
    $keywordKey = ($brandSlug + "|" + $kw.ToLowerInvariant())
  }
  $rows += [pscustomobject]@{
    keyword_key = $keywordKey
    brand = $Brand
    website = $Website
    keyword = $kw
    data_source = $dataSource
    semrush_volume = $semrushVolume
    semrush_kd = $semrushKd
    semrush_competition = $semrushCompetition
    final_score = [int]$finalScore
    cn_translation = ""
    strategy_line = $line
    intent_type = $intentType
    entity = $entity
    score = [int]$score
    intent_score = [int]$intentScore
    kd_score = [int]$kdScore
    brand_score = [int]$brandScore
    gap_score = [int]$gapScore
    kd = $kd
    reviewer_label = $label
    scoring_mode = $scoringMode
    est_monthly_views = [int]$estMonthly
    status = "mined"
    content_status = "todo"
    publish_status = "todo"
    data_status = "pending"
    auto_competitors = ($autoCompetitors -join ", ")
    updated_at = $now
    notes = ""
  }
}

$sorted = @(
  $rows |
    Sort-Object @{ Expression = { [int]$_.final_score }; Descending = $true }, @{ Expression = { [int]$_.est_monthly_views }; Descending = $true }, @{ Expression = { $_.keyword }; Descending = $false }
)
$selected = @()
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($r in $sorted) {
  $k = ([string]$r.intent_type + "|" + [string]$r.entity)
  if ($seen.Add($k)) {
    $selected += $r
  }
  if ($selected.Count -ge $TopN) { break }
}
if ($selected.Count -lt $TopN) {
  foreach ($r in $sorted) {
    if ($selected.Count -ge $TopN) { break }
    $exists = $false
    foreach ($x in $selected) {
      if ([string]$x.keyword -ieq [string]$r.keyword) { $exists = $true; break }
    }
    if (-not $exists) { $selected += $r }
  }
}
$top = @($selected | Select-Object -First $TopN)

if ($profile -eq "game_scene") {
  $zeroRows = @($top | Where-Object { [int]$_.est_monthly_views -le 0 })
  if ($zeroRows.Count -gt 0) {
    $existingKeywords = @($rows | Select-Object -ExpandProperty keyword)
    $backfillHits = Get-GameSceneBackfillKeywords -NeedCount $zeroRows.Count -ExistingKeywords $existingKeywords -Loc $LocationCode
    if ($backfillHits.Count -gt 0) {
      $backfillKeywords = @($backfillHits | Select-Object -ExpandProperty keyword)
      $backfillMap = @{}
      try {
        $kwFile = Join-Path $OutputDir "keywords-backfill-input.txt"
        Set-Content -LiteralPath $kwFile -Value ($backfillKeywords -join "`n") -Encoding UTF8
        $reviewerScript = Join-Path $PSScriptRoot "..\..\..\scripts\keyword-value-reviewer\classify-keywords-dataforseo.ps1"
        $jsonText = & $reviewerScript -File $kwFile -KdCutoff $KdCutoff -LocationCode $LocationCode -LanguageCode $LanguageCode -FallbackLocationCodes $FallbackLocationCodes -SemrushOnly:$SemrushOnly 2>$null | Out-String
        $obj = $jsonText | ConvertFrom-Json
        if ($null -ne $obj -and $obj.results) {
          foreach ($r in $obj.results) { $backfillMap[[string]$r.keyword] = $r }
        }
      } catch { }

      $backfillRows = @()
      foreach ($kw in $backfillKeywords) {
        $intentType = Get-IntentType -kw $kw -brandName $Brand -profile $profile
        $line = Get-StrategyLine -kw $kw -brandName $Brand -competitors $autoCompetitors -profile $profile
        $entity = Get-PrimaryEntity -kw $kw -brandName $Brand -competitors $autoCompetitors
        $intentScore = Get-IntentScore -kw $kw -brandName $Brand -competitors $autoCompetitors -profile $profile
        $brandScore = Get-BrandScore -kw $kw -brandName $Brand -strategyLine $line -profile $profile
        $gapScore = Get-GapScore -kw $kw -competitors $autoCompetitors
        $kdScore = Get-HeuristicKdScore -kw $kw -intentType $intentType
        $kd = $null
        $label = ""
        $estMonthly = 0
        $dataSource = "semrush"
        $semrushVolume = $null
        $semrushKd = $null
        $semrushCompetition = $null
        if ($backfillMap.ContainsKey($kw)) {
          $rv = $backfillMap[$kw]
          $label = [string]$rv.label
          $dataSource = Get-DataSource -reviewRow $rv
          if ($rv.PSObject.Properties.Name -contains "kd" -and "$($rv.kd)" -ne "") {
            $kd = [double]$rv.kd
            $kdScore = [Math]::Max(0, 40 - [int]$kd)
          }
          $estMonthly = Get-EstimatedMonthlyViews -reviewRow $rv -score 0
          if ($rv.PSObject.Properties.Name -contains "search_volume_source" -and [string]$rv.search_volume_source -like "semrush*") {
            $semrushVolume = $rv.search_volume
            if ($rv.PSObject.Properties.Name -contains "competition_index" -and "$($rv.competition_index)" -ne "") {
              $semrushCompetition = $rv.competition_index
            }
          }
          if ($rv.PSObject.Properties.Name -contains "kd_source" -and [string]$rv.kd_source -like "semrush*") {
            $semrushKd = $rv.kd
          }
        }
        if ([int]$estMonthly -le 0) { continue }
        $baseScore = Get-WeightedScore -line $line -intentScore $intentScore -kdScore $kdScore -brandScore $brandScore -gapScore $gapScore -profile $profile
        $finalScore = Get-FinalScore -baseScore $baseScore -views ([int]$estMonthly) -kd $kd
        $keywordKey = Get-NichediggerKeywordKey -brandSlug $brandSlug -website $Website -keyword $kw
        if ([string]::IsNullOrWhiteSpace($keywordKey)) {
          $keywordKey = ($brandSlug + "|" + $kw.ToLowerInvariant())
        }
        $backfillRows += [pscustomobject]@{
          keyword_key = $keywordKey
          brand = $Brand
          website = $Website
          keyword = $kw
          data_source = $dataSource
          semrush_volume = $semrushVolume
          semrush_kd = $semrushKd
          semrush_competition = $semrushCompetition
          final_score = [int]$finalScore
          cn_translation = ""
          strategy_line = $line
          intent_type = $intentType
          entity = $entity
          score = [int]$baseScore
          intent_score = [int]$intentScore
          kd_score = [int]$kdScore
          brand_score = [int]$brandScore
          gap_score = [int]$gapScore
          kd = $kd
          reviewer_label = $label
          scoring_mode = $scoringMode
          est_monthly_views = [int]$estMonthly
          status = "mined"
          content_status = "todo"
          publish_status = "todo"
          data_status = "pending"
          auto_competitors = ($autoCompetitors -join ", ")
          updated_at = $now
          notes = "semrush_backfill"
        }
      }

      if ($backfillRows.Count -gt 0) {
        $merged = @($top + $backfillRows)
        $top = @(
          $merged |
            Sort-Object @{ Expression = { [int]$_.est_monthly_views }; Descending = $true }, @{ Expression = { [int]$_.final_score }; Descending = $true } |
            Group-Object keyword_key |
            ForEach-Object { $_.Group[0] } |
            Select-Object -First $TopN
        )
      }
    }
  }
}

$competitorPath = Join-Path $OutputDir "competitors-auto.txt"
$candidatePath = Join-Path $OutputDir "keywords-candidates.csv"
$topPath = Join-Path $OutputDir "keywords-top200.csv"
$summaryPath = Join-Path $OutputDir "run-summary.json"

Set-Content -LiteralPath $competitorPath -Value ($autoCompetitors -join "`n") -Encoding UTF8
$sorted | Export-Csv -LiteralPath $candidatePath -NoTypeInformation -Encoding UTF8
$top | Export-Csv -LiteralPath $topPath -NoTypeInformation -Encoding UTF8

$feishuResult = Sync-KeywordsToFeishu -rows $top -brandSlug $brandSlug

[ordered]@{
  bundle = "nichedigger"
  brand = $Brand
  website = $Website
  brand_context_file = $brandContextFile
  strategy_file = $StrategyFile
  output_dir = $OutputDir
  scoring_mode = $scoringMode
  dfs_error = $dfsError
  semrush = [ordered]@{
    used = $semrushUsed
    database = $semrushDatabase
    error = $semrushError
  }
  scoring_profile = ("strategy-aware/" + $profile)
  seed_keywords = @($seedKeywords).Count
  auto_competitors = $autoCompetitors
  candidate_keywords = @($allCandidates).Count
  filtered_candidates = @($filteredCandidates).Count
  top_n = @($top).Count
  feishu_sync = $feishuResult
  output_files = [ordered]@{
    competitors = $competitorPath
    candidates = $candidatePath
    top200 = $topPath
  }
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

[ordered]@{
  success = $true
  bundle = "nichedigger"
  brand = $Brand
  output_dir = $OutputDir
  scoring_mode = $scoringMode
  dfs_error = $dfsError
  semrush = [ordered]@{
    used = $semrushUsed
    database = $semrushDatabase
    error = $semrushError
  }
  scoring_profile = ("strategy-aware/" + $profile)
  auto_competitors = $autoCompetitors
  feishu_sync = $feishuResult
  top200_file = $topPath
  summary_file = $summaryPath
} | ConvertTo-Json -Depth 8

