import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';

import { createGroceriesRouter } from '../routes/groceriesRoutes.js';

async function makeRequest(server, path) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
  const body = await response.json();

  return {
    status: response.status,
    body
  };
}

async function withGroceriesApp(fetchUsdaReportsImpl, run) {
  const app = express();
  app.use('/api/groceries', createGroceriesRouter({ fetchUsdaReports: fetchUsdaReportsImpl }));

  const server = app.listen(0);
  await once(server, 'listening');

  try {
    await run(server);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('GET /api/groceries/usda/reports/search returns ranked USDA reports', async () => {
  await withGroceriesApp(async ({ q, limit }) => {
    assert.equal(q, 'eggs');
    assert.equal(limit, '2');

    return {
      sourceName: 'USDA MyMarketNews',
      count: 1,
      reports: [
        {
          id: 'egg-1',
          title: 'National Shell Egg Index Report',
          commodity: 'Eggs',
          marketType: 'Daily'
        }
      ]
    };
  }, async (server) => {
    const response = await makeRequest(server, '/api/groceries/usda/reports/search?q=eggs&limit=2');
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.reports[0].commodity, 'Eggs');
  });
});

test('GET /api/groceries/usda/reports with empty q returns 200 and []', async () => {
  await withGroceriesApp(async () => ({
    sourceName: 'USDA MyMarketNews',
    count: 0,
    reports: []
  }), async (server) => {
    const response = await makeRequest(server, '/api/groceries/usda/reports?q=%20%20%20&limit=5');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      sourceName: 'USDA MyMarketNews',
      count: 0,
      reports: []
    });
  });
});

test('GET /api/groceries/usda/reports returns controlled 5xx on USDA failure', async () => {
  await withGroceriesApp(async () => {
    const error = new Error('Failed to fetch USDA reports');
    error.statusCode = 502;
    throw error;
  }, async (server) => {
    const response = await makeRequest(server, '/api/groceries/usda/reports?q=eggs&limit=5');
    assert.equal(response.status, 502);
    assert.deepEqual(response.body, {
      error: 'Failed to fetch USDA reports'
    });
  });
});
