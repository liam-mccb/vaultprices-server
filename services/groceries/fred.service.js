import fetch from 'node-fetch';

export const GROCERY_SERIES_BY_ITEM = Object.freeze({
  eggs: 'APU0000708111',
  milk: 'APU0000709112',
  bread: 'APU0000702111',
  bananas: 'APU0000711211',
  chicken: 'APU0000706111'
});

export const GROCERY_ITEMS = Object.freeze(Object.keys(GROCERY_SERIES_BY_ITEM));

const FRED_OBSERVATIONS_ENDPOINT = 'https://api.stlouisfed.org/fred/series/observations';

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export async function fetchGroceryHistory(item) {
  const normalizedItem = String(item || '').toLowerCase().trim();
  const seriesId = GROCERY_SERIES_BY_ITEM[normalizedItem];

  if (!seriesId) {
    throw createHttpError(400, `Unsupported grocery item: ${item}`);
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw createHttpError(500, 'FRED_API_KEY is missing');
  }

  const query = new URLSearchParams({
    api_key: apiKey,
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
    item: normalizedItem,
    seriesId,
    name: normalizedItem,
    unit: data.units || '',
    currentPrices: [],
    history: points.map((p) => ({ date: p.date, price: p.price })),
    data: points
  };
}
