const express = require('express');
const router = express.Router();
const StockController = require('../controllers/StockController');

router.post('/stock/items', StockController.addItems.bind(StockController));
router.get('/stock/products/:product_id/items', StockController.listItems.bind(StockController));
router.put('/stock/items/:item_id/sold', StockController.markAsSold.bind(StockController));
router.get('/stock/products/:product_id/next', StockController.getNextAvailable.bind(StockController));
router.delete('/stock/items', StockController.removeItems.bind(StockController));
router.put('/stock/items/:id', StockController.updateItem);

module.exports = router; 