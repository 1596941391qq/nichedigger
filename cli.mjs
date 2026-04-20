#!/usr/bin/env node
// nichedigger CLI — standalone Reddit-powered keyword mining
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scoreIntent, assessBrandFitness, detectContentFormat, rankPriority } from './lib/intent-taxonomy.mjs';
import { collectLiveSignals, discoverSubreddits } from './lib/source-adapters.mjs';
import { isLLMAvailable } from './lib/llm-adapter.mjs';
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
  .option('--limit <n>', 'Max keywords to analyze', '30')
  .option('--iterations <n>', 'LLM research rounds', '3')
  .option('--no-comments', 'Skip reading top comments')
  .option('--dry-run', 'Print results, no file output')
  .action(async (opts) => {
    const keywords = parseKeywords(opts.keywords);
    const limit = Math.min(keywords.length, Number(opts.limit || 30));
    const targetSubreddits = opts.subreddit ? opts.subreddit.split(',').map((s) => s.trim()) : [];
    const sortModes = opts.sort.split(',').map((s) => s.trim());
    const fetchComments = opts.comments !== false; // --no-comments disables
    const useLLM = isLLMAvailable();

    console.error(`[nichedigger] Processing ${limit} keywords for brand "${opts.brand}"`);
    if (targetSubreddits.length) console.error(`[nichedigger] Target subreddits: ${targetSubreddits.join(', ')}`);
    if (useLLM) console.error(`[nichedigger] LLM research enabled (${opts.iterations} iterations)`);

    // Phase 0: Subreddit discovery (if not specified)
    let discoveredSubs = [];
    if (targetSubreddits.length === 0 && keywords.length > 0) {
      console.error(`[nichedigger] Auto-discovering subreddits for "${keywords[0]}"...`);
      discoveredSubs = await discoverSubreddits(keywords[0], 8);
      if (discoveredSubs.length > 0) {
        console.error(`[nichedigger] Found: ${discoveredSubs.slice(0, 5).map((s) => `r/${s.subreddit} (${s.relevantPosts} relevant, ${(s.subscribers || 0).toLocaleString()} subs)`).join(', ')}`);
      }
    }

    const subsToSearch = [...targetSubreddits, ...discoveredSubs.slice(0, 3).map((s) => s.subreddit)];

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
        }),
      };
    });

    const topOpportunities = enriched
      .slice()
      .sort((a, b) => {
        const po = { P0: 0, P1: 1, P2: 2, P3: 3 };
        return (po[a.priority] ?? 9) - (po[b.priority] ?? 9) || b.commercialScore - a.commercialScore;
      });

    // Build report
    const report = {
      brand: opts.brand,
      generatedAt: new Date().toISOString(),
      llmEnabled: useLLM,
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

    // Console summary — Chinese intent labels
    console.log(JSON.stringify({
      品牌: report.brand,
      关键词数: report.summary.keywordCount,
      高优先级_P0P1: report.summary.highPriorityCount,
      发现的社区: subsToSearch.map((s) => `r/${s}`),
      读取评论数: report.summary.commentsRead,
      竞品发现: (llmResearch?.dynamicCompetitors || []).slice(0, 10).map((c) => `${c.brand}(${c.mentions}次)`),
      topOpportunities: topOpportunities.slice(0, 10).map((i) => ({
        关键词: i.keyword,
        优先级: i.priority,
        意图: i.intentLabel || '未分类',
        漏斗: i.funnel || '?',
        商业分: i.commercialScore,
        实时信号: i.liveSignalScore,
        品牌适配: i.brandFitnessLabel || '?',
        内容类型: i.contentFormat || '?',
      })),
    }, null, 2));
  });

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
