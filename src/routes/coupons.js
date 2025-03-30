const express = require('express');
const router = express.Router();
const CouponController = require('../controllers/CouponController');

router.get('/coupons/validate/:code', CouponController.validate);
router.get('/coupons', CouponController.index);
router.post('/coupons', CouponController.store);
router.put('/coupons/:id', CouponController.update);
router.delete('/coupons/:id', CouponController.delete);

module.exports = router; 