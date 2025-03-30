const express = require('express');
const router = express.Router();
const cors = require('cors');
const PaymentController = require('../controllers/PaymentController');

// Configuração CORS
const corsOptions = {
  origin: 'https://ggnox.com',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Middleware CORS personalizado
const corsMiddleware = (req, res, next) => {
  // Permite webhook sem restrições
  if (req.path === '/payments/webhooks') {
    return next();
  }

  // Verifica origem para outras rotas
  const origin = req.headers.origin;
  if (origin === 'https://ggnox.com') {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Credentials', 'true');
    return next();
  }

  return res.status(403).json({ error: 'Acesso não autorizado' });
};

// Aplica middleware CORS
router.use(corsMiddleware);

// Importar outras rotas
const categoriesRoutes = require('./categories');
const productsRoutes = require('./products');
const couponsRoutes = require('./coupons');
const stockRoutes = require('./stock');
const cartRoutes = require('./cart');
const paymentsRoutes = require('./payments');
const settingsRoutes = require('./settings');

// Usar outras rotas
router.use(categoriesRoutes);
router.use(productsRoutes);
router.use(couponsRoutes);
router.use(stockRoutes);
router.use(cartRoutes);
router.use('/payments', paymentsRoutes);
router.use('/settings', settingsRoutes);

// Rota do webhook sem restrições de CORS
router.post('/payments/webhooks', async (req, res, next) => {
  console.log('Rota do webhook acionada');
  try {
    const controller = require('../controllers/PaymentController');
    await controller.handleWebhook(req, res);
  } catch (error) {
    next(error);
  }
});

// Outras rotas de pagamento com CORS restritivo
// router.post('/payments', PaymentController.createPayment); // Já está em paymentsRoutes
// router.get('/payments/:payment_id/status', PaymentController.getPaymentStatus); // Já está em paymentsRoutes

module.exports = router;