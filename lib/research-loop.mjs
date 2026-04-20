// Research Loop v2 — Reddit-only agentic research
// No Bing, no news, no SEO content. Pure real-user conversations.

import { classifyQuery, decideNextAction, extractFacts, isLLMAvailable } from './llm-adapter.mjs';
import { fetchRedditSignals } from './source-adapters.mjs';
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
    llmClassification: null,
    llmAvailable: useLLM,
  };

  // ── Phase 1: LLM Query Understanding ──
  const queries = useLLM
    ? await generateRedditQueries(primaryQuery, findings)
    : [primaryQuery];

  // ── Phase 2: Reddit search round ──
  const round1 = await searchReddit(queries.slice(0, 3), 8);
  findings.iterations.push({ round: 1, queries, results: round1 });
  for (const r of round1) {
    if (r.reddit) findings.allRedditPosts.push(...(r.reddit.items || []));
  }

  // ── Phase 3: Iterative deepening (LLM decides next angle) ──
  if (useLLM && maxIterations > 1) {
    for (let i = 1; i < maxIterations; i++) {
      const summary = buildFindingsSummary(findings);
      const decision = await decideNextAction({
        query: primaryQuery,
        iteration: i,
        findings: summary,
        maxIterations,
      });

      findings.iterations.push({ round: i + 1, decision });

      if (decision.action === 'done' || !decision.query) break;

      // Only Reddit searches allowed
      const nextRound = await searchReddit([decision.query], 8);
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

  // ── Phase 4: Extract long-tail keywords from Reddit titles ──
  findings.longTailKeywords = extractLongTailKeywords(findings.allRedditPosts, primaryQuery);

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
    // Generate Reddit-friendly queries: questions, comparisons, discussions
    const raw = classification.searchQueries || [query];
    // Append discussion modifiers for Reddit
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

async function searchReddit(queries, perQueryLimit = 8) {
  const results = [];
  for (const query of queries) {
    try {
      const reddit = await fetchRedditSignals(query, perQueryLimit);
      results.push({
        query,
        reddit: {
          ok: reddit.ok,
          mode: reddit.mode,
          count: reddit.count,
          topDiscussions: (reddit.topDiscussions || []).map((d) => ({
            title: d.title,
            link: d.link,
            subreddit: d.subreddit,
            score: d.score,
            buyingSignals: d.buyingSignals || [],
            painPoints: d.painPoints || [],
            competitors: d.competitors || [],
          })),
          aggregatedSignals: reddit.aggregatedSignals,
          items: reddit.items || [],
        },
      });
    } catch {
      results.push({ query, reddit: { ok: false, count: 0, items: [] } });
    }
  }
  return results;
}

function extractLongTailKeywords(posts, seedQuery) {
  const keywords = [];
  const seedTokens = new Set(seedQuery.toLowerCase().split(/\s+/));

  for (const post of posts) {
    const title = (post.title || '').trim();
    if (!title || title.length < 10) continue;

    // Extract question-style long-tails: "what is the best...", "how to..."
    if (/^(what|how|which|where|why|can you|is there|are there|does anyone)/i.test(title)) {
      keywords.push({ keyword: title.toLowerCase().replace(/[?.!]+$/, ''), source: 'reddit_question', score: post.score || 0 });
    }

    // Extract "best X for Y" patterns
    const bestFor = title.match(/best\s+\w+(?:\s+\w+)?\s+for\s+[\w\s]+/i);
    if (bestFor) {
      keywords.push({ keyword: bestFor[0].toLowerCase(), source: 'reddit_best_for', score: post.score || 0 });
    }

    // Extract "X vs Y" patterns
    const vs = title.match(/[\w\s]+\s+vs\.?\s+[\w\s]+/i);
    if (vs && vs[0].length < 80) {
      keywords.push({ keyword: vs[0].toLowerCase().trim(), source: 'reddit_vs', score: post.score || 0 });
    }

    // Extract "looking for X" / "need X" / "recommend X"
    const seeking = title.match(/(?:looking for|need|recommend|suggestions?\s+(?:for|on))\s+[\w\s]+/i);
    if (seeking) {
      keywords.push({ keyword: seeking[0].toLowerCase().trim(), source: 'reddit_seeking', score: post.score || 0 });
    }

    // Extract pain point phrases
    for (const pp of (post.painPoints || [])) {
      if (post.title) {
        keywords.push({ keyword: `${pp.replace(/_/g, ' ')} ${seedTokens.values().next().value || ''}`, source: 'reddit_pain', score: post.score || 0 });
      }
    }
  }

  // Deduplicate and rank
  const seen = new Set();
  return keywords
    .filter((k) => {
      if (seen.has(k.keyword)) return false;
      seen.add(k.keyword);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
}

function buildFindingsSummary(findings) {
  const parts = [];
  parts.push(`Reddit posts collected: ${findings.allRedditPosts.length}`);
  parts.push(`Extracted facts: ${findings.allExtractedFacts.length}`);
  parts.push(`Long-tail keywords: ${findings.longTailKeywords.length}`);

  const postsWithBuying = findings.allRedditPosts.filter((p) => (p.buyingSignals || []).length > 0);
  const postsWithPain = findings.allRedditPosts.filter((p) => (p.painPoints || []).length > 0);
  parts.push(`Posts with buying signals: ${postsWithBuying.length}`);
  parts.push(`Posts with pain points: ${postsWithPain.length}`);

  // Unique subreddits
  const subs = [...new Set(findings.allRedditPosts.map((p) => p.subreddit).filter(Boolean))];
  parts.push(`Subreddits: ${subs.slice(0, 10).join(', ')}`);

  // Top post titles
  const titles = findings.allRedditPosts.slice(0, 5).map((p) => p.title).filter(Boolean);
  if (titles.length > 0) parts.push(`Top posts: ${titles.join(' | ')}`);

  // Extracted facts
  const factTexts = findings.allExtractedFacts.slice(0, 5).map((f) => f.fact || f.snippet).filter(Boolean);
  if (factTexts.length > 0) parts.push(`Facts: ${factTexts.join(' | ')}`);

  return parts.join('\n');
}
