// Content Extractor — fetch HTML, extract readable text, optionally LLM-extract facts
// No Playwright dependency. Uses undici fetch + lightweight HTML-to-text.

const MAX_CONTENT_LENGTH = 8000; // chars sent to LLM

function stripHtml(html) {
  return String(html || '')
    // Remove scripts, styles, nav, footer, header
    .replace(/<(script|style|nav|footer|header|aside|iframe|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Remove all HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMainContent(html) {
  // Try to find <article>, <main>, or <div class="content/post/entry"> first
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return stripHtml(articleMatch[1]);

  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return stripHtml(mainMatch[1]);

  const contentDiv = html.match(/<div[^>]*class="[^"]*(?:content|post|entry|article|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentDiv) return stripHtml(contentDiv[1]);

  // Fallback: strip everything and take body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return stripHtml(bodyMatch[1]);

  return stripHtml(html).slice(0, MAX_CONTENT_LENGTH);
}

export async function fetchAndExtract(url) {
  // Build fetch with proxy support
  let fetchFn;
  try {
    const undici = await import('undici');
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
    fetchFn = proxyUrl
      ? (u, o) => undici.fetch(u, { ...o, dispatcher: new undici.ProxyAgent(proxyUrl) })
      : undici.fetch;
  } catch {
    fetchFn = globalThis.fetch;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, url, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const text = extractMainContent(html);

    return {
      ok: true,
      url,
      title: extractTitle(html),
      text: text.slice(0, MAX_CONTENT_LENGTH),
      length: text.length,
    };
  } catch (error) {
    return { ok: false, url, error: String(error.message || error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractTitle(html) {
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i);
  if (ogTitle) return ogTitle[1];
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  return '';
}

// Extract facts from multiple URLs in parallel, then merge
export async function extractFromUrls(urls, query, { llmAdapter, maxUrls = 3 } = {}) {
  const targetUrls = urls.slice(0, maxUrls);
  const extractions = await Promise.all(targetUrls.map((url) => fetchAndExtract(url)));

  const results = [];
  for (const ext of extractions) {
    if (!ext.ok || ext.text.length < 100) continue;

    const entry = {
      url: ext.url,
      title: ext.title,
      snippet: ext.text.slice(0, 500),
      extractedLength: ext.length,
    };

    // If LLM is available, extract facts
    if (llmAdapter && llmAdapter.isLLMAvailable && llmAdapter.isLLMAvailable()) {
      try {
        const { extractFacts } = await import('./llm-adapter.mjs');
        entry.facts = await extractFacts(ext.text, query);
      } catch {
        entry.facts = [];
      }
    }

    results.push(entry);
  }

  return results;
}
