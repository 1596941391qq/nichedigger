#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO_ROOT = join(fileURLToPath(new URL('..', import.meta.url)), '..');
const CLI_PATH = join(REPO_ROOT, 'tools', 'intent-workbench', 'cli.mjs');
const SITE_SYNC_PATH = join(REPO_ROOT, 'scripts', 'sync-intent-workbench-site.mjs');
const KEYWORD_ROOT = join(REPO_ROOT, 'workspace', 'keyword-mining');
const PORT = Number(process.env.INTENT_WORKBENCH_PORT || 4318);

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function notFound(res) {
  json(res, 404, { ok: false, error: 'not found' });
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildDashboard(report) {
  return {
    brand: report.brand,
    website: report.website,
    generatedAt: report.generatedAt,
    summary: report.summary,
    intentDistribution: report.intentDistribution,
    topOpportunities: (report.topOpportunities || []).slice(0, 30).map((item) => ({
      keyword: item.keyword,
      priority: item.priority,
      intent: item.intentLabel,
      funnel: item.funnel,
      commercialScore: item.commercialScore,
      liveSignalScore: item.liveSignalScore,
      semrushVolume: item.semrushVolume,
      contentFormat: item.contentFormat,
      strategyLine: item.strategyLine,
    })),
    liveSignals: report.liveSignals || [],
  };
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function runNodeScript(scriptPath, args = [], extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `exit ${code}`));
    });
  });
}

async function handleRun(req, res) {
  const raw = await collectBody(req);
  const body = raw ? JSON.parse(raw) : {};
  if (!body.brand) {
    json(res, 400, { ok: false, error: 'brand is required' });
    return;
  }
  const args = ['--brand', body.brand];
  if (body.topic) args.push('--topic', String(body.topic));
  if (body.website) args.push('--website', String(body.website));
  if (body.limit) args.push('--limit', String(body.limit));
  if (body.liveQueryLimit) args.push('--live-query-limit', String(body.liveQueryLimit));
  const extraEnv = {};
  // Forward proxy env vars to CLI subprocess
  for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    if (process.env[key]) extraEnv[key] = process.env[key];
  }
  // Forward LLM config to CLI subprocess
  for (const key of ['LLM_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_TIMEOUT']) {
    if (process.env[key]) extraEnv[key] = process.env[key];
  }
  if (body.env && typeof body.env === 'object') {
    for (const [key, value] of Object.entries(body.env)) {
      if (typeof value === 'string' && value.trim()) {
        extraEnv[key] = value.trim();
      }
    }
  }
  const result = await runNodeScript(CLI_PATH, args, extraEnv);
  json(res, 200, {
    ok: true,
    brand: body.brand,
    output: result.stdout ? JSON.parse(result.stdout) : null,
  });
}

async function handleSiteSync(req, res) {
  const raw = await collectBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const brand = body.brand || 'arousen';
  const result = await runNodeScript(SITE_SYNC_PATH, ['--brand', brand]);
  json(res, 200, {
    ok: true,
    brand,
    output: result.stdout ? JSON.parse(result.stdout) : null,
  });
}

function handleReport(req, res, url) {
  const brand = url.searchParams.get('brand') || 'arousen';
  const report = readJsonFile(join(KEYWORD_ROOT, brand, 'intent-workbench-latest.json'));
  const dashboard = readJsonFile(join(KEYWORD_ROOT, brand, 'intent-workbench-dashboard.json'));
  if (!report) {
    json(res, 404, { ok: false, error: `report not found for ${brand}` });
    return;
  }
  json(res, 200, {
    ok: true,
    brand,
    report,
    dashboard: dashboard || buildDashboard(report),
  });
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    notFound(res);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, {
        ok: true,
        service: 'intent-workbench',
        port: PORT,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/report') {
      handleReport(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      await handleRun(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/site-sync') {
      await handleSiteSync(req, res);
      return;
    }

    notFound(res);
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: String(error.message || error),
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        service: 'intent-workbench',
        port: PORT,
        endpoints: ['/api/health', '/api/report?brand=arousen', '/api/run', '/api/site-sync'],
      },
      null,
      2,
    ) + '\n',
  );
});
