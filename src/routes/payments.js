const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/PaymentController');

// Rotas de pagamento
router.post('/', PaymentController.createPayment);

// Rotas do dashboard - Ajustando a ordem e os nomes
router.get('/dashboard/stats', PaymentController.getDashboardStats); // Stats gerais
router.get('/dashboard/data', PaymentController.getDashboardData);   // Dados dos gráficos
router.get('/sales', PaymentController.getSales);

// Rotas com parâmetros depois
router.get('/:payment_id/status', PaymentController.getPaymentStatus);
router.get('/external/:external_id/status', PaymentController.getPaymentStatusByExternalId);
router.get('/:external_id/items', PaymentController.getSoldItems);

module.exports = router;