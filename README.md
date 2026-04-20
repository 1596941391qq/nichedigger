<div align="center">

# 🔍 Nichedigger

**Reddit-Powered Keyword Mining for PSEO**

Mine high-conversion long-tail keywords from real user conversations.

[![GitHub stars](https://img.shields.io/github/stars/1596941391qq/nichedigger?style=social)](https://github.com/1596941391qq/nichedigger)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

[English](#features) · [中文说明](#中文说明)

</div>

---

## Stop Guessing, Start Mining

Traditional keyword tools give you volume and KD. **Nichedigger tells you WHY people search.**

It mines Reddit for real user conversations, extracts buying signals and pain points, then ranks keywords by what actually converts — not just what gets clicks.

```
Traditional:  "best vibrator" → volume: 12100, KD: 72 → ???
Nichedigger:  "best vibrator" → 47 Reddit threads, 23 buying signals,
              pain: "too loud for roommates" → P0, write best-of guide
```

## Screenshots

![Dashboard - How It Works](docs/dashboard-top.png)

![Dashboard - Keywords & Signals](docs/dashboard-bottom.png)

## Features

- **18 Intent Types** — From competitor interception (95) to educational (35), every keyword gets a precise commercial intent score
- **Reddit Deep Mining** — Direct JSON API with rate limiting. Buying signals, pain points, competitor mentions extracted from real posts
- **LLM-Powered Research Loop** — Any OpenAI-compatible LLM generates targeted Reddit search queries, iterates 3 rounds, each round deciding the next angle
- **Relevance Filtering** — Token-overlap gate kills false positives. No more nuclear fusion when searching for vibrators
- **KD-Aware Priority** — P0/P1/P2/P3 ranking with keyword difficulty baked in. KD > 60 can never be P0
- **Brand Fitness Scoring** — Each keyword scored against your brand positioning
- **Zero SEO Tool Dependency** — Pure Reddit data. No Semrush subscription needed

## Quick Start

```bash
git clone https://github.com/1596941391qq/nichedigger.git
cd nichedigger
npm install

# Basic usage (no LLM)
export HTTPS_PROXY=http://127.0.0.1:7892
node cli.mjs --keywords "best vibrator,quiet vibrator,vibrator for couples" --brand arousen

# With LLM deep research (recommended)
export LLM_API_KEY=your_api_key
node cli.mjs --keywords "best vibrator,quiet vibrator" --brand arousen --iterations 3

# Web dashboard mode
node server.mjs  # http://127.0.0.1:4318
```

## How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Keywords    │────▶│  Intent Scoring  │────▶│  LLM Classify   │
│  (CSV/text)  │     │  (18 types)      │     │  (Reddit queries)│
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
              ┌────────────────────────────────────────┘
              ▼
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Reddit Mining   │────▶│  Relevance       │────▶│  Priority       │
│  (3 iterations)  │     │  Filtering       │     │  Ranking (P0-P3)│
│  buying signals  │     │  (token overlap) │     │  KD penalty     │
│  pain points     │     │  <30% = zeroed   │     │  brand fitness  │
│  competitors     │     └──────────────────┘     └────────┬────────┘
└──────────────────┘                                         │
                                                             ▼
                                               ┌──────────────────┐
                                               │  Report + CSV +  │
                                               │  Web Dashboard   │
                                               └──────────────────┘
```

## Priority Formula

```
blended = commercialScore × 0.45      # 18-intent taxonomy
        + liveSignalScore × 0.25      # Reddit buying signals + pain points
        + log10(volume+1)×20 × 0.20   # Search volume
        + KD_penalty × 0.10           # Keyword difficulty (inverse)

Hard caps: KD > 60 → max P1 | KD > 80 → max P2
```

## 18 Intent Taxonomy

| Intent | Weight | Funnel | What It Catches |
|--------|--------|--------|-----------------|
| Competitor Interception | 95 | Bottom | "X vs Y", "alternative to" |
| Transactional Support | 92 | Bottom | "buy", "price", "discount" |
| Review Judgment | 90 | Bottom | "review", "worth it", "legit" |
| Brand Defense | 88 | Bottom | Brand name mentions |
| Commercial Investigation | 82 | Mid | "best X", "top rated" |
| Comparison Shop | 80 | Mid | "compare", "different" |
| Alternative Seeking | 78 | Mid | "similar to", "instead of" |
| Feature-Driven | 75 | Mid | "quiet", "waterproof", "app-controlled" |
| Retention Upsell | 70 | Post | "upgrade", "premium" |
| Objection Handling | 65 | Mid | "safe?", "side effects" |
| UGC Pain Point | 62 | Mid | "disappointed", "broke" |
| Use Case Scenario | 60 | Top | "for travel", "for apartment" |
| Hidden Demand | 58 | Top | "wish there was", "cannot find" |
| Trend Spike | 55 | Top | "viral", "2025", "tiktok" |
| Problem Solution | 55 | Top | "how to", "fix" |
| How-To Usage | 50 | Top | "how to use", "tutorial" |
| Post Purchase | 45 | Post | "how to clean", "not working" |
| Educational | 35 | Top | "what is", "guide" |

## CLI Reference

```
node cli.mjs [options]

  --keywords <string>    Comma-separated keywords or CSV path (required)
  --brand <slug>         Brand slug for fitness scoring (default: generic)
  --output <dir>         Output directory (default: ./output)
  --limit <n>            Max keywords to analyze (default: 30)
  --iterations <n>       LLM research rounds (default: 3)
  --dry-run              Print results, no file output
```

## API Server

```
node server.mjs  (default port: 4318)

GET  /api/health                 Health check
GET  /api/report?brand=arousen   Get latest report
POST /api/run                    Run mining {brand, keywords}
POST /api/site-sync              Sync to static site
```

## Architecture

```
nichedigger/
├── cli.mjs                    Standalone CLI
├── server.mjs                 HTTP API server
├── index.html                 Web dashboard (self-contained)
├── lib/
│   ├── intent-taxonomy.mjs    18 intents + brand fitness + KD ranking
│   ├── source-adapters.mjs    Reddit API + rate limit + relevance filter
│   ├── research-loop.mjs      LLM iterative research (3 rounds)
│   ├── llm-adapter.mjs        LLM adapter (OpenAI-compatible)
│   ├── content-extractor.mjs  HTML → text extraction
│   └── report-writer.mjs      JSON + CSV + Markdown output
└── docs/
    ├── dashboard-top.png      Screenshot (How It Works)
    └── dashboard-bottom.png   Screenshot (Keywords & Signals)
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HTTPS_PROXY` | China | — | Proxy for Reddit API |
| `LLM_API_KEY` | Optional | — | Any OpenAI-compatible API key |
| `LLM_BASE_URL` | No | — | Custom LLM endpoint |
| `LLM_MODEL` | No | `glm-4-flash` | Model name |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=1596941391qq/nichedigger&type=Date)](https://star-history.com/#1596941391qq/nichedigger&Date)

---

## 中文说明

### 别猜了，直接挖

传统关键词工具只给搜索量和难度。**Nichedigger 告诉你为什么有人搜这个词。**

它从 Reddit 真人对话中提取购买信号、痛点和竞品提及，然后按商业意图 + 实时信号 + KD 难度排序，输出优先级关键词列表。

```
传统工具: "best vibrator" → 搜索量: 12100, KD: 72 → 接下来呢？
Nichedigger: "best vibrator" → 47条Reddit讨论, 23个购买信号,
             痛点: "室友能听到" → P0优先级, 建议写best-of指南
```

### 截图

![看板 - How It Works](docs/dashboard-top.png)

![看板 - 关键词 & 信号](docs/dashboard-bottom.png)

### 核心特性

- **18种意图分类** — 从竞品拦截(95分)到教育科普(35分)，每个词精确打分
- **Reddit深度挖掘** — 直接JSON API，带限速保护。提取购买信号、痛点、竞品提及
- **LLM研究循环** — 支持任何OpenAI兼容API，3轮迭代，每轮LLM决定下一个挖掘角度
- **相关性过滤** — token重叠<30%的帖子信号归零，杜绝"搜振动棒出核聚变"
- **KD感知排序** — KD>60不能P0，KD>80不能P1
- **品牌适配度** — 每个词按品牌定位打分，"lovense review"对非Lovense品牌=低适配
- **零SEO工具依赖** — 纯Reddit数据，不需要任何付费订阅

### 30秒上手

```bash
git clone https://github.com/1596941391qq/nichedigger.git
cd nichedigger && npm install

# 基础用法（不开LLM）
export HTTPS_PROXY=http://127.0.0.1:7892
node cli.mjs --keywords "best vibrator,quiet vibrator" --brand arousen

# 开LLM深度研究（推荐）
export LLM_API_KEY=你的API_key
node cli.mjs --keywords "best vibrator,quiet vibrator" --brand arousen --iterations 3

# Web看板模式
node server.mjs  # http://127.0.0.1:4318
```

### 工作原理

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  关键词列表   │────▶│  18种意图打分     │────▶│  LLM生成搜索词   │
│  (CSV/文本)  │     │  +品牌适配度      │     │  (Reddit优化)    │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
              ┌────────────────────────────────────────┘
              ▼
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Reddit挖掘      │────▶│  相关性过滤       │────▶│  优先级排序      │
│  (3轮迭代)       │     │  (token重叠检测)  │     │  (P0-P3)        │
│  购买信号        │     │  <30% = 信号归零  │     │  KD惩罚         │
│  痛点            │     └──────────────────┘     │  品牌适配        │
│  竞品提及        │                               └────────┬────────┘
└──────────────────┘                                         │
                                                             ▼
                                               ┌──────────────────┐
                                               │  报告 + CSV +    │
                                               │  Web看板         │
                                               └──────────────────┘
```

### 优先级公式

```
总分 = 商业意图 × 0.45 + Reddit实时信号 × 0.25 + 搜索量 × 0.20 + KD惩罚 × 0.10

硬限制: KD > 60 → 最高P1 | KD > 80 → 最高P2
```

### 18种意图分类

| 意图类型 | 权重 | 漏斗位置 | 捕获的搜索词 |
|----------|------|----------|-------------|
| 竞品拦截 | 95 | 底部 | "X vs Y"、"alternative to" |
| 交易决策 | 92 | 底部 | "buy"、"price"、"discount" |
| 评测判断 | 90 | 底部 | "review"、"worth it"、"legit" |
| 品牌防御 | 88 | 底部 | 品牌名提及 |
| 商业调查 | 82 | 中部 | "best X"、"top rated" |
| 对比选购 | 80 | 中部 | "compare"、"different" |
| 替代品搜索 | 78 | 中部 | "similar to"、"instead of" |
| 功能型商业 | 75 | 中部 | "quiet"、"waterproof"、"app-controlled" |
| 复购升级 | 70 | 购后 | "upgrade"、"premium" |
| 顾虑消除 | 65 | 中部 | "safe?"、"side effects" |
| UGC痛点 | 62 | 中部 | "disappointed"、"broke" |
| 场景需求 | 60 | 顶部 | "for travel"、"for apartment" |
| 隐性需求 | 58 | 顶部 | "wish there was"、"cannot find" |
| 热点趋势 | 55 | 顶部 | "viral"、"2025"、"tiktok" |
| 问题解决 | 55 | 顶部 | "how to"、"fix" |
| 使用教程 | 50 | 顶部 | "how to use"、"tutorial" |
| 购后支持 | 45 | 购后 | "how to clean"、"not working" |
| 教育科普 | 35 | 顶部 | "what is"、"guide" |

### CLI 参数

```
node cli.mjs [选项]

  --keywords <字符串>   逗号分隔关键词或CSV路径（必填）
  --brand <品牌>        品牌slug，用于适配度打分（默认: generic）
  --output <目录>       输出目录（默认: ./output）
  --limit <数字>        最大关键词数（默认: 30）
  --iterations <数字>   LLM研究轮数（默认: 3）
  --dry-run             只打印结果，不写文件
```

### API 服务

```
node server.mjs  （默认端口: 4318）

GET  /api/health                 健康检查
GET  /api/report?brand=arousen   获取最新报告
POST /api/run                    执行挖掘 {brand, keywords}
POST /api/site-sync              同步到静态站点
```

### 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `HTTPS_PROXY` | 国内必需 | — | 访问Reddit的代理 |
| `LLM_API_KEY` | 可选 | — | 任何OpenAI兼容API的密钥 |
| `LLM_BASE_URL` | 可选 | — | 自定义LLM端点 |
| `LLM_MODEL` | 可选 | `glm-4-flash` | 模型名 |

---

<div align="center">

**如果这个项目对你有帮助，给个 ⭐️ 吧！**

[![Star History Chart](https://api.star-history.com/svg?repos=1596941391qq/nichedigger&type=Date)](https://star-history.com/#1596941391qq/nichedigger&Date)

MIT License

</div>
