# Nichedigger

Reddit-powered keyword mining for PSEO. Mine real user conversations to find high-conversion long-tail keywords.

## What It Does

Nichedigger takes a list of keywords and mines Reddit for real user discussions, extracting buying signals, pain points, and competitor mentions. It ranks keywords by commercial intent + live Reddit signals + keyword difficulty, outputting a prioritized list of content opportunities.

**Not another keyword volume tool.** This finds the *why* behind searches by reading what real users actually say.

## How It Works

```
Keywords → Intent Scoring (18 types) → LLM Query Generation → Reddit Mining (3 rounds)
                ↓                            ↓                        ↓
         commercial score            targeted searches         buying signals
         brand fitness               follow-up angles           pain points
         funnel position             topic pivots               competitor mentions
                ↓                            ↓                        ↓
                              Relevance Filtering
                                      ↓
                            Priority Ranking (P0-P3)
                           KD > 60 can never be P0
                                      ↓
                              Report + Dashboard
```

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/nichedigger.git
cd nichedigger
npm install

# Set environment
export HTTPS_PROXY=http://127.0.0.1:7892  # Required for Reddit API from China
export LLM_API_KEY=your_key_here          # Optional: enables deep research

# Run
node cli.mjs --keywords "best vibrator,best wand vibrator,quiet vibrator" --brand arousen

# Or with server + web dashboard
node server.mjs  # http://127.0.0.1:4318
```

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--keywords` | Comma-separated keywords or CSV path | (required) |
| `--brand` | Brand slug for fitness scoring | `generic` |
| `--output` | Output directory | `./output` |
| `--limit` | Max keywords to analyze | `30` |
| `--iterations` | LLM research iterations | `3` |
| `--dry-run` | Print results, no file output | `false` |

## Priority Formula

```
blended = commercialScore × 0.45
        + liveSignalScore × 0.25
        + log10(volume+1) × 20 × 0.20
        + KD_penalty × 0.10

P0: blended >= 80  (KD>60 hard-capped to P1)
P1: blended >= 60  (KD>80 hard-capped to P2)
P2: blended >= 40
P3: below 40
```

## Relevance Filtering

Every Reddit post goes through token-overlap relevance check. Posts with < 30% overlap get **zero signals**. No false positives.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HTTPS_PROXY` | Yes (China) | — | Proxy for Reddit API |
| `LLM_API_KEY` | No | — | Enables LLM deep research |
| `LLM_BASE_URL` | No | `https://open.bigmodel.cn/api/paas/v4` | LLM endpoint |
| `LLM_MODEL` | No | `glm-4-flash` | Model name |

## License

MIT
