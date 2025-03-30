const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "srv1843.hstgr.io",
  user: process.env.DB_USER || "u801303619_staging",
  password: process.env.DB_PASS || "Monkeymod123@",
  database: process.env.DB_NAME || "u801303619_staging",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
