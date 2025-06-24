import sql, { config as SqlConfig } from "mssql";
import { logger } from "../logger/logger.js"; // Importa il logger
import "dotenv/config";

const config: SqlConfig  = {
  user: process.env.DB_USER ?? "",
  password: process.env.DB_PASSWORD ?? "",
  server: process.env.DB_SERVER ?? "",
  database: process.env.DB_NAME ?? "",
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: process.env.DB_ENCRYPT === "true", // Converte la stringa in booleano
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === "true", // Converte la stringa in booleano
    connectTimeout: 60000,
    requestTimeout: 300000
  },
};

// Pool di connessione riutilizzabile
let poolPromise: Promise<sql.ConnectionPool> | null = null;

export const getDatabasePool = async (): Promise<sql.ConnectionPool> => {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        logger.info("Connessione al database riuscita");
        return pool;
      })
      .catch((err) => {
        logger.error("Errore nella connessione al database:", err);
        throw err;
      });
  }
  return poolPromise;
};

// Esportazione ESM
export { sql };
