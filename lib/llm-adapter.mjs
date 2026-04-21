// LLM Adapter — Zhipu GLM via OpenAI-compatible API
// Used for query understanding, iterative research, and content extraction

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'glm-4-flash';
const LLM_TIMEOUT = Number(process.env.LLM_TIMEOUT || 30000);

export function isLLMAvailable() {
  return LLM_API_KEY.length > 10;
}

export async function callLLM({ system, user, jsonMode = false, maxTokens = 1024, temperature = 0.3 }, { timeout: overrideTimeout } = {}) {
  if (!isLLMAvailable()) {
    throw new Error('LLM_API_KEY not configured. Set LLM_API_KEY or ANTHROPIC_API_KEY env var.');
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  if (user) messages.push({ role: 'user', content: user });

  const body = {
    model: LLM_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const timeout = overrideTimeout || LLM_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Try undici fetch first (supports proxy)
    let fetchFn;
    try {
      const undici = await import('undici');
      const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
      fetchFn = proxyUrl ? (url, opts) => undici.fetch(url, { ...opts, dispatcher: new undici.ProxyAgent(proxyUrl) }) : undici.fetch;
    } catch {
      fetchFn = globalThis.fetch;
    }

    const res = await fetchFn(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';

    if (jsonMode) {
      // Try to parse JSON from the response
      try {
        return JSON.parse(content);
      } catch {
        // Try extracting JSON from markdown code block
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) return JSON.parse(jsonMatch[1]);
        throw new Error(`LLM returned non-JSON: ${content.slice(0, 200)}`);
      }
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Query Understanding ──

export async function classifyQuery(query) {
  const result = await callLLM({
    system: `You are a Reddit-focused keyword miner (nichedigger).
Your job: classify the query and generate Reddit search queries that will find REAL user discussions.
Return JSON with exactly these fields:
{
  "primaryIntent": "informational|commercial|transactional|comparison|review|discussion",
  "searchQueries": ["query1", "query2", "query3"],
  "standaloneQuery": "a self-contained version of the query",
  "followUpQueries": ["related query 1", "related query 2"]
}

Rules:
- searchQueries: 2-5 queries optimized for REDDIT search (not Google)
  - Include question forms: "what is the best...", "how to choose..."
  - Include comparison forms: "X vs Y"
  - Include pain point forms: "problem with...", "disappointed by..."
- NEVER use Reddit flair syntax (|flair:xxx) or special operators
- Use plain natural language queries only
- followUpQueries: related queries real users would ask in communities
- Think like a Reddit user, not an SEO
- Be concise, no explanation, just the JSON`,
    user: query,
    jsonMode: true,
    maxTokens: 512,
    temperature: 0.1,
  });
  return result;
}

// ── Impulse Discovery: extract human search impulses from Reddit discussions ──

export async function discoverImpulses(redditDiscussions, topic) {
  const discussionText = redditDiscussions
    .slice(0, 60) // Feed enough posts to get diverse impulses
    .map((p, i) => {
      const parts = [`[${i + 1}] ${p.title || ''}`];
      if (p.content) parts.push(p.content.slice(0, 200));
      if (p.comments && p.comments.length > 0) {
        parts.push('Top comments: ' + p.comments.slice(0, 3).map((c) => c.body.slice(0, 150)).join(' | '));
      }
      return parts.join('\n');
    })
    .join('\n\n');

  const result = await callLLM({
    system: `You are a search psychology analyst. Your job: read Reddit discussions about a topic, identify the UNDERLYING HUMAN IMPULSES that drive people to search, ask, or discuss.

An "impulse" is NOT an SEO intent category (commercial/informational/navigational). It is the raw psychological driver — why a real person opens Google or Reddit and types something. Examples for different niches:
- Vibrators: first-time anxiety, fear of being heard by roommates, "is it worth the price"
- AI tools: fear of job replacement, worry about API price hikes, data privacy concerns
- Gaming: is it worth full price, will it be another half-finished release, which class for beginners

Return JSON:
{
  "impulses": [
    {
      "id": 1,
      "impulse": "一段具体生动的中文描述（10到20个中文字），描述这种搜索冲动背后的心理状态",
      "impulse_en": "English version",
      "description": "2-3 sentences explaining what drives this impulse",
      "keywords": ["5 real ENGLISH search queries a person with this impulse would type into Google or Reddit"]
    }
  ]
}

CRITICAL RULES:
- "impulse" field: 一段完整句子，10-20个中文字。描述具体心理，不能只写两个词。
  - GOOD: "第一次买情趣用品完全不知道选哪个", "住在合租房怕室友听到声音", "花了很多钱怕买回来不好用"
  - BAD: "好奇", "焦虑", "价格敏感", "探索欲望" (字数不够)
  - 如果不够10个字就不要提交这条冲动
- "keywords" field: MUST be in ENGLISH — these are queries typed into Reddit/Google by English-speaking users
- Keywords must be real natural-language queries people would actually type, not SEO phrases
- Example good keyword: "quiet vibrator that roommates can't hear"
- Example bad keyword: "best quiet discreet vibrator 2025" (too SEO-ish)
- Identify 10-20 distinct impulses
- Include impulses across the full emotional spectrum: anxiety, curiosity, desire, frustration, embarrassment, ambition
- Return JSON only, no explanation`,
    user: `Topic: ${topic}\n\nReddit discussions:\n${discussionText.slice(0, 8000)}`,
    jsonMode: true,
    maxTokens: 4096,
    temperature: 0.4,
  },
  { timeout: 120000 }); // 2 minute timeout for impulse discovery

  return result.impulses || [];
}

// ── Fact Extraction from content ──

export async function extractFacts(content, query) {
  const result = await callLLM({
    system: `You are a PSEO research assistant. Extract actionable facts from search results.
Return JSON array of facts:
[
  {"fact": "...", "source": "implicit", "type": "pain_point|buying_signal|preference|trend|objection|recommendation|comparison|price"}
]

Rules:
- Only extract facts relevant to the query topic
- Maximum 10 facts
- Be specific, not generic
- No explanation, just the JSON array`,
    user: `Query: ${query}\n\nContent:\n${content.slice(0, 6000)}`,
    jsonMode: true,
    maxTokens: 1024,
    temperature: 0.1,
  });
  return Array.isArray(result) ? result : (result.facts || []);
}

// ── Research Decision ──

export async function decideNextAction({ query, iteration, findings, maxIterations = 3 }) {
  const done = iteration >= maxIterations;
  const result = await callLLM({
    system: `You are a Reddit-focused research orchestrator (nichedigger).
You ONLY search Reddit for real user discussions. No web search, no news.
Return JSON:
{
  "action": "search_reddit|extract_content|done",
  "query": "optimized Reddit search query, or Reddit thread URL if extract_content, empty if done",
  "reason": "one sentence explaining why"
}

Rules:
- If Reddit posts already cover the topic well with buying signals and pain points, return "done"
- If we haven't found enough real-user discussions, return "search_reddit" with a new angle
- If a specific Reddit thread URL looks promising for deep analysis, return "extract_content" with the URL
- Always think about what REAL USERS would discuss, not what SEO content would say
- Max ${maxIterations} iterations, currently at ${iteration}${done ? ' (MUST return done)' : ''}
- No explanation, just the JSON`,
    user: `Original query: ${query}\nIteration: ${iteration}/${maxIterations}\nFindings so far:\n${JSON.stringify(findings).slice(0, 4000)}`,
    jsonMode: true,
    maxTokens: 256,
    temperature: 0.1,
  });
  return result;
}
