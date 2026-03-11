import fetch from 'node-fetch';
import { resolveCuratedGrocery } from './catalog.js';
import { normalizeSearchInput, tokenizeSearchInput } from './normalize.js';

const FRED_SERIES_SEARCH_ENDPOINT = 'https://api.stlouisfed.org/fred/series/search';
const MAX_FRED_SEARCH_RESULTS = 25;
const MAX_GROCERY_CANDIDATES = 5;

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getFredApiKey() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw createHttpError(500, 'FRED_API_KEY is missing');
  }
  return apiKey;
}

function buildSearchText(normalizedQuery, curatedMatch) {
  if (!curatedMatch) {
    return normalizedQuery;
  }

  return [curatedMatch.canonicalName, ...curatedMatch.aliases]
    .slice(0, 4)
    .join(' ');
}

function parseObservationEnd(value) {
  if (!value || value === '9999-12-31') {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function scoreSeries(series, context) {
  const title = normalizeSearchInput(series.title);
  const notes = normalizeSearchInput(series.notes || '');
  const text = `${title} ${notes}`.trim();
  const queryTerms = context.queryTerms;
  const canonicalTerms = context.canonicalTerms;
  let score = 0;

  if (context.preferredSeriesId && series.id === context.preferredSeriesId) {
    score += 150;
  }

  if (title === context.normalizedQuery) {
    score += 90;
  }

  if (context.normalizedCanonical && title === context.normalizedCanonical) {
    score += 80;
  }

  if (title.includes(context.normalizedQuery)) {
    score += 35;
  }

  if (context.normalizedCanonical && title.includes(context.normalizedCanonical)) {
    score += 30;
  }

  for (const term of queryTerms) {
    if (title.includes(term)) {
      score += 12;
    } else if (text.includes(term)) {
      score += 5;
    } else {
      score -= 6;
    }
  }

  for (const term of canonicalTerms) {
    if (title.includes(term)) {
      score += 6;
    }
  }

  const positiveSignals = [
    { pattern: /\baverage price\b/, points: 30 },
    { pattern: /\bu s city average\b/, points: 28 },
    { pattern: /\bcity average\b/, points: 16 },
    { pattern: /\bconsumer\b/, points: 12 },
    { pattern: /\bfood\b/, points: 10 },
    { pattern: /\bretail\b/, points: 8 },
    { pattern: /\bfresh\b/, points: 8 }
  ];

  for (const signal of positiveSignals) {
    if (signal.pattern.test(text)) {
      score += signal.points;
    }
  }

  const negativeSignals = [
    { pattern: /\bproducer\b/, points: -35 },
    { pattern: /\bwholesale\b/, points: -35 },
    { pattern: /\bindustrial\b/, points: -40 },
    { pattern: /\bmanufacturing\b/, points: -40 },
    { pattern: /\bimport\b/, points: -30 },
    { pattern: /\bexport\b/, points: -30 },
    { pattern: /\bcommodity\b/, points: -12 },
    { pattern: /\bppi\b/, points: -25 },
    { pattern: /\bfarm products?\b/, points: -14 },
    { pattern: /\blivestock\b/, points: -14 }
  ];

  for (const signal of negativeSignals) {
    if (signal.pattern.test(text)) {
      score += signal.points;
    }
  }

  if ((series.frequency_short || '').toUpperCase() === 'M') {
    score += 18;
  } else if ((series.frequency_short || '').toUpperCase() === 'Q') {
    score += 4;
  } else {
    score -= 8;
  }

  const observationEnd = parseObservationEnd(series.observation_end);
  if (observationEnd === Number.POSITIVE_INFINITY) {
    score += 15;
  } else {
    const ageInDays = (Date.now() - observationEnd) / (1000 * 60 * 60 * 24);
    if (ageInDays <= 400) {
      score += 14;
    } else if (ageInDays <= 365 * 3) {
      score += 8;
    } else if (ageInDays > 365 * 8) {
      score -= 12;
    }
  }

  if (/\b(chicago|new york|los angeles|atlanta|detroit|miami|boston|dallas|philadelphia|san francisco)\b/.test(title) && !/\bu s city average\b/.test(title)) {
    score -= 16;
  }

  return score;
}

async function searchFredSeries(searchText) {
  const apiKey = getFredApiKey();
  const query = new URLSearchParams({
    api_key: apiKey,
    file_type: 'json',
    search_text: searchText,
    limit: String(MAX_FRED_SEARCH_RESULTS),
    order_by: 'search_rank',
    sort_order: 'desc'
  });

  const response = await fetch(`${FRED_SERIES_SEARCH_ENDPOINT}?${query.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    throw createHttpError(502, `FRED search failed (${response.status}): ${body}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw createHttpError(502, 'Invalid JSON from FRED search');
  }

  return Array.isArray(data.seriess) ? data.seriess : [];
}

export async function findGroceryCandidates(query, options = {}) {
  const normalizedQuery = normalizeSearchInput(query);
  if (!normalizedQuery) {
    return {
      query: String(query || ''),
      normalizedQuery,
      curatedMatch: null,
      candidates: []
    };
  }

  const curatedMatch = resolveCuratedGrocery(normalizedQuery);
  const normalizedCanonical = curatedMatch?.canonicalKey || normalizedQuery;
  const searchResults = await searchFredSeries(buildSearchText(normalizedQuery, curatedMatch));
  const context = {
    normalizedQuery,
    normalizedCanonical,
    preferredSeriesId: curatedMatch?.preferredSeriesId || null,
    queryTerms: tokenizeSearchInput(normalizedQuery),
    canonicalTerms: tokenizeSearchInput(normalizedCanonical)
  };

  const candidates = searchResults
    .map((series) => ({
      seriesId: series.id,
      title: series.title,
      units: series.units || '',
      frequency: series.frequency || '',
      frequencyShort: series.frequency_short || '',
      observationStart: series.observation_start || '',
      observationEnd: series.observation_end || '',
      score: scoreSeries(series, context)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return parseObservationEnd(b.observationEnd) - parseObservationEnd(a.observationEnd);
    })
    .slice(0, options.maxCandidates || MAX_GROCERY_CANDIDATES);

  return {
    query: String(query || ''),
    normalizedQuery,
    curatedMatch,
    candidates
  };
}
