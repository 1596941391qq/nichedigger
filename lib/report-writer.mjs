import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ].join('\n');
}

export function writeReportBundle(outputDir, report) {
  ensureDir(outputDir);
  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(join(outputDir, 'dashboard.json'), JSON.stringify(buildDashboardPayload(report), null, 2) + '\n', 'utf8');
  writeFileSync(join(outputDir, 'summary.md'), buildMarkdown(report), 'utf8');
  writeFileSync(
    join(outputDir, 'commercial-opportunities.csv'),
    toCsv(
      report.topOpportunities.map((item) => ({
        keyword: item.keyword,
        intent: item.intentLabel,
        secondary_intents: (item.secondaryIntents || []).map((s) => s.label).join(';'),
        funnel: item.funnel,
        conversion_distance: item.conversionDistance || '',
        commercial_score: item.commercialScore,
        live_signal_score: item.liveSignalScore,
        semrush_volume: item.semrushVolume,
        brand_fitness: item.brandFitnessLabel || '',
        priority: item.priority,
        recommended_format: item.suggestedContentType || item.contentFormat,
      })),
    ),
    'utf8',
  );
}

export function writeKeywordMiningLatest(keywordRoot, report) {
  ensureDir(keywordRoot);
  writeFileSync(join(keywordRoot, 'intent-workbench-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(
    join(keywordRoot, 'intent-workbench-dashboard.json'),
    JSON.stringify(buildDashboardPayload(report), null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    join(keywordRoot, 'intent-workbench-opportunities.csv'),
    toCsv(
      report.topOpportunities.map((item) => ({
        keyword: item.keyword,
        priority: item.priority,
        intent: item.intentLabel,
        secondary_intents: (item.secondaryIntents || []).map((s) => s.label).join(';'),
        funnel: item.funnel,
        conversion_distance: item.conversionDistance || '',
        commercial_score: item.commercialScore,
        live_signal_score: item.liveSignalScore,
        semrush_volume: item.semrushVolume,
        brand_fitness: item.brandFitnessLabel || '',
        content_format: item.suggestedContentType || item.contentFormat,
        existing_intent: item.existingIntent,
        strategy_line: item.strategyLine,
      })),
    ),
    'utf8',
  );
  writeFileSync(
    join(keywordRoot, 'intent-workbench-live-signals.json'),
    JSON.stringify(
      {
        brand: report.brand,
        generatedAt: report.generatedAt,
        liveSignals: report.liveSignals,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

function buildDashboardPayload(report) {
  return {
    brand: report.brand,
    website: report.website,
    generatedAt: report.generatedAt,
    taxonomyVersion: report.taxonomyVersion || 2,
    llmEnabled: report.llmEnabled || false,
    summary: report.summary,
    intentDistribution: report.intentDistribution,
    funnelDistribution: report.funnelDistribution || [],
    topOpportunities: report.topOpportunities.slice(0, 30).map((item) => ({
      keyword: item.keyword,
      priority: item.priority,
      intent: item.intentLabel,
      secondaryIntents: (item.secondaryIntents || []).map((s) => s.label),
      funnel: item.funnel,
      conversionDistance: item.conversionDistance || '',
      commercialScore: item.commercialScore,
      liveSignalScore: item.liveSignalScore,
      semrushVolume: item.semrushVolume,
      brandFitness: item.brandFitnessLabel || '',
      contentFormat: item.suggestedContentType || item.contentFormat,
      strategyLine: item.strategyLine,
    })),
    notRecommended: (report.notRecommended || []).slice(0, 20).map((item) => ({
      keyword: item.keyword,
      intent: item.intentLabel,
      brandFitness: item.brandFitnessLabel || '',
      commercialScore: item.commercialScore,
      reason: item.brandFitnessLabel === 'low' ? 'low_brand_fitness' : 'low_commercial_value',
    })),
    llmResearch: report.llmResearch ? {
      available: report.llmResearch.available,
      classification: report.llmResearch.classification ? {
        primaryIntent: report.llmResearch.classification.primaryIntent,
        searchQueries: report.llmResearch.classification.searchQueries,
      } : null,
      iterations: report.llmResearch.iterations || 0,
      extractedFacts: (report.llmResearch.extractedFacts || []).slice(0, 15).map((f) => ({
        fact: f.fact || f.snippet || '',
        type: f.type || 'auto_extracted',
        source: f.source || f.url || '',
      })),
    } : null,
    liveSignals: report.liveSignals.map((signal) => {
      const posts = signal.reddit.deepAnalysis?.topDiscussions || signal.reddit.items || [];
      const allScores = posts.map((d) => d.score || 0).filter((s) => s > 0);
      const allComments = posts.map((d) => d.numComments || 0).filter((s) => s > 0);
      const subreddits = [...new Set(posts.map((d) => d.subreddit).filter(Boolean))];
      return {
        query: signal.query,
        liveSignalScore: signal.liveSignalScore,
        reddit: {
          count: signal.reddit.count,
          ok: signal.reddit.ok,
          error: signal.reddit.error || '',
          mode: signal.reddit.mode || '',
          stats: {
            totalPosts: posts.length,
            avgScore: allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0,
            maxScore: allScores.length ? Math.max(...allScores) : 0,
            avgComments: allComments.length ? Math.round(allComments.reduce((a, b) => a + b, 0) / allComments.length) : 0,
            subreddits: subreddits.slice(0, 10),
            totalBuyingSignals: signal.reddit.aggregatedSignals?.totalBuyingSignals || 0,
            totalPainPoints: signal.reddit.aggregatedSignals?.totalPainPoints || 0,
            competitors: signal.reddit.aggregatedSignals?.competitorMentions || [],
          },
          topDiscussions: posts.slice(0, 5).map((d) => ({
            title: d.title || '',
            subreddit: d.subreddit || '',
            score: d.score ?? 0,
            numComments: d.numComments || 0,
            link: d.link || '',
            painPoints: d.painPoints || [],
            buyingSignals: d.buyingSignals || [],
            competitors: d.competitors || [],
          })),
        },
      };
    }),
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# Intent Report: ${report.brand}`);
  lines.push('');
  lines.push(`- Website: ${report.website}`);
  lines.push(`- Generated At: ${report.generatedAt}`);
  lines.push(`- Taxonomy Version: ${report.taxonomyVersion || 2}`);
  lines.push(`- Brand Context: ${report.inputs.contextPath}`);
  lines.push(`- SEO Strategy: ${report.inputs.strategyPath}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Keywords analyzed: ${report.summary.keywordCount}`);
  lines.push(`- Live queries sampled: ${report.summary.liveQueryCount}`);
  lines.push(`- High-priority opportunities: ${report.summary.highPriorityCount}`);
  if (report.summary.notRecommendedCount > 0) {
    lines.push(`- Not recommended for PSEO: ${report.summary.notRecommendedCount}`);
  }
  lines.push('');

  lines.push('## Intent Distribution');
  lines.push('');
  for (const item of report.intentDistribution) {
    lines.push(`- ${item.intentLabel}: ${item.count}`);
  }
  lines.push('');

  if (report.funnelDistribution && report.funnelDistribution.length > 0) {
    lines.push('## Funnel Distribution');
    lines.push('');
    for (const item of report.funnelDistribution) {
      lines.push(`- ${item.funnel}: ${item.count}`);
    }
    lines.push('');
  }

  lines.push('## Top Opportunities (P0/P1)');
  lines.push('');
  const highPriority = report.topOpportunities.filter((item) => item.priority === 'P0' || item.priority === 'P1');
  if (highPriority.length === 0) {
    lines.push('No P0/P1 opportunities found.');
  } else {
    for (const item of highPriority.slice(0, 20)) {
      const secondary = (item.secondaryIntents || []).map((s) => s.label).join(', ');
      lines.push(
        `- **${item.keyword}** | ${item.intentLabel}${secondary ? ` + ${secondary}` : ''} | ${item.priority} | commercial=${item.commercialScore} | live=${item.liveSignalScore} | fitness=${item.brandFitnessLabel || '?'} | distance=${item.conversionDistance || '?'} | format=${item.suggestedContentType || item.contentFormat}`,
      );
    }
  }
  lines.push('');

  if (report.notRecommended && report.notRecommended.length > 0) {
    lines.push('## Not Recommended for PSEO');
    lines.push('');
    for (const item of report.notRecommended.slice(0, 10)) {
      lines.push(`- ${item.keyword} | ${item.intentLabel} | fitness=${item.brandFitnessLabel || '?'} | reason=${item.brandFitnessLabel === 'low' ? 'low_brand_fitness' : 'low_commercial_value'}`);
    }
    lines.push('');
  }

  lines.push('## 链路追踪 (Pipeline Trace)');
  lines.push('');
  lines.push(`1. 读取品牌资产: ${report.inputs.contextPath}`);
  lines.push(`2. 意图打分: ${report.summary.keywordCount} 个关键词 × 18 种意图分类`);
  lines.push(`3. 数据源: Reddit Direct JSON API (仅 Reddit，无 Bing/News)`);
  lines.push(`4. LLM: ${report.llmEnabled ? '已启用 (GLM-4-flash)' : '未启用'}`);
  if (report.llmResearch?.classification) {
    const c = report.llmResearch.classification;
    lines.push(`5. LLM 生成搜索词: ${(c.searchQueries || []).join(', ')}`);
    lines.push(`6. 研究迭代: ${report.llmResearch.iterations || 0} 轮`);
  }
  lines.push('');

  lines.push('## Live Signals (Reddit Only)');
  lines.push('');
  for (const signal of report.liveSignals) {
    lines.push(`### ${signal.query}`);
    lines.push(`- Live Score: ${signal.liveSignalScore}`);
    if (signal.reddit.ok && signal.reddit.count > 0) {
      const posts = signal.reddit.deepAnalysis?.topDiscussions || signal.reddit.items || [];
      const scores = posts.map((d) => d.score || 0).filter((s) => s > 0);
      const comments = posts.map((d) => d.numComments || 0).filter((s) => s > 0);
      const subs = [...new Set(posts.map((d) => d.subreddit).filter(Boolean))];
      lines.push(`- Reddit: ${signal.reddit.count} 条帖子 (mode: ${signal.reddit.mode || 'unknown'})`);
      if (scores.length) lines.push(`- 热度: avg=${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}, max=${Math.max(...scores)} | 评论: avg=${comments.length ? Math.round(comments.reduce((a, b) => a + b, 0) / comments.length) : 0}`);
      if (subs.length) lines.push(`- 子版块: ${subs.join(', ')}`);
      const agg = signal.reddit.aggregatedSignals;
      if (agg) {
        lines.push(`- 购买信号: ${agg.totalBuyingSignals || 0} | 痛点: ${agg.totalPainPoints || 0} | 竞品提及: ${(agg.competitorMentions || []).join(', ') || '无'}`);
      }
      for (const d of posts.slice(0, 3)) {
        lines.push(`  - [${d.score || 0}↑] ${d.title || 'untitled'} ${d.subreddit ? `(r/${d.subreddit})` : ''}`);
        if (d.painPoints && d.painPoints.length > 0) lines.push(`    - 痛点: ${d.painPoints.join(', ')}`);
        if (d.buyingSignals && d.buyingSignals.length > 0) lines.push(`    - 购买信号: ${d.buyingSignals.join(', ')}`);
        if (d.competitors && d.competitors.length > 0) lines.push(`    - 竞品: ${d.competitors.join(', ')}`);
      }
    } else {
      lines.push(`- Reddit: ${signal.reddit.error || 'no results'}`);
    }
    lines.push('');
  }
  // LLM Research Findings
  if (report.llmResearch && report.llmResearch.available) {
    lines.push('## LLM Research Findings');
    lines.push('');
    if (report.llmResearch.classification) {
      const c = report.llmResearch.classification;
      lines.push(`- Primary intent: ${c.primaryIntent || 'unknown'}`);
      if (c.searchQueries) lines.push(`- Generated queries: ${c.searchQueries.join(', ')}`);
    }
    lines.push(`- Research iterations: ${report.llmResearch.iterations || 0}`);
    const facts = report.llmResearch.extractedFacts || [];
    if (facts.length > 0) {
      lines.push(`- Extracted facts: ${facts.length}`);
      for (const f of facts.slice(0, 10)) {
        lines.push(`  - [${f.type || 'fact'}] ${f.fact || f.snippet || ''}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
