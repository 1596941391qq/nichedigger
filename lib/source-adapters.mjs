// Source Adapters v5 — Reddit-only with relevance filtering + rate limiting
// nichedigger: mine real user conversations, not SEO soft content.
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const _proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || '';
const _proxyAgent = _proxyUrl ? new ProxyAgent(_proxyUrl) : undefined;

function smartFetch(url, opts = {}) {
  if (_proxyAgent) opts.dispatcher = _proxyAgent;
  return undiciFetch(url, opts);
}

// ── Rate limiter: 1 request per 1.1s to avoid Reddit 429 ──
const _rateLimit = { minInterval: 1100, lastCall: 0 };

async function rateLimitedFetch(url, opts = {}) {
  const elapsed = Date.now() - _rateLimit.lastCall;
  if (elapsed < _rateLimit.minInterval) {
    await new Promise((r) => setTimeout(r, _rateLimit.minInterval - elapsed));
  }
  _rateLimit.lastCall = Date.now();
  const res = await smartFetch(url, opts);
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || 10) * 1000;
    process.stderr.write(`[nichedigger] Reddit rate limited, retrying in ${retryAfter / 1000}s\n`);
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30000)));
    _rateLimit.lastCall = Date.now();
    return smartFetch(url, opts);
  }
  return res;
}

// ── Domain-specific relevance check ──
// Stop words that appear in every Reddit post and carry no topical signal
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'but',
  'or', 'and', 'not', 'no', 'if', 'so', 'up', 'out', 'just', 'that',
  'this', 'it', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'what', 'which', 'who', 'when', 'where', 'how', 'why', 'all', 'any',
  'some', 'more', 'most', 'other', 'than', 'then', 'very', 'too',
  'reddit', 'post', 'thread', 'comment', 'subreddit', 'really', 'like',
  'get', 'got', 'know', 'think', 'want', 'need', 'good', 'best',
  'new', 'one', 'time', 'day', 'year', 'make', 'made',
]);

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function computeRelevance(postText, seedQuery) {
  const postTokens = new Set(tokenize(postText));
  const seedTokens = tokenize(seedQuery).filter((t) => t.length > 2);
  if (seedTokens.length === 0) return 1; // no seed to compare against
  const overlap = seedTokens.filter((t) => postTokens.has(t)).length;
  return overlap / seedTokens.length;
}

// ── Reddit signal extraction ──

function extractBuyingSignals(text) {
  if (!text) return [];
  const signals = [];
  const patterns = [
    { regex: /\b(buying|bought|purchase|ordered|ordering)\b/gi, label: 'purchase_mention' },
    { regex: /\b(considering|thinking about|planning to|want to get|looking to buy)\b/gi, label: 'considering' },
    { regex: /\b(recommend|suggestion|what should i|which one|any advice)\b/gi, label: 'seeking_recommendation' },
    { regex: /\b(worth it|worth the|good investment|money well spent)\b/gi, label: 'value_assessment' },
    { regex: /\b(compare|versus|vs|alternative to|instead of)\b/gi, label: 'comparison_shopping' },
    { regex: /\b(budget|under \$|affordable|cheap|expensive|overpriced)\b/gi, label: 'price_sensitivity' },
    { regex: /\b(partner|girlfriend|boyfriend|wife|husband|gift)\b/gi, label: 'gift_intent' },
  ];
  for (const { regex, label } of patterns) {
    if (regex.test(text)) signals.push(label);
    regex.lastIndex = 0;
  }
  return [...new Set(signals)];
}

