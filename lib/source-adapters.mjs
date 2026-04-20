// Source Adapters v6 — Reddit with subreddit targeting, comment reading, multi-sort, dynamic competitors
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

// Simple stemmer: normalize word forms so vibrator/vibrating/vibrations match
function stem(word) {
  return word
    .replace(/(?:ing|tion|tions|ment|ments|ness|ity|ies|ied|ies|ous|ive|able|ible|ful|less|al|ly|ed|er|est|s)$/, '')
    .replace(/(.)\1$/, '$1'); // double consonant: vibrating → vibrat
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t)).map(stem);
}

function computeRelevance(postText, seedQuery) {
  const postTokens = new Set(tokenize(postText));
  const seedTokens = tokenize(seedQuery).filter((t) => t.length > 2);
  if (seedTokens.length === 0) return 1;
  const overlap = seedTokens.filter((t) => postTokens.has(t)).length;
  return overlap / seedTokens.length;
}

// ── Category → Subreddit hardcoded mapping (fallback when discovery misses) ──
const CATEGORY_SUBREDDITS = {
  // NSFW subreddits can't be searched via JSON API (403), only SFW ones work for restrict_sr
  // For NSFW topics, we rely on site-wide search + aggressive relevance filtering
  vibrator: ['AskWomenNoCensor', 'Marriage', 'relationship_advice', 'AskWomen', 'TwoXChromosomes'],
  sex_toys: ['AskWomenNoCensor', 'Marriage', 'relationship_advice', 'AskWomen'],
  wand: ['Massage', 'AskWomenNoCensor'],
  dildo: ['AskWomenNoCensor', 'Marriage', 'AskWomen'],
  couples: ['relationships', 'Marriage', 'AskWomen', 'relationship_advice'],
  bdsm: ['BDSMcommunity', 'Bondage'],
  lingerie: ['lingerie', 'TwoXChromosomes', 'AskWomen'],
  ai_tool: ['artificial', 'MachineLearning', 'ChatGPT', 'LocalLLaMA'],
  gaming: ['gaming', 'Games', 'NintendoSwitch', 'PS5'],
};

export function guessCategorySubreddits(query) {
  const q = query.toLowerCase();
  const subs = new Set();
  for (const [cat, catSubs] of Object.entries(CATEGORY_SUBREDDITS)) {
    // Check if any category keyword appears in the query
    if (q.includes(cat.replace('_', ' ')) || q.includes(cat.replace('_', ''))) {
      for (const s of catSubs) subs.add(s);
    }
  }
  // Broader matches
  if (/\bvibrat/i.test(q)) { for (const s of CATEGORY_SUBREDDITS.vibrator) subs.add(s); }
  if (/\btoy|toys/i.test(q)) { for (const s of CATEGORY_SUBREDDITS.sex_toys) subs.add(s); }
  if (/\bwand/i.test(q)) { for (const s of CATEGORY_SUBREDDITS.wand) subs.add(s); }
  if (/\bcouple|partner|together/i.test(q)) { for (const s of CATEGORY_SUBREDDITS.couples) subs.add(s); }
  return [...subs];
}

// ── Signal extraction ──

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

// Dynamic competitor discovery: extract brand-like nouns from text
const KNOWN_BRANDS = ['lovense', 'lelo', 'we-vibe', 'womanizer', 'satisfyer', 'dame', 'magic wand', 'hitachi', 'arousen', 'pinkpunch', 'lelo', 'svakom', 'tracey cox', 'lovehoney', 'ann summers'];

