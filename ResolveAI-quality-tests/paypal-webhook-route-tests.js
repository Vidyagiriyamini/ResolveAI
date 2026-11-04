const Database = require("better-sqlite3");
const express = require("express");

const {
  createPayPalWebhookRouter,
} = require("../paypal-webhook-router");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, callback) {
  try {
    await callback();
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

  db.exec(`
    CREATE TABLE paypal_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paypal_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      transmission_id TEXT,
      verification_status TEXT NOT NULL,
      processing_status TEXT NOT NULL,
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      event_summary_json TEXT,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      last_error TEXT
    );
  `);

  return db;
}

function createEvent(overrides = {}) {
  return {
    id: "WH-HTTP-TEST-001",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource_type: "capture",
    resource: {
      id: "TEST-CAPTURE-001",
      status: "COMPLETED",
      amount: {
        value: "10.00",
        currency_code: "USD",
      },
      supplementary_data: {
        related_ids: {
          order_id: "TEST-ORDER-001",
        },
      },
    },
    ...overrides,
  };
}

async function createTestServer({
  verified = true,
  processEvent,
} = {}) {
  const db = createTestDatabase();

  let signatureChecks = 0;
  let processingCalls = 0;

  const app = express();

  // Match the raw-body capture behavior used by server.js.
  app.use(
    express.json({
      verify(req, res, buffer) {
        req.rawBody = buffer.toString("utf8");
      },
    })
  );

  const paypalWebhookService = {
    async processEvent(eventId) {
      processingCalls++;

      if (processEvent) {
        return processEvent(eventId, db);
      }

      db.prepare(`
        UPDATE paypal_webhook_events
        SET processing_status = 'PROCESSED'
        WHERE paypal_event_id = ?
      `).run(eventId);

      return {
        status: "PROCESSED",
        investigationRunId: 101,
        incidentId: 201,
        classification: "RECONCILIATION_MISMATCH",
      };
    },
  };

  app.use(
    "/api/webhooks/paypal",
    createPayPalWebhookRouter({
      db,
      paypalWebhookService,

      async verifyPayPalWebhookSignature(req) {
        signatureChecks++;

        assert(
          typeof req.rawBody === "string",
          "Raw request body was not preserved."
        );

        return {
          verified,
          reason: verified ? null : "Invalid test signature",
        };
      },

      paypalWebhookLimiter(req, res, next) {
        next();
      },
    })
  );

  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();

  return {
    db,
    server,
    url: `http://127.0.0.1:${address.port}/api/webhooks/paypal`,

    get signatureChecks() {
      return signatureChecks;
    },

    get processingCalls() {
      return processingCalls;
    },

    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      db.close();
    },
  };
}

async function sendEvent(context, event) {
  return fetch(context.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "paypal-transmission-id": "TEST-TRANSMISSION-001",
    },
    body: JSON.stringify(event),
  });
}

function getEvent(db, eventId) {
  return db.prepare(`
    SELECT *
    FROM paypal_webhook_events
    WHERE paypal_event_id = ?
  `).get(eventId);
}

