
const Database = require("better-sqlite3");
const { getDatabasePath } = require("./db-path");

const db = new Database(getDatabasePath());

function addColumnIfMissing(tableName, columnName, definition) {
  // Table and column names here are fixed by this file, not user input.
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all();

  if (columns.some((column) => column.name === columnName)) {
    console.log(`Already exists: ${tableName}.${columnName}`);
    return;
  }

  db.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
  );

  console.log(`Added ${tableName}.${columnName}`);
}

try {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Core payment and incident tables. Existing tables are preserved.
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

  // PayPal evidence fields belong to the central payment schema.
  // Add missing columns without deleting or overwriting existing records.
  addColumnIfMissing("payments", "paypal_capture_id", "TEXT");
  addColumnIfMissing("payments", "amount_value", "TEXT");
  addColumnIfMissing("payments", "currency_code", "TEXT");
  addColumnIfMissing("payments", "evidence_source", "TEXT");
  addColumnIfMissing("payments", "verified_at", "TEXT");


  // Extend the existing incidents table without deleting its data.
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

  // Investigation history stores deterministic results separately from AI.
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

  // AI results are supplementary; deterministic results are not overwritten.
  addColumnIfMissing(
    "investigation_runs",
    "ai_explanation",
    "TEXT"
  );
  addColumnIfMissing(
    "investigation_runs",
    "ai_recommended_action",
    "TEXT"
  );
  addColumnIfMissing(
    "investigation_runs",
    "ai_model",
    "TEXT"
  );
  addColumnIfMissing(
    "investigation_runs",
    "ai_status",
    "TEXT"
  );
  addColumnIfMissing(
    "investigation_runs",
    "ai_analyzed_at",
    "TEXT"
  );

  // Verify all five AI columns exist before reporting success.
  const investigationColumns = new Set(
    db.prepare("PRAGMA table_info(investigation_runs)")
      .all()
      .map((column) => column.name)
  );

  const requiredAiColumns = [
    "ai_explanation",
    "ai_recommended_action",
    "ai_model",
    "ai_status",
    "ai_analyzed_at"
  ];

  const missingAiColumns = requiredAiColumns.filter(
    (column) => !investigationColumns.has(column)
  );

  if (missingAiColumns.length > 0) {
    throw new Error(
      `AI schema verification failed. Missing: ${missingAiColumns.join(", ")}`
    );
  }

  console.log("\nAI schema verification: PASSED");
  console.log("All five AI analysis columns are present.");
  console.log("Existing payment and investigation records are preserved.");
  console.log("ResolveAI database migration completed successfully.");
} catch (error) {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
