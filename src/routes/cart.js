const express = require('express');
const router = express.Router();
const CartController = require('../controllers/CartController');

router.post('/cart/add', CartController.addToCart);
router.delete('/cart/:product_id', CartController.removeFromCart);
router.get('/cart', CartController.getCart);
router.put('/cart/:product_id', CartController.updateQuantity);
router.delete('/cart', CartController.clearCart);

module.exports = router; 