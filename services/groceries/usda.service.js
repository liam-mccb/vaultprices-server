import fetch from 'node-fetch';
import { getGrocerySearchTerms, resolveCuratedGrocery } from './catalog.js';
import { normalizeSearchInput, tokenizeSearchInput } from './normalize.js';

const USDA_REPORTS_ENDPOINT = 'https://marsapi.ams.usda.gov/services/v1.2/reports';
const USDA_SOURCE_NAME = 'USDA MyMarketNews';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const USDA_FETCH_WINDOW = 200;
const CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const LOW_CONFIDENCE_SCORE = 90;

const rawReportsCache = new Map();
const queryResultsCache = new Map();

const QUERY_ALIASES = new Map([
  ['egg', ['egg', 'eggs']],
  ['eggs', ['egg', 'eggs']],
  ['chicken', ['chicken', 'chickens', 'hen', 'hens', 'broiler', 'broilers']],
  ['chickens', ['chicken', 'chickens', 'hen', 'hens', 'broiler', 'broilers']],
  ['beef', ['beef', 'cattle', 'steer', 'steers', 'cow', 'cows']],
  ['tomato', ['tomato', 'tomatoes']],
  ['tomatoes', ['tomato', 'tomatoes']],
  ['potato', ['potato', 'potatoes']],
  ['potatoes', ['potato', 'potatoes']]
]);

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getUsdaApiKey() {
  const apiKey = process.env.USDA_MYMARKET_API_KEY;
  if (!apiKey) {
    throw createHttpError(500, 'USDA_MYMARKET_API_KEY is missing');
  }
  return apiKey;
}

function sanitizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function pickReports(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.reports)) return payload.reports;
  return [];
}

function projectReport(report) {
  return {
    id:
      report?.reportId ||
      report?.report_id ||
      report?.slugId ||
      report?.slug_id ||
      report?.id ||
      null,
    title: report?.reportTitle || report?.report_title || report?.title || report?.name || null,
    commodity: report?.commodity || report?.commodity_name || null,
    marketType: report?.marketType || report?.market_type || null
  };
}

function getCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function setCacheEntry(cache, key, value, ttlMs = CACHE_TTL_MS) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function normalizePluralToken(token) {
  if (!token) return [];

  const forms = new Set([token]);
  if (token.endsWith('ies') && token.length > 3) {
    forms.add(`${token.slice(0, -3)}y`);
  }
  if (token.endsWith('es') && token.length > 2) {
    forms.add(token.slice(0, -2));
  }
  if (token.endsWith('s') && token.length > 1) {
    forms.add(token.slice(0, -1));
  } else {
    forms.add(`${token}s`);
  }
  return [...forms];
}

function expandQueryTerms(query) {
  const tokens = tokenizeSearchInput(query);
  const catalogTerms = getGrocerySearchTerms(query);
  const expanded = new Set(tokens);

  for (const token of tokens) {
    for (const form of normalizePluralToken(token)) {
      expanded.add(form);
    }

    const aliases = QUERY_ALIASES.get(token);
    if (aliases) {
      for (const alias of aliases) {
        expanded.add(alias);
        for (const form of normalizePluralToken(alias)) {
          expanded.add(form);
        }
      }
    }
  }

  for (const term of catalogTerms) {
    expanded.add(term);
    for (const token of tokenizeSearchInput(term)) {
      expanded.add(token);
      for (const form of normalizePluralToken(token)) {
        expanded.add(form);
      }
    }
  }

  return expanded;
}

function extractKeywordValues(report) {
  const keywordSources = [
    report?.keywords,
    report?.keyword,
    report?.tags,
    report?.tag,
    report?.category,
    report?.categories,
    report?.commodityGroup,
    report?.commodity_group
  ];

  const values = [];
  for (const source of keywordSources) {
    if (Array.isArray(source)) {
      values.push(...source);
    } else if (source) {
      values.push(source);
    }
  }

  return values.map((value) => normalizeSearchInput(value)).filter(Boolean);
}

