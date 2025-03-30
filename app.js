const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./src/routes');
const db = require('./src/config/database');
const nivoPayConfig = require('./src/config/nivopay');
const primepagConfig = require('./src/config/primepag');

const app = express();

// Configurar o parser JSON antes do CORS
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware para verificar a origem da requisição
app.use((req, res, next) => {
  // Log detalhado para requisições webhook
  if (req.path === '/api/payments/webhooks') {
    console.log('Recebendo webhook:', {
      method: req.method,
      headers: req.headers,
      body: req.body,
      path: req.path
    });

    // Permitir qualquer origem para o webhook
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    return next();
  }

  // Para todas as outras rotas, aplicar restrições de CORS normais
  cors({
    origin: 'https://ggnox.com',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With',
      'Accept',
      'Origin'
    ],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 86400
  })(req, res, next);
});

// Logger para requisições da API
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  if (req.path === '/api/payments/webhooks') {
    console.log('Webhook payload completo:', {
      headers: req.headers,
      body: req.body
    });
  }
  next();
});

// Pasta de uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rotas da API
app.use('/api', routes);

// Registra o webhook na NivoPay
nivoPayConfig.createWebhook().catch(error => {
  console.error('Erro ao registrar webhook na NivoPay:', error);
});

// Registra o webhook na PrimePag
primepagConfig.setupWebhook().catch(error => {
  console.error('Erro ao registrar webhook na PrimePag:', error);
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ 
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = app; 