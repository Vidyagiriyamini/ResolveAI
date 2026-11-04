
const crypto = require("node:crypto");

const SUPPORTED_EVENT_TYPES = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
]);

function normalizeMoney(value) {
  if (
    typeof value !== "string" ||
    !/^\d+(?:\.\d{1,2})?$/.test(value)
  ) {
    return null;
  }

  const [whole, fraction = ""] = value.split(".");

  const minorUnits =
    BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, "0"));

  return minorUnits.toString();
}

function createPayPalWebhookService(
  db,
  {
    verifyPayPalEvidence,
    detectIncident,
    persistInvestigation,
    processingLeaseMs = 5 * 60 * 1000,
  } = {}
) {
  if (
    !db ||
    typeof db.prepare !== "function" ||
    typeof db.transaction !== "function"
  ) {
    throw new Error(
      "A valid SQLite database connection is required."
    );
  }

  if (typeof verifyPayPalEvidence !== "function") {
    throw new Error(
      "PayPal evidence verification is required."
    );
  }

  if (typeof detectIncident !== "function") {
    throw new Error(
      "Incident detection is required."
    );
  }

  if (typeof persistInvestigation !== "function") {
    throw new Error(
      "Investigation persistence is required."
    );
  }

  if (
    !Number.isSafeInteger(processingLeaseMs) ||
    processingLeaseMs <= 0
  ) {
    throw new Error(
      "Processing lease duration must be a positive safe integer."
    );
  }

  const findEvent = db.prepare(`
    SELECT *
    FROM paypal_webhook_events
    WHERE paypal_event_id = ?
  `);

  const markFailed = db.prepare(`
    UPDATE paypal_webhook_events
    SET
      processing_status = 'FAILED',
      processed_at = CURRENT_TIMESTAMP,
      last_error = ?,
      processing_lease_token = NULL,
      processing_lease_expires_at = NULL
    WHERE paypal_event_id = ?
      AND processing_status = 'PROCESSING'
      AND processing_lease_token = ?
      AND processing_lease_expires_at > ?
  `);

  const markIgnored = db.prepare(`
    UPDATE paypal_webhook_events
    SET
      processing_status = 'IGNORED',
      processed_at = CURRENT_TIMESTAMP,
      last_error = ?,
      processing_lease_token = NULL,
      processing_lease_expires_at = NULL
    WHERE paypal_event_id = ?
      AND processing_status = 'PROCESSING'
      AND processing_lease_token = ?
      AND processing_lease_expires_at > ?
  `);

  const markProcessed = db.prepare(`
    UPDATE paypal_webhook_events
    SET
      processing_status = 'PROCESSED',
      processed_at = CURRENT_TIMESTAMP,
      last_error = NULL,
      processing_lease_token = NULL,
      processing_lease_expires_at = NULL
    WHERE paypal_event_id = ?
      AND processing_status = 'PROCESSING'
      AND processing_lease_token = ?
      AND processing_lease_expires_at > ?
  `);

  // Each claim receives a unique fencing token.
  // Expired PROCESSING events can be reclaimed safely.
  const claimEvent = db.transaction((eventId) => {
    const leaseToken = crypto.randomUUID();

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const expiresAt = new Date(
      now + processingLeaseMs
    ).toISOString();

    const result = db.prepare(`
      UPDATE paypal_webhook_events
      SET
        processing_status = 'PROCESSING',
        processing_attempts = processing_attempts + 1,
        processed_at = NULL,
        last_error = NULL,
        processing_lease_token = ?,
        processing_lease_expires_at = ?
      WHERE paypal_event_id = ?
        AND verification_status = 'VERIFIED'
        AND (
          processing_status IN ('RECEIVED', 'FAILED')
          OR (
            processing_status = 'PROCESSING'
            AND (
              processing_lease_expires_at IS NULL
              OR processing_lease_expires_at <= ?
            )
          )
        )
    `).run(
      leaseToken,
      expiresAt,
      eventId,
      nowIso
    );

    return result.changes === 1
      ? leaseToken
      : null;
  });

  function recordIgnoredEvent(
    event,
    eventId,
    reason,
    leaseToken
  ) {
    return db.transaction(() => {
      const nowIso = new Date().toISOString();

      const updated = markIgnored.run(
        reason,
        eventId,
        leaseToken,
        nowIso
      );

      if (updated.changes !== 1) {
        return false;
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
        "PAYPAL_WEBHOOK_IGNORED",
        "PAYPAL_WEBHOOK_EVENT",
        event.id,
        JSON.stringify({
          eventId,
          eventType: event.event_type,
          reason,
        })
      );

      return true;
    })();
  }

  function hasSamePaymentSnapshot(original, latest) {
    if (!latest) {
      return false;
    }

    const fields = [
      "paypal_order_id",
      "paypal_capture_id",
      "paypal_status",
      "merchant_status",
      "amount_value",
      "currency_code",
      "evidence_source",
      "verified_at",
    ];

    return fields.every(
      (field) => original[field] === latest[field]
    );
  }

  async function processEvent(eventId) {
    if (
      typeof eventId !== "string" ||
      eventId.trim().length === 0 ||
      eventId.length > 255
    ) {
      throw new Error(
        "Invalid PayPal webhook event ID."
      );
    }

    const event = findEvent.get(eventId);

    if (!event) {
      throw new Error(
        "PayPal webhook event was not found."
      );
    }

    if (event.verification_status !== "VERIFIED") {
      throw new Error(
        "Webhook event is not verified."
      );
    }

    // Unsupported events are ignored before claiming.
    // They cannot interfere with an active PROCESSING worker.
    if (!SUPPORTED_EVENT_TYPES.has(event.event_type)) {
      const ignored = db.transaction(() => {
        const updated = db.prepare(`
          UPDATE paypal_webhook_events
          SET
            processing_status = 'IGNORED',
            processed_at = CURRENT_TIMESTAMP,
            last_error = ?,
            processing_lease_token = NULL,
            processing_lease_expires_at = NULL
          WHERE paypal_event_id = ?
            AND verification_status = 'VERIFIED'
            AND processing_status IN ('RECEIVED', 'FAILED')
        `).run(
          "Unsupported PayPal event type.",
          eventId
        );

        if (updated.changes !== 1) {
          return false;
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
          "PAYPAL_WEBHOOK_IGNORED",
          "PAYPAL_WEBHOOK_EVENT",
          event.id,
          JSON.stringify({
            eventId,
            eventType: event.event_type,
            reason: "Unsupported event type",
          })
        );

        return true;
      })();

      return {
        status: ignored ? "IGNORED" : "NOT_CLAIMED",
        eventId,
      };
    }

    // A successful claim returns its unique lease token.
    const leaseToken = claimEvent(eventId);

    if (!leaseToken) {
      return {
        status: "NOT_CLAIMED",
        eventId,
      };
    }

    try {
      let summary;

      try {
        summary = JSON.parse(
          event.event_summary_json || "{}"
        );
      } catch {
        const ignored = recordIgnoredEvent(
          event,
          eventId,
          "Invalid webhook event summary JSON.",
          leaseToken
        );

        return {
          status: ignored ? "IGNORED" : "NOT_CLAIMED",
          eventId,
          reason: "Invalid event summary",
        };
      }

      const resourceId = event.resource_id;
      const relatedOrderId = summary.related_order_id;

      if (
        typeof resourceId !== "string" ||
        resourceId.length === 0 ||
        typeof relatedOrderId !== "string" ||
        relatedOrderId.length === 0
      ) {
        const ignored = recordIgnoredEvent(
          event,
          eventId,
          "Webhook capture ID or related order ID is missing.",
          leaseToken
        );

        return {
          status: ignored ? "IGNORED" : "NOT_CLAIMED",
          eventId,
          reason: "Incomplete payment correlation data",
        };
      }

      if (
        event.resource_type &&
        event.resource_type.toLowerCase() !== "capture"
      ) {
        const ignored = recordIgnoredEvent(
          event,
          eventId,
          "Webhook resource type is not a capture.",
          leaseToken
        );

        return {
          status: ignored ? "IGNORED" : "NOT_CLAIMED",
          eventId,
          reason: "Invalid resource type",
        };
      }

      // Match both PayPal identifiers exactly.
      const matchingPayments = db.prepare(`
        SELECT *
        FROM payments
        WHERE paypal_capture_id = ?
          AND paypal_order_id = ?
      `).all(
        resourceId,
        relatedOrderId
      );

      if (matchingPayments.length !== 1) {
        const ignored = recordIgnoredEvent(
          event,
          eventId,
          matchingPayments.length === 0
            ? "No existing payment matches both PayPal identifiers."
            : "Multiple payments match the webhook identifiers.",
          leaseToken
        );

        return {
          status: ignored ? "IGNORED" : "NOT_CLAIMED",
          eventId,
          reason: "Payment correlation failed",
        };
      }

      const payment = matchingPayments[0];

      if (
        !payment.amount_value ||
        !payment.currency_code
      ) {
        throw new Error(
          "Recorded payment amount or currency is unavailable."
        );
      }

      // Capture merchant state BEFORE awaiting PayPal.
      // This allows us to detect changes during verification.
      const simulatedOrder = db.prepare(`
        SELECT merchant_status
        FROM simulated_merchant_orders
        WHERE payment_id = ?
      `).get(payment.id);

      const isSimulated = Boolean(simulatedOrder);

      const merchantStatus = isSimulated
        ? simulatedOrder.merchant_status
        : payment.merchant_status;

      // Fetch fresh authoritative evidence from PayPal.
      const freshEvidence = await verifyPayPalEvidence(
        payment.paypal_order_id,
        payment.paypal_capture_id
      );

      if (
        !freshEvidence ||
        freshEvidence.verifiedByPayPalApi !== true ||
        freshEvidence.orderId !== payment.paypal_order_id ||
        freshEvidence.captureId !== payment.paypal_capture_id ||
        freshEvidence.orderStatus !== "COMPLETED" ||
        freshEvidence.captureStatus !== "COMPLETED" ||
        freshEvidence.captureBelongsToOrder !== true ||
        freshEvidence.orderCaptureMatches !== true
      ) {
        throw new Error(
          "Fresh PayPal evidence failed identity or completion verification."
        );
      }

      const freshAmount = freshEvidence.captureAmount;

      const freshMinorUnits = normalizeMoney(
        freshAmount?.value
      );

      const recordedMinorUnits = normalizeMoney(
        String(payment.amount_value)
      );

      if (
        freshMinorUnits === null ||
        recordedMinorUnits === null ||
        freshMinorUnits !== recordedMinorUnits ||
        typeof freshAmount.currency_code !== "string" ||
        !/^[A-Z]{3}$/.test(freshAmount.currency_code) ||
        freshAmount.currency_code !== payment.currency_code
      ) {
        throw new Error(
          "Fresh PayPal amount or currency does not match the recorded payment."
        );
      }

      if (
        summary.amount !== undefined &&
        summary.amount !== null
      ) {
        const webhookMinorUnits = normalizeMoney(
          String(summary.amount)
        );

        if (
          webhookMinorUnits === null ||
          webhookMinorUnits !== freshMinorUnits
        ) {
          throw new Error(
            "Webhook amount does not match fresh PayPal evidence."
          );
        }
      }

      if (
        summary.currency !== undefined &&
        summary.currency !== null &&
        summary.currency !== freshAmount.currency_code
      ) {
        throw new Error(
          "Webhook currency does not match fresh PayPal evidence."
        );
      }

      const verifiedPayment = {
        ...payment,
        paypal_status: freshEvidence.orderStatus,
        amount_value: freshAmount.value,
        currency_code: freshAmount.currency_code,
        evidence_source: "PAYPAL_SANDBOX_API",
        verified_at: new Date().toISOString(),
        merchant_status: merchantStatus,
      };

      const complete = db.transaction(() => {
        // Fencing check: the worker must still own an
        // unexpired lease before making ANY database writes.
        const nowIso = new Date().toISOString();

        const activeClaim = db.prepare(`
          SELECT
            processing_status,
            processing_lease_token,
            processing_lease_expires_at
          FROM paypal_webhook_events
          WHERE paypal_event_id = ?
        `).get(eventId);

        if (
          !activeClaim ||
          activeClaim.processing_status !== "PROCESSING" ||
          activeClaim.processing_lease_token !== leaseToken ||
          typeof activeClaim.processing_lease_expires_at !== "string" ||
          activeClaim.processing_lease_expires_at <= nowIso
        ) {
          throw new Error(
            "Webhook processing lease was lost or expired. Processing must be retried."
          );
        }

        // Check the payment snapshot again before committing.
        const latestPayment = db.prepare(`
          SELECT *
          FROM payments
          WHERE id = ?
        `).get(payment.id);

        if (
          !hasSamePaymentSnapshot(
            payment,
            latestPayment
          )
        ) {
          throw new Error(
            "Payment changed during PayPal verification. Processing must be retried."
          );
        }

        // Check the original simulated merchant snapshot.
        const latestSimulatedOrder = db.prepare(`
          SELECT merchant_status
          FROM simulated_merchant_orders
          WHERE payment_id = ?
        `).get(payment.id);

        if (
          Boolean(latestSimulatedOrder) !== isSimulated ||
          (
            isSimulated &&
            latestSimulatedOrder.merchant_status !==
              simulatedOrder.merchant_status
          )
        ) {
          throw new Error(
            "Merchant state changed during PayPal verification. Processing must be retried."
          );
        }

        // Update PayPal evidence only.
        // Never update the merchant status here.
        const evidenceUpdate = db.prepare(`
          UPDATE payments
          SET
            paypal_status = ?,
            amount_value = ?,
            currency_code = ?,
            evidence_source = ?,
            verified_at = ?
          WHERE id = ?
        `).run(
          freshEvidence.orderStatus,
          freshAmount.value,
          freshAmount.currency_code,
          "PAYPAL_SANDBOX_API",
          verifiedPayment.verified_at,
          payment.id
        );

        if (evidenceUpdate.changes !== 1) {
          throw new Error(
            "Unable to persist freshly verified PayPal evidence."
          );
        }

        const result = detectIncident(
          verifiedPayment,
          merchantStatus,
          isSimulated
        );

        const investigation = persistInvestigation(
          verifiedPayment,
          result
        );

        // Final state transition also checks ownership and expiry.
        const updated = markProcessed.run(
          eventId,
          leaseToken,
          new Date().toISOString()
        );

        if (updated.changes !== 1) {
          throw new Error(
            "Webhook processing lease was lost before completion."
          );
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
          "PAYPAL_WEBHOOK_PROCESSED",
          "PAYPAL_WEBHOOK_EVENT",
          event.id,
          JSON.stringify({
            eventId,
            eventType: event.event_type,
            paymentId: payment.id,
            investigationRunId:
              investigation.investigationRunId,
            incidentId: investigation.incidentId,
            classification: result.classification,
            severity: result.severity,
            simulated: isSimulated,
            paypalEvidenceVerified: true,
          })
        );

        return {
          investigation,
          classification: result.classification,
        };
      });

      const completed = complete();

      return {
        status: "PROCESSED",
        eventId,
        paymentId: payment.id,
        investigationRunId:
          completed.investigation.investigationRunId,
        incidentId:
          completed.investigation.incidentId,
        classification: completed.classification,
      };
    } catch (error) {
      // A stale worker cannot mark a newer worker's claim FAILED.
      // An expired lease remains reclaimable.
      markFailed.run(
        String(
          error.message || "Webhook processing failed"
        ).slice(0, 1000),
        eventId,
        leaseToken,
        new Date().toISOString()
      );

      throw error;
    }
  }

  return {
    processEvent,
  };
}

module.exports = {
  createPayPalWebhookService,
};
