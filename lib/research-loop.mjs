// Research Loop v3 — Reddit with subreddit discovery, comment mining, multi-sort
// No Bing, no news, no SEO content. Pure real-user conversations.

import { classifyQuery, decideNextAction, extractFacts, isLLMAvailable } from './llm-adapter.mjs';
import { fetchRedditSignals, discoverSubreddits } from './source-adapters.mjs';
import { fetchAndExtract } from './content-extractor.mjs';

const MAX_ITERATIONS = 3;

export async function runResearchLoop(primaryQuery, options = {}) {
  const maxIterations = Number(options.maxIterations || MAX_ITERATIONS);
  const useLLM = isLLMAvailable();

  const findings = {
    query: primaryQuery,
    iterations: [],
    allRedditPosts: [],
    allExtractedFacts: [],
    longTailKeywords: [],
    discoveredSubreddits: [],
    dynamicCompetitors: [],
    llmClassification: null,
    llmAvailable: useLLM,
  };

  // ── Phase 0: Subreddit discovery ──
  const discoveredSubs = await discoverSubreddits(primaryQuery, 8);
  findings.discoveredSubreddits = discoveredSubs;
  const topSubs = discoveredSubs.slice(0, 5).map((s) => s.subreddit);

  if (topSubs.length > 0) {
    process.stderr.write(`[nichedigger] Discovered subreddits: ${topSubs.join(', ')}\n`);
  }

  // ── Phase 1: LLM Query Understanding ──
  const queries = useLLM
    ? await generateRedditQueries(primaryQuery, findings)
    : [primaryQuery];

  // ── Phase 2: Multi-pass Reddit search ──
  // Round 1: Site-wide with multiple sort modes
  const sortModes = ['relevance', 'top'];
  const round1Results = [];
  for (const sort of sortModes) {
    const batch = await searchReddit(queries.slice(0, 3), { sort, limit: 8, fetchComments: true });
    round1Results.push(...batch);
  }
  findings.iterations.push({ round: 1, phase: 'site_wide', queries, sortModes, results: round1Results });
  for (const r of round1Results) {
    if (r.reddit) findings.allRedditPosts.push(...(r.reddit.items || []));
  }

  // Round 2: Subreddit-targeted search in discovered communities
  if (topSubs.length > 0) {
    const subResults = [];
    for (const sub of topSubs) {
      const batch = await searchReddit(queries.slice(0, 2), { subreddit: sub, sort: 'relevance', limit: 8, fetchComments: true });
      subResults.push(...batch);
    }
    findings.iterations.push({ round: 2, phase: 'subreddit_targeted', subreddits: topSubs, results: subResults });
    for (const r of subResults) {
      if (r.reddit) findings.allRedditPosts.push(...(r.reddit.items || []));
    }
  }

  // ── Phase 3: Iterative deepening (LLM decides next angle) ──
  if (useLLM && maxIterations > 1) {
    for (let i = 2; i < maxIterations + 1; i++) {
      const summary = buildFindingsSummary(findings);
      const decision = await decideNextAction({
        query: primaryQuery,
        iteration: i,
        findings: summary,
        maxIterations,
        discoveredSubreddits: topSubs,
      });

      findings.iterations.push({ round: i + 1, phase: 'llm_deepening', decision });

      if (decision.action === 'done' || !decision.query) break;

      // LLM may specify a subreddit to target
      const targetSub = decision.subreddit || null;
      const nextRound = await searchReddit([decision.query], {
        subreddit: targetSub,
        sort: 'relevance',
        limit: 8,
        fetchComments: true,
      });
      for (const r of nextRound) {
        if (r.reddit) findings.allRedditPosts.push(...(r.reddit.items || []));
      }
      findings.iterations[findings.iterations.length - 1].results = nextRound;

      // Extract facts from top Reddit threads
      if (decision.action === 'extract_content' && decision.query) {
        const extracted = await fetchAndExtract(decision.query);
        if (extracted.ok && extracted.text.length > 100) {
          try {
            const facts = await extractFacts(extracted.text, primaryQuery);
            findings.allExtractedFacts.push(...facts);
            findings.iterations[findings.iterations.length - 1].extraction = {
              url: decision.query, title: extracted.title, facts,
            };
          } catch {}
        }
      }
    }
  }

  // ── Phase 4: Extract long-tail keywords from titles + comments ──
  findings.longTailKeywords = extractLongTailKeywords(findings.allRedditPosts, primaryQuery);

  // ── Phase 5: Dynamic competitor discovery ──
  findings.dynamicCompetitors = discoverDynamicCompetitors(findings.allRedditPosts);

  // ── Deduplicate posts by URL ──
  const seen = new Set();
  findings.allRedditPosts = findings.allRedditPosts.filter((p) => {
    const key = p.link || p.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return findings;
}

async function generateRedditQueries(query, findings) {
  try {
    const classification = await classifyQuery(query);
    findings.llmClassification = classification;
    const raw = classification.searchQueries || [query];
    const expanded = [...raw];
    for (const q of raw.slice(0, 2)) {
      expanded.push(`${q} reddit discussion`);
      expanded.push(`best ${q} recommendation`);
    }
    return [...new Set(expanded)].slice(0, 5);
  } catch (error) {
    findings.llmClassification = { error: error.message };
    return [query];
  }
}

async function searchReddit(queries, options = {}) {
  const { subreddit = null, sort = 'relevance', limit = 8, fetchComments = true } = options;
  const results = [];
  for (const query of queries) {
    try {
      const reddit = await fetchRedditSignals(query, {
        limit,
        subreddit,
        sort,
        time: sort === 'new' ? 'month' : 'year',
        fetchComments,
      });
      results.push({
        query,
        reddit: {
          ok: reddit.ok,
          mode: reddit.mode,
          count: reddit.count,
          relevantCount: reddit.relevantCount || 0,
          commentCount: reddit.commentCount || 0,
          topDiscussions: (reddit.topDiscussions || []).map((d) => ({
            title: d.title,
            link: d.link,
            subreddit: d.subreddit,
            score: d.score,
            numComments: d.numComments,
            buyingSignals: d.buyingSignals || [],
            painPoints: d.painPoints || [],
            competitors: d.competitors || [],
            commentCount: (d.comments || []).length,
            commentSnippets: (d.comments || []).slice(0, 2).map((c) => ({
              body: c.body.slice(0, 200),
              score: c.score,
            })),
          })),
          aggregatedSignals: reddit.aggregatedSignals,
          stats: reddit.stats,
          items: reddit.items || [],
        },
        searchMeta: { subreddit, sort },
      });
    } catch {
      results.push({ query, reddit: { ok: false, count: 0, items: [] }, searchMeta: { subreddit, sort } });
    }
  }
  return results;
}

// Extract long-tail keywords from post titles AND comment bodies
function extractLongTailKeywords(posts, seedQuery) {
  const keywords = [];

  for (const post of posts) {
    const title = (post.title || '').trim();
    if (!title || title.length < 10) continue;

    // Title patterns
    if (/^(what|how|which|where|why|can you|is there|are there|does anyone)/i.test(title)) {
      keywords.push({ keyword: title.toLowerCase().replace(/[?.!]+$/, ''), source: 'reddit_question', score: post.score || 0 });
    }

    const bestFor = title.match(/best\s+\w+(?:\s+\w+)?\s+for\s+[\w\s]+/i);
    if (bestFor) keywords.push({ keyword: bestFor[0].toLowerCase(), source: 'reddit_best_for', score: post.score || 0 });

    const vs = title.match(/[\w\s]+\s+vs\.?\s+[\w\s]+/i);
    if (vs && vs[0].length < 80) keywords.push({ keyword: vs[0].toLowerCase().trim(), source: 'reddit_vs', score: post.score || 0 });

    const seeking = title.match(/(?:looking for|need|recommend|suggestions?\s+(?:for|on))\s+[\w\s]+/i);
    if (seeking) keywords.push({ keyword: seeking[0].toLowerCase().trim(), source: 'reddit_seeking', score: post.score || 0 });

    // Pain point long-tails from title
    for (const pp of (post.painPoints || [])) {
      const seed = seedQuery.toLowerCase().split(/\s+/)[0] || '';
      keywords.push({ keyword: `${pp.replace(/_/g, ' ')} ${seed}`, source: 'reddit_pain', score: post.score || 0 });
    }

    // ── NEW: Comment-based long-tail extraction ──
    for (const comment of (post.comments || [])) {
      const body = (comment.body || '').trim();
      if (!body || body.length < 15) continue;

      // "I ended up buying X because..."
      const purchaseReason = body.match(/(?:ended up (?:buying|getting|choosing)|went with|finally bought)\s+[\w\s]+(?:because|since|as)/i);
      if (purchaseReason) {
        keywords.push({ keyword: purchaseReason[0].toLowerCase().split(/because|since|as/i)[0].trim(), source: 'comment_purchase', score: comment.score || 0 });
      }

      // "X is great for Y"
      const greatFor = body.match(/(?:great|perfect|ideal|excellent)\s+(?:for|if you (?:want|need|have))\s+[\w\s]+/i);
      if (greatFor && greatFor[0].length < 80) {
        keywords.push({ keyword: greatFor[0].toLowerCase(), source: 'comment_use_case', score: comment.score || 0 });
      }

      // "compared to X, Y has..."
      const comparison = body.match(/compared to\s+[\w\s]+,\s*[\w\s]+\s+has/i);
      if (comparison && comparison[0].length < 80) {
        keywords.push({ keyword: comparison[0].toLowerCase().slice(0, 60), source: 'comment_comparison', score: comment.score || 0 });
      }

      // Question patterns in comments
      if (/^(anyone know|has anyone|what about|how about|does anyone|can anyone)/i.test(body)) {
        const qText = body.slice(0, 80).replace(/[?.!]+$/, '').toLowerCase();
        keywords.push({ keyword: qText, source: 'comment_question', score: comment.score || 0 });
      }
    }
  }

  const seen = new Set();
  return keywords
    .filter((k) => {
      if (seen.has(k.keyword) || k.keyword.length < 8) return false;
      seen.add(k.keyword);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
}

// Discover competitors from post+comment text dynamically
function discoverDynamicCompetitors(posts) {
  const brandCounts = new Map();
  // Known brand patterns (lowercase)
  const brandPatterns = [
    /\b(lovense|lelo|we-vibe|wevibe|womanizer|satisfyer|dame|svakom|magic\s*wand|hitachi|arousen|pinkpunch|leewow|hakko)\b/gi,
    /\b(tracey\s*cox|lovehoney|ann\s*summers|adam\s*&\s*eve|le\s*wand|bms\s*enterprise|blush\s*novelties)\b/gi,
  ];

  for (const post of posts) {
    const texts = [post.title, post.content, ...(post.comments || []).map((c) => c.body)].filter(Boolean);
    for (const text of texts) {
      for (const pattern of brandPatterns) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(text)) !== null) {
          const brand = match[1].toLowerCase().replace(/\s+/g, ' ');
          brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
        }
      }
    }
  }

  return [...brandCounts.entries()]
    .map(([brand, count]) => ({ brand, mentions: count }))
    .sort((a, b) => b.mentions - a.mentions)
    .filter((b) => b.mentions >= 2);
}

function buildFindingsSummary(findings) {
  const parts = [];
  parts.push(`Reddit posts collected: ${findings.allRedditPosts.length}`);
  parts.push(`Extracted facts: ${findings.allExtractedFacts.length}`);
  parts.push(`Long-tail keywords: ${findings.longTailKeywords.length}`);
  parts.push(`Discovered subreddits: ${findings.discoveredSubreddits.map((s) => `r/${s.subreddit}(${s.relevantPostCount})`).join(', ')}`);
  parts.push(`Dynamic competitors: ${findings.dynamicCompetitors.map((c) => `${c.brand}(${c.mentions}x)`).join(', ')}`);

  const postsWithBuying = findings.allRedditPosts.filter((p) => (p.buyingSignals || []).length > 0);
  const postsWithPain = findings.allRedditPosts.filter((p) => (p.painPoints || []).length > 0);
  parts.push(`Posts with buying signals: ${postsWithBuying.length}`);
  parts.push(`Posts with pain points: ${postsWithPain.length}`);

  // Comment stats
  const totalComments = findings.allRedditPosts.reduce((s, p) => s + (p.comments?.length || 0), 0);
  parts.push(`Comments read: ${totalComments}`);

  const subs = [...new Set(findings.allRedditPosts.map((p) => p.subreddit).filter(Boolean))];
  parts.push(`Unique subreddits: ${subs.slice(0, 15).join(', ')}`);

  const titles = findings.allRedditPosts.slice(0, 5).map((p) => p.title).filter(Boolean);
  if (titles.length > 0) parts.push(`Top posts: ${titles.join(' | ')}`);

  const factTexts = findings.allExtractedFacts.slice(0, 5).map((f) => f.fact || f.snippet).filter(Boolean);
  if (factTexts.length > 0) parts.push(`Facts: ${factTexts.join(' | ')}`);

  return parts.join('\n');
}
