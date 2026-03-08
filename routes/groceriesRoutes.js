import { Router } from 'express';
import { fetchGroceryHistory, GROCERY_ITEMS } from '../services/groceries/fred.service.js';

const router = Router();

router.get('/:item', async (req, res, next) => {
  try {
    const item = String(req.params.item || '').toLowerCase().trim();
    if (!GROCERY_ITEMS.includes(item)) {
      return res.status(400).json({
        error: 'Unsupported grocery item',
        supportedItems: GROCERY_ITEMS
      });
    }

    const data = await fetchGroceryHistory(item);
    return res.json(data);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Groceries route error:', err.message);
    }
    return res.status(statusCode).json({
      error: err.message || 'Failed to fetch grocery data'
    });
  }
});

export default router;