function extractCompetitorMentions(text) {
  if (!text) return [];
  return KNOWN_BRANDS.filter((b) => new RegExp(`\\b${b.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text));
}

// ── Comment fetching: read ALL comments, not just top N ──
// Comments are MORE valuable than posts — real purchase decisions, pain points,
// and brand comparisons live in comment threads, not titles.
// Reddit's .json endpoint returns the full comment tree (top-level + replies).

async function fetchAllComments(permalink) {
  try {
    // limit=500 → max comments Reddit will return in one request
    // depth=2 → top-level comments + one level of replies (covers most signal)
    const url = `https://www.reddit.com${permalink}.json?limit=500&sort=top&depth=2`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const res = await rateLimitedFetch(url, {
      headers: { 'User-Agent': 'nichedigger/7.0 (keyword-research)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const data = await res.json();
    // data[1] is the comment listing
    const rawComments = data?.[1]?.data?.children || [];

    // Flatten: extract top-level + reply comments recursively
    const allComments = [];
    function walkCommentTree(node) {
      if (node.kind === 't1' && node.data) {
        const c = node.data;
        if (c.body && c.body !== '[deleted]' && c.body !== '[removed]') {
          allComments.push({
            author: c.author || '',
            body: c.body.slice(0, 1200),
            score: c.score || 0,
            permalink: c.permalink || '',
            depth: c.depth || 0,
          });
        }
        // Walk replies
        const replies = c.replies;
        if (replies && typeof replies === 'object' && replies.data) {
          for (const child of (replies.data.children || [])) {
            walkCommentTree(child);
          }
        }
      }
    }
    for (const raw of rawComments) {
      walkCommentTree(raw);
    }

    return allComments;
  } catch {
    return [];
  }
}

// ── Subreddit discovery: 3-pronged approach ──
// 1. Reddit's /subreddits/search.json — finds communities by name/description
// 2. Post search with multiple query variations — finds communities by activity
// 3. Merge + deduplicate + rank by signal density

export async function discoverSubreddits(query, limit = 10) {
  const subMap = new Map();

  // Prong 1: Reddit's subreddit search API (finds communities by name + description)
  // Use the core noun from the query, not the full query with modifiers like "best"
  const coreTerms = query.toLowerCase()
    .replace(/\b(best|top|good|best\s+for|review|vs|versus|cheap|affordable|under|budget|recommended|alternative|new|buy)\b/g, '')
    .trim() || query;
  try {
    const subSearchURL = `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(coreTerms)}&limit=25`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await rateLimitedFetch(subSearchURL, {
      headers: { 'User-Agent': 'nichedigger/7.0 (keyword-research)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      const subs = (data?.data?.children || []).map((c) => c?.data).filter(Boolean);
      for (const sub of subs) {
        if (!sub.display_name) continue;
        const name = sub.display_name;
        const existing = subMap.get(name.toLowerCase()) || { subreddit: name, count: 0, totalScore: 0, relevantPosts: 0, subscribers: 0, source: [] };
        existing.subscribers = sub.subscribers || 0;
        existing.source.push('subreddit_search');
        // Give bonus for having the query keyword in the subreddit name/description
        const nameDesc = [sub.display_name, sub.title, sub.public_description].filter(Boolean).join(' ').toLowerCase();
        if (computeRelevance(nameDesc, query) >= 0.2) {
          existing.relevantPosts += 5; // strong signal: the subreddit IS about this topic
          existing.source.push('name_match');
        } else {
          // Subreddit search API returns loosely related results — skip if not relevant
          // unless it has very high subscribers (likely a major community)
          if ((sub.subscribers || 0) < 100000) continue;
        }
        subMap.set(name.toLowerCase(), existing);
      }
    }
  } catch (error) {
    process.stderr.write(`[nichedigger] Subreddit search API error: ${error.message}\n`);
  }

  // Prong 2: Post search with multiple query variations to find where people discuss
  const queryVariations = [
    query,                              // original
    `${query} review`,                  // review discussions
    `${query} recommendation`,          // recommendation threads
    `best ${query}`,                    // "best of" threads
  ];

  for (const qVar of queryVariations) {
    try {
      const searchURL = `https://www.reddit.com/search.json?q=${encodeURIComponent(qVar)}&sort=relevance&t=year&limit=50&include_over_18=on`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await rateLimitedFetch(searchURL, {
        headers: { 'User-Agent': 'nichedigger/7.0 (keyword-research)' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) continue;

      const data = await res.json();
      const posts = (data?.data?.children || []).map((c) => c?.data).filter(Boolean);

      for (const post of posts) {
        const sub = post.subreddit;
        if (!sub) continue;
        const key = sub.toLowerCase();
        const existing = subMap.get(key) || { subreddit: sub, count: 0, totalScore: 0, relevantPosts: 0, subscribers: 0, source: [] };
        existing.count++;
        existing.totalScore += (post.score || 0);

        const text = [post.title, post.selftext].filter(Boolean).join(' ');
        if (computeRelevance(text, query) >= 0.3) {
          existing.relevantPosts++;
        }
        if (!existing.source.includes('post_search')) existing.source.push('post_search');
        subMap.set(key, existing);
      }
    } catch {
      // Continue with other variations
    }
  }

  // Rank: prioritize signal density, then subscriber count, then post volume
  return [...subMap.values()]
    .filter((s) => s.relevantPosts >= 1 || s.subscribers >= 1000)
    .map((s) => ({
      ...s,
      avgScore: s.count > 0 ? Math.round(s.totalScore / s.count) : 0,
      signalDensity: s.count > 0 ? s.relevantPosts / s.count : 0,
    }))
    .sort((a, b) => {
      // Primary: relevant posts (actual signal value)
      if (b.relevantPosts !== a.relevantPosts) return b.relevantPosts - a.relevantPosts;
      // Secondary: subscribers (community size = more future content)
      return (b.subscribers || 0) - (a.subscribers || 0);
    })
    .slice(0, limit);
}

// ── Post analysis (with comments) ──

async function analyzeRedditItem(item, seedQuery, fetchComments = false) {
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

  // Irrelevant post: zero out signals
  if (relevance < 0.4) {
    return { ...base, buyingSignals: [], painPoints: [], competitors: [], comments: [] };
  }

  const result = {
    ...base,
    buyingSignals: extractBuyingSignals(text),
    painPoints: extractPainPoints(text),
    competitors: extractCompetitorMentions(text),
    comments: [],
  };

  // Fetch ALL comments for relevant posts — comments carry more signal than titles
  if (fetchComments && item.permalink) {
    const comments = await fetchAllComments(item.permalink);
    result.comments = comments;

    // Merge comment signals (comments weighted 2x — they're more valuable)
    for (const comment of comments) {
      const commentBuying = extractBuyingSignals(comment.body);
      const commentPain = extractPainPoints(comment.body);
      const commentComp = extractCompetitorMentions(comment.body);
      // Add twice to give comment signals more weight in deduped set
      result.buyingSignals.push(...commentBuying, ...commentBuying);
      result.painPoints.push(...commentPain, ...commentPain);
      result.competitors.push(...commentComp);
    }
    result.buyingSignals = [...new Set(result.buyingSignals)];
    result.painPoints = [...new Set(result.painPoints)];
    result.competitors = [...new Set(result.competitors)];
  }

  return result;
}

// ── Reddit: search with subreddit targeting + multi-sort ──

export async function fetchRedditSignals(query, options = {}) {
  const limit = Number(options.limit || 8);
  const subreddit = options.subreddit || null;
  const sort = options.sort || 'relevance';
  const time = options.time || 'year';
  const fetchComments = options.fetchComments !== false; // default true
  const searchId = options.searchId || 'default';

  try {
    let redditURL;
    if (subreddit) {
      // Targeted search within a specific subreddit
      redditURL = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=${sort}&t=${time}&limit=${limit}`;
    } else {
      // Site-wide search
      redditURL = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${time}&limit=${limit}&include_over_18=on`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await rateLimitedFetch(redditURL, {
      headers: { 'User-Agent': 'nichedigger/6.0 (keyword-research)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      const posts = (data?.data?.children || []).map((c) => c?.data).filter(Boolean);
      if (posts.length > 0) {
        const analyzed = [];
        for (const post of posts) {
          const item = await analyzeRedditItem({
            title: post.title,
            url: `https://reddit.com${post.permalink}`,
            selftext: post.selftext,
            content: post.selftext?.slice(0, 500),
            subreddit: post.subreddit,
            score: post.score,
            num_comments: post.num_comments,
            permalink: post.permalink,
          }, query, fetchComments);
          analyzed.push(item);
        }
        return buildRedditSuccess(analyzed, subreddit ? `targeted:${subreddit}` : 'direct_api', sort);
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

function buildRedditSuccess(analyzed, mode, sort) {
  const relevant = analyzed.filter((p) => (p._relevance || 0) >= 0.4);

  // Aggregate subreddit stats
  const subMap = new Map();
  for (const p of relevant) {
    const sub = p.subreddit;
    if (!sub) continue;
    subMap.set(sub, (subMap.get(sub) || 0) + 1);
  }

  // Aggregate comment stats
  const totalComments = analyzed.reduce((s, p) => s + (p.comments?.length || 0), 0);
  const commentBuying = analyzed.reduce((s, p) => s + (p.comments || []).reduce((cs, c) => cs + extractBuyingSignals(c.body).length, 0), 0);
  const commentPain = analyzed.reduce((s, p) => s + (p.comments || []).reduce((cs, c) => cs + extractPainPoints(c.body).length, 0), 0);

  return {
    source: 'reddit',
    ok: true,
    mode,
    sort,
    count: analyzed.length,
    relevantCount: relevant.length,
    commentCount: totalComments,
    items: analyzed,
    topDiscussions: relevant.length > 0 ? relevant.slice(0, 5) : analyzed.slice(0, 3),
    aggregatedSignals: {
      totalBuyingSignals: relevant.reduce((s, i) => s + i.buyingSignals.length, 0),
      totalPainPoints: relevant.reduce((s, i) => s + i.painPoints.length, 0),
      competitorMentions: [...new Set(relevant.flatMap((i) => i.competitors))],
      commentBuyingSignals: commentBuying,
      commentPainPoints: commentPain,
    },
    stats: {
      avgScore: relevant.length > 0 ? Math.round(relevant.reduce((s, p) => s + p.score, 0) / relevant.length) : 0,
      maxScore: relevant.reduce((s, p) => Math.max(s, p.score), 0),
      avgComments: relevant.length > 0 ? Math.round(relevant.reduce((s, p) => s + p.numComments, 0) / relevant.length) : 0,
      subreddits: [...subMap.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 10),
      totalPosts: relevant.length,
      totalBuyingSignals: relevant.reduce((s, i) => s + i.buyingSignals.length, 0),
      totalPainPoints: relevant.reduce((s, i) => s + i.painPoints.length, 0),
    },
  };
}

// ── Orchestrator: multi-pass with subreddit targeting + multi-sort ──

export async function collectLiveSignals(queries, options = {}) {
  const queryLimit = Number(options.queryLimit || 5);
  const perSourceLimit = Number(options.perSourceLimit || 8);
  const subreddits = options.subreddits || []; // e.g. ['SexToys', 'wandvibers']
  const sortModes = options.sortModes || ['relevance']; // e.g. ['relevance', 'top', 'new']
  const fetchComments = options.fetchComments !== false;
  const selectedQueries = queries.slice(0, queryLimit);
  const results = [];
  const seenQueries = new Set();

  // Phase 1: Site-wide search with multiple sort modes
  for (const sort of sortModes) {
    for (const query of selectedQueries) {
      const key = `${query}::${sort}::global`;
      if (seenQueries.has(key)) continue;
      seenQueries.add(key);

      const reddit = await fetchRedditSignals(query, {
        limit: perSourceLimit,
        sort,
        time: sort === 'new' ? 'month' : 'year',
        fetchComments,
        searchId: key,
      });

      const redditEngagementScore = reddit.ok
        ? Math.min(100, (reddit.aggregatedSignals?.totalBuyingSignals || 0) * 15 + (reddit.aggregatedSignals?.totalPainPoints || 0) * 10)
        : 0;

      results.push({
        query,
        reddit,
        googleNews: { source: 'news', ok: false, count: 0, items: [], error: 'disabled' },
        liveSignalScore: redditEngagementScore,
        searchMeta: { sort, subreddit: null },
      });
    }
  }

  // Phase 2: Subreddit-targeted search (if subreddits specified or auto-discovered)
  const targetSubs = [...subreddits];
  if (targetSubs.length > 0) {
    for (const sub of targetSubs.slice(0, 5)) {
      for (const query of selectedQueries.slice(0, 3)) {
        const key = `${query}::relevance::r/${sub}`;
        if (seenQueries.has(key)) continue;
        seenQueries.add(key);

        const reddit = await fetchRedditSignals(query, {
          limit: perSourceLimit,
          subreddit: sub,
          sort: 'relevance',
          time: 'year',
          fetchComments,
          searchId: key,
        });

        const redditEngagementScore = reddit.ok
          ? Math.min(100, (reddit.aggregatedSignals?.totalBuyingSignals || 0) * 15 + (reddit.aggregatedSignals?.totalPainPoints || 0) * 10)
          : 0;

        results.push({
          query,
          reddit,
          googleNews: { source: 'news', ok: false, count: 0, items: [], error: 'disabled' },
          liveSignalScore: redditEngagementScore,
          searchMeta: { sort: 'relevance', subreddit: sub },
        });
      }
    }
  }

  return results;
}
