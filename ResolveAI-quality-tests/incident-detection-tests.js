
const Database = require("better-sqlite3");

const {
  createIncidentDetectionService,
} = require("../incident-detection-service");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name, callback) {
  try {
    callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

function createTestDatabase() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paypal_order_id TEXT UNIQUE NOT NULL,
      paypal_status TEXT NOT NULL,
      merchant_status TEXT NOT NULL,
      paypal_capture_id TEXT,
      amount_value TEXT,
      currency_code TEXT,
      evidence_source TEXT,
      verified_at TEXT
    );

    CREATE TABLE incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL,
      incident_type TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN',
      severity TEXT,
      simulated INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT,
      explanation TEXT,
      recommended_action TEXT,
      detection_run_id INTEGER,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE investigation_runs (
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

    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

function createPayment(db, overrides = {}) {
  const payment = {
    paypal_order_id: "TEST-ORDER-001",
    paypal_status: "COMPLETED",
    merchant_status: "PENDING",
    paypal_capture_id: "TEST-CAPTURE-001",
    amount_value: "10.00",
    currency_code: "USD",
    evidence_source: "PAYPAL_SANDBOX_API",
    verified_at: "2026-11-02T10:00:00.000Z",
    ...overrides,
  };

  const result = db.prepare(`
    INSERT INTO payments (
      paypal_order_id,
      paypal_status,
      merchant_status,
      paypal_capture_id,
      amount_value,
      currency_code,
      evidence_source,
      verified_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payment.paypal_order_id,
    payment.paypal_status,
    payment.merchant_status,
    payment.paypal_capture_id,
    payment.amount_value,
    payment.currency_code,
    payment.evidence_source,
    payment.verified_at
  );

  return {
    id: Number(result.lastInsertRowid),
    ...payment,
  };
}

function createTestContext(paymentOverrides = {}) {
  const db = createTestDatabase();
  const service = createIncidentDetectionService(db);
  const payment = createPayment(db, paymentOverrides);

  return { db, service, payment };
}

// 1. Completed PayPal payment + pending merchant state.
test("Completed PayPal + pending merchant detects HIGH mismatch", () => {
  const { db, service, payment } = createTestContext();

  try {
    const result = service.detectIncident(payment, "PENDING", false);

    assert(
      result.classification === "RECONCILIATION_MISMATCH",
      "Expected RECONCILIATION_MISMATCH"
    );
    assert(result.severity === "HIGH", "Expected HIGH severity");
    assert(result.simulated === false, "Expected non-simulated result");
  } finally {
    db.close();
  }
});

// 2. Simulated mismatch remains explicitly labelled.
test("Simulated mismatch uses separate classification", () => {
  const { db, service, payment } = createTestContext();

  try {
    const result = service.detectIncident(payment, "PENDING", true);

    assert(
      result.classification === "SIMULATED_RECONCILIATION_MISMATCH",
      "Expected simulated mismatch classification"
    );
    assert(result.simulated === true, "Expected simulated result");
  } finally {
    db.close();
  }
});

// 3. Both systems report completed.
test("Both completed states are classified as reconciled", () => {
  const { db, service, payment } = createTestContext({
    merchant_status: "COMPLETED",
  });

  try {
    const result = service.detectIncident(payment, "COMPLETED", false);

    assert(result.classification === "RECONCILED", "Expected RECONCILED");
    assert(result.severity === "NONE", "Expected NONE severity");
  } finally {
    db.close();
  }
});

// 4. Missing PayPal evidence.
test("Missing PayPal evidence produces UNDETERMINED", () => {
  const { db, service, payment } = createTestContext({
    evidence_source: null,
  });

  try {
    const result = service.detectIncident(payment, "PENDING", false);

    assert(
      result.classification === "INSUFFICIENT_PAYPAL_EVIDENCE",
      "Expected insufficient PayPal evidence"
    );
    assert(result.severity === "UNDETERMINED", "Expected UNDETERMINED");
  } finally {
    db.close();
  }
});

// 5. Unknown merchant status.
test("Unknown merchant state produces UNDETERMINED", () => {
  const { db, service, payment } = createTestContext();

  try {
    const result = service.detectIncident(payment, "UNKNOWN", false);

    assert(
      result.classification === "INSUFFICIENT_MERCHANT_EVIDENCE",
      "Expected insufficient merchant evidence"
    );
    assert(result.severity === "UNDETERMINED", "Expected UNDETERMINED");
  } finally {
    db.close();
  }
});

// 6. Both systems report pending.
test("Both pending states are classified as PAYMENT_PENDING", () => {
  const { db, service, payment } = createTestContext({
    paypal_status: "PENDING",
    merchant_status: "PENDING",
  });

  try {
    const result = service.detectIncident(payment, "PENDING", false);

    assert(result.classification === "PAYMENT_PENDING", "Expected PAYMENT_PENDING");
    assert(result.severity === "LOW", "Expected LOW severity");
  } finally {
    db.close();
  }
});

// 7. Failed PayPal payment.
test("Failed PayPal payment is classified as PAYMENT_NOT_COMPLETED", () => {
  const { db, service, payment } = createTestContext({
    paypal_status: "FAILED",
  });

  try {
    const result = service.detectIncident(payment, "PENDING", false);

    assert(
      result.classification === "PAYMENT_NOT_COMPLETED",
      "Expected PAYMENT_NOT_COMPLETED"
    );
    assert(result.severity === "MEDIUM", "Expected MEDIUM severity");
  } finally {
    db.close();
  }
});

// 8. First mismatch creates an incident.
test("First mismatch creates investigation, incident and audit records", () => {
  const { db, service, payment } = createTestContext();

  try {
    const result = service.detectIncident(payment, "PENDING", false);
    const saved = service.persistInvestigation(payment, result);

    assert(saved.incidentCreated === true, "Expected a new incident");
    assert(saved.incidentId !== null, "Expected an incident ID");

    const runs = db.prepare(
      "SELECT COUNT(*) AS count FROM investigation_runs"
    ).get();

    const incidents = db.prepare(
      "SELECT COUNT(*) AS count FROM incidents"
    ).get();

    const audits = db.prepare(
      "SELECT COUNT(*) AS count FROM audit_events"
    ).get();

    assert(runs.count === 1, "Expected one investigation run");
    assert(incidents.count === 1, "Expected one incident");
    assert(audits.count === 1, "Expected one audit event");
  } finally {
    db.close();
  }
});

// 9. Repeated mismatch reuses the incident.
test("Repeated mismatch reuses incident without creating a duplicate", () => {
  const { db, service, payment } = createTestContext();

  try {
    const firstResult = service.detectIncident(payment, "PENDING", false);
    const firstSaved = service.persistInvestigation(payment, firstResult);

    const secondResult = service.detectIncident(payment, "PENDING", false);
    const secondSaved = service.persistInvestigation(payment, secondResult);

    const incidents = db.prepare(
      "SELECT COUNT(*) AS count FROM incidents"
    ).get();

    const runs = db.prepare(
      "SELECT COUNT(*) AS count FROM investigation_runs"
    ).get();

    const audits = db.prepare(
      "SELECT COUNT(*) AS count FROM audit_events"
    ).get();

    assert(firstSaved.incidentCreated === true, "First run should create incident");
    assert(secondSaved.incidentCreated === false, "Second run should reuse incident");
    assert(firstSaved.incidentId === secondSaved.incidentId, "Incident IDs should match");
    assert(incidents.count === 1, "Expected only one incident");
    assert(runs.count === 2, "Expected two investigation runs");
    assert(audits.count === 2, "Expected two audit events");
  } finally {
    db.close();
  }
});

// 10. Non-incident classifications do not create incidents.
test("Reconciled payment persists investigation without creating incident", () => {
  const { db, service, payment } = createTestContext({
    merchant_status: "COMPLETED",
  });

  try {
    const result = service.detectIncident(payment, "COMPLETED", false);
    const saved = service.persistInvestigation(payment, result);

    const incidents = db.prepare(
      "SELECT COUNT(*) AS count FROM incidents"
    ).get();

    assert(saved.incidentId === null, "Expected no incident ID");
    assert(saved.incidentCreated === false, "Expected no incident creation");
    assert(incidents.count === 0, "Expected zero incidents");
  } finally {
    db.close();
  }
});

// 11. Invalid database connection.
test("Invalid database connection is rejected", () => {
  let rejected = false;

  try {
    createIncidentDetectionService({});
  } catch (error) {
    rejected = error.message === "A valid SQLite database connection is required.";
  }

  assert(rejected, "Expected invalid database connection to be rejected");
});

// 12. Invalid payment.
test("Invalid payment record is rejected", () => {
  const { db, service } = createTestContext();

  try {
    let rejected = false;

    try {
      service.persistInvestigation({}, {});
    } catch (error) {
      rejected = error.message === "A valid payment record is required.";
    }

    assert(rejected, "Expected invalid payment to be rejected");
  } finally {
    db.close();
  }
});

// 13. Invalid investigation result.
test("Invalid investigation result is rejected", () => {
  const { db, service, payment } = createTestContext();

  try {
    let rejected = false;

    try {
      service.persistInvestigation(payment, {});
    } catch (error) {
      rejected = error.message === "Invalid investigation result.";
    }

    assert(rejected, "Expected invalid investigation result to be rejected");
  } finally {
    db.close();
  }
});

console.log("\n========================================");
console.log("Incident Detection Test Results");
console.log("========================================");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
  process.exitCode = 1;
}
