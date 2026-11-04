
const Database = require("better-sqlite3");

const {
  createPayPalWebhookService,
} = require("../paypal-webhook-service");

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

async function assertRejects(callback, expectedMessage) {
  let rejected = false;

  try {
    await callback();
  } catch (error) {
    rejected = true;

    if (
      expectedMessage &&
      !error.message.includes(expectedMessage)
    ) {
      throw new Error(
        `Expected error containing "${expectedMessage}", received "${error.message}".`
      );
    }
  }

  assert(rejected, "Expected operation to reject.");
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

    CREATE TABLE simulated_merchant_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL UNIQUE,
      merchant_status TEXT NOT NULL
        CHECK (merchant_status IN ('PENDING', 'COMPLETED')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

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
      processing_lease_token TEXT,
      processing_lease_expires_at TEXT,
      event_summary_json TEXT,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      last_error TEXT
    );
  `);

  return db;
}

function createPayment(db, overrides = {}) {
  const payment = {
    paypal_order_id: "TEST-ORDER-001",
    paypal_status: "PENDING",
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

function createSimulatedMerchantOrder(
  db,
  paymentId,
  merchantStatus = "PENDING"
) {
  db.prepare(`
    INSERT INTO simulated_merchant_orders (
      payment_id,
      merchant_status
    )
    VALUES (?, ?)
  `).run(paymentId, merchantStatus);
}

function createWebhookEvent(db, overrides = {}) {
  const event = {
    paypal_event_id: "WH-TEST-EVENT-001",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource_type: "capture",
    resource_id: "TEST-CAPTURE-001",
    verification_status: "VERIFIED",
    processing_status: "RECEIVED",
    event_summary_json: JSON.stringify({
      related_order_id: "TEST-ORDER-001",
      amount: "10.00",
      currency: "USD",
    }),
    ...overrides,
  };

  const result = db.prepare(`
    INSERT INTO paypal_webhook_events (
      paypal_event_id,
      event_type,
      resource_type,
      resource_id,
      verification_status,
      processing_status,
      event_summary_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.paypal_event_id,
    event.event_type,
    event.resource_type,
    event.resource_id,
    event.verification_status,
    event.processing_status,
    event.event_summary_json
  );

  return {
    id: Number(result.lastInsertRowid),
    ...event,
  };
}

function createFreshEvidence(overrides = {}) {
  return {
    verifiedByPayPalApi: true,
    orderId: "TEST-ORDER-001",
    orderStatus: "COMPLETED",
    captureId: "TEST-CAPTURE-001",
    captureStatus: "COMPLETED",
    captureBelongsToOrder: true,
    orderCaptureMatches: true,
    captureAmount: {
      value: "10.00",
      currency_code: "USD",
    },
    ...overrides,
  };
}

function createTestContext({
  paymentOverrides = {},
  eventOverrides = {},
  simulated = false,
  simulatedMerchantStatus = "PENDING",
  verifyPayPalEvidence,
  persistInvestigation,
  processingLeaseMs = 5 * 60 * 1000,
} = {}) {
  const db = createTestDatabase();

  const payment = createPayment(
    db,
    paymentOverrides
  );

  if (simulated) {
    createSimulatedMerchantOrder(
      db,
      payment.id,
      simulatedMerchantStatus
    );
  }

  const event = createWebhookEvent(
    db,
    eventOverrides
  );

  const incidentService =
    createIncidentDetectionService(db);

  const service = createPayPalWebhookService(db, {
    verifyPayPalEvidence:
      verifyPayPalEvidence ||
      (async () => createFreshEvidence()),

    detectIncident: incidentService.detectIncident,

    persistInvestigation:
      persistInvestigation ||
      incidentService.persistInvestigation,

    processingLeaseMs,
  });

  return {
    db,
    payment,
    event,
    service,
  };
}

function getCount(db, tableName) {
  const allowedTables = new Set([
    "payments",
    "incidents",
    "investigation_runs",
    "audit_events",
    "paypal_webhook_events",
    "simulated_merchant_orders",
  ]);

  assert(
    allowedTables.has(tableName),
    "Invalid test table name."
  );

  return db.prepare(
    `SELECT COUNT(*) AS count FROM ${tableName}`
  ).get().count;
}

