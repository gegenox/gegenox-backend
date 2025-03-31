const express = require("express");
const path = require("path");
const routes = require("./routes");
const db = require("./config/database");
const setupWebhook = require("./config/setupWebhook");
const cors = require("cors");

const app = express();

// Aumentar limite do JSON
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Logger para requisições da API
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  if (req.path === "/api/payments/webhook") {
    console.log("Webhook payload:", req.body);
  }
  next();
});

app.use(cors());

// Pasta de uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Rotas da API
app.use("/api", routes);

// Configurar webhook ao iniciar a aplicação
setupWebhook().catch(console.error);

// Error handler global
app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  res.status(500).json({
    message: "Erro interno do servidor",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

module.exports = app;
