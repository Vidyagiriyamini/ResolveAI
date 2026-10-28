const path = require("node:path");
const Database = require("better-sqlite3");

const db = new Database(
  path.join(__dirname, "resolveai.db")
);

function addColumnIfMissing(tableName, columnName, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all();

  if (!columns.some((column) => column.name === columnName)) {
    db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
    );
    console.log(`Added ${tableName}.${columnName}`);
  }
}

try {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paypal_order_id TEXT UNIQUE NOT NULL,
      paypal_status TEXT NOT NULL,
      merchant_status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL,
      incident_type TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );
  `);

  // Preserve and extend the existing incident table.
  addColumnIfMissing("incidents", "severity", "TEXT");
  addColumnIfMissing(
    "incidents",
    "simulated",
    "INTEGER NOT NULL DEFAULT 0"
  );
  addColumnIfMissing("incidents", "evidence_json", "TEXT");
  addColumnIfMissing("incidents", "explanation", "TEXT");
  addColumnIfMissing("incidents", "recommended_action", "TEXT");
  addColumnIfMissing("incidents", "detection_run_id", "INTEGER");

  db.exec(`
    CREATE TABLE IF NOT EXISTS investigation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL,
      classification TEXT NOT NULL,
      severity TEXT NOT NULL,
      simulated INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT NOT NULL,
      explanation TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_payment_id
      ON incidents(payment_id);

    CREATE INDEX IF NOT EXISTS idx_investigation_runs_payment_id
      ON investigation_runs(payment_id);

    CREATE INDEX IF NOT EXISTS idx_audit_events_entity
      ON audit_events(entity_type, entity_id);
  `);

  console.log("\nResolveAI database migration completed successfully.");
  console.log("Existing payment records have been preserved.");
  console.log("Investigation history and audit tables are ready.");
} catch (error) {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}