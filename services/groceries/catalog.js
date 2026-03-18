import { normalizeSearchInput } from './normalize.js';

const catalogSeed = [
  {
    canonicalName: 'eggs',
    preferredSeriesId: 'APU0000708111',
    aliases: ['egg', 'eggs', 'large eggs', 'dozen eggs', 'grade a eggs', 'shell eggs', 'table eggs', 'egg products']
  },
  {
    canonicalName: 'milk',
    preferredSeriesId: 'APU0000709112',
    aliases: ['milk', 'whole milk', 'gallon of milk']
  },
  {
    canonicalName: 'bread',
    preferredSeriesId: 'APU0000702111',
    aliases: ['bread', 'white bread', 'loaf of bread', 'sandwich bread']
  },
  {
    canonicalName: 'bananas',
    preferredSeriesId: 'APU0000711211',
    aliases: ['banana', 'bananas']
  },
  {
    canonicalName: 'chicken',
    preferredSeriesId: 'APU0000706111',
    aliases: ['chicken', 'fresh chicken', 'chicken breast', 'boneless chicken breast', 'broiler', 'broilers', 'fryer', 'fryers', 'whole bird']
  },
  {
    canonicalName: 'apples',
    preferredSeriesId: null,
    aliases: ['apple', 'apples', 'red delicious apples', 'gala apples']
  },
  {
    canonicalName: 'oranges',
    preferredSeriesId: null,
    aliases: ['orange', 'oranges', 'navel oranges']
  },
  {
    canonicalName: 'orange juice',
    preferredSeriesId: null,
    aliases: ['orange juice', 'oj']
  },
  {
    canonicalName: 'ground beef',
    preferredSeriesId: null,
    aliases: ['ground beef', 'hamburger', 'hamburger meat', 'ground chuck', 'ground round']
  },
  {
    canonicalName: 'beef',
    preferredSeriesId: null,
    aliases: ['beef', 'steak', 'cattle', 'boxed beef']
  },
  {
    canonicalName: 'bacon',
    preferredSeriesId: null,
    aliases: ['bacon']
  },
  {
    canonicalName: 'pork chops',
    preferredSeriesId: null,
    aliases: ['pork chops', 'pork chop', 'pork']
  },
  {
    canonicalName: 'turkey',
    preferredSeriesId: null,
    aliases: ['turkey', 'ground turkey', 'turkey breast']
  },
  {
    canonicalName: 'salmon',
    preferredSeriesId: null,
    aliases: ['salmon']
  },
  {
    canonicalName: 'butter',
    preferredSeriesId: null,
    aliases: ['butter', 'salted butter', 'unsalted butter']
  },
  {
    canonicalName: 'cheese',
    preferredSeriesId: null,
    aliases: ['cheese', 'american cheese', 'cheddar cheese']
  },
  {
    canonicalName: 'yogurt',
    preferredSeriesId: null,
    aliases: ['yogurt', 'yoghurt', 'greek yogurt']
  },
  {
    canonicalName: 'cereal',
    preferredSeriesId: null,
    aliases: ['cereal', 'breakfast cereal']
  },
  {
    canonicalName: 'coffee',
    preferredSeriesId: null,
    aliases: ['coffee', 'ground coffee']
  },
  {
    canonicalName: 'rice',
    preferredSeriesId: null,
    aliases: ['rice', 'white rice', 'long grain rice']
  },
  {
    canonicalName: 'flour',
    preferredSeriesId: null,
    aliases: ['flour', 'all purpose flour', 'ap flour']
  },
  {
    canonicalName: 'pasta',
    preferredSeriesId: null,
    aliases: ['pasta', 'spaghetti', 'macaroni']
  },
  {
    canonicalName: 'peanut butter',
    preferredSeriesId: null,
    aliases: ['peanut butter', 'pb']
  },
  {
    canonicalName: 'lettuce',
    preferredSeriesId: null,
    aliases: ['lettuce', 'iceberg lettuce', 'romaine lettuce']
  },
  {
    canonicalName: 'tomatoes',
    preferredSeriesId: null,
    aliases: ['tomato', 'tomatoes', 'roma tomatoes']
  },
  {
    canonicalName: 'potatoes',
    preferredSeriesId: null,
    aliases: ['potato', 'potatoes', 'russet potatoes']
  },
  {
    canonicalName: 'onions',
    preferredSeriesId: null,
    aliases: ['onion', 'onions', 'yellow onions']
  },
  {
    canonicalName: 'broccoli',
    preferredSeriesId: null,
    aliases: ['broccoli']
  },
  {
    canonicalName: 'carrots',
    preferredSeriesId: null,
    aliases: ['carrot', 'carrots']
  },
  {
    canonicalName: 'grapes',
    preferredSeriesId: null,
    aliases: ['grape', 'grapes']
  },
  {
    canonicalName: 'strawberries',
    preferredSeriesId: null,
    aliases: ['strawberry', 'strawberries']
  }
];

export const GROCERY_CATALOG = Object.freeze(
  catalogSeed.map((item) => {
    const canonicalKey = normalizeSearchInput(item.canonicalName);
    const aliasSet = new Set([item.canonicalName, ...(item.aliases || [])]);

    return Object.freeze({
      canonicalKey,
      canonicalName: item.canonicalName,
      preferredSeriesId: item.preferredSeriesId || null,
      aliases: Object.freeze(
        Array.from(aliasSet)
          .map((alias) => normalizeSearchInput(alias))
          .filter(Boolean)
      )
    });
  })
);

export const GROCERY_ITEMS = Object.freeze(
  GROCERY_CATALOG.map((item) => item.canonicalKey)
);

export const GROCERY_CATALOG_BY_KEY = new Map(
  GROCERY_CATALOG.map((item) => [item.canonicalKey, item])
);

export const GROCERY_ALIAS_INDEX = new Map();

for (const item of GROCERY_CATALOG) {
  for (const alias of item.aliases) {
    if (!GROCERY_ALIAS_INDEX.has(alias)) {
      GROCERY_ALIAS_INDEX.set(alias, item);
    }
  }
}

export function resolveCuratedGrocery(value) {
  const normalized = normalizeSearchInput(value);
  return GROCERY_ALIAS_INDEX.get(normalized) || null;
}

export function getGrocerySearchTerms(value) {
  const normalized = normalizeSearchInput(value);
  if (!normalized) {
    return [];
  }

  const directMatch = resolveCuratedGrocery(normalized);
  if (directMatch) {
    return [...directMatch.aliases];
  }

  const matchedItems = GROCERY_CATALOG.filter(
    (item) =>
      item.canonicalKey.includes(normalized) ||
      item.aliases.some((alias) => alias.includes(normalized) || normalized.includes(alias))
  );

  return [...new Set(matchedItems.flatMap((item) => item.aliases))];
}