function extractPainPoints(text) {
  if (!text) return [];
  const points = [];
  const patterns = [
    { regex: /\b(disappointed|waste|regret|returned|sent back)\b/gi, label: 'buyer_remorse' },
    { regex: /\b(broke|stopped working|defective|malfunction)\b/gi, label: 'quality_issue' },
    { regex: /\b(too loud|too big|too small|uncomfortable|painful)\b/gi, label: 'fit_comfort' },
    { regex: /\b(battery|charging|dies quickly|won't charge)\b/gi, label: 'battery_issue' },
    { regex: /\b(overrated|hyped|not worth|scam)\b/gi, label: 'trust_issue' },
    { regex: /\b(confusing|hard to use|complicated|difficult)\b/gi, label: 'usability_issue' },
    { regex: /\b(noisy|can hear|obvious|embarrassing)\b/gi, label: 'discretion_issue' },
  ];
  for (const { regex, label } of patterns) {
    if (regex.test(text)) points.push(label);
    regex.lastIndex = 0;
  }
  return [...new Set(points)];
}

function extractCompetitorMentions(text) {
  if (!text) return [];
  const brands = ['lovense', 'lelo', 'we-vibe', 'womanizer', 'satisfyer', 'dame', 'magic wand', 'hitachi', 'arousen', 'pinkpunch'];
  return brands.filter((b) => new RegExp(`\\b${b}\\b`, 'i').test(text));
}

function analyzeRedditItem(item, seedQuery) {
  const text = [item.title, item.content, item.selftext].filter(Boolean).join(' ');
  const relevance = computeRelevance(text, seedQuery);

  const base = {
    title: item.title || '',
    link: item.url || item.link || '',
    subreddit: item.subreddit || '',
    score: item.score || 0,
    numComments: item.num_comments || 0,
    content: (item.content || item.selftext || '').slice(0, 500),
    _relevance: relevance,
  };

  // Only extract signals from topically relevant posts (>= 30% token overlap)
  if (relevance >= 0.3) {
    return {
      ...base,
      buyingSignals: extractBuyingSignals(text),
      painPoints: extractPainPoints(text),
      competitors: extractCompetitorMentions(text),
    };
  }

  // Irrelevant post: zero out signals
  return {
    ...base,
    buyingSignals: [],
    painPoints: [],
    competitors: [],
  };
}

// ── Reddit: Direct JSON API only ──

export async function fetchRedditSignals(query, limit = 5) {
  try {
    const redditURL = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=year&limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await rateLimitedFetch(redditURL, {
      headers: { 'User-Agent': 'nichedigger/5.0 (keyword-research)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      const posts = (data?.data?.children || []).map((c) => c?.data).filter(Boolean);
      if (posts.length > 0) {
        const analyzed = posts.map((post) => analyzeRedditItem({
          title: post.title,
          url: `https://reddit.com${post.permalink}`,
          selftext: post.selftext,
          content: post.selftext?.slice(0, 500),
          subreddit: post.subreddit,
          score: post.score,
          num_comments: post.num_comments,
        }, query));
        return buildRedditSuccess(analyzed, 'direct_api');
      }
    }
  } catch (error) {
    process.stderr.write(`[nichedigger] Reddit API error for "${query}": ${error.message || error}\n`);
  }

  return {
    source: 'reddit',
    ok: false,
    count: 0,
    error: 'Reddit API failed (check proxy)',
    items: [],
    topDiscussions: [],
    aggregatedSignals: { totalBuyingSignals: 0, totalPainPoints: 0, competitorMentions: [] },
  };
}

function buildRedditSuccess(analyzed, mode) {
  // Filter to only relevant posts for aggregated signals
  const relevant = analyzed.filter((p) => (p._relevance || 0) >= 0.3);
  return {
    source: 'reddit',
    ok: true,
    mode,
    count: analyzed.length,
    relevantCount: relevant.length,
    items: analyzed,
    topDiscussions: relevant.length > 0 ? relevant.slice(0, 5) : analyzed.slice(0, 3),
    aggregatedSignals: {
      totalBuyingSignals: relevant.reduce((s, i) => s + i.buyingSignals.length, 0),
      totalPainPoints: relevant.reduce((s, i) => s + i.painPoints.length, 0),
      competitorMentions: [...new Set(relevant.flatMap((i) => i.competitors))],
    },
  };
}

// ── Orchestrator (Reddit-only) ──

export async function collectLiveSignals(queries, options = {}) {
  const queryLimit = Number(options.queryLimit || 5);
  const perSourceLimit = Number(options.perSourceLimit || 8);
  const selectedQueries = queries.slice(0, queryLimit);
  const results = [];

  for (const query of selectedQueries) {
    const reddit = await fetchRedditSignals(query, perSourceLimit);

    const redditEngagementScore = reddit.ok
      ? Math.min(100, (reddit.aggregatedSignals?.totalBuyingSignals || 0) * 15 + (reddit.aggregatedSignals?.totalPainPoints || 0) * 10)
      : 0;

    results.push({
      query,
      reddit,
      googleNews: { source: 'news', ok: false, count: 0, items: [], error: 'disabled' },
      liveSignalScore: redditEngagementScore,
    });
  }

  return results;
}
