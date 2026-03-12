import { normalizeSearchInput, tokenizeSearchInput } from './normalize.js';

export const EIA_SOURCE_NAME = 'EIA';

const energyCatalogSeed = [
  {
    canonicalName: 'crude oil',
    title: 'Crude oil (WTI spot price)',
    seriesId: 'PET.RWTC.D',
    frequency: 'Daily',
    frequencyShort: 'D',
    units: 'Dollars per barrel',
    aliases: ['oil', 'crude oil', 'wti', 'wti crude', 'west texas intermediate']
  },
  {
    canonicalName: 'gasoline',
    title: 'Gasoline (regular retail price, U.S.)',
    seriesId: 'PET.EMM_EPMRR_PTE_NUS_DPG.W',
    frequency: 'Weekly',
    frequencyShort: 'W',
    units: 'Dollars per gallon',
    aliases: ['gasoline', 'gas', 'regular gas', 'regular gasoline', 'gas prices', 'petrol']
  },
  {
    canonicalName: 'diesel',
    title: 'Diesel (on-highway retail price, U.S.)',
    seriesId: 'PET.EMD_EPD2D_PTE_NUS_DPG.W',
    frequency: 'Weekly',
    frequencyShort: 'W',
    units: 'Dollars per gallon',
    aliases: ['diesel', 'diesel fuel', 'ultra low sulfur diesel']
  },
  {
    canonicalName: 'natural gas',
    title: 'Natural gas (Henry Hub spot price)',
    seriesId: 'NG.RNGWHHD.D',
    frequency: 'Daily',
    frequencyShort: 'D',
    units: 'Dollars per million Btu',
    aliases: ['natural gas', 'nat gas', 'henry hub gas', 'gas hub']
  },
  {
    canonicalName: 'electricity',
    title: 'Electricity (residential retail price, U.S.)',
    route: 'electricity/retail-sales/data',
    routeId: 'electricity-retail-sales-us-res-price',
    dataField: 'price',
    frequency: 'Monthly',
    frequencyShort: 'M',
    units: 'Cents per kilowatthour',
    facets: {
      stateid: ['US'],
      sectorid: ['RES']
    },
    aliases: ['electricity', 'electric power', 'power price', 'residential electricity']
  }
];

export const EIA_CATALOG = Object.freeze(
  energyCatalogSeed.map((item) => {
    const canonicalKey = normalizeSearchInput(item.canonicalName);
    const aliasSet = new Set([item.canonicalName, ...(item.aliases || [])]);

    return Object.freeze({
      canonicalKey,
      canonicalName: item.canonicalName,
      title: item.title,
      sourceName: EIA_SOURCE_NAME,
      seriesId: item.seriesId || null,
      route: item.route || null,
      routeId: item.routeId || null,
      dataField: item.dataField || 'value',
      frequency: item.frequency || '',
      frequencyShort: item.frequencyShort || '',
      units: item.units || '',
      facets: item.facets || null,
      aliases: Object.freeze(
        Array.from(aliasSet)
          .map((alias) => normalizeSearchInput(alias))
          .filter(Boolean)
      )
    });
  })
);

export const EIA_ITEMS = Object.freeze(EIA_CATALOG.map((item) => item.canonicalKey));

export const EIA_ALIAS_INDEX = new Map();
for (const item of EIA_CATALOG) {
  for (const alias of item.aliases) {
    if (!EIA_ALIAS_INDEX.has(alias)) {
      EIA_ALIAS_INDEX.set(alias, item);
    }
  }
}

const ENERGY_HINT_PATTERNS = [
  /\boil\b/,
  /\bcrude\b/,
  /\bgasoline\b/,
  /\bgas prices?\b/,
  /\bdiesel\b/,
  /\bnatural gas\b/,
  /\bhenry hub\b/,
  /\belectricity\b/,
  /\belectric power\b/,
  /\bpower price\b/,
  /\bfuel\b/,
  /\benergy\b/
];

export function resolveCuratedEnergy(value) {
  const normalized = normalizeSearchInput(value);
  return EIA_ALIAS_INDEX.get(normalized) || null;
}

export function looksLikeEnergyQuery(value) {
  const normalized = normalizeSearchInput(value);
  if (!normalized) {
    return false;
  }

  if (EIA_ALIAS_INDEX.has(normalized)) {
    return true;
  }

  return ENERGY_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function rankEiaMappings(query) {
  const normalizedQuery = normalizeSearchInput(query);
  const queryTerms = tokenizeSearchInput(normalizedQuery);

  return EIA_CATALOG
    .map((item) => {
      let score = 0;

      if (item.canonicalKey === normalizedQuery) {
        score += 120;
      }

      for (const alias of item.aliases) {
        if (alias === normalizedQuery) {
          score += 100;
        } else if (alias.includes(normalizedQuery) || normalizedQuery.includes(alias)) {
          score += 45;
        }
      }

      const title = normalizeSearchInput(item.title);
      if (title.includes(normalizedQuery)) {
        score += 30;
      }

      for (const term of queryTerms) {
        if (item.canonicalKey.includes(term)) {
          score += 16;
        } else if (title.includes(term)) {
          score += 10;
        } else if (item.aliases.some((alias) => alias.includes(term))) {
          score += 8;
        }
      }

      return {
        item,
        score
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}