function getEventCount(db) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM paypal_webhook_events
  `).get().count;
}

async function runTests() {
  await test(
    "Invalid PayPal signature is rejected without recording the event",
    async () => {
      const context = await createTestServer({
        verified: false,
      });

      try {
        const response = await sendEvent(
          context,
          createEvent()
        );

        const body = await response.json();

        assert(response.status === 400, "Expected HTTP 400.");
        assert(body.status === "rejected", "Expected rejection.");
        assert(getEventCount(context.db) === 0, "Unverified event was recorded.");
        assert(context.processingCalls === 0, "Unverified event was processed.");
      } finally {
        await context.close();
      }
    }
  );

  await test(
    "Valid webhook is recorded and processed with HTTP 200",
    async () => {
      const context = await createTestServer();

      try {
        const response = await sendEvent(
          context,
          createEvent()
        );

        const body = await response.json();
        const event = getEvent(
          context.db,
          "WH-HTTP-TEST-001"
        );

        assert(response.status === 200, "Expected HTTP 200.");
        assert(body.processingStatus === "PROCESSED", "Expected PROCESSED response.");
        assert(body.investigationRunId === 101, "Investigation ID missing.");
        assert(body.incidentId === 201, "Incident ID missing.");
        assert(event.verification_status === "VERIFIED", "Event was not verified.");
        assert(event.processing_status === "PROCESSED", "Event was not processed.");
        assert(context.signatureChecks === 1, "Expected one signature check.");
        assert(context.processingCalls === 1, "Expected one processing call.");
      } finally {
        await context.close();
      }
    }
  );

  await test(
    "Duplicate delivery is acknowledged without duplicate processing",
    async () => {
      let calls = 0;

      const context = await createTestServer({
        processEvent: async (eventId, db) => {
          calls++;

          if (calls === 1) {
            db.prepare(`
              UPDATE paypal_webhook_events
              SET processing_status = 'PROCESSED'
              WHERE paypal_event_id = ?
            `).run(eventId);

            return {
              status: "PROCESSED",
              investigationRunId: 101,
              incidentId: 201,
              classification: "RECONCILIATION_MISMATCH",
            };
          }

          return { status: "NOT_CLAIMED" };
        },
      });

      try {
        const first = await sendEvent(context, createEvent());
        const second = await sendEvent(context, createEvent());

        assert(first.status === 200, "First delivery should succeed.");
        assert(second.status === 200, "Duplicate should be acknowledged.");
        assert(calls === 2, "Expected duplicate processor invocation to be safely rejected by the service.");
        assert(getEventCount(context.db) === 1, "Duplicate created another event record.");
        assert(
          getEvent(context.db, "WH-HTTP-TEST-001").processing_status === "PROCESSED",
          "Original event should remain processed."
        );
      } finally {
        await context.close();
      }
    }
  );

  await test(
    "Reused event ID with changed payload is rejected with HTTP 409",
    async () => {
      const context = await createTestServer();

      try {
        const first = await sendEvent(context, createEvent());

        const changedEvent = createEvent({
          resource: {
            ...createEvent().resource,
            amount: {
              value: "99.00",
              currency_code: "USD",
            },
          },
        });

        const second = await sendEvent(context, changedEvent);
        const body = await second.json();

        assert(first.status === 200, "Initial delivery should succeed.");
        assert(second.status === 409, "Expected HTTP 409.");
        assert(body.status === "rejected", "Expected rejection.");
        assert(context.processingCalls === 1, "Changed payload reached processor.");
        assert(getEventCount(context.db) === 1, "Unexpected second event record.");
      } finally {
        await context.close();
      }
    }
  );

  await test(
    "Processing failure returns HTTP 500 so PayPal can retry",
    async () => {
      const context = await createTestServer({
        processEvent: async () => {
          throw new Error("Simulated processing failure");
        },
      });

      try {
        const response = await sendEvent(
          context,
          createEvent()
        );

        const body = await response.json();

        assert(response.status === 500, "Expected HTTP 500.");
        assert(body.status === "error", "Expected error response.");
        assert(context.processingCalls === 1, "Expected one processing attempt.");
        assert(
          getEvent(context.db, "WH-HTTP-TEST-001").verification_status === "VERIFIED",
          "Verified event should remain recorded for retry."
        );
      } finally {
        await context.close();
      }
    }
  );

  await test(
    "Unsupported event is acknowledged as ignored",
    async () => {
      const context = await createTestServer({
        processEvent: async (eventId, db) => {
          db.prepare(`
            UPDATE paypal_webhook_events
            SET processing_status = 'IGNORED'
            WHERE paypal_event_id = ?
          `).run(eventId);

          return { status: "IGNORED" };
        },
      });

      try {
        const response = await sendEvent(
          context,
          createEvent({
            event_type: "PAYMENT.CAPTURE.REFUNDED",
          })
        );

        const body = await response.json();

        assert(response.status === 200, "Expected HTTP 200.");
        assert(body.processingStatus === "IGNORED", "Expected IGNORED status.");
        assert(
          getEvent(context.db, "WH-HTTP-TEST-001").processing_status === "IGNORED",
          "Event should be recorded as ignored."
        );
      } finally {
        await context.close();
      }
    }
  );

  await test(
    "Malformed event identifiers are rejected",
    async () => {
      const context = await createTestServer();

      try {
        const response = await sendEvent(
          context,
          createEvent({ id: " " })
        );

        assert(response.status === 400, "Expected HTTP 400.");
        assert(getEventCount(context.db) === 0, "Malformed event was recorded.");
        assert(context.processingCalls === 0, "Malformed event was processed.");
      } finally {
        await context.close();
      }
    }
  );

  console.log("\n========================================");
  console.log("PayPal Webhook HTTP Route Test Results");
  console.log("========================================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log("\nAll webhook HTTP route tests passed.");
    console.log("Isolated in-memory database only.");
  }
}

runTests().catch((error) => {
  console.error("Webhook HTTP test suite failed:", error);
  process.exitCode = 1;
});