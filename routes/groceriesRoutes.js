import { Router } from 'express';
import { fetchGroceryHistory, findGroceryCandidates, GROCERY_ITEMS } from '../services/groceries/groceries.service.js';
import { normalizeSearchInput } from '../services/groceries/normalize.js';
import { fetchUsdaReports } from '../services/groceries/usda.service.js';

const router = Router();

router.get('/search', async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || '').trim();
    if (!query) {
      return res.status(400).json({
        error: 'Query is required',
        supportedItems: GROCERY_ITEMS
      });
    }

    const result = await findGroceryCandidates(query, { maxCandidates: 5 });
    return res.json({
      query,
      normalizedQuery: normalizeSearchInput(query),
      curatedMatch: result.curatedMatch
        ? result.curatedMatch
        : null,
      sourceName: result.candidates[0]?.sourceName || result.curatedMatch?.sourceName || null,
      candidates: result.candidates
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Groceries search route error:', err.message);
    }
    return res.status(statusCode).json({
      error: err.message || 'Failed to search grocery data'
    });
  }
});

router.get('/usda/reports', async (req, res) => {
  try {
    const data = await fetchUsdaReports({ limit: req.query.limit });
    return res.json(data);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) {
      console.error('USDA reports route error:', err.message);
    }
    return res.status(statusCode).json({
      error: err.message || 'Failed to fetch USDA reports'
    });
  }
});

router.get('/:item', async (req, res) => {
  try {
    const item = String(req.params.item || '').trim();
    const data = await fetchGroceryHistory(item);
    return res.json(data);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Groceries route error:', err.message);
    }
    return res.status(statusCode).json({
      error: err.message || 'Failed to fetch grocery data',
      supportedItems: GROCERY_ITEMS
    });
  }
});

export default router;
