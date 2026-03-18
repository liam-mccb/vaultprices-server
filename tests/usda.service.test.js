import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetUsdaReportCaches,
  __testables,
  fetchUsdaReports
} from '../services/groceries/usda.service.js';

const ORIGINAL_API_KEY = process.env.USDA_MYMARKET_API_KEY;

function createResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

test.beforeEach(() => {
  process.env.USDA_MYMARKET_API_KEY = 'test-key';
  __resetUsdaReportCaches();
});

test.after(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.USDA_MYMARKET_API_KEY;
    return;
  }

  process.env.USDA_MYMARKET_API_KEY = ORIGINAL_API_KEY;
});

test('query "eggs" returns relevant reports when available', async () => {
  const payload = {
    reports: [
      {
        reportId: 'beef-1',
        reportTitle: 'National Daily Boxed Beef Cutout',
        commodity: 'Beef',
        marketType: 'Daily'
      },
      {
        reportId: 'egg-1',
        reportTitle: 'National Shell Egg Index Report',
        commodity: 'Eggs',
        marketType: 'Daily',
        keywords: ['shell eggs', 'cartons'],
        publishedDate: '2026-03-14T00:00:00Z'
      },
      {
        reportId: 'egg-2',
        reportTitle: 'Egg Products Weekly Update',
        commodity: 'Egg Products',
        marketType: 'Weekly',
        publishedDate: '2026-02-10T00:00:00Z'
      }
    ]
  };

  const result = await fetchUsdaReports({
    q: 'eggs',
    limit: 2,
    now: new Date('2026-03-18T00:00:00Z'),
    fetchImpl: async () => createResponse(payload)
  });

  assert.equal(result.count, 2);
  assert.equal(result.reports[0].id, 'egg-1');
  assert.match(result.reports[0].title, /egg/i);
});

test('singular and plural normalization expand query terms', () => {
  const singular = __testables.expandQueryTerms('egg');
  const plural = __testables.expandQueryTerms('eggs');
  const chicken = __testables.expandQueryTerms('chicken');

  assert.ok(singular.has('eggs'));
  assert.ok(plural.has('egg'));
  assert.ok(plural.has('shell eggs'));
  assert.ok(chicken.has('broilers'));
});

test('empty query returns an empty reports list', async () => {
  const result = await fetchUsdaReports({
    q: '   ',
    limit: 5
  });

  assert.deepEqual(result, {
    sourceName: 'USDA MyMarketNews',
    count: 0,
    reports: []
  });
});

test('no-match query returns an empty reports list', async () => {
  const payload = {
    reports: [
      {
        reportId: 'beef-1',
        reportTitle: 'National Daily Boxed Beef Cutout',
        commodity: 'Beef',
        marketType: 'Daily'
      }
    ]
  };

  const result = await fetchUsdaReports({
    q: 'papaya',
    limit: 5,
    fetchImpl: async () => createResponse(payload)
  });

  assert.deepEqual(result.reports, []);
  assert.equal(result.count, 0);
});

test('dedupes duplicate reports and prefers fresher matches when scores are similar', async () => {
  const payload = {
    reports: [
      {
        reportId: 'egg-old',
        reportTitle: 'National Shell Egg Index Report',
        commodity: 'Eggs',
        marketType: 'Daily',
        publishedDate: '2025-01-01T00:00:00Z'
      },
      {
        reportId: 'egg-new',
        reportTitle: 'National Shell Egg Index Report',
        commodity: 'Eggs',
        marketType: 'Daily',
        publishedDate: '2026-03-16T00:00:00Z'
      },
      {
        reportId: 'egg-weekly',
        reportTitle: 'Egg Products Weekly Update',
        commodity: 'Egg Products',
        marketType: 'Weekly',
        publishedDate: '2026-03-15T00:00:00Z'
      }
    ]
  };

  const result = await fetchUsdaReports({
    q: 'eggs',
    limit: 5,
    now: new Date('2026-03-18T00:00:00Z'),
    fetchImpl: async () => createResponse(payload)
  });

  assert.equal(result.count, 2);
  assert.equal(result.reports[0].id, 'egg-new');
  assert.ok(result.reports.every((report) => report.id !== 'egg-old'));
});

test('upstream USDA failure returns a controlled 5xx error', async () => {
  await assert.rejects(
    fetchUsdaReports({
      q: 'eggs',
      limit: 5,
      fetchImpl: async () => {
        throw new Error('socket hang up');
      }
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /failed to fetch usda reports/i);
      return true;
    }
  );
});
