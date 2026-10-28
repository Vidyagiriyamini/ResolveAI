
const path = require("node:path");
const Database = require("better-sqlite3");

const db = new Database(
  path.join(__dirname, "resolveai.db"),
  { readonly: true }
);

try {
  const orderId = "5SK84774459287357";

  console.log("\n========================================");
  console.log(" ResolveAI Investigation Audit Check");
  console.log("========================================");

  const payment = db.prepare(`
    SELECT
      paypal_order_id,
      paypal_status,
      merchant_status,
      evidence_source,
      paypal_capture_id,
      amount_value,
      currency_code
    FROM payments
    WHERE paypal_order_id = ?
  `).get(orderId);

  if (!payment) {
    throw new Error("Expected payment record was not found.");
  }

  const investigations = db.prepare(`
    SELECT
      id,
      classification,
      severity,
      simulated,
      created_at
    FROM investigation_runs
    WHERE payment_id = (
      SELECT id FROM payments WHERE paypal_order_id = ?
    )
    ORDER BY id
  `).all(orderId);

  const incidents = db.prepare(`
    SELECT
      id,
      incident_type,
      status,
      severity,
      simulated,
      detection_run_id
    FROM incidents
    WHERE payment_id = (
      SELECT id FROM payments WHERE paypal_order_id = ?
    )
    ORDER BY id
  `).all(orderId);

  const auditEvents = db.prepare(`
    SELECT
      id,
      event_type,
      entity_type,
      entity_id,
      details_json,
      created_at
    FROM audit_events
    WHERE entity_type = 'INVESTIGATION'
    ORDER BY id
  `).all();

  const orderAuditEvents = auditEvents.filter((event) => {
    try {
      const details = JSON.parse(event.details_json);
      return details.paymentId === 3;
    } catch {
      return false;
    }
  });

  console.log("\n[1] STORED PAYMENT");
  console.log(JSON.stringify(payment, null, 2));

  console.log("\n[2] INVESTIGATION RUNS");
  console.log(JSON.stringify(investigations, null, 2));

  console.log("\n[3] INCIDENT RECORDS");
  console.log(JSON.stringify(incidents, null, 2));

  console.log("\n[4] AUDIT EVENTS FOR THIS PAYMENT");
  console.log(JSON.stringify(orderAuditEvents, null, 2));

  const paymentUnchanged =
    payment.merchant_status === "UNKNOWN" &&
    payment.paypal_status === "COMPLETED" &&
    payment.evidence_source === "PAYPAL_SANDBOX_API";

  const simulationRecorded = incidents.some(
    (incident) =>
      incident.incident_type ===
        "SIMULATED_RECONCILIATION_MISMATCH" &&
      incident.simulated === 1 &&
      incident.status === "SIMULATED"
  );

  const investigationHistorySaved = investigations.length >= 3;
  const auditHistorySaved = orderAuditEvents.length >= 3;

  console.log("\n[5] VALIDATION");
  console.log("Payment evidence preserved:", paymentUnchanged);
  console.log("Investigation history saved:", investigationHistorySaved);
  console.log("Simulated incident labelled:", simulationRecorded);
  console.log("Audit history saved:", auditHistorySaved);

  if (
    !paymentUnchanged ||
    !investigationHistorySaved ||
    !simulationRecorded ||
    !auditHistorySaved
  ) {
    console.error("\nRESULT: VALIDATION NEEDS REVIEW");
    process.exitCode = 1;
  } else {
    console.log("\nRESULT: ALL CHECKS PASSED");
  }
} catch (error) {
  console.error("\nAudit verification failed:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}