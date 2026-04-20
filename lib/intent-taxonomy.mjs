// Intent Taxonomy v2 — 18 intent types per plan
// Each keyword gets: primary intent, secondary intents, commercial score,
// funnel position, conversion distance, content format suggestion.

export const INTENT_TAXONOMY = [
  // ── High commercial intent (bottom funnel) ──
  {
    key: 'competitor_interception',
    label: '竞品拦截',
    patterns: [/\bvs\b/i, /alternative/i, /instead of/i, /better than/i],
    funnel: 'bottom',
    commercialWeight: 95,
    conversionDistance: 'near',
    suggestedContentType: 'comparison_page',
  },
  {
    key: 'transactional_support',
    label: '交易前决策',
    patterns: [/discount/i, /coupon/i, /promo/i, /sale/i, /buy/i, /where to buy/i, /price/i, /pricing/i, /cost/i, /cheap/i, /deals?/i],
    funnel: 'bottom',
    commercialWeight: 92,
    conversionDistance: 'near',
    suggestedContentType: 'review_page',
  },
  {
    key: 'review_judgment',
    label: '评测判断',
    patterns: [/review/i, /worth it/i, /pros and cons/i, /rating/i, /legit/i, /scam/i, /honest/i, /real review/i],
    funnel: 'bottom',
    commercialWeight: 90,
    conversionDistance: 'near',
    suggestedContentType: 'review_page',
  },
  {
    key: 'brand_defense',
    label: '品牌防御',
    patterns: [/\barousen\b/i, /\blovense\b/i, /\blelo\b/i, /\bwe-vibe\b/i, /\bwomanizer\b/i, /\bsatisfyer\b/i, /\bdame\b/i, /\bpinkpunch\b/i],
    funnel: 'bottom',
    commercialWeight: 88,
    conversionDistance: 'near',
    suggestedContentType: 'brand_page',
  },

  // ── Mid-funnel commercial investigation ──
  {
    key: 'commercial_investigation',
    label: '商业调查',
    patterns: [/best/i, /top\s*\d/i, /top rated/i, /recommended/i, /for beginners/i, /for couples/i, /for women/i, /for men/i, /\d+ best/i],
    funnel: 'mid',
    commercialWeight: 82,
    conversionDistance: 'mid',
    suggestedContentType: 'bestof_page',
  },
  {
    key: 'feature_driven_commercial',
    label: '功能型商业词',
    patterns: [
      /app[- ]controlled/i, /remote control/i, /long distance/i, /quiet/i,
      /discreet/i, /wearable/i, /waterproof/i, /body-safe/i, /mini vibrator/i,
      /bullet vibrator/i, /rabbit vibrator/i, /g[- ]spot vibrator/i, /rechargeable/i,
      /hands[- ]free/i, /couples? vibrator/i, /dual stimulation/i,
    ],
    funnel: 'mid',
    commercialWeight: 75,
    conversionDistance: 'mid',
    suggestedContentType: 'category_page',
  },
  {
    key: 'comparison_shop',
    label: '对比选购',
    patterns: [/compare/i, /comparison/i, /differen[tc]/i, /which is/i, /or\s+\w+\s+better/i],
    funnel: 'mid',
    commercialWeight: 80,
    conversionDistance: 'mid',
    suggestedContentType: 'comparison_page',
  },
  {
    key: 'alternative_seeking',
    label: '替代品搜索',
    patterns: [/alternative/i, /substitute/i, /similar to/i, /like \w+ but/i, /other options/i, /instead of/i],
    funnel: 'mid',
    commercialWeight: 78,
    conversionDistance: 'mid',
    suggestedContentType: 'comparison_page',
  },
  {
    key: 'objection_handling',
    label: '顾虑消除',
    patterns: [/safe/i, /danger/i, /risk/i, /harm/i, /side effect/i, /cause damage/i, /nerve damage/i, /addicted/i, /desensitiz/i, /too much/i],
    funnel: 'mid',
    commercialWeight: 65,
    conversionDistance: 'mid-far',
    suggestedContentType: 'guide_page',
  },
  {
    key: 'post_purchase',
    label: '购后支持',
    patterns: [/how to clean/i, /how to sanitize/i, /how to charge/i, /not working/i, /warranty/i, /repair/i, /how to store/i, /battery/i],
    funnel: 'post',
    commercialWeight: 45,
    conversionDistance: 'far',
    suggestedContentType: 'guide_page',
  },
  {
    key: 'retention_upsell',
    label: '复购升级',
    patterns: [/upgrade/i, /premium/i, /luxury/i, /next level/i, /advanced/i, /pro version/i, /collection/i, /gift set/i, /gift guide/i],
    funnel: 'post',
    commercialWeight: 70,
    conversionDistance: 'mid',
    suggestedContentType: 'bestof_page',
  },

  // ── Top-funnel awareness ──
  {
    key: 'problem_solution',
    label: '问题解决',
    patterns: [/how to/i, /how do/i, /how can/i, /ways to/i, /tips/i, /tricks/i, /hack/i, /solution/i, /fix/i],
    funnel: 'top',
    commercialWeight: 55,
    conversionDistance: 'mid-far',
    suggestedContentType: 'guide_page',
  },
  {
    key: 'educational',
    label: '教育科普',
    patterns: [/what is/i, /guide to/i, /beginner guide/i, /101/i, /basics/i, /explained/i, /science/i, /anatomy/i, /types of/i],
    funnel: 'top',
    commercialWeight: 35,
    conversionDistance: 'far',
    suggestedContentType: 'guide_page',
  },
  {
    key: 'howto_usage',
    label: '使用教程',
    patterns: [/how to use/i, /how does/i, /tutorial/i, /step by step/i, /first time/i, /positions?/i, /techniques?/i],
    funnel: 'top',
    commercialWeight: 50,
    conversionDistance: 'mid-far',
    suggestedContentType: 'guide_page',
  },
  {
    key: 'use_case_scenario',
    label: '场景需求',
    patterns: [/for travel/i, /on a plane/i, /for apartment/i, /for roommate/i, /for partner/i, /for solo/i, /discreet/i, /hide/i, /in public/i, /shower/i, /bath/i, /bed/i],
    funnel: 'top',
    commercialWeight: 60,
    conversionDistance: 'mid',
    suggestedContentType: 'guide_page',
  },
  {
    key: 'trend_spike',
    label: '热点趋势',
    patterns: [/new\b/i, /\d{4}/i, /latest/i, /trending/i, /viral/i, /tiktok/i, /influencer/i, /celebrity/i, /valentine/i, /christmas/i, /black friday/i, /holiday/i],
    funnel: 'top',
    commercialWeight: 55,
    conversionDistance: 'mid-far',
    suggestedContentType: 'bestof_page',
  },
  {
    key: 'ugc_pain_point',
    label: 'UGC 痛点',
    patterns: [/complaint/i, /problem/i, /issue/i, /disappointed/i, /regret/i, /waste/i, /overrated/i, /not worth/i, /return/i, /bad/i, /broke/i, /stopped/i],
    funnel: 'mid',
    commercialWeight: 62,
    conversionDistance: 'mid',
    suggestedContentType: 'review_page',
  },
  {
    key: 'hidden_demand',
    label: '隐性需求',
    patterns: [/wish/i, /looking for/i, /need something/i, /cant find/i, /hard to find/i, /why isnt there/i, /someone should/i, /i want/i, /anyone know/i],
    funnel: 'top',
    commercialWeight: 58,
    conversionDistance: 'mid-far',
    suggestedContentType: 'guide_page',
  },
];

