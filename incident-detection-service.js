
const INCIDENT_CLASSIFICATIONS = new Set([
  "RECONCILIATION_MISMATCH",
  "SIMULATED_RECONCILIATION_MISMATCH",
]);

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

function createIncidentDetectionService(db) {
  if (
    !db ||
    typeof db.prepare !== "function" ||
    typeof db.transaction !== "function"
  ) {
    throw new Error(
      "A valid SQLite database connection is required."
    );
  }

  function persistInvestigation(payment, result) {
    if (!payment || !Number.isInteger(payment.id)) {
      throw new Error("A valid payment record is required.");
    }

    if (
      !result ||
      typeof result.classification !== "string" ||
      typeof result.severity !== "string" ||
      typeof result.explanation !== "string" ||
      typeof result.recommendedAction !== "string" ||
      !result.evidence
    ) {
      throw new Error("Invalid investigation result.");
    }

    const persist = db.transaction(() => {
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

      const investigationRunId = Number(
        runResult.lastInsertRowid
      );

      let incidentId = null;
      let incidentCreated = false;

      if (
        INCIDENT_CLASSIFICATIONS.has(result.classification)
      ) {
        const incidentStatus = result.simulated
          ? "SIMULATED"
          : "OPEN";

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

          incidentId = Number(
            incidentResult.lastInsertRowid
          );

          incidentCreated = true;
        }
      }

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

  return {
    detectIncident,
    persistInvestigation,
  };
}

module.exports = {
  createIncidentDetectionService,
};
