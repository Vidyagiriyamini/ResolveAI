
const Database = require("better-sqlite3");
const { getDatabasePath } = require("./db-path");

const db = new Database(getDatabasePath());

try {
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      operator_username TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_operator_sessions_expiry
      ON operator_sessions(expires_at);
  `);

  console.log("[ResolveAI] Operator session migration completed.");
  console.log("[ResolveAI] Existing application records preserved.");
} catch (error) {
  console.error("[ResolveAI] Authentication migration failed:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
