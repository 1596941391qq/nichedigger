#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessBrandFitness,
  detectContentFormat,
  rankPriority,
  scoreIntent,
} from './lib/intent-taxonomy.mjs';
import {
  inferWebsite,
  REPO_ROOT,
  resolveBrandInputs,
  summarizeText,
} from './lib/workspace-loader.mjs';
import { collectLiveSignals } from './lib/source-adapters.mjs';
import { isLLMAvailable } from './lib/llm-adapter.mjs';
import { runResearchLoop } from './lib/research-loop.mjs';
import { writeKeywordMiningLatest, writeReportBundle } from './lib/report-writer.mjs';

const program = new Command();

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chooseKeywords(inputs, limit) {
  const sourceRows = inputs.top200Rows.length > 0 ? inputs.top200Rows : inputs.candidateRows;
  return sourceRows
    .map((row) => ({
      keyword: row.keyword || row.Keyword || '',
      semrushVolume: numberOrZero(row.semrush_volume || row.volume || row.search_volume),
      kd: numberOrZero(row.semrush_kd || row.kd),
      existingIntent: row.intent_type || '',
      strategyLine: row.strategy_line || '',
      status: row.status || '',
    }))
    .filter((row) => row.keyword)
    .sort((a, b) => b.semrushVolume - a.semrushVolume)
    .slice(0, limit);
}

