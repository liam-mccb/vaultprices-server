import fetch from 'node-fetch';
import {
  EIA_CATALOG,
  EIA_ITEMS,
  EIA_SOURCE_NAME,
  looksLikeEnergyQuery,
  rankEiaMappings,
  resolveCuratedEnergy
} from './eiaCatalog.js';
import { normalizeSearchInput } from './normalize.js';

const EIA_API_BASE_URL = 'https://api.eia.gov/v2';
const MAX_EIA_CANDIDATES = 5;

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function getEiaApiKey() {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    throw createHttpError(500, 'EIA_API_KEY is missing');
  }
  return apiKey;
}

function buildCandidate(item, score, normalizedQuery) {
  return {
    item: item.canonicalKey,
    canonicalItem: item.canonicalKey,
    canonicalName: item.canonicalName,
    requestedItem: normalizedQuery,
    seriesId: item.seriesId || item.routeId,
    title: item.title,
    units: item.units,
    frequency: item.frequency,
    frequencyShort: item.frequencyShort,
    observationStart: '',
    observationEnd: '',
    score,
    sourceName: EIA_SOURCE_NAME
  };
}

function compareObservationDate(a, b) {
  return String(a.date).localeCompare(String(b.date));
}

function parseEiaPayload(payload) {
  const rows = payload?.response?.data;
  return Array.isArray(rows) ? rows : [];
}

function pickObservationValue(row, dataField) {
  const directValue = row?.[dataField];
  if (directValue !== undefined && directValue !== null && directValue !== '') {
    return Number(directValue);
  }

  if (row?.value !== undefined && row?.value !== null && row?.value !== '') {
    return Number(row.value);
  }

  const ignoredKeys = new Set([
    'period',
    'series-description',
    'seriesDescription',
    'name',
    'product',
    'process',
    'duoarea',
    'area-name',
    'areaName',
    'stateid',
    'sectorid',
    'sectorName'
  ]);

  for (const [key, value] of Object.entries(row || {})) {
    if (
      ignoredKeys.has(key) ||
      key.endsWith('-units') ||
      key.endsWith('-description') ||
      key.endsWith('-name')
    ) {
      continue;
    }

    const numericValue = Number(value);
    if (value !== null && value !== '' && Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

async function fetchEiaData(entry) {
  const apiKey = getEiaApiKey();
  const query = new URLSearchParams({
    api_key: apiKey,
    length: '5000'
  });
  query.append('sort[0][column]', 'period');
  query.append('sort[0][direction]', 'asc');

  let endpoint = '';

  if (entry.seriesId) {
    endpoint = `${EIA_API_BASE_URL}/seriesid/${encodeURIComponent(entry.seriesId)}`;
  } else {
    endpoint = `${EIA_API_BASE_URL}/${entry.route}`;
    query.append('frequency', entry.frequency.toLowerCase());
    query.append('data[]', entry.dataField);

    for (const [facetName, facetValues] of Object.entries(entry.facets || {})) {
      for (const value of facetValues) {
        query.append(`facets[${facetName}][]`, value);
      }
    }
  }

  const response = await fetch(`${endpoint}?${query.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    throw createHttpError(502, `EIA request failed (${response.status}): ${body}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw createHttpError(502, 'Invalid JSON from EIA');
  }

  const rows = parseEiaPayload(payload);
  if (!rows.length) {
    throw createHttpError(404, `No EIA data found for: ${entry.canonicalName}`);
  }

  const observations = rows
    .map((row) => {
      const value = pickObservationValue(row, entry.dataField);
      return {
        date: row.period,
        value
      };
    })
    .filter((row) => row.date && Number.isFinite(row.value))
    .sort(compareObservationDate);

  if (!observations.length) {
    throw createHttpError(404, `No numeric EIA observations found for: ${entry.canonicalName}`);
  }

  const firstRow = rows[0] || {};
  const unit =
    firstRow?.[`${entry.dataField}-units`] ||
    payload?.response?.units ||
    entry.units ||
    '';

  return {
    unit,
    observations,
    history: observations.map((row) => ({ date: row.date, price: row.value })),
    data: observations.map((row) => ({ date: row.date, price: row.value }))
  };
}

export { EIA_ITEMS, EIA_SOURCE_NAME, looksLikeEnergyQuery };

export async function findEiaCandidates(query, options = {}) {
  const normalizedQuery = normalizeSearchInput(query);
  if (!normalizedQuery) {
    return {
      query: String(query || ''),
      normalizedQuery,
      curatedMatch: null,
      candidates: []
    };
  }

  const curatedMatch = resolveCuratedEnergy(normalizedQuery);
  const ranked = rankEiaMappings(normalizedQuery)
    .slice(0, options.maxCandidates || MAX_EIA_CANDIDATES)
    .map(({ item, score }) => buildCandidate(item, score, normalizedQuery));

  return {
    query: String(query || ''),
    normalizedQuery,
    curatedMatch,
    candidates: ranked
  };
}

export function resolveEiaSeries(query) {
  const normalizedQuery = normalizeSearchInput(query);
  if (!normalizedQuery || !looksLikeEnergyQuery(normalizedQuery)) {
    return null;
  }

  const curatedMatch = resolveCuratedEnergy(normalizedQuery);
  const bestMatch = curatedMatch || rankEiaMappings(normalizedQuery)[0]?.item || null;
  if (!bestMatch) {
    return null;
  }

  return {
    requestedItem: normalizedQuery,
    canonicalItem: bestMatch.canonicalKey,
    canonicalName: bestMatch.canonicalName,
    seriesId: bestMatch.seriesId || bestMatch.routeId,
    sourceName: EIA_SOURCE_NAME,
    matchType: curatedMatch ? 'eia-curated' : 'eia-search',
    providerConfig: bestMatch
  };
}

export async function fetchEiaHistory(query) {
  const resolved = resolveEiaSeries(query);
  if (!resolved) {
    throw createHttpError(404, `No EIA series found for: ${query}`);
  }

  const seriesData = await fetchEiaData(resolved.providerConfig);
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
    observations: seriesData.observations,
    matchType: resolved.matchType
  };
}
