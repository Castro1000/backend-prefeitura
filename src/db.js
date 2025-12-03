const mysql = require("mysql2");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Teste de conexão
pool.getConnection((err, connection) => {
  if (err) {
    console.error("ERRO AO CONECTAR NO BANCO:", err.code, err.message);
  } else {
    console.log("Conexão com MySQL OK!");
    connection.release();
  }
});

module.exports = pool;