function buildQuerySeeds(keywords, topic) {
  const topCommercial = keywords
    .slice()
    .sort((a, b) => b.commercialScore - a.commercialScore)
    .slice(0, 3)
    .map((item) => item.keyword);
  const topVolume = keywords
    .slice()
    .sort((a, b) => b.semrushVolume - a.semrushVolume)
    .slice(0, 2)
    .map((item) => item.keyword);
  return Array.from(new Set([topic, ...topCommercial, ...topVolume].filter(Boolean)));
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function inferLiveScore(keyword, liveSignals) {
  const keywordTokens = new Set(tokenize(keyword));
  let bestScore = 0;
  for (const signal of liveSignals) {
    const queryTokens = tokenize(signal.query);
    const overlap = queryTokens.filter((token) => keywordTokens.has(token)).length;
    if (overlap === 0) continue;
    const overlapRatio = overlap / Math.max(queryTokens.length, 1);
    const candidateScore = Math.round(signal.liveSignalScore * overlapRatio);
    if (candidateScore > bestScore) bestScore = candidateScore;
  }
  return bestScore;
}

function inferLiveScoreFromResearch(roundResult) {
  let score = 0;
  const reddit = roundResult.reddit;
  if (reddit && reddit.ok) {
    score += Math.min(reddit.count || 0, 10) * 3;
    const signals = reddit.aggregatedSignals || {};
    score += (signals.totalBuyingSignals || 0) * 5;
    score += (signals.totalPainPoints || 0) * 2;
  }
  const newsCount = (roundResult.results || []).filter((r) => r.source === 'news').length;
  score += newsCount * 2;
  return Math.min(score, 100);
}

program
  .name('intent-workbench')
  .description('PSEO intent intelligence workbench CLI v2')
  .requiredOption('--brand <brand>', 'brand slug, e.g. arousen')
  .option('--website <website>', 'canonical website')
  .option('--topic <topic>', 'seed topic')
  .option('--limit <number>', 'keyword limit', '30')
  .option('--live-query-limit <number>', 'number of live queries to sample', '5')
  .option(
    '--output-root <path>',
    'output root',
    join(REPO_ROOT, 'workspace', 'intent-research'),
  )
  .option('--dry-run', 'do not write files', false)
  .action(async (options) => {
    const limit = Math.max(1, Number(options.limit || 30));
    const inputs = resolveBrandInputs(options.brand);
    const website = options.website || inferWebsite(inputs.contextText, '');

    if (!inputs.contextText && !inputs.strategyText && inputs.top200Rows.length === 0 && inputs.candidateRows.length === 0) {
      throw new Error(`No brand assets found for ${options.brand}`);
    }

    // Phase 1: Intent scoring with v2 taxonomy (18 types + secondary + fitness)
    const keywordRows = chooseKeywords(inputs, limit).map((row) => {
      const intent = scoreIntent(row.keyword);
      const fitness = assessBrandFitness(row.keyword, options.brand);
      return {
        ...row,
        ...intent,
        contentFormat: detectContentFormat(row.keyword),
        brandFitness: fitness.score,
        brandFitnessLabel: fitness.label,
        liveSignalScore: 0,
        priority: 'P3',
      };
    });

    // Phase 2: Live signal collection (LLM-powered research loop or plain fallback)
    const querySeeds = buildQuerySeeds(keywordRows, options.topic);
    const useLLM = isLLMAvailable();
    let liveSignals = [];
    let llmResearch = null;

    if (useLLM && querySeeds.length > 0) {
      // Run agentic research loop on the top query seed
      try {
        const primarySeed = querySeeds[0];
        llmResearch = await runResearchLoop(primarySeed, { maxIterations: 3 });

        // Convert research loop results into liveSignals format
        for (const iter of llmResearch.iterations) {
          for (const roundResult of iter.results || []) {
            const reddit = roundResult.reddit;
            const newsItems = (roundResult.results || []).filter((r) => r.source === 'news');
            liveSignals.push({
              query: roundResult.query,
              liveSignalScore: inferLiveScoreFromResearch(roundResult),
              reddit: reddit ? {
                ok: reddit.ok,
                count: reddit.count || 0,
                mode: reddit.mode || 'research_loop',
                error: '',
                items: [],
                deepAnalysis: {
                  topDiscussions: reddit.topDiscussions || [],
                  aggregatedSignals: reddit.aggregatedSignals || {},
                },
              } : { ok: false, count: 0, error: 'not_fetched', items: [] },
              googleNews: {
                ok: newsItems.length > 0,
                count: newsItems.length,
                error: newsItems.length === 0 ? 'no_results' : '',
                items: newsItems,
              },
            });
          }
        }

        // Also run plain signals for remaining seeds
        if (querySeeds.length > 1) {
          const extraSignals = await collectLiveSignals(querySeeds.slice(1), {
            queryLimit: Number(options.liveQueryLimit || 5),
            perSourceLimit: 5,
          });
          liveSignals.push(...extraSignals);
        }
      } catch (error) {
        // Fallback to plain signals if research loop fails
        liveSignals = await collectLiveSignals(querySeeds, {
          queryLimit: Number(options.liveQueryLimit || 5),
          perSourceLimit: 5,
        });
        llmResearch = { error: error.message };
      }
    } else {
      liveSignals = await collectLiveSignals(querySeeds, {
        queryLimit: Number(options.liveQueryLimit || 5),
        perSourceLimit: 5,
      });
    }

    // Phase 3: Enrich with live scores and final ranking
    const enriched = keywordRows.map((row) => {
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

    // Phase 4: Aggregate analytics
    const intentCounts = new Map();
    for (const row of enriched) {
      const current = intentCounts.get(row.intentLabel) || 0;
      intentCounts.set(row.intentLabel, current + 1);
    }

    const funnelCounts = new Map();
    for (const row of enriched) {
      const current = funnelCounts.get(row.funnel) || 0;
      funnelCounts.set(row.funnel, current + 1);
    }

    const conversionDistanceCounts = new Map();
    for (const row of enriched) {
      const d = row.conversionDistance || 'unknown';
      conversionDistanceCounts.set(d, (conversionDistanceCounts.get(d) || 0) + 1);
    }

    const topOpportunities = enriched
      .slice()
      .sort((a, b) => {
        const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
        return (
          (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9) ||
          b.commercialScore - a.commercialScore ||
          b.liveSignalScore - a.liveSignalScore ||
          b.semrushVolume - a.semrushVolume
        );
      });

    // Recommendations: what NOT to put in PSEO
    const notRecommended = enriched.filter(
      (row) =>
        row.brandFitnessLabel === 'low' ||
        row.conversionDistance === 'far' && row.commercialScore < 40,
    );

    const report = {
      brand: options.brand,
      website,
      generatedAt: new Date().toISOString(),
      taxonomyVersion: 2,
      llmEnabled: useLLM,
      llmResearch: llmResearch ? {
        available: llmResearch.llmAvailable,
        classification: llmResearch.llmClassification,
        iterations: (llmResearch.iterations || []).length,
        extractedFacts: (llmResearch.allExtractedFacts || []).slice(0, 20),
      } : null,
      inputs: {
        contextPath: inputs.contextPath,
        strategyPath: inputs.strategyPath,
        keywordRoot: inputs.keywordRoot,
        contextSummary: summarizeText(inputs.contextText, 1200),
        strategySummary: summarizeText(inputs.strategyText, 1800),
      },
      summary: {
        keywordCount: enriched.length,
        liveQueryCount: liveSignals.length,
        highPriorityCount: topOpportunities.filter((item) => item.priority === 'P0' || item.priority === 'P1').length,
        notRecommendedCount: notRecommended.length,
      },
      intentDistribution: Array.from(intentCounts.entries())
        .map(([intentLabel, count]) => ({ intentLabel, count }))
        .sort((a, b) => b.count - a.count),
      funnelDistribution: Array.from(funnelCounts.entries())
        .map(([funnel, count]) => ({ funnel, count }))
        .sort((a, b) => b.count - a.count),
      conversionDistanceDistribution: Array.from(conversionDistanceCounts.entries())
        .map(([distance, count]) => ({ distance, count })),
      keywords: enriched,
      topOpportunities,
      notRecommended,
      liveSignals,
    };

    const outputDir = join(
      options.outputRoot,
      options.brand,
      new Date().toISOString().replace(/[:.]/g, '-'),
    );

    if (!options.dryRun) {
      if (!existsSync(options.outputRoot)) mkdirSync(options.outputRoot, { recursive: true });
      writeReportBundle(outputDir, report);
      writeKeywordMiningLatest(inputs.keywordRoot, report);
    }

    const consoleSummary = {
      brand: report.brand,
      website: report.website,
      taxonomyVersion: 2,
      outputDir: options.dryRun ? '(dry-run)' : outputDir,
      keywordCount: report.summary.keywordCount,
      liveQueryCount: report.summary.liveQueryCount,
      highPriorityCount: report.summary.highPriorityCount,
      notRecommendedCount: report.summary.notRecommendedCount,
      intentTypes: report.intentDistribution.map((i) => `${i.intentLabel}:${i.count}`).join(', '),
      topOpportunities: report.topOpportunities.slice(0, 10).map((item) => ({
        keyword: item.keyword,
        priority: item.priority,
        intent: item.intentLabel,
        commercialScore: item.commercialScore,
        liveSignalScore: item.liveSignalScore,
        brandFitness: item.brandFitnessLabel,
        conversionDistance: item.conversionDistance,
      })),
    };

    process.stdout.write(`${JSON.stringify(consoleSummary, null, 2)}\n`);
  });

program.parseAsync(process.argv);
