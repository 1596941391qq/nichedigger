#!/usr/bin/env node
// nichedigger HTTP server — standalone
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreIntent, assessBrandFitness, detectContentFormat, rankPriority } from './lib/intent-taxonomy.mjs';
import { collectLiveSignals, discoverSubreddits } from './lib/source-adapters.mjs';
import { isLLMAvailable } from './lib/llm-adapter.mjs';
import { runResearchLoop } from './lib/research-loop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');
const PORT = Number(process.env.PORT || 4318);

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(payload, null, 2));
}

function notFound(res) { json(res, 404, { ok: false, error: 'not found' }); }

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleRun(req, res) {
  const raw = await collectBody(req);
  const body = raw ? JSON.parse(raw) : {};
  if (!body.keywords) { json(res, 400, { ok: false, error: 'keywords is required' }); return; }

  const keywords = body.keywords.split(',').map((k) => k.trim()).filter(Boolean);
  const brand = body.brand || 'generic';
  const targetSubreddits = body.subreddit ? body.subreddit.split(',').map((s) => s.trim()) : [];
  const sortModes = body.sort ? body.sort.split(',').map((s) => s.trim()) : ['relevance', 'top'];
  const useLLM = isLLMAvailable();

  // Subreddit discovery
  let discoveredSubs = [];
  if (targetSubreddits.length === 0 && keywords.length > 0) {
    discoveredSubs = await discoverSubreddits(keywords[0], 8);
  }
  const subsToSearch = [...targetSubreddits, ...discoveredSubs.slice(0, 3).map((s) => s.subreddit)];

  // Score keywords
  const scored = keywords.map((keyword) => {
    const intent = scoreIntent(keyword);
    const fitness = assessBrandFitness(keyword, brand);
    return { keyword, ...intent, contentFormat: detectContentFormat(keyword), brandFitness: fitness.score, brandFitnessLabel: fitness.label, semrushVolume: 0, kd: 0, liveSignalScore: 0, priority: 'P3' };
  });

  // Live signals
  const querySeeds = scored.slice(0, 5).map((k) => k.keyword);
  let liveSignals = [];
  let llmResearch = null;

  if (useLLM && querySeeds.length > 0) {
    try {
      llmResearch = await runResearchLoop(querySeeds[0], { maxIterations: 3 });
      for (const iter of llmResearch.iterations) {
        for (const roundResult of (iter.results || [])) {
          const reddit = roundResult.reddit;
          let liveSignalScore = 0;
          if (reddit && reddit.ok) {
            liveSignalScore = Math.min(100, (reddit.count || 0) * 3 + (reddit.aggregatedSignals?.totalBuyingSignals || 0) * 5 + (reddit.aggregatedSignals?.totalPainPoints || 0) * 2);
          }
          liveSignals.push({ query: roundResult.query, liveSignalScore, reddit, searchMeta: roundResult.searchMeta || {} });
        }
      }
    } catch { liveSignals = await collectLiveSignals(querySeeds, { subreddits: subsToSearch, sortModes }); }
  } else {
    liveSignals = await collectLiveSignals(querySeeds, { subreddits: subsToSearch, sortModes });
  }

  // Rank
  const enriched = scored.map((row) => {
    let best = 0;
    for (const sig of liveSignals) {
      const qt = (sig.query || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const kt = row.keyword.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const overlap = qt.filter((t) => kt.includes(t)).length;
      if (overlap > 0) best = Math.max(best, Math.round((sig.liveSignalScore || 0) * overlap / Math.max(qt.length, 1)));
    }
    return { ...row, liveSignalScore: best, priority: rankPriority({ commercialScore: row.commercialScore, liveSignalScore: best, kd: row.kd }) };
  });

  const report = {
    brand,
    generatedAt: new Date().toISOString(),
    llmEnabled: useLLM,
    summary: {
      keywordCount: enriched.length,
      highPriorityCount: enriched.filter((i) => i.priority === 'P0' || i.priority === 'P1').length,
      subredditCount: subsToSearch.length,
    },
    keywords: enriched,
    topOpportunities: enriched.sort((a, b) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[a.priority] ?? 9) - ({ P0: 0, P1: 1, P2: 2, P3: 3 }[b.priority] ?? 9) || b.commercialScore - a.commercialScore),
    liveSignals,
  };

  if (!existsSync(OUTPUT_DIR)) writeFileSync(join(OUTPUT_DIR, '.gitkeep'), '');
  writeFileSync(join(OUTPUT_DIR, `report-${brand}-${Date.now()}.json`), JSON.stringify(report, null, 2));

  json(res, 200, { ok: true, brand, summary: report.summary });
}

const server = createServer(async (req, res) => {
  if (!req.url) { notFound(res); return; }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
    res.end(); return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') { json(res, 200, { ok: true, service: 'nichedigger', port: PORT }); return; }
    if (req.method === 'POST' && url.pathname === '/api/run') { await handleRun(req, res); return; }
    // Serve dashboard
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html); return;
    }
    notFound(res);
  } catch (error) { json(res, 500, { ok: false, error: String(error.message || error) }); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ ok: true, service: 'nichedigger', port: PORT, endpoints: ['/', '/api/health', '/api/run'] }, null, 2));
});
