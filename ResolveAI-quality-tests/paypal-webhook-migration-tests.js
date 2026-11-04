
const Database = require("better-sqlite3");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const migrationPath = path.join(
  __dirname,
  "..",
  "paypal-webhook-migration.js"
);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runMigration(databasePath) {
  const result = spawnSync(
    process.execPath,
    [migrationPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        RESOLVEAI_DB_PATH: databasePath,
      },
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Migration process exited with code ${result.status}.`,
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }

  return result.stdout;
}

async function test(name, callback) {
  try {
    await callback();
    passed++;
    console.log("PASS:", name);
  } catch (error) {
    failed++;
    console.error("FAIL:", name);
    console.error(" ", error.message);
  }
}

function withTemporaryDatabase(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "resolveai-webhook-migration-")
  );

  const databasePath = path.join(
    directory,
    "migration-test.db"
  );

  try {
    callback(databasePath);
  } finally {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
}

function getColumns(db) {
  return db
    .prepare("PRAGMA table_info(paypal_webhook_events)")
    .all()
    .map((column) => column.name);
}

function getIndexes(db) {
  return db
    .prepare("PRAGMA index_list(paypal_webhook_events)")
    .all()
    .map((index) => index.name);
}

async function main() {
  console.log("\n========================================");
  console.log("PayPal Webhook Migration Test Suite");
  console.log("========================================\n");

  await test(
    "Fresh database creates complete webhook schema",
    async () => {
      withTemporaryDatabase((databasePath) => {
        const output = runMigration(databasePath);

        assert(
          output.includes(
            "PayPal webhook migration completed successfully."
          ),
          "Migration success message is missing."
        );

        const db = new Database(databasePath);

        try {
          const columns = getColumns(db);

          const requiredColumns = [
            "id",
            "paypal_event_id",
            "event_type",
            "resource_type",
            "resource_id",
            "transmission_id",
            "verification_status",
            "processing_status",
            "processing_attempts",
            "processing_lease_token",
            "processing_lease_expires_at",
            "event_summary_json",
            "received_at",
            "processed_at",
            "last_error",
          ];

          for (const column of requiredColumns) {
            assert(
              columns.includes(column),
              `Missing required column: ${column}`
            );
          }

          const indexes = getIndexes(db);

          for (const index of [
            "idx_paypal_webhook_events_processing_status",
            "idx_paypal_webhook_events_resource_id",
            "idx_paypal_webhook_events_received_at",
          ]) {
            assert(
              indexes.includes(index),
              `Missing expected index: ${index}`
            );
          }

          const integrity = db
            .prepare("PRAGMA integrity_check")
            .get();

          assert(
            integrity.integrity_check === "ok",
            "SQLite integrity check failed."
          );

          const event = db.prepare(`
            INSERT INTO paypal_webhook_events (
              paypal_event_id,
              event_type
            )
            VALUES (?, ?)
          `).run(
            "FRESH-DB-EVENT-001",
            "PAYMENT.CAPTURE.COMPLETED"
          );

          assert(
            event.changes === 1,
            "Could not insert an event into the fresh schema."
          );

          const savedEvent = db.prepare(`
            SELECT *
            FROM paypal_webhook_events
            WHERE paypal_event_id = ?
          `).get("FRESH-DB-EVENT-001");

          assert(
            savedEvent.verification_status === "PENDING",
            "Incorrect default verification status."
          );

          assert(
            savedEvent.processing_status === "RECEIVED",
            "Incorrect default processing status."
          );

          assert(
            savedEvent.processing_attempts === 0,
            "Incorrect default processing attempts."
          );

          assert(
            savedEvent.processing_lease_token === null,
            "Lease token should initially be NULL."
          );

          assert(
            savedEvent.processing_lease_expires_at === null,
            "Lease expiry should initially be NULL."
          );

          let invalidStatusRejected = false;

          try {
            db.prepare(`
              UPDATE paypal_webhook_events
              SET processing_status = 'INVALID_STATUS'
              WHERE paypal_event_id = ?
            `).run("FRESH-DB-EVENT-001");
          } catch {
            invalidStatusRejected = true;
          }

          assert(
            invalidStatusRejected,
            "Processing status CHECK constraint was not enforced."
          );
        } finally {
          db.close();
        }
      });
    }
  );

  await test(
    "Legacy database receives lease columns without losing existing events",
    async () => {
      withTemporaryDatabase((databasePath) => {
        const db = new Database(databasePath);

        try {
          // Simulate the original webhook schema before leases existed.
          db.exec(`
            CREATE TABLE paypal_webhook_events (
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
              event_summary_json TEXT,

              received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              processed_at TEXT,
              last_error TEXT
            );
          `);

          db.prepare(`
            INSERT INTO paypal_webhook_events (
              paypal_event_id,
              event_type,
              resource_type,
              resource_id,
              verification_status,
              processing_status,
              processing_attempts,
              event_summary_json,
              last_error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            "LEGACY-EVENT-001",
            "PAYMENT.CAPTURE.COMPLETED",
            "capture",
            "LEGACY-CAPTURE-001",
            "VERIFIED",
            "FAILED",
            2,
            JSON.stringify({
              related_order_id: "LEGACY-ORDER-001",
            }),
            "Temporary PayPal API failure"
          );
        } finally {
          db.close();
        }

        runMigration(databasePath);

        const migratedDb = new Database(databasePath);

        try {
          const columns = getColumns(migratedDb);

          assert(
            columns.includes("processing_lease_token"),
            "Legacy migration did not add processing_lease_token."
          );

          assert(
            columns.includes("processing_lease_expires_at"),
            "Legacy migration did not add processing_lease_expires_at."
          );

          const event = migratedDb.prepare(`
            SELECT *
            FROM paypal_webhook_events
            WHERE paypal_event_id = ?
          `).get("LEGACY-EVENT-001");

          assert(
            Boolean(event),
            "Existing legacy webhook event was deleted."
          );

          assert(
            event.processing_status === "FAILED",
            "Existing processing status was changed."
          );

          assert(
            event.processing_attempts === 2,
            "Existing processing attempts were changed."
          );

          assert(
            event.verification_status === "VERIFIED",
            "Existing verification status was changed."
          );

          assert(
            event.last_error === "Temporary PayPal API failure",
            "Existing error information was lost."
          );

          assert(
            event.processing_lease_token === null,
            "Legacy event should have a NULL lease token."
          );

          assert(
            event.processing_lease_expires_at === null,
            "Legacy event should have a NULL lease expiry."
          );

          const summary = JSON.parse(
            event.event_summary_json
          );

          assert(
            summary.related_order_id === "LEGACY-ORDER-001",
            "Existing webhook summary was changed."
          );

          const integrity = migratedDb
            .prepare("PRAGMA integrity_check")
            .get();

          assert(
            integrity.integrity_check === "ok",
            "Legacy database integrity check failed."
          );
        } finally {
          migratedDb.close();
        }
      });
    }
  );

  await test(
    "Repeated migration is safe and does not duplicate schema objects",
    async () => {
      withTemporaryDatabase((databasePath) => {
        runMigration(databasePath);

        let db = new Database(databasePath);

        let originalColumns;
        let originalIndexes;

        try {
          db.prepare(`
            INSERT INTO paypal_webhook_events (
              paypal_event_id,
              event_type
            )
            VALUES (?, ?)
          `).run(
            "REPEAT-MIGRATION-EVENT-001",
            "PAYMENT.CAPTURE.COMPLETED"
          );

          originalColumns = getColumns(db).sort();
          originalIndexes = getIndexes(db).sort();
        } finally {
          db.close();
        }

        // Execute the exact same migration again.
        runMigration(databasePath);

        db = new Database(databasePath);

        try {
          const repeatedColumns = getColumns(db).sort();
          const repeatedIndexes = getIndexes(db).sort();

          assert(
            JSON.stringify(repeatedColumns) ===
              JSON.stringify(originalColumns),
            "Repeated migration changed the column list."
          );

          assert(
            JSON.stringify(repeatedIndexes) ===
              JSON.stringify(originalIndexes),
            "Repeated migration duplicated or changed indexes."
          );

          assert(
            db.prepare(`
              SELECT COUNT(*) AS count
              FROM paypal_webhook_events
              WHERE paypal_event_id = ?
            `).get("REPEAT-MIGRATION-EVENT-001").count === 1,
            "Repeated migration changed existing event records."
          );

          const integrity = db
            .prepare("PRAGMA integrity_check")
            .get();

          assert(
            integrity.integrity_check === "ok",
            "Repeated migration integrity check failed."
          );
        } finally {
          db.close();
        }
      });
    }
  );

  console.log("\n========================================");
  console.log("Migration Test Results");
  console.log("========================================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log(
      "\nAll migration tests passed. Temporary databases only."
    );
  }
}

main().catch((error) => {
  console.error("\nMigration test suite execution failed:");
  console.error(error);
  process.exitCode = 1;
});