// Navigational is a catch-all for brand-specific navigational queries
const NAVIGATIONAL_PATTERNS = [/\blogin\b/i, /\bwebsite\b/i, /\bofficial\b/i, /\bstore\b/i, /\bshop\b/i];

export function scoreIntent(keyword) {
  const value = String(keyword || '').trim();
  const normalized = value.toLowerCase();

  let primary = {
    intentKey: 'unknown',
    intentLabel: '未分类',
    funnel: 'unknown',
    commercialScore: 10,
    conversionDistance: 'unknown',
    matchedPatterns: [],
    suggestedContentType: 'category_page',
  };

  // Collect ALL matching intents (for secondary intents)
  const allMatches = [];

  for (const rule of INTENT_TAXONOMY) {
    const matchedPatterns = rule.patterns
      .filter((pattern) => pattern.test(normalized))
      .map((pattern) => pattern.source);
    if (matchedPatterns.length === 0) continue;

    const score = Math.min(100, rule.commercialWeight + matchedPatterns.length * 3);
    allMatches.push({
      intentKey: rule.key,
      intentLabel: rule.label,
      funnel: rule.funnel,
      commercialScore: score,
      conversionDistance: rule.conversionDistance,
      matchedPatterns,
      suggestedContentType: rule.suggestedContentType,
    });
  }

  // Check navigational
  const navPatterns = NAVIGATIONAL_PATTERNS.filter((p) => p.test(normalized));
  if (navPatterns.length > 0) {
    allMatches.push({
      intentKey: 'navigational',
      intentLabel: '导航型',
      funnel: 'bottom',
      commercialScore: 20,
      conversionDistance: 'near',
      matchedPatterns: navPatterns.map((p) => p.source),
      suggestedContentType: 'brand_page',
    });
  }

  if (allMatches.length === 0) {
    // Generic category fallback
    if (/vibrators?/i.test(normalized) || /stimulators?/i.test(normalized) || /wand/i.test(normalized)) {
      primary = {
        intentKey: 'generic_category',
        intentLabel: '泛品类',
        funnel: 'top',
        commercialScore: 25,
        conversionDistance: 'far',
        matchedPatterns: ['generic_vibrator'],
        suggestedContentType: 'category_page',
      };
    }
    return {
      primary,
      secondaryIntents: [],
      ...primary,
    };
  }

  // Sort by score, highest first
  allMatches.sort((a, b) => b.commercialScore - a.commercialScore);
  primary = allMatches[0];

  // Secondary intents: top 2 after primary (deduplicated)
  const secondaryIntents = allMatches
    .slice(1, 3)
    .map((m) => ({ key: m.intentKey, label: m.intentLabel }));

  return {
    primary,
    secondaryIntents,
    // Flatten for backward compatibility
    intentKey: primary.intentKey,
    intentLabel: primary.intentLabel,
    funnel: primary.funnel,
    commercialScore: primary.commercialScore,
    conversionDistance: primary.conversionDistance,
    matchedPatterns: primary.matchedPatterns,
    suggestedContentType: primary.suggestedContentType,
  };
}

