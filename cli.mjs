#!/usr/bin/env node
// nichedigger CLI — standalone Reddit-powered keyword mining
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scoreIntent, assessBrandFitness, detectContentFormat, rankPriority } from './lib/intent-taxonomy.mjs';
import { collectLiveSignals, discoverSubreddits, guessCategorySubreddits, fetchRedditSignals } from './lib/source-adapters.mjs';
import { isLLMAvailable, discoverImpulses } from './lib/llm-adapter.mjs';
import { runResearchLoop } from './lib/research-loop.mjs';

const program = new Command();

function parseKeywords(input) {
  // If it's a CSV file path, read it
  if (input.endsWith('.csv') && existsSync(input)) {
    const content = readFileSync(input, 'utf-8');
    return content.split('\n').map((line) => line.split(',')[0].trim()).filter(Boolean);
  }
  return input.split(',').map((k) => k.trim()).filter(Boolean);
}

program
  .name('nichedigger')
  .description('Reddit-powered keyword mining for PSEO')
  .requiredOption('--keywords <string>', 'Comma-separated keywords or CSV path')
  .option('--brand <slug>', 'Brand slug for fitness scoring', 'generic')
  .option('--subreddit <string>', 'Comma-separated subreddits to target (e.g. SexToys,wandvibers)')
  .option('--sort <string>', 'Comma-separated sort modes: relevance,top,new', 'relevance,top')
  .option('--output <dir>', 'Output directory', './output')
  .option('--limit <n>', 'Max keywords to analyze', '100')
  .option('--iterations <n>', 'LLM research rounds', '3')
  .option('--no-comments', 'Skip reading top comments')
  .option('--dry-run', 'Print results, no file output')
  .option('--discover', 'Discover impulses from Reddit instead of using provided keywords. Requires --keywords as seed topic.')
  .action(async (opts) => {
    let keywords = parseKeywords(opts.keywords);
    let impulses = [];
    const useLLM = isLLMAvailable();

    // ── Discover mode: mine impulses from Reddit first ──
    if (opts.discover && useLLM) {
      const seedTopic = keywords[0] || 'vibrator';
      console.error(`[nichedigger] Discover mode: mining impulses for "${seedTopic}"...`);

      // Step 1: Quick Reddit scan to get raw discussions
      console.error(`[nichedigger] Scanning Reddit for real discussions...`);
      const rawPosts = [];
      const scanQueries = [seedTopic, `${seedTopic} review reddit`, `${seedTopic} recommendation`, `best ${seedTopic}`, `${seedTopic} advice`];
      for (const q of scanQueries) {
        try {
          const r = await fetchRedditSignals(q, { limit: 15, sort: 'relevance', fetchComments: true });
          if (r.ok && r.items) {
            for (const post of r.items) {
              if (post._relevance >= 0.5 && post.title) {
                rawPosts.push(post);
              }
            }
          }
        } catch {}
      }
      console.error(`[nichedigger] Collected ${rawPosts.length} relevant posts`);

      // Step 2: LLM discovers impulses from these discussions
      if (rawPosts.length >= 5) {
        console.error(`[nichedigger] LLM analyzing discussions to discover search impulses...`);
        impulses = await discoverImpulses(rawPosts, seedTopic);
        console.error(`[nichedigger] Discovered ${impulses.length} impulses`);

        // Step 3: Collect all keywords from impulses
        keywords = impulses.flatMap((imp) => imp.keywords || []);
        console.error(`[nichedigger] Generated ${keywords.length} keywords from impulses`);

        // Print impulse summary
        for (const imp of impulses) {
          console.error(`  ${imp.id}. ${imp.impulse} (${imp.impulse_en}) → ${(imp.keywords||[]).length} keywords`);
        }
      } else {
        console.error(`[nichedigger] Not enough relevant posts for impulse discovery, using provided keywords`);
      }
    }

    const limit = Math.min(keywords.length, Number(opts.limit || 75));
    const targetSubreddits = opts.subreddit ? opts.subreddit.split(',').map((s) => s.trim()) : [];
    const sortModes = opts.sort.split(',').map((s) => s.trim());
    const fetchComments = opts.comments !== false;

    console.error(`[nichedigger] Processing ${limit} keywords for brand "${opts.brand}"`);
    if (targetSubreddits.length) console.error(`[nichedigger] Target subreddits: ${targetSubreddits.join(', ')}`);

    // Phase 0: Subreddit discovery — always use seed topic, not expanded keywords
    const seedTopic = opts.discover ? (parseKeywords(opts.keywords)[0] || keywords[0]) : keywords[0];
    let discoveredSubs = [];
    if (targetSubreddits.length === 0 && keywords.length > 0) {
      console.error(`[nichedigger] Auto-discovering subreddits for "${seedTopic}"...`);
      discoveredSubs = await discoverSubreddits(seedTopic, 8);
      if (discoveredSubs.length > 0) {
        console.error(`[nichedigger] Found: ${discoveredSubs.slice(0, 5).map((s) => `r/${s.subreddit} (${s.relevantPosts} relevant, ${(s.subscribers || 0).toLocaleString()} subs)`).join(', ')}`);
      }
    }

    // Merge: user-specified + discovered + hardcoded category fallback
    const hardcodedSubs = [...new Set([seedTopic, ...keywords.slice(0, 2)].flatMap((k) => guessCategorySubreddits(k)))];
    const subsToSearch = [...new Set([...targetSubreddits, ...discoveredSubs.slice(0, 3).map((s) => s.subreddit), ...hardcodedSubs])];
    if (subsToSearch.length > 0) {
      console.error(`[nichedigger] Subreddit pool: ${subsToSearch.slice(0, 8).map((s) => `r/${s}`).join(', ')}`);
    }

    // Phase 1: Intent scoring
    const scored = keywords.slice(0, limit).map((keyword) => {
      const intent = scoreIntent(keyword);
      const fitness = assessBrandFitness(keyword, opts.brand);
      return {
        keyword,
        ...intent,
        contentFormat: detectContentFormat(keyword),
        brandFitness: fitness.score,
        brandFitnessLabel: fitness.label,
        semrushVolume: 0,
        kd: 0,
        liveSignalScore: 0,
        priority: 'P3',
      };
    });

    // Phase 2: Live signal collection
    let liveSignals = [];
    let llmResearch = null;
    const querySeeds = scored.slice(0, 5).map((k) => k.keyword);

    if (useLLM && querySeeds.length > 0) {
      try {
        llmResearch = await runResearchLoop(querySeeds[0], {
          maxIterations: Number(opts.iterations || 3),
        });
        // Convert research loop results into liveSignals format
        for (const iter of llmResearch.iterations) {
          for (const roundResult of (iter.results || [])) {
            const reddit = roundResult.reddit;
            liveSignals.push({
              query: roundResult.query,
              liveSignalScore: inferLiveScoreFromResearch(roundResult),
              reddit: reddit ? {
                ok: reddit.ok,
                count: reddit.count || 0,
                mode: reddit.mode || 'research_loop',
                relevantCount: reddit.relevantCount || 0,
                commentCount: reddit.commentCount || 0,
                topDiscussions: reddit.topDiscussions || [],
                aggregatedSignals: reddit.aggregatedSignals || {},
                stats: reddit.stats || {},
              } : { ok: false, count: 0, error: 'not_fetched', items: [] },
              searchMeta: roundResult.searchMeta || {},
            });
          }
        }

        // Also run plain signals for remaining seeds with subreddit targeting
        if (querySeeds.length > 1) {
          const extraSignals = await collectLiveSignals(querySeeds.slice(1), {
            subreddits: subsToSearch,
            sortModes,
            fetchComments,
          });
          liveSignals.push(...extraSignals);
        }
      } catch (error) {
        console.error(`[nichedigger] Research loop error: ${error.message}`);
        liveSignals = await collectLiveSignals(querySeeds, {
          subreddits: subsToSearch,
          sortModes,
          fetchComments,
        });
        llmResearch = { error: error.message };
      }
    } else {
      liveSignals = await collectLiveSignals(querySeeds, {
        subreddits: subsToSearch,
        sortModes,
        fetchComments,
      });
    }

    // Phase 3: Enrich with live scores and final ranking
    const enriched = scored.map((row) => {
      const liveSignalScore = inferLiveScore(row.keyword, liveSignals);
      return {
        ...row,
        liveSignalScore,
        priority: rankPriority({
          commercialScore: row.commercialScore,
          semrushVolume: row.semrushVolume,
          liveSignalScore,
          kd: row.kd,
          keyword: row.keyword,
        }),
      };
    });

    const topOpportunities = enriched
      .slice()
      .sort((a, b) => {
        const po = { P0: 0, P1: 1, P2: 2, P3: 3 };
        return (po[a.priority] ?? 9) - (po[b.priority] ?? 9) || b.commercialScore - a.commercialScore;
      });

    // Build qualitative analysis from raw Reddit data
    const qualitativeAnalysis = buildQualitativeAnalysis(liveSignals, impulses);

    // Build report
    const report = {
      brand: opts.brand,
      generatedAt: new Date().toISOString(),
      llmEnabled: useLLM,
      discoverMode: !!opts.discover,
      impulses: impulses.length > 0 ? impulses : undefined,
      llmResearch: llmResearch ? {
        available: llmResearch.llmAvailable,
        classification: llmResearch.llmClassification,
        iterations: (llmResearch.iterations || []).length,
        discoveredSubreddits: llmResearch.discoveredSubreddits || [],
        dynamicCompetitors: llmResearch.dynamicCompetitors || [],
        extractedFacts: (llmResearch.allExtractedFacts || []).slice(0, 20),
      } : null,
      summary: {
        keywordCount: enriched.length,
        liveQueryCount: liveSignals.length,
        highPriorityCount: topOpportunities.filter((i) => i.priority === 'P0' || i.priority === 'P1').length,
        subredditCount: subsToSearch.length,
        commentsRead: liveSignals.reduce((s, sig) => s + (sig.reddit?.commentCount || 0), 0),
      },
      qualitativeAnalysis,
      keywords: enriched,
      topOpportunities,
      liveSignals,
    };

    // Output
    if (!opts.dryRun) {
      if (!existsSync(opts.output)) mkdirSync(opts.output, { recursive: true });
      const jsonPath = join(opts.output, 'report.json');
      writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.error(`[nichedigger] Report saved to ${jsonPath}`);

      // Write dashboard JSON
      const dashPath = join(opts.output, 'dashboard.json');
      writeFileSync(dashPath, JSON.stringify(report, null, 2));
    }

    // Console summary — Chinese intent labels + impulses
    const output = {
      品牌: report.brand,
      关键词数: report.summary.keywordCount,
      高优先级_P0P1: report.summary.highPriorityCount,
      发现的社区: subsToSearch.slice(0, 8).map((s) => `r/${s}`),
      读取评论数: report.summary.commentsRead,
      竞品发现: (llmResearch?.dynamicCompetitors || []).slice(0, 10).map((c) => `${c.brand}(${c.mentions}次)`),
    };
    if (impulses.length > 0) {
      output.发现的搜索冲动 = impulses.map((imp) => ({
        冲动: imp.impulse,
        english: imp.impulse_en,
        泛化关键词: (imp.keywords || []).slice(0, 3),
      }));
    }
    output.topOpportunities = topOpportunities.slice(0, 15).map((i) => ({
      关键词: i.keyword,
      优先级: i.priority,
      意图: i.intentLabel || '未分类',
      漏斗: i.funnel || '?',
      商业分: i.commercialScore,
      实时信号: i.liveSignalScore,
      品牌适配: i.brandFitnessLabel || '?',
      内容类型: i.contentFormat || '?',
    }));
    console.log(JSON.stringify(output, null, 2));
  });

