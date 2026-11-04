
const Database = require("better-sqlite3");
const { getDatabasePath } = require("./db-path");

const db = new Database(getDatabasePath());

try {
  db.pragma("foreign_keys = ON");

  // Run table creation, backward-compatible column additions,
  // and index creation as one atomic migration.
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS paypal_webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        paypal_event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,

        resource_type TEXT,
        resource_id TEXT,
        transmission_id TEXT,

        verification_status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (
            verification_status IN (
              'PENDING',
              'VERIFIED',
              'FAILED'
            )
          ),

        processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
          CHECK (
            processing_status IN (
              'RECEIVED',
              'PROCESSING',
              'PROCESSED',
              'IGNORED',
              'FAILED'
            )
          ),

        processing_attempts INTEGER NOT NULL DEFAULT 0,
        processing_lease_token TEXT,
        processing_lease_expires_at TEXT,
        event_summary_json TEXT,

        received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT,
        last_error TEXT
      );
    `);

    // Support databases created before processing leases existed.
    const existingColumns = db
      .prepare("PRAGMA table_info(paypal_webhook_events)")
      .all()
      .map((column) => column.name);

    if (!existingColumns.includes("processing_lease_token")) {
      db.exec(`
        ALTER TABLE paypal_webhook_events
        ADD COLUMN processing_lease_token TEXT
      `);
    }

    if (!existingColumns.includes("processing_lease_expires_at")) {
      db.exec(`
        ALTER TABLE paypal_webhook_events
        ADD COLUMN processing_lease_expires_at TEXT
      `);
    }

    // Create indexes after ensuring the table schema exists.
    db.exec(`
      CREATE INDEX IF NOT EXISTS
        idx_paypal_webhook_events_processing_status
      ON paypal_webhook_events(processing_status);

      CREATE INDEX IF NOT EXISTS
        idx_paypal_webhook_events_resource_id
      ON paypal_webhook_events(resource_id);

      CREATE INDEX IF NOT EXISTS
        idx_paypal_webhook_events_received_at
      ON paypal_webhook_events(received_at);
    `);
  });

  // Acquire the write lock before applying schema changes.
  migrate.immediate();

  console.log(
    "PayPal webhook migration completed successfully."
  );

  const columns = db
    .prepare("PRAGMA table_info(paypal_webhook_events)")
    .all();

  console.log("\nPayPal webhook table columns:");

  console.table(
    columns.map((column) => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      primaryKey: column.pk,
    }))
  );

} catch (error) {
  console.error(
    "PayPal webhook migration failed:",
    error.message
  );

  process.exitCode = 1;

} finally {
  db.close();
}