export function detectContentFormat(keyword) {
  const normalized = String(keyword || '').toLowerCase();
  if (/review|worth it|complaints?|issues?|problems?|pros and cons|legit|scam/.test(normalized)) return 'review_page';
  if (/\bvs\b|compare|comparison|alternative|instead of|better than|which is/.test(normalized)) return 'comparison_page';
  if (/best|top|recommended|\d+ best/.test(normalized)) return 'bestof_page';
  if (/how to|guide|what is|safe|clean|sanitize|hide|travel|plane|tutorial|step by step|first time/.test(normalized)) return 'guide_page';
  if (/discount|coupon|promo|sale|buy|price|pricing|cheap|deal/.test(normalized)) return 'deal_page';
  if (/brand|official|login|store/.test(normalized)) return 'brand_page';
  return 'category_page';
}

export function rankPriority({ commercialScore = 0, semrushVolume = 0, liveSignalScore = 0, kd = 0 }) {
  const volume = Number.isFinite(Number(semrushVolume)) ? Number(semrushVolume) : 0;
  const live = Number.isFinite(Number(liveSignalScore)) ? Number(liveSignalScore) : 0;
  const kdScore = Number.isFinite(Number(kd)) ? Number(kd) : 50;

  // KD penalty: high difficulty keywords get deprioritized for PSEO
  // kdScore 0-20: easy (penalty=0), 20-40: moderate (penalty=0-15), 40-60: hard (15-35), 60+: very hard (35-50)
  let kdPenalty = 0;
  if (kdScore > 60) kdPenalty = 50;
  else if (kdScore > 40) kdPenalty = 15 + (kdScore - 40) * 1;
  else if (kdScore > 20) kdPenalty = (kdScore - 20) * 0.75;

  const blended = commercialScore * 0.45 + Math.min(100, Math.log10(volume + 1) * 20) * 0.2 + live * 0.25 + (100 - kdPenalty) * 0.1;

  // Hard cap: KD > 60 can never be P0 regardless of other signals
  if (kdScore > 60 && blended >= 80) return 'P1';
  if (kdScore > 80 && blended >= 60) return 'P2';

  if (blended >= 80) return 'P0';
  if (blended >= 60) return 'P1';
  if (blended >= 40) return 'P2';
  return 'P3';
}

// Brand fitness: how well a keyword matches a specific brand's positioning
export function assessBrandFitness(keyword, brand) {
  const normalized = String(keyword || '').toLowerCase();
  const fitnessMap = {
    arousen: {
      positive: [/vibrat/i, /stimulat/i, /wellness/i, /pleasure/i, /clitoral/i, /g[- ]spot/i, /rabbit/i, /wand/i, /couples?/i, /solo/i, /app/i, /remote/i],
      negative: [/\bdame\b/i, /\blelo\b/i, /\blovense\b/i, /\bwe-vibe\b/i, /\bwomanizer\b/i, /\bsatisfyer\b/i],
    },
    '302ai': {
      positive: [/api/i, /ai\b/i, /model/i, /generate/i, /pricing/i, /docs/i, /integration/i],
      negative: [],
    },
    hakkoai: {
      positive: [/coach/i, /tracker/i, /guide/i, /tier list/i, /settings/i, /build/i, /rank/i, /gaming/i],
      negative: [],
    },
    pinkpunch: {
      positive: [/vibrat/i, /pleasure/i, /wellness/i, /discreet/i, /mini/i, /quiet/i],
      negative: [/\bdame\b/i, /\blelo\b/i, /\blovense\b/i],
    },
    leewow: {
      positive: [/coach/i, /dating/i, /relationship/i, /communication/i, /text/i, /message/i],
      negative: [],
    },
  };

  const rules = fitnessMap[brand];
  if (!rules) return { score: 50, label: 'unknown' };

  let score = 50;
  for (const p of rules.positive) {
    if (p.test(normalized)) score += 12;
  }
  for (const n of rules.negative) {
    if (n.test(normalized)) score -= 20;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    label: score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low',
  };
}
