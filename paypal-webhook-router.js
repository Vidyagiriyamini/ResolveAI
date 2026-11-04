const express = require("express");

function createPayPalWebhookRouter({
  db,
  paypalWebhookService,
  verifyPayPalWebhookSignature,
  paypalWebhookLimiter,
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("A valid SQLite database connection is required.");
  }

  if (
    !paypalWebhookService ||
    typeof paypalWebhookService.processEvent !== "function"
  ) {
    throw new Error("A valid PayPal webhook service is required.");
  }

  if (typeof verifyPayPalWebhookSignature !== "function") {
    throw new Error("PayPal signature verification is required.");
  }

  if (typeof paypalWebhookLimiter !== "function") {
    throw new Error("PayPal webhook rate limiter is required.");
  }

  const router = express.Router();

  router.post("/", paypalWebhookLimiter, async (req, res) => {
    try {
      // Step 1: Verify the event directly with PayPal.
      const verification = await verifyPayPalWebhookSignature(req);

      if (!verification.verified) {
        console.warn(
          "[ResolveAI] PayPal webhook rejected:",
          verification.reason
        );

        return res.status(400).json({
          status: "rejected",
          message: "PayPal webhook signature verification failed",
        });
      }

      const event = req.body;

      if (
        !event ||
        typeof event !== "object" ||
        Array.isArray(event) ||
        typeof event.id !== "string" ||
        event.id.trim().length === 0 ||
        event.id.length > 255 ||
        typeof event.event_type !== "string" ||
        event.event_type.trim().length === 0
      ) {
        return res.status(400).json({
          status: "rejected",
          message: "Invalid PayPal webhook event identifiers",
        });
      }

      const resource =
        event.resource &&
        typeof event.resource === "object" &&
        !Array.isArray(event.resource)
          ? event.resource
          : {};

      // Step 2: Extract only the fields needed for processing.
      const summary = {
        summary: event.summary || null,
        create_time: event.create_time || null,
        resource_status: resource.status || null,
        amount: resource.amount?.value || null,
        currency: resource.amount?.currency_code || null,
        related_order_id:
          resource.supplementary_data?.related_ids?.order_id || null,
      };

      const resourceType = event.resource_type || null;
      const resourceId = resource.id || null;
      const transmissionId =
        req.headers["paypal-transmission-id"] || null;

      // Protect SQLite from unexpected non-string identifiers.
      if (
        (resourceType !== null && typeof resourceType !== "string") ||
        (resourceId !== null && typeof resourceId !== "string") ||
        (transmissionId !== null &&
          typeof transmissionId !== "string")
      ) {
        return res.status(400).json({
          status: "rejected",
          message: "Invalid PayPal webhook resource identifiers",
        });
      }

      // Step 3: Record the verified event.
      const insertResult = db
        .prepare(`
          INSERT OR IGNORE INTO paypal_webhook_events (
            paypal_event_id,
            event_type,
            resource_type,
            resource_id,
            transmission_id,
            verification_status,
            processing_status,
            event_summary_json
          )
          VALUES (?, ?, ?, ?, ?, 'VERIFIED', 'RECEIVED', ?)
        `)
        .run(
          event.id,
          event.event_type,
          resourceType,
          resourceId,
          transmissionId,
          JSON.stringify(summary)
        );

      // Step 4: Validate duplicate event payload consistency.
      if (insertResult.changes === 0) {
        const existingEvent = db
          .prepare(`
            SELECT *
            FROM paypal_webhook_events
            WHERE paypal_event_id = ?
          `)
          .get(event.id);

        if (!existingEvent) {
          throw new Error(
            "Existing PayPal webhook event could not be retrieved."
          );
        }

        let existingSummary;

        try {
          existingSummary = JSON.parse(
            existingEvent.event_summary_json || "{}"
          );
        } catch {
          throw new Error(
            "Stored PayPal webhook summary is invalid."
          );
        }

        const sameEvent =
          existingEvent.verification_status === "VERIFIED" &&
          existingEvent.event_type === event.event_type &&
          existingEvent.resource_type === resourceType &&
          existingEvent.resource_id === resourceId &&
          existingSummary.related_order_id ===
            summary.related_order_id &&
          existingSummary.amount === summary.amount &&
          existingSummary.currency === summary.currency;

        if (!sameEvent) {
          console.error(
            "[ResolveAI] PayPal event ID collision or payload mismatch:",
            event.id
          );

          return res.status(409).json({
            status: "rejected",
            message:
              "PayPal event ID does not match its recorded payload",
          });
        }

        console.log(
          `[ResolveAI] Verified PayPal event redelivered: ${event.id}`
        );
      } else {
        console.log(
          `[ResolveAI] Verified PayPal event recorded: ${event.event_type}`
        );
      }

      // Step 5: Process the event.
      // FAILED events can be retried. Already processed, ignored,
      // or currently claimed events cannot be claimed again.
      const processing = await paypalWebhookService.processEvent(
        event.id
      );

      if (processing.status === "PROCESSED") {
        console.log(
          `[ResolveAI] PayPal event processed: ${event.id}`
        );

        return res.status(200).json({
          status: "success",
          message: "PayPal webhook verified and processed",
          eventId: event.id,
          processingStatus: processing.status,
          investigationRunId: processing.investigationRunId,
          incidentId: processing.incidentId,
          classification: processing.classification,
        });
      }

      if (
        processing.status === "IGNORED" ||
        processing.status === "NOT_CLAIMED"
      ) {
        const currentEvent = db
          .prepare(`
            SELECT processing_status
            FROM paypal_webhook_events
            WHERE paypal_event_id = ?
          `)
          .get(event.id);

        console.log(
          `[ResolveAI] PayPal event acknowledged: ${event.id} (${currentEvent?.processing_status || processing.status})`
        );

        return res.status(200).json({
          status: "success",
          message: "PayPal webhook acknowledged",
          eventId: event.id,
          processingStatus:
            currentEvent?.processing_status || processing.status,
        });
      }

      throw new Error(
        `Unexpected webhook processing status: ${processing.status}`
      );
    } catch (error) {
      console.error(
        "[ResolveAI] PayPal webhook processing error:",
        error.message
      );

      // A 500 response allows PayPal to retry delivery.
      return res.status(500).json({
        status: "error",
        message: "Unable to process PayPal webhook",
      });
    }
  });

  return router;
}

module.exports = {
  createPayPalWebhookRouter,
};