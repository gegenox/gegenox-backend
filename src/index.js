require("dotenv").config();
const https = require("https");
const app = require("./app");
const db = require("./config/database");
// const sslConfig = require("./config/ssl");

const PORT = process.env.PORT || 21135;

async function startServer() {
  try {
    const connection = await db.getConnection();
    console.log("Conectado ao banco de dados");
    connection.release();

    // const httpsServer = https.createServer(app);

    app.listen(PORT, () => {
      console.log(`Servidor HTTPS rodando localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Erro ao iniciar servidor:", err);
    process.exit(1);
  }
}

startServer();
