import fetch from 'node-fetch';
import { GROCERY_ITEMS, resolveCuratedGrocery } from './catalog.js';
import { findGroceryCandidates } from './fredSearch.service.js';
import { normalizeSearchInput } from './normalize.js';

export { GROCERY_ITEMS } from './catalog.js';

const FRED_OBSERVATIONS_ENDPOINT = 'https://api.stlouisfed.org/fred/series/observations';
const GROCERY_SOURCE_NAME = 'FRED';

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

async function fetchSeriesObservations(seriesId) {
  const query = new URLSearchParams({
    api_key: getFredApiKey(),
    file_type: 'json',
    series_id: seriesId,
    sort_order: 'asc'
  });

  const response = await fetch(`${FRED_OBSERVATIONS_ENDPOINT}?${query.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    throw createHttpError(502, `FRED request failed (${response.status}): ${body}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw createHttpError(502, 'Invalid JSON from FRED');
  }

  const points = (data.observations || [])
    .filter((entry) => entry.value !== '.')
    .map((entry) => ({
      date: entry.date,
      price: Number(entry.value)
    }));

  return {
    unit: data.units || '',
    history: points.map((p) => ({ date: p.date, price: p.price })),
    data: points
  };
}

export async function resolveGrocerySeries(item) {
  const normalizedQuery = normalizeSearchInput(item);
  if (!normalizedQuery) {
    throw createHttpError(400, 'Grocery item is required');
  }

  const curatedMatch = resolveCuratedGrocery(normalizedQuery);
  if (curatedMatch?.preferredSeriesId) {
    return {
      requestedItem: normalizedQuery,
      canonicalItem: curatedMatch.canonicalKey,
      canonicalName: curatedMatch.canonicalName,
      seriesId: curatedMatch.preferredSeriesId,
      sourceName: GROCERY_SOURCE_NAME,
      matchType: 'curated',
      candidates: []
    };
  }

  const searchResult = await findGroceryCandidates(normalizedQuery);
  const selected = searchResult.candidates[0];

  if (!selected) {
    throw createHttpError(404, `No grocery series found for: ${item}`);
  }

  return {
    requestedItem: normalizedQuery,
    canonicalItem: curatedMatch?.canonicalKey || normalizedQuery,
    canonicalName: curatedMatch?.canonicalName || normalizedQuery,
    seriesId: selected.seriesId,
    sourceName: GROCERY_SOURCE_NAME,
    matchType: curatedMatch ? 'curated-fallback' : 'fred-search',
    candidates: searchResult.candidates
  };
}

export async function fetchGroceryHistory(item) {
  const resolved = await resolveGrocerySeries(item);
  const seriesData = await fetchSeriesObservations(resolved.seriesId);

  return {
    item: resolved.canonicalItem,
    requestedItem: resolved.requestedItem,
    seriesId: resolved.seriesId,
    name: resolved.canonicalItem,
    canonicalName: resolved.canonicalName,
    sourceName: resolved.sourceName,
    unit: seriesData.unit,
    currentPrices: [],
    history: seriesData.history,
    data: seriesData.data,
    matchType: resolved.matchType
  };
}