function getEvent(db, eventId) {
  return db.prepare(`
    SELECT *
    FROM paypal_webhook_events
    WHERE paypal_event_id = ?
  `).get(eventId);
}

async function runTests() {
  await test(
    "Valid verified webhook creates investigation and audit records",
    async () => {
      const { db, event, service } = createTestContext();

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.status === "PROCESSED",
          "Expected PROCESSED status."
        );

        assert(
          result.classification === "RECONCILIATION_MISMATCH",
          "Expected non-simulated mismatch classification."
        );

        assert(
          getCount(db, "investigation_runs") === 1,
          "Expected one investigation run."
        );

        assert(
          getCount(db, "incidents") === 1,
          "Expected one incident."
        );

        assert(
          getCount(db, "audit_events") === 2,
          "Expected detection and webhook audit events."
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "PROCESSED",
          "Expected event to be PROCESSED."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Duplicate webhook delivery does not create another investigation",
    async () => {
      const { db, event, service } = createTestContext();

      try {
        const first = await service.processEvent(
          event.paypal_event_id
        );

        const second = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          first.status === "PROCESSED",
          "First processing should succeed."
        );

        assert(
          second.status === "NOT_CLAIMED",
          "Duplicate processing should not claim the event again."
        );

        assert(
          getCount(db, "investigation_runs") === 1,
          "Duplicate delivery created another investigation."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Unsupported PayPal event is safely ignored and audited",
    async () => {
      const { db, event, service } = createTestContext({
        eventOverrides: {
          event_type: "PAYMENT.CAPTURE.REFUNDED",
        },
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.status === "IGNORED",
          "Expected IGNORED status."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Unsupported event must not create an investigation."
        );

        assert(
          getCount(db, "audit_events") === 1,
          "Expected ignored-event audit."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Webhook without a matching payment is ignored",
    async () => {
      const { db, event, service } = createTestContext({
        eventOverrides: {
          resource_id: "UNKNOWN-CAPTURE",
        },
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.status === "IGNORED",
          "Expected unmatched payment to be ignored."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Unexpected investigation was created."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Unverified webhook event is rejected",
    async () => {
      const { db, event, service } = createTestContext({
        eventOverrides: {
          verification_status: "PENDING",
        },
      });

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "not verified"
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "RECEIVED",
          "Unverified event processing state should remain unchanged."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Unverified event must not create an investigation."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Failed fresh PayPal verification marks event FAILED",
    async () => {
      const { db, event, service } = createTestContext({
        verifyPayPalEvidence: async () => {
          throw new Error("PayPal API unavailable");
        },
      });

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "PayPal API unavailable"
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "FAILED",
          "Expected FAILED processing status."
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_attempts === 1,
          "Expected one processing attempt."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "PayPal amount mismatch blocks processing",
    async () => {
      const { db, event, service } = createTestContext({
        verifyPayPalEvidence: async () =>
          createFreshEvidence({
            captureAmount: {
              value: "11.00",
              currency_code: "USD",
            },
          }),
      });

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "amount or currency"
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "FAILED",
          "Expected FAILED status."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Amount mismatch must not create an investigation."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "PayPal currency mismatch blocks processing",
    async () => {
      const { db, event, service } = createTestContext({
        verifyPayPalEvidence: async () =>
          createFreshEvidence({
            captureAmount: {
              value: "10.00",
              currency_code: "EUR",
            },
          }),
      });

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "amount or currency"
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "FAILED",
          "Expected FAILED status."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Currency mismatch must not create an investigation."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "PayPal capture identity mismatch blocks processing",
    async () => {
      const { db, event, service } = createTestContext({
        verifyPayPalEvidence: async () =>
          createFreshEvidence({
            captureId: "DIFFERENT-CAPTURE",
          }),
      });

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "identity or completion"
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Capture identity mismatch must not create an investigation."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Webhook order mismatch blocks payment correlation",
    async () => {
      const { db, event, service } = createTestContext({
        eventOverrides: {
          event_summary_json: JSON.stringify({
            related_order_id: "DIFFERENT-ORDER",
            amount: "10.00",
            currency: "USD",
          }),
        },
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.status === "IGNORED",
          "Mismatched order should be ignored."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Mismatched order must not create an investigation."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Simulated merchant mismatch uses simulated classification",
    async () => {
      const { db, event, service } = createTestContext({
        simulated: true,
        simulatedMerchantStatus: "PENDING",
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.classification ===
            "SIMULATED_RECONCILIATION_MISMATCH",
          "Expected simulated mismatch classification."
        );

        const investigation = db.prepare(`
          SELECT simulated
          FROM investigation_runs
          WHERE id = ?
        `).get(result.investigationRunId);

        assert(
          investigation.simulated === 1,
          "Investigation should be marked simulated."
        );

        const payment = db.prepare(`
          SELECT merchant_status
          FROM payments
          WHERE id = ?
        `).get(result.paymentId);

        assert(
          payment.merchant_status === "PENDING",
          "Payment merchant status must remain unchanged."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Non-simulated merchant mismatch uses real classification",
    async () => {
      const { db, event, service } = createTestContext({
        simulated: false,
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.classification === "RECONCILIATION_MISMATCH",
          "Expected non-simulated mismatch classification."
        );

        const investigation = db.prepare(`
          SELECT simulated
          FROM investigation_runs
          WHERE id = ?
        `).get(result.investigationRunId);

        assert(
          investigation.simulated === 0,
          "Investigation should not be marked simulated."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Fresh PayPal evidence drives classification and is persisted",
    async () => {
      const { db, event, service } = createTestContext({
        paymentOverrides: {
          paypal_status: "PENDING",
        },
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        const payment = db.prepare(`
          SELECT *
          FROM payments
          WHERE id = ?
        `).get(result.paymentId);

        assert(
          result.classification === "RECONCILIATION_MISMATCH",
          "Classification must use fresh COMPLETED evidence."
        );

        assert(
          payment.paypal_status === "COMPLETED",
          "Fresh PayPal status was not persisted."
        );

        assert(
          payment.evidence_source === "PAYPAL_SANDBOX_API",
          "Expected PayPal API evidence source."
        );

        assert(
          payment.verified_at !== "2026-11-02T10:00:00.000Z",
          "Expected a fresh verification timestamp."
        );

        assert(
          payment.merchant_status === "PENDING",
          "Merchant status must not be modified."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Payment changes during PayPal verification block processing",
    async () => {
      let dbReference;
      let paymentReference;

      const { db, event, payment, service } =
        createTestContext({
          verifyPayPalEvidence: async () => {
            dbReference.prepare(`
              UPDATE payments
              SET merchant_status = 'COMPLETED'
              WHERE id = ?
            `).run(paymentReference.id);

            return createFreshEvidence();
          },
        });

      dbReference = db;
      paymentReference = payment;

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "Payment changed"
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Changed payment must not create an investigation."
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "FAILED",
          "Expected FAILED event status."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Simulated merchant changes during verification block processing",
    async () => {
      let dbReference;
      let paymentReference;

      const { db, event, payment, service } =
        createTestContext({
          simulated: true,
          simulatedMerchantStatus: "PENDING",
          verifyPayPalEvidence: async () => {
            dbReference.prepare(`
              UPDATE simulated_merchant_orders
              SET merchant_status = 'COMPLETED'
              WHERE payment_id = ?
            `).run(paymentReference.id);

            return createFreshEvidence();
          },
        });

      dbReference = db;
      paymentReference = payment;

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "Merchant state changed"
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Changed simulated state must not create an investigation."
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "FAILED",
          "Expected FAILED event status."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Investigation persistence failure rolls back evidence and audit writes",
    async () => {
      const { db, event, service } = createTestContext({
        persistInvestigation: () => {
          throw new Error(
            "Simulated investigation persistence failure"
          );
        },
      });

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "persistence failure"
        );

        const payment = db.prepare(`
          SELECT *
          FROM payments
          WHERE paypal_order_id = ?
        `).get("TEST-ORDER-001");

        assert(
          payment.paypal_status === "PENDING",
          "PayPal evidence update was not rolled back."
        );

        assert(
          payment.verified_at === "2026-11-02T10:00:00.000Z",
          "Verification timestamp update was not rolled back."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Unexpected investigation record."
        );

        assert(
          getCount(db, "audit_events") === 0,
          "Unexpected audit record after rollback."
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "FAILED",
          "Event should be marked FAILED after rollback."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Invalid webhook resource type is safely ignored",
    async () => {
      const { db, event, service } = createTestContext({
        eventOverrides: {
          resource_type: "subscription",
        },
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.status === "IGNORED",
          "Expected invalid resource type to be ignored."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Invalid resource type must not create an investigation."
        );

        assert(
          getCount(db, "audit_events") === 1,
          "Expected ignored-event audit."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Malformed webhook summary is safely ignored",
    async () => {
      const { db, event, service } = createTestContext({
        eventOverrides: {
          event_summary_json: "{invalid-json",
        },
      });

      try {
        const result = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          result.status === "IGNORED",
          "Expected malformed summary to be ignored."
        );

        assert(
          getCount(db, "investigation_runs") === 0,
          "Malformed summary must not create an investigation."
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_status === "IGNORED",
          "Expected IGNORED event state."
        );
      } finally {
        db.close();
      }
    }
  );

  // -------------------------------------------------------
  // Processing lease recovery and concurrency tests
  // -------------------------------------------------------

  await test(
    "Active processing lease prevents a second worker from claiming the event",
    async () => {
      let releaseVerification;
      let signalVerificationStarted;

      const verificationStarted = new Promise((resolve) => {
        signalVerificationStarted = resolve;
      });

      const delayedVerification = new Promise((resolve) => {
        releaseVerification = resolve;
      });

      const { db, event, service } = createTestContext({
        processingLeaseMs: 60000,
        verifyPayPalEvidence: async () => {
          signalVerificationStarted();
          return delayedVerification;
        },
      });

      try {
        const firstWorker = service.processEvent(
          event.paypal_event_id
        );

        await verificationStarted;

        const secondWorker = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          secondWorker.status === "NOT_CLAIMED",
          "Second worker must not claim an actively leased event."
        );

        assert(
          getEvent(db, event.paypal_event_id)
            .processing_attempts === 1,
          "Active lease must not increment processing attempts."
        );

        releaseVerification(createFreshEvidence());

        const firstResult = await firstWorker;

        assert(
          firstResult.status === "PROCESSED",
          "Original lease owner should complete processing."
        );
      } finally {
        // Ensure the first worker is released even if an assertion fails.
        if (releaseVerification) {
          releaseVerification(createFreshEvidence());
        }

        db.close();
      }
    }
  );

  await test(
    "Expired processing lease can be reclaimed by another worker",
    async () => {
      const { db, event, service } = createTestContext();

      try {
        db.prepare(`
          UPDATE paypal_webhook_events
          SET
            processing_status = 'PROCESSING',
            processing_attempts = 1,
            processing_lease_token = 'expired-worker-token',
            processing_lease_expires_at = ?
          WHERE paypal_event_id = ?
        `).run(
          new Date(Date.now() - 1000).toISOString(),
          event.paypal_event_id
        );

        const result = await service.processEvent(
          event.paypal_event_id
        );

        const savedEvent = getEvent(
          db,
          event.paypal_event_id
        );

        assert(
          result.status === "PROCESSED",
          "A new worker should process an event after its lease expires."
        );

        assert(
          savedEvent.processing_attempts === 2,
          "Reclaiming an expired lease should increment attempts."
        );

        assert(
          savedEvent.processing_lease_token === null,
          "Completed processing must clear the lease token."
        );

        assert(
          savedEvent.processing_lease_expires_at === null,
          "Completed processing must clear the lease expiry."
        );
      } finally {
        db.close();
      }
    }
  );

  await test(
    "Stale worker cannot commit or mark a newer worker's event FAILED",
    async () => {
      let releaseFirstVerification;
      let signalFirstVerificationStarted;
      let verificationCalls = 0;

      const firstVerificationStarted = new Promise((resolve) => {
        signalFirstVerificationStarted = resolve;
      });

      const delayedFirstVerification = new Promise((resolve) => {
        releaseFirstVerification = resolve;
      });

      const { db, event, service } = createTestContext({
        processingLeaseMs: 60000,

        verifyPayPalEvidence: async () => {
          verificationCalls++;

          if (verificationCalls === 1) {
            signalFirstVerificationStarted();
            return delayedFirstVerification;
          }

          return createFreshEvidence();
        },
      });

      try {
        const firstWorker = service.processEvent(
          event.paypal_event_id
        );

        await firstVerificationStarted;

        // Simulate Worker A's lease expiring.
        db.prepare(`
          UPDATE paypal_webhook_events
          SET processing_lease_expires_at = ?
          WHERE paypal_event_id = ?
        `).run(
          new Date(Date.now() - 1000).toISOString(),
          event.paypal_event_id
        );

        // Worker B reclaims and completes the event.
        const secondResult = await service.processEvent(
          event.paypal_event_id
        );

        assert(
          secondResult.status === "PROCESSED",
          "New worker should successfully process the reclaimed event."
        );

        // Worker A resumes after Worker B has taken over.
        releaseFirstVerification(createFreshEvidence());

        await assertRejects(
          () => firstWorker,
          "Webhook processing lease was lost or expired"
        );

        const savedEvent = getEvent(
          db,
          event.paypal_event_id
        );

        assert(
          savedEvent.processing_status === "PROCESSED",
          "Stale worker must not overwrite the newer worker's PROCESSED status."
        );

        assert(
          savedEvent.processing_attempts === 2,
          "Expected exactly two processing attempts."
        );

        assert(
          getCount(db, "investigation_runs") === 1,
          "Only the successful worker should persist an investigation."
        );

        assert(
          savedEvent.processing_lease_token === null,
          "Completed event must not retain a lease token."
        );
      } finally {
        if (releaseFirstVerification) {
          releaseFirstVerification(createFreshEvidence());
        }

        db.close();
      }
    }
  );

  await test(
    "Failed processing releases its lease and allows a successful retry",
    async () => {
      let verificationCalls = 0;

      const { db, event, service } = createTestContext({
        verifyPayPalEvidence: async () => {
          verificationCalls++;

          if (verificationCalls === 1) {
            throw new Error("Temporary PayPal API failure");
          }

          return createFreshEvidence();
        },
      });

      try {
        await assertRejects(
          () => service.processEvent(event.paypal_event_id),
          "Temporary PayPal API failure"
        );

        const failedEvent = getEvent(
          db,
          event.paypal_event_id
        );

        assert(
          failedEvent.processing_status === "FAILED",
          "First attempt should be marked FAILED."
        );

        assert(
          failedEvent.processing_lease_token === null,
          "Failed attempt should release its lease token."
        );

        assert(
          failedEvent.processing_lease_expires_at === null,
          "Failed attempt should clear its lease expiry."
        );

        const retryResult = await service.processEvent(
          event.paypal_event_id
        );

        const retriedEvent = getEvent(
          db,
          event.paypal_event_id
        );

        assert(
          retryResult.status === "PROCESSED",
          "Retry should successfully process the event."
        );

        assert(
          retriedEvent.processing_attempts === 2,
          "Retry should increment processing attempts."
        );
      } finally {
        db.close();
      }
    }
  );
}

async function main() {
  console.log("\n========================================");
  console.log("PayPal Webhook Test Suite");
  console.log("========================================\n");

  await runTests();

  console.log("\n========================================");
  console.log("PayPal Webhook Test Results");
  console.log("========================================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log(
      "\nAll webhook tests passed. Isolated in-memory database only."
    );
  }
}

main().catch((error) => {
  console.error("\nWebhook test suite execution failed:");
  console.error(error);
  process.exitCode = 1;
});
