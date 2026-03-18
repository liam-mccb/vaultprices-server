import fetch from 'node-fetch';

const USDA_REPORTS_ENDPOINT = 'https://marsapi.ams.usda.gov/services/v1.2/reports';
const USDA_SOURCE_NAME = 'USDA MyMarketNews';

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
    return 25;
  }
  return Math.min(parsed, 100);
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

export async function fetchUsdaReports(options = {}) {
  const apiKey = getUsdaApiKey();
  const limit = sanitizeLimit(options.limit);
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(USDA_REPORTS_ENDPOINT, {
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

    const reports = pickReports(payload).slice(0, limit).map(projectReport);

    return {
      sourceName: USDA_SOURCE_NAME,
      count: reports.length,
      reports
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw createHttpError(504, 'USDA request timed out');
    }
    if (err.statusCode) {
      throw err;
    }
    throw createHttpError(502, 'USDA request failed');
  } finally {
    clearTimeout(timeout);
  }
}