function tokenizeValue(value) {
  return new Set(tokenizeSearchInput(value));
}

function parseReportDate(report) {
  const candidates = [
    report?.publishedDate,
    report?.published_date,
    report?.publishDate,
    report?.publish_date,
    report?.reportDate,
    report?.report_date,
    report?.releaseDate,
    report?.release_date,
    report?.updatedAt,
    report?.updated_at
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function getFreshnessBoost(reportDate, now = new Date()) {
  if (!reportDate) {
    return 0;
  }

  const ageMs = now.getTime() - reportDate.getTime();
  if (ageMs < 0) {
    return 10;
  }

  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) return 25;
  if (ageDays <= 30) return 16;
  if (ageDays <= 90) return 8;
  if (ageDays <= 365) return 3;
  return 0;
}

function scoreReport(report, normalizedQuery, expandedTerms, now = new Date()) {
  const commodity = normalizeSearchInput(report?.commodity || report?.commodity_name || '');
  const title = normalizeSearchInput(
    report?.reportTitle || report?.report_title || report?.title || report?.name || ''
  );
  const keywords = extractKeywordValues(report);

  if (!commodity && !title && keywords.length === 0) {
    return 0;
  }

  const commodityTokens = tokenizeValue(commodity);
  const titleTokens = tokenizeValue(title);
  const keywordTokens = new Set(keywords.flatMap((value) => tokenizeSearchInput(value)));

  let score = 0;

  if (commodity === normalizedQuery) score += 120;
  if (title === normalizedQuery) score += 110;
  if (commodity.includes(normalizedQuery)) score += 70;
  if (title.includes(normalizedQuery)) score += 55;
  if (keywords.some((value) => value.includes(normalizedQuery))) score += 45;

  for (const term of expandedTerms) {
    if (commodityTokens.has(term)) score += 30;
    if (titleTokens.has(term)) score += 18;
    if (keywordTokens.has(term)) score += 24;
  }

  score += getFreshnessBoost(parseReportDate(report), now);

  return score;
}

function createDeduplicationKey(report) {
  const projected = projectReport(report);
  return [
    normalizeSearchInput(projected.title || ''),
    normalizeSearchInput(projected.commodity || ''),
    normalizeSearchInput(projected.marketType || '')
  ].join('|');
}

function dedupeRankedEntries(entries) {
  const deduped = [];
  const seenKeys = new Set();

  for (const entry of entries) {
    const key = createDeduplicationKey(entry.report);
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function logSearchEvent({
  query,
  resolvedItem,
  candidateCount,
  topMatchScore,
  returnedCount,
  cacheHit
}) {
  const payload = {
    event: 'usda_report_search',
    query,
    resolvedItem,
    candidateCount,
    topMatchScore,
    returnedCount,
    cacheHit
  };

  console.info(JSON.stringify(payload));

  if (query && candidateCount === 0) {
    console.warn(
      JSON.stringify({
        event: 'usda_report_search_no_match',
        query,
        resolvedItem
      })
    );
  } else if (query && topMatchScore !== null && topMatchScore < LOW_CONFIDENCE_SCORE) {
    console.warn(
      JSON.stringify({
        event: 'usda_report_search_low_confidence',
        query,
        resolvedItem,
        topMatchScore
      })
    );
  }
}

function buildReportsUrl(limit) {
  const url = new URL(USDA_REPORTS_ENDPOINT);
  url.searchParams.set('limit', String(limit));
  return url;
}

async function fetchRawUsdaReports({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const cacheKey = 'raw-reports';
  if (!forceRefresh) {
    const cached = getCacheEntry(rawReportsCache, cacheKey);
    if (cached) {
      return cached;
    }
  }

  const apiKey = getUsdaApiKey();
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetchImpl(buildReportsUrl(USDA_FETCH_WINDOW), {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      throw createHttpError(401, 'USDA authentication failed');
    }

    if (!response.ok) {
      throw createHttpError(502, `USDA request failed (${response.status})`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw createHttpError(502, 'Invalid JSON from USDA');
    }

    const reports = pickReports(payload);
    setCacheEntry(rawReportsCache, cacheKey, reports);
    return reports;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw createHttpError(504, 'USDA request timed out');
    }
    if (err.statusCode) {
      throw err;
    }
    throw createHttpError(502, 'Failed to fetch USDA reports');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchUsdaReports(options = {}) {
  const limit = sanitizeLimit(options.limit);
  const normalizedQuery = normalizeSearchInput(options.q || options.query || '');
  const hasQueryParam = Object.prototype.hasOwnProperty.call(options, 'q') || Object.prototype.hasOwnProperty.call(options, 'query');
  const resolvedItem = normalizedQuery ? resolveCuratedGrocery(normalizedQuery)?.canonicalKey || null : null;

  if (hasQueryParam && !normalizedQuery) {
    return {
      sourceName: USDA_SOURCE_NAME,
      count: 0,
      reports: []
    };
  }

  const queryCacheKey = normalizedQuery ? `${normalizedQuery}:${limit}` : null;
  if (queryCacheKey) {
    const cached = getCacheEntry(queryResultsCache, queryCacheKey);
    if (cached) {
      logSearchEvent({
        query: normalizedQuery,
        resolvedItem,
        candidateCount: cached.candidateCount,
        topMatchScore: cached.topMatchScore,
        returnedCount: cached.reports.length,
        cacheHit: true
      });
      return {
        sourceName: USDA_SOURCE_NAME,
        count: cached.reports.length,
        reports: cached.reports
      };
    }
  }

  const rawReports = await fetchRawUsdaReports({ fetchImpl: options.fetchImpl });

  let reports = rawReports.map(projectReport);
  let candidateCount = reports.length;
  let topMatchScore = null;

  if (normalizedQuery) {
    const now = options.now instanceof Date ? options.now : new Date();
    const expandedTerms = expandQueryTerms(normalizedQuery);
    const dedupedRankedEntries = dedupeRankedEntries(
      rawReports
        .map((report, index) => ({
          report,
          projected: projectReport(report),
          score: scoreReport(report, normalizedQuery, expandedTerms, now),
          index,
          reportDate: parseReportDate(report)
        }))
        .filter((entry) => entry.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            (right.reportDate?.getTime() || 0) - (left.reportDate?.getTime() || 0) ||
            left.index - right.index
        )
    );

    reports = dedupedRankedEntries.slice(0, limit).map((entry) => entry.projected);
    candidateCount = dedupedRankedEntries.length;
    topMatchScore = dedupedRankedEntries[0]?.score ?? null;
  } else {
    reports = dedupeRankedEntries(
      rawReports.map((report, index) => ({
        report,
        projected: projectReport(report),
        index,
        score: 0,
        reportDate: parseReportDate(report)
      }))
    )
      .sort(
        (left, right) =>
          (right.reportDate?.getTime() || 0) - (left.reportDate?.getTime() || 0) ||
          left.index - right.index
      )
      .slice(0, limit)
      .map((entry) => entry.projected);
  }

  logSearchEvent({
    query: normalizedQuery || null,
    resolvedItem,
    candidateCount,
    topMatchScore,
    returnedCount: reports.length,
    cacheHit: false
  });

  if (queryCacheKey) {
    setCacheEntry(queryResultsCache, queryCacheKey, {
      candidateCount,
      topMatchScore,
      reports
    });
  }

  return {
    sourceName: USDA_SOURCE_NAME,
    count: reports.length,
    reports
  };
}

export function __resetUsdaReportCaches() {
  rawReportsCache.clear();
  queryResultsCache.clear();
}

export const __testables = {
  createDeduplicationKey,
  dedupeRankedEntries,
  expandQueryTerms,
  extractKeywordValues,
  getFreshnessBoost,
  parseReportDate,
  projectReport,
  scoreReport
};
