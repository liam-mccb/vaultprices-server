import {
  fetchGroceryHistory as fetchFredHistory,
  GROCERY_ITEMS as FRED_GROCERY_ITEMS
} from './fred.service.js';
import { findFredCandidates, FRED_SOURCE_NAME } from './fredSearch.service.js';
import {
  EIA_ITEMS,
  fetchEiaHistory,
  findEiaCandidates,
  looksLikeEnergyQuery,
  resolveEiaSeries
} from './eia.service.js';
import { normalizeSearchInput } from './normalize.js';

export const GROCERY_ITEMS = Object.freeze([
  ...new Set([...FRED_GROCERY_ITEMS, ...EIA_ITEMS])
]);

function decorateFredSearchResult(result, normalizedQuery) {
  const canonicalItem = result.curatedMatch?.canonicalKey || normalizedQuery;
  const canonicalName = result.curatedMatch?.canonicalName || normalizedQuery;

  return {
    curatedMatch: result.curatedMatch
      ? {
          canonicalItem: result.curatedMatch.canonicalKey,
          canonicalName: result.curatedMatch.canonicalName,
          preferredSeriesId: result.curatedMatch.preferredSeriesId,
          sourceName: FRED_SOURCE_NAME
        }
      : null,
    candidates: result.candidates.map((candidate) => ({
      item: canonicalItem,
      canonicalItem,
      canonicalName,
      requestedItem: normalizedQuery,
      sourceName: FRED_SOURCE_NAME,
      ...candidate
    }))
  };
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

  const maxCandidates = options.maxCandidates || 5;
  const energyPreferred = looksLikeEnergyQuery(normalizedQuery);
  let curatedMatch = null;
  let candidates = [];

  if (energyPreferred) {
    const eiaResult = await findEiaCandidates(normalizedQuery, { maxCandidates });
    curatedMatch = eiaResult.curatedMatch
      ? {
          canonicalItem: eiaResult.curatedMatch.canonicalKey,
          canonicalName: eiaResult.curatedMatch.canonicalName,
          preferredSeriesId: eiaResult.curatedMatch.seriesId || eiaResult.curatedMatch.routeId,
          sourceName: eiaResult.curatedMatch.sourceName
        }
      : null;
    candidates = eiaResult.candidates;

    if (!candidates.length) {
      const fredResult = decorateFredSearchResult(
        await findFredCandidates(normalizedQuery, { maxCandidates }),
        normalizedQuery
      );

      if (!curatedMatch) {
        curatedMatch = fredResult.curatedMatch;
      }

      candidates = [...candidates, ...fredResult.candidates].slice(0, maxCandidates);
    }
  } else {
    const fredResult = decorateFredSearchResult(
      await findFredCandidates(normalizedQuery, { maxCandidates }),
      normalizedQuery
    );
    curatedMatch = fredResult.curatedMatch;
    candidates = fredResult.candidates;
  }

  return {
    query: String(query || ''),
    normalizedQuery,
    curatedMatch,
    candidates
  };
}

export async function fetchGroceryHistory(item) {
  const normalizedQuery = normalizeSearchInput(item);
  const eiaResolution = resolveEiaSeries(normalizedQuery);
  if (eiaResolution) {
    return fetchEiaHistory(normalizedQuery);
  }

  return fetchFredHistory(normalizedQuery);
}
