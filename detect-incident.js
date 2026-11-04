const path = require("node:path");
const Database = require("better-sqlite3");

const {
  createIncidentDetectionService,
} = require("./incident-detection-service");

const db = new Database(
  path.join(__dirname, "resolveai.db")
);

db.pragma("foreign_keys = ON");

const {
  detectIncident,
  persistInvestigation,
} = createIncidentDetectionService(db);

const VALID_STATUSES = [
  "COMPLETED",
  "PENDING",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
];

function getArgument(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((arg) =>
    arg.startsWith(prefix)
  );

  return argument ? argument.slice(prefix.length) : null;
}



function main() {
  try {
    const orderId = getArgument("order-id");
    const requestedMerchantStatus = getArgument("merchant-status");
    const simulated = process.argv.includes("--simulate");

    if (!orderId) {
      throw new Error(
        "Missing order ID. Supply --order-id=YOUR_PAYPAL_ORDER_ID"
      );
    }

    if (
      requestedMerchantStatus &&
      !VALID_STATUSES.includes(requestedMerchantStatus)
    ) {
      throw new Error(
        `Invalid merchant status. Allowed values: ${VALID_STATUSES.join(", ")}`
      );
    }

    if (requestedMerchantStatus && !simulated) {
      throw new Error(
        "Overriding merchant status is permitted only with --simulate."
      );
    }

    const payment = db.prepare(`
      SELECT
        id,
        paypal_order_id,
        paypal_status,
        merchant_status,
        paypal_capture_id,
        amount_value,
        currency_code,
        evidence_source,
        verified_at
      FROM payments
      WHERE paypal_order_id = ?
    `).get(orderId);

    if (!payment) {
      throw new Error(
        "Payment not found in SQLite. Verify and sync the PayPal order first."
      );
    }

    const merchantStatus =
      requestedMerchantStatus || payment.merchant_status;

    console.log("\n========================================");
    console.log("       ResolveAI Incident Engine");
    console.log("========================================");

    console.log("\n[1] DATABASE PAYMENT RECORD");
    console.log(JSON.stringify(payment, null, 2));

    console.log("\n[2] INVESTIGATION INPUT");
    console.log("Merchant status:", merchantStatus);
    console.log(
      "Test mode:",
      simulated ? "SIMULATED" : "DATABASE EVIDENCE ONLY"
    );

    const result = detectIncident(
      payment,
      merchantStatus,
      simulated
    );

    console.log("\n[3] DETECTION RESULT");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n[4] SUMMARY");
    console.log("Classification:", result.classification);
    console.log("Severity:", result.severity);
    console.log(
      "Simulated finding:",
      result.simulated ? "YES — NOT A REAL INCIDENT" : "NO"
    );
    console.log("Recommended action:", result.recommendedAction);

    // Persist only after detection has completed successfully.
    const saved = persistInvestigation(payment, result);

    console.log("\n[5] PERSISTENCE RESULT");
    console.log(
      "Investigation run ID:",
      saved.investigationRunId
    );
    console.log(
      "Incident ID:",
      saved.incidentId ?? "No incident created for this classification"
    );
    console.log("New incident created:", saved.incidentCreated);
    console.log("Audit event: DETECTION_COMPLETED");
    console.log("Investigation and audit results saved to SQLite.");

    console.log("\n[6] SAFETY");
    console.log("- No PayPal API calls were made.");
    console.log("- No payment was created, captured, or refunded.");
    console.log("- Payment evidence and merchant status were not modified.");
    console.log("- Simulated findings remain explicitly labelled.");
    console.log("- No AI-generated claims were used.");

    console.log("\nDetection and persistence completed successfully.");
  } catch (error) {
    console.error("\n[ResolveAI] Detection failed:", error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();