// ── Qualitative analysis: full content breakdown from Reddit data ──
function buildQualitativeAnalysis(liveSignals, impulses) {
  const analysis = {
    topPosts: [],
    hotDiscussions: [],
    userPainPoints: [],
    buyingSignalsRaw: [],
    brandMentions: [],
    communityInsights: [],
    impulseEvidence: [],
  };

  // Known off-topic subreddits that frequently appear in broad searches
  const OFF_TOPIC_SUBS = new Set([
    'epstein', 'politics', 'worldnews', 'nottheonion',
    'conspiracy', 'conservative', 'liberal', 'politicaldiscussion',
    'hfy', 'astralprojection', 'entertainment',
  ]);

  // Collect all relevant posts across all signals
  const allPosts = [];
  for (const sig of liveSignals) {
    const reddit = sig.reddit;
    if (!reddit || !reddit.ok) continue;
    for (const item of (reddit.items || [])) {
      if ((item._relevance || 0) >= 0.5) {
        const subLower = (item.subreddit || '').toLowerCase();
        // Skip posts from known off-topic communities
        if (OFF_TOPIC_SUBS.has(subLower)) continue;
        // Additional relevance check for low-relevance posts
        const text = [item.title, item.content].filter(Boolean).join(' ').toLowerCase();
        const hasRelevantKeyword = /\b(vibrat|stimulat|pleasure|clitoral|g-spot|wand|suction|lovense|lelo|we-vibe|womanizer|satisfyer|dame|dildo|sex\s*toy|bullet|rabbit|orgasm|clit)\b/i.test(text);
        if ((item._relevance || 0) < 0.6 && !hasRelevantKeyword) continue;
        allPosts.push({ ...item, _query: sig.query });
      }
    }
  }

  // Deduplicate by title
  const seenTitles = new Set();
  const uniquePosts = allPosts.filter((p) => {
    const key = (p.title || '').toLowerCase().slice(0, 80);
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  // Top posts: highest-scoring relevant posts with full text
  analysis.topPosts = uniquePosts
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 30)
    .map((p) => ({
      title: p.title,
      subreddit: `r/${p.subreddit}`,
      score: p.score,
      comments: p.numComments,
      excerpt: (p.content || '').slice(0, 300),
      buyingSignals: p.buyingSignals || [],
      painPoints: p.painPoints || [],
      competitors: p.competitors || [],
      topComments: (p.comments || []).slice(0, 5).map((c) => ({
        excerpt: c.body.slice(0, 200),
        score: c.score,
      })),
    }));

  // Hot discussions: most-commented relevant posts
  analysis.hotDiscussions = uniquePosts
    .sort((a, b) => (b.numComments || 0) - (a.numComments || 0))
    .slice(0, 20)
    .map((p) => ({
      title: p.title,
      subreddit: `r/${p.subreddit}`,
      comments: p.numComments,
      score: p.score,
      excerpt: (p.content || '').slice(0, 300),
      topCommentThemes: summarizeCommentThemes(p.comments || []),
    }));

  // User pain points: collect actual pain point text from posts + comments
  const painLabels = {
    buyer_remorse: '后悔/退货',
    quality_issue: '质量问题',
    fit_comfort: '尺寸/舒适度',
    battery_issue: '续航/充电',
    trust_issue: '信任问题',
    usability_issue: '使用困难',
    discretion_issue: '隐私/噪音',
  };
  for (const p of uniquePosts) {
    for (const pp of (p.painPoints || [])) {
      const commentExcerpts = (p.comments || [])
        .filter((c) => /\b(disappointed|waste|regret|broke|stopped|too loud|too big|too small|uncomfortable|battery|charging|overrated|confusing|noisy|can hear)\b/i.test(c.body))
        .slice(0, 2)
        .map((c) => c.body.slice(0, 200));
      analysis.userPainPoints.push({
        type: painLabels[pp] || pp,
        postTitle: p.title,
        postExcerpt: (p.content || '').slice(0, 200),
        commentExcerpts,
      });
    }
  }
  analysis.userPainPoints = analysis.userPainPoints.slice(0, 40);

  // Buying signals raw: actual user quotes showing purchase intent
  const buyingLabels = {
    purchase_mention: '已购',
    considering: '考虑购买',
    seeking_recommendation: '求推荐',
    value_assessment: '值不值',
    comparison_shopping: '对比选购',
    price_sensitivity: '价格敏感',
    gift_intent: '送礼意图',
  };
  for (const p of uniquePosts) {
    for (const bs of (p.buyingSignals || [])) {
      const commentExcerpts = (p.comments || [])
        .filter((c) => /\b(buying|bought|purchase|recommend|which one|worth it|budget|under \$|gift)\b/i.test(c.body))
        .slice(0, 2)
        .map((c) => c.body.slice(0, 200));
      analysis.buyingSignalsRaw.push({
        type: buyingLabels[bs] || bs,
        postTitle: p.title,
        postExcerpt: (p.content || '').slice(0, 200),
        commentExcerpts,
      });
    }
  }
  analysis.buyingSignalsRaw = analysis.buyingSignalsRaw.slice(0, 40);

  // Brand mentions: which brands appear in discussions
  const brandCounts = {};
  for (const p of uniquePosts) {
    for (const brand of (p.competitors || [])) {
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;
      // Find comment context for this brand
      const contextComments = (p.comments || [])
        .filter((c) => new RegExp(`\\b${brand.replace(/\s+/g, '\\s+')}\\b`, 'i').test(c.body))
        .slice(0, 2)
        .map((c) => c.body.slice(0, 200));
      if (contextComments.length > 0) {
        if (!analysis.brandMentions.find((m) => m.brand === brand)) {
          analysis.brandMentions.push({ brand, mentions: 0, context: [] });
        }
        const entry = analysis.brandMentions.find((m) => m.brand === brand);
        entry.context.push(...contextComments);
      }
    }
  }
  analysis.brandMentions = analysis.brandMentions
    .map((m) => ({ ...m, mentions: brandCounts[m.brand] || 0, context: m.context.slice(0, 5) }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 15);

  // Community insights: aggregate by subreddit
  const subAgg = {};
  for (const p of uniquePosts) {
    const sub = p.subreddit;
    if (!sub) continue;
    if (!subAgg[sub]) subAgg[sub] = { subreddit: `r/${sub}`, postCount: 0, totalScore: 0, themes: [], sampleTitles: [] };
    subAgg[sub].postCount++;
    subAgg[sub].totalScore += (p.score || 0);
    subAgg[sub].sampleTitles.push(p.title);
  }
  analysis.communityInsights = Object.values(subAgg)
    .sort((a, b) => b.postCount - a.postCount)
    .slice(0, 10)
    .map((s) => ({
      ...s,
      avgScore: s.postCount > 0 ? Math.round(s.totalScore / s.postCount) : 0,
      sampleTitles: s.sampleTitles.slice(0, 5),
    }));

  // Impulse evidence: map discovered impulses back to actual Reddit posts
  if (impulses.length > 0) {
    for (const imp of impulses.slice(0, 15)) {
      const matchingPosts = uniquePosts.filter((p) => {
        const text = [p.title, p.content, ...(p.comments || []).map((c) => c.body)].join(' ').toLowerCase();
        return (imp.keywords || []).some((kw) => {
          const tokens = kw.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
          return tokens.some((t) => text.includes(t));
        });
      });
      if (matchingPosts.length > 0) {
        analysis.impulseEvidence.push({
          impulse: imp.impulse,
          impulse_en: imp.impulse_en,
          evidencePosts: matchingPosts.slice(0, 3).map((p) => ({
            title: p.title,
            excerpt: (p.content || '').slice(0, 200),
            topComment: (p.comments || [])[0]?.body?.slice(0, 200) || '',
          })),
        });
      }
    }
  }

  return analysis;
}

function summarizeCommentThemes(comments) {
  const themes = [];
  const text = comments.map((c) => c.body).join(' ').toLowerCase();
  if (/recommend|suggestion|try this/i.test(text)) themes.push('求推荐/分享经验');
  if (/disappointed|waste|regret|return/i.test(text)) themes.push('负面体验');
  if (/compare|versus|vs|alternative/i.test(text)) themes.push('对比讨论');
  if (/budget|cheap|affordable|expensive/i.test(text)) themes.push('价格讨论');
  if (/partner|wife|girlfriend|gift/i.test(text)) themes.push('关系/送礼');
  if (/safe|danger|health|risk/i.test(text)) themes.push('安全顾虑');
  if (/quiet|noise|discreet|hide/i.test(text)) themes.push('隐私顾虑');
  if (/beginner|first time|new to/i.test(text)) themes.push('新手入门');
  return themes;
}

function inferLiveScore(keyword, liveSignals) {
  const kwTokens = new Set(keyword.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  let best = 0;
  for (const sig of liveSignals) {
    const qTokens = (sig.query || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const overlap = qTokens.filter((t) => kwTokens.has(t)).length;
    if (overlap === 0) continue;
    const ratio = overlap / Math.max(qTokens.length, 1);
    best = Math.max(best, Math.round((sig.liveSignalScore || 0) * ratio));
  }
  return best;
}

function inferLiveScoreFromResearch(roundResult) {
  let score = 0;
  const reddit = roundResult.reddit;
  if (reddit && reddit.ok) {
    score += Math.min(reddit.count || 0, 10) * 3;
    const sigs = reddit.aggregatedSignals || {};
    score += (sigs.totalBuyingSignals || 0) * 5;
    score += (sigs.totalPainPoints || 0) * 2;
    // Bonus for comment signals
    score += (sigs.commentBuyingSignals || 0) * 3;
    score += (sigs.commentPainPoints || 0) * 2;
  }
  return Math.min(score, 100);
}

program.parseAsync(process.argv);
