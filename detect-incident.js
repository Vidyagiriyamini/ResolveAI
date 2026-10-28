const path = require("node:path");
const Database = require("better-sqlite3");

const db = new Database(
  path.join(__dirname, "resolveai.db")
);

db.pragma("foreign_keys = ON");

const VALID_STATUSES = [
  "COMPLETED",
  "PENDING",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
];

const INCIDENT_CLASSIFICATIONS = new Set([
  "RECONCILIATION_MISMATCH",
  "SIMULATED_RECONCILIATION_MISMATCH",
]);

function getArgument(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((arg) =>
    arg.startsWith(prefix)
  );

  return argument ? argument.slice(prefix.length) : null;
}

function detectIncident(payment, merchantStatus, simulated) {
  const paypalStatus = payment.paypal_status;

  const evidence = {
    orderId: payment.paypal_order_id,
    captureId: payment.paypal_capture_id,
    paypalStatus,
    merchantStatus,
    amount: payment.amount_value,
    currency: payment.currency_code,
    evidenceSource: payment.evidence_source,
    verifiedAt: payment.verified_at,
  };

  if (
    payment.evidence_source !== "PAYPAL_SANDBOX_API" ||
    !payment.paypal_capture_id ||
    !payment.amount_value ||
    !payment.currency_code
  ) {
    return {
      classification: "INSUFFICIENT_PAYPAL_EVIDENCE",
      severity: "UNDETERMINED",
      simulated,
      evidence,
      explanation:
        "The payment record does not contain all required PayPal verification evidence.",
      recommendedAction:
        "Retrieve and validate the payment directly with PayPal before investigating a mismatch.",
    };
  }

  if (merchantStatus === "UNKNOWN") {
    return {
      classification: "INSUFFICIENT_MERCHANT_EVIDENCE",
      severity: "UNDETERMINED",
      simulated,
      evidence,
      explanation:
        "PayPal evidence is recorded, but the merchant-side order state is unknown.",
      recommendedAction:
        "Retrieve the merchant order state from its authoritative source before classifying an incident.",
    };
  }

  if (
    paypalStatus === "COMPLETED" &&
    merchantStatus === "COMPLETED"
  ) {
    return {
      classification: "RECONCILED",
      severity: "NONE",
      simulated,
      evidence,
      explanation:
        "PayPal and merchant states both indicate completion.",
      recommendedAction:
        "No payment recovery action is needed. Continue normal reconciliation monitoring.",
    };
  }

  if (
    paypalStatus === "COMPLETED" &&
    merchantStatus === "PENDING"
  ) {
    return {
      classification: simulated
        ? "SIMULATED_RECONCILIATION_MISMATCH"
        : "RECONCILIATION_MISMATCH",
      severity: "HIGH",
      simulated,
      evidence,
      explanation: simulated
        ? "In this test, PayPal shows a completed payment while the simulated merchant state remains pending. This demonstrates the mismatch detection rule, not a real merchant failure."
        : "Verified PayPal completion conflicts with the supplied merchant state. The merchant state and order correlation should be independently confirmed.",
      recommendedAction:
        "Check the merchant order record and webhook/event processing history. If the mismatch is confirmed, reconcile the existing payment idempotently. Do not charge the customer again.",
    };
  }

  if (
    paypalStatus === "PENDING" &&
    merchantStatus === "PENDING"
  ) {
    return {
      classification: "PAYMENT_PENDING",
      severity: "LOW",
      simulated,
      evidence,
      explanation:
        "Both systems report a pending state.",
      recommendedAction:
        "Monitor the payment and recheck its status. Do not initiate another charge.",
    };
  }

  if (
    paypalStatus === "FAILED" ||
    paypalStatus === "CANCELLED"
  ) {
    return {
      classification: "PAYMENT_NOT_COMPLETED",
      severity: "MEDIUM",
      simulated,
      evidence,
      explanation:
        `PayPal reports ${paypalStatus}; a completed payment has not been established by this rule.`,
      recommendedAction:
        "Check the full PayPal payment details and merchant order history before deciding whether a new checkout is appropriate.",
    };
  }

  return {
    classification: "REVIEW_REQUIRED",
    severity: "MEDIUM",
    simulated,
    evidence,
    explanation:
      "The current combination of payment and merchant statuses needs further investigation.",
    recommendedAction:
      "Retrieve authoritative status details from both systems and review the payment history.",
  };
}

function persistInvestigation(payment, result) {
  const persist = db.transaction(() => {
    // Save every investigation, including cases where
    // the evidence is insufficient to declare an incident.
    const runResult = db.prepare(`
      INSERT INTO investigation_runs (
        payment_id,
        classification,
        severity,
        simulated,
        evidence_json,
        explanation,
        recommended_action
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.id,
      result.classification,
      result.severity,
      result.simulated ? 1 : 0,
      JSON.stringify(result.evidence),
      result.explanation,
      result.recommendedAction
    );

    const investigationRunId = Number(runResult.lastInsertRowid);
    let incidentId = null;
    let incidentCreated = false;

    // Only reconciliation mismatches become incident records
    // in this version. Simulated findings are clearly labelled.
    if (INCIDENT_CLASSIFICATIONS.has(result.classification)) {
      const incidentStatus = result.simulated
        ? "SIMULATED"
        : "OPEN";

      // Reuse an existing matching open/simulated incident
      // instead of creating duplicates on every investigation.
      const existingIncident = db.prepare(`
        SELECT id
        FROM incidents
        WHERE payment_id = ?
          AND incident_type = ?
          AND simulated = ?
          AND status = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(
        payment.id,
        result.classification,
        result.simulated ? 1 : 0,
        incidentStatus
      );

      if (existingIncident) {
        incidentId = existingIncident.id;
      } else {
        const incidentResult = db.prepare(`
          INSERT INTO incidents (
            payment_id,
            incident_type,
            status,
            severity,
            simulated,
            evidence_json,
            explanation,
            recommended_action,
            detection_run_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          payment.id,
          result.classification,
          incidentStatus,
          result.severity,
          result.simulated ? 1 : 0,
          JSON.stringify(result.evidence),
          result.explanation,
          result.recommendedAction,
          investigationRunId
        );

        incidentId = Number(incidentResult.lastInsertRowid);
        incidentCreated = true;
      }
    }

    // Record the result and associated incident reference.
    db.prepare(`
      INSERT INTO audit_events (
        event_type,
        entity_type,
        entity_id,
        details_json
      )
      VALUES (?, ?, ?, ?)
    `).run(
      "DETECTION_COMPLETED",
      "INVESTIGATION",
      investigationRunId,
      JSON.stringify({
        investigationRunId,
        paymentId: payment.id,
        classification: result.classification,
        severity: result.severity,
        simulated: result.simulated,
        incidentId,
        incidentCreated,
      })
    );

    return {
      investigationRunId,
      incidentId,
      incidentCreated,
    };
  });

  return persist();
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