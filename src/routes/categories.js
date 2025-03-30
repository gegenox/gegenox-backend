const express = require('express');
const router = express.Router();
const CategoryController = require('../controllers/CategoryController');

router.get('/categories', CategoryController.index);
router.post('/categories', CategoryController.store);
router.get('/categories/:id', CategoryController.show);
router.put('/categories/:id', CategoryController.update);
router.delete('/categories/:id', CategoryController.delete);

module.exports = router; 