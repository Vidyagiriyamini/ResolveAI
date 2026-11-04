const Database = require("better-sqlite3");
const { getDatabasePath } = require("./db-path");

const db = new Database(getDatabasePath());

try {
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS simulated_merchant_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL UNIQUE,
      merchant_status TEXT NOT NULL
        CHECK (merchant_status IN ('PENDING', 'COMPLETED')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS reconciliation_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_run_id INTEGER NOT NULL UNIQUE,
      payment_id INTEGER NOT NULL,
      simulated INTEGER NOT NULL DEFAULT 1
        CHECK (simulated = 1),
      proposed_action TEXT NOT NULL
        CHECK (proposed_action = 'MARK_SIMULATED_MERCHANT_COMPLETED'),
      status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
        CHECK (
          status IN (
            'PENDING_APPROVAL',
            'APPROVED',
            'EXECUTED',
            'REJECTED'
          )
        ),
      approved_by TEXT,
      approved_at TEXT,
      executed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (investigation_run_id)
        REFERENCES investigation_runs(id),
      FOREIGN KEY (payment_id)
        REFERENCES payments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_reconciliation_proposals_status
      ON reconciliation_proposals(status);
  `);

  console.log(
    "SUCCESS: Reconciliation tables created or already exist."
  );
  console.log(
    "Existing PayPal payments, incidents, and investigations were preserved."
  );
} catch (error) {
  console.error(
    "Reconciliation migration failed:",
    error.message
  );
  process.exitCode = 1;
} finally {
  db.close();
}
