
const crypto = require("node:crypto");
const path = require("node:path");
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const { getPayPalAccessToken } = require("./paypal-auth-service");

const {
  createAiInvestigationService,
} = require("./ai-investigation-service");

const {
  createReconciliationService,
} = require("./reconciliation-service");

const {
  createOperatorAuthService,
} = require("./operator-auth-service");

const {
  createIncidentDetectionService,
} = require("./incident-detection-service");

const {
  createPayPalWebhookService,
} = require("./paypal-webhook-service");

const app = express();
const PORT = process.env.PORT || 3000;

const { getDatabasePath } = require("./db-path");
const db = new Database(getDatabasePath());

const {
  createPayPalWebhookRouter,
} = require("./paypal-webhook-router");

db.pragma("foreign_keys = ON");

// PayPal environment - Sandbox only for the hackathon.
const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox")
  .trim()
  .toLowerCase();

if (PAYPAL_ENV !== "sandbox") {
  throw new Error(
    "[ResolveAI] Unsafe PayPal environment configuration. " +
      "This hackathon build supports Sandbox only."
  );
}

const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";

// Verify existing PayPal order and capture evidence.
async function verifyPayPalEvidence(orderId, captureId) {
  if (
    typeof orderId !== "string" ||
    !/^[A-Za-z0-9]+$/.test(orderId) ||
    typeof captureId !== "string" ||
    !/^[A-Za-z0-9]+$/.test(captureId)
  ) {
    throw new Error("Invalid PayPal evidence identifiers");
  }

  const accessToken = await getPayPalAccessToken();

  const [orderResponse, captureResponse] = await Promise.all([
    fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    ),
    fetch(
      `${PAYPAL_BASE_URL}/v2/payments/captures/${encodeURIComponent(captureId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    ),
  ]);

  if (!orderResponse.ok || !captureResponse.ok) {
    throw new Error("PayPal evidence verification failed");
  }

  const [order, capture] = await Promise.all([
    orderResponse.json(),
    captureResponse.json(),
  ]);

  const orderCaptures = (order.purchase_units || []).flatMap(
    (unit) => unit.payments?.captures || []
  );

  const matchingCapture = orderCaptures.find(
    (item) => item.id === capture.id
  );

  return {
    verifiedByPayPalApi: true,
    orderId: order.id,
    orderStatus: order.status,
    captureId: capture.id,
    captureStatus: capture.status,
    captureAmount: capture.amount,
    captureBelongsToOrder: Boolean(
      matchingCapture &&
        capture.supplementary_data?.related_ids?.order_id === order.id
    ),
    orderCaptureMatches: Boolean(matchingCapture),
  };
}

// Initialize application services.
const aiInvestigationService = createAiInvestigationService(db, {
  verifyPayPalEvidence,
});

const reconciliationService = createReconciliationService(db, {
  verifyPayPalEvidence,
});

const operatorAuthService = createOperatorAuthService(db);

// Initialize incident detection and PayPal webhook processing.
const incidentDetectionService = createIncidentDetectionService(db);

const paypalWebhookService = createPayPalWebhookService(db, {
  verifyPayPalEvidence,
  detectIncident: incidentDetectionService.detectIncident,
  persistInvestigation: incidentDetectionService.persistInvestigation,
});

// Apply security-related HTTP headers.
app.use(helmet());

// Parse JSON requests and preserve the original webhook request body.
app.use(
  express.json({
    limit: "100kb",
    verify: (req, res, buffer) => {
      if (req.originalUrl.startsWith("/api/webhooks/paypal")) {
        req.rawBody = Buffer.from(buffer);
      }
    },
  })
);

// Log incoming requests without logging credentials or request bodies.
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    console.log(
      `[ResolveAI] ${req.method} ${req.path} | HTTP ${res.statusCode} | ${Date.now() - startedAt}ms`
    );
  });

  next();
});

// Dedicated rate limit for AI investigation requests.
const aiAnalysisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many AI analysis requests. Please try again later.",
  },
});

// Dedicated rate limit for PayPal webhook requests.
const paypalWebhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many PayPal webhook requests. Please try again later.",
  },
});

// General API rate limit.
// This declaration intentionally appears only once.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests. Please try again later.",
  },
  skip: (req) =>
    req.path.startsWith("/webhooks/paypal") ||
    req.path === "/health" ||
    req.path === "/health/database",
});

// Apply the general limit to API routes.
app.use("/api", apiLimiter);


// Operator authentication and session security.

const OPERATOR_SESSION_COOKIE = "resolveai_operator_session";
const OPERATOR_SESSION_MAX_AGE = 8 * 60 * 60 * 1000;

const allowedOrigins = new Set(
  (process.env.RESOLVEAI_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (allowedOrigins.size === 0) {
  throw new Error(
    "[ResolveAI] RESOLVEAI_ALLOWED_ORIGINS must be configured."
  );
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many login attempts. Please try again later.",
  },
});

const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: OPERATOR_SESSION_MAX_AGE,
};

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");

  if (!origin || !allowedOrigins.has(origin)) {
    return res.status(403).json({
      success: false,
      error: "Request origin is not allowed.",
    });
  }

  next();
}

function getOperatorSessionToken(req) {
  const cookieHeader = req.headers.cookie || "";

  const sessionCookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) =>
      item.startsWith(`${OPERATOR_SESSION_COOKIE}=`)
    );

  if (!sessionCookie) return null;

  return sessionCookie.slice(
    OPERATOR_SESSION_COOKIE.length + 1
  );
}

function requireOperator(req, res, next) {
  const token = getOperatorSessionToken(req);
  const session = operatorAuthService.getSession(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: "Operator authentication required.",
    });
  }

  req.operator = {
    username: session.username,
  };

  next();
}

// Operator login.
app.post(
  "/api/auth/login",
  requireSameOrigin,
  loginLimiter,
  (req, res) => {
    try {
      const username = req.body?.username;
      const password = req.body?.password;

      if (!operatorAuthService.authenticate(username, password)) {
        return res.status(401).json({
          success: false,
          error: "Invalid operator credentials.",
        });
      }

      operatorAuthService.cleanupExpiredSessions();

      const session = operatorAuthService.createSession(username);

      res.cookie(
        OPERATOR_SESSION_COOKIE,
        session.token,
        sessionCookieOptions
      );

      return res.json({
        success: true,
        operator: {
          username,
          expiresAt: session.expiresAt,
        },
      });
    } catch (error) {
      console.error(
        "[ResolveAI] Operator login failed:",
        error.message
      );

      return res.status(500).json({
        success: false,
        error: "Unable to complete operator login.",
      });
    }
  }
);

// Check current operator session.
app.get("/api/auth/me", (req, res) => {
  const token = getOperatorSessionToken(req);
  const session = operatorAuthService.getSession(token);

  if (!session) {
    return res.json({
      success: true,
      authenticated: false,
    });
  }

  return res.json({
    success: true,
    authenticated: true,
    operator: {
      username: session.username,
      expiresAt: session.expiresAt,
    },
  });
});

// Operator logout.
app.post(
  "/api/auth/logout",
  requireSameOrigin,
  (req, res) => {
    const token = getOperatorSessionToken(req);

    if (token) {
      operatorAuthService.revokeSession(token);
    }

    res.clearCookie(
      OPERATOR_SESSION_COOKIE,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      }
    );

    return res.json({
      success: true,
      message: "Operator logged out successfully.",
    });
  }
);


// Verify PayPal webhook signatures.
async function verifyPayPalWebhookSignature(req) {
  const headers = req.headers;

  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const authAlgo = headers["paypal-auth-algo"];
  const transmissionSig = headers["paypal-transmission-sig"];

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    return {
      verified: false,
      reason: "Required PayPal signature headers are missing",
    };
  }

  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    throw new Error("Original webhook request body is unavailable");
  }

  if (
    !req.body ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    typeof req.body.id !== "string" ||
    typeof req.body.event_type !== "string"
  ) {
    return {
      verified: false,
      reason: "Invalid webhook event structure",
    };
  }

  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  }

  const accessToken = await getPayPalAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: req.body,
      }),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `PayPal signature verification API returned HTTP ${response.status}`
    );
  }

  return {
    verified: result.verification_status === "SUCCESS",
    reason:
      result.verification_status === "SUCCESS"
        ? "PayPal signature verified"
        : "PayPal signature verification failed",
  };
}

// Receive, verify, record and process PayPal webhook events.
app.use(
  "/api/webhooks/paypal",
  createPayPalWebhookRouter({
    db,
    paypalWebhookService,
    verifyPayPalWebhookSignature,
    paypalWebhookLimiter,
  })
);

// Backend health check.
app.get("/api/health", (req, res) => {
  const result = {
    message: "ResolveAI Backend Running",
    status: "success",
    environment: PAYPAL_ENV,
  };

  console.log("[ResolveAI] Backend health:", result);
  res.json(result);
});

// Database health check.
app.get("/api/health/database", (req, res) => {
  try {
    const paymentCount = db
      .prepare("SELECT COUNT(*) AS count FROM payments")
      .get().count;

    const incidentCount = db
      .prepare("SELECT COUNT(*) AS count FROM incidents")
      .get().count;

    const result = {
      status: "success",
      database: "connected",
      payments: paymentCount,
      incidents: incidentCount,
    };

    console.log("[ResolveAI] Database health:", result);
    res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Database health check failed:",
      error.message
    );

    res.status(500).json({
      status: "error",
      error: "Database health check failed",
    });
  }
});

// Create PayPal Sandbox order.
app.post("/api/orders", async (req, res) => {
  try {
    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              description: "ResolveAI Demo Product",
              amount: {
                currency_code: "USD",
                value: "10.00",
              },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "ResolveAI",
                user_action: "PAY_NOW",
                return_url: "http://localhost:5173/success",
                cancel_url: "http://localhost:5173/cancel",
              },
            },
          },
        }),
      }
    );

    const order = await response.json();

    if (!response.ok) {
      console.error(
        "[ResolveAI] PayPal order creation failed:",
        response.status
      );

      return res.status(response.status).json({
        error: "Could not create PayPal order",
      });
    }

    const approvalLink = order.links?.find(
      (link) =>
        link.rel === "payer-action" ||
        link.rel === "approve"
    );

    if (!approvalLink) {
      return res.status(502).json({
        error: "PayPal did not return an approval link",
      });
    }

    const result = {
      id: order.id,
      status: order.status,
      approvalUrl: approvalLink.href,
    };

    console.log("[ResolveAI] Order created:", {
      orderId: order.id,
      status: order.status,
    });

    return res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Order creation error:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to create a PayPal Sandbox order",
    });
  }
});

// Capture approved PayPal order.
app.post("/api/orders/:orderId/capture", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    if (!/^[A-Za-z0-9-]+$/.test(orderId)) {
      return res.status(400).json({
        error: "Invalid PayPal order ID",
      });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `resolveai-${orderId}`,
        },
        body: "{}",
      }
    );

    const order = await response.json();

    if (!response.ok) {
      console.error("[ResolveAI] Capture failed:", {
        httpStatus: response.status,
        message: order.message,
      });

      return res.status(response.status).json({
        error: "PayPal could not capture this order",
        details: order.details?.map((item) => ({
          issue: item.issue,
          description: item.description,
        })),
      });
    }

    const captures = (order.purchase_units || []).flatMap(
      (unit) => unit.payments?.captures || []
    );

    const completedCapture = captures.find(
      (capture) => capture.status === "COMPLETED"
    );

    if (
      order.status !== "COMPLETED" ||
      !completedCapture
    ) {
      return res.status(409).json({
        status: order.status,
        error: "Payment has not been confirmed as completed",
      });
    }

    const result = {
      success: true,
      orderId: order.id,
      orderStatus: order.status,
      captureId: completedCapture.id,
      captureStatus: completedCapture.status,
      amount: completedCapture.amount,
    };

    console.log(
      "[ResolveAI] Capture completed:\n",
      JSON.stringify(result, null, 2)
    );

    return res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Capture endpoint error:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to process the PayPal capture",
    });
  }
});

// Verify an existing PayPal order (read-only).
app.get("/api/paypal/orders/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    if (!/^[A-Za-z0-9]+$/.test(orderId)) {
      return res.status(400).json({
        error: "Invalid PayPal order ID",
      });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const order = await response.json();

    if (!response.ok) {
      console.error(
        "[ResolveAI] Order lookup failed:",
        response.status
      );

      return res.status(response.status).json({
        error: "Could not retrieve PayPal order",
        paypalHttpStatus: response.status,
      });
    }

    const captures = (order.purchase_units || []).flatMap(
      (unit) => unit.payments?.captures || []
    );

    const result = {
      verifiedByPayPalApi: true,
      orderId: order.id,
      orderStatus: order.status,
      intent: order.intent,
      captures: captures.map((capture) => ({
        captureId: capture.id,
        status: capture.status,
        amount: capture.amount,
      })),
    };

    console.log(
      "[ResolveAI] Verified PayPal order:\n",
      JSON.stringify(result, null, 2)
    );

    return res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Order lookup error:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to verify PayPal order",
    });
  }
});

// Verify existing PayPal capture (read-only).
app.get("/api/paypal/captures/:captureId", async (req, res) => {
  try {
    const captureId = req.params.captureId;

    if (!/^[A-Za-z0-9]+$/.test(captureId)) {
      return res.status(400).json({
        error: "Invalid capture ID",
      });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${PAYPAL_BASE_URL}/v2/payments/captures/${encodeURIComponent(captureId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const capture = await response.json();

    if (!response.ok) {
      console.error(
        "[ResolveAI] Capture lookup failed:",
        response.status
      );

      return res.status(response.status).json({
        error: "Could not retrieve PayPal capture details",
        paypalHttpStatus: response.status,
      });
    }

    const result = {
      verifiedByPayPalApi: true,
      captureId: capture.id,
      status: capture.status,
      amount: capture.amount,
      finalCapture: capture.final_capture,
      createTime: capture.create_time,
      updateTime: capture.update_time,
      relatedIds:
        capture.supplementary_data?.related_ids ?? null,
    };

    console.log(
      "[ResolveAI] Verified PayPal capture:\n",
      JSON.stringify(result, null, 2)
    );

    return res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Capture lookup error:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to retrieve PayPal capture details",
    });
  }
});

/**
 * Retrieve investigation details (read-only).
 * Includes saved AI analysis, PayPal verification,
 * reconciliation state, and a chronological audit timeline.
 */
app.get(
  "/api/investigations/:investigationRunId",
  (req, res) => {
    try {
      const investigationRunId = Number(
        req.params.investigationRunId
      );

      if (
        !Number.isSafeInteger(investigationRunId) ||
        investigationRunId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid investigation run ID",
        });
      }

      const investigation = db
        .prepare(`
          SELECT
            ir.id,
            ir.payment_id,
            ir.classification,
            ir.severity,
            ir.simulated,
            ir.evidence_json,
            ir.explanation,
            ir.recommended_action,
            ir.ai_explanation,
            ir.ai_recommended_action,
            ir.ai_model,
            ir.ai_status,
            ir.ai_analyzed_at,
            p.paypal_order_id,
            p.paypal_status,
            p.merchant_status,
            p.paypal_capture_id,
            p.amount_value,
            p.currency_code,
            p.evidence_source,
            p.verified_at
          FROM investigation_runs ir
          INNER JOIN payments p
            ON p.id = ir.payment_id
          WHERE ir.id = ?
        `)
        .get(investigationRunId);

      if (!investigation) {
        return res.status(404).json({
          success: false,
          error: "Investigation run not found",
        });
      }

      const parseJson = (value, fallback = null) => {
        if (!value) return fallback;

        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      };

      const evidence = parseJson(
        investigation.evidence_json
      );

      if (!evidence) {
        console.error(
          "[ResolveAI] Invalid evidence JSON for investigation:",
          investigationRunId
        );

        return res.status(500).json({
          success: false,
          error: "Investigation evidence could not be read",
        });
      }

      const latestAiAudit = db
        .prepare(`
          SELECT
            details_json,
            created_at
          FROM audit_events
          WHERE event_type = 'AI_ANALYSIS_COMPLETED'
            AND entity_type = 'INVESTIGATION'
            AND entity_id = ?
          ORDER BY id DESC
          LIMIT 1
        `)
        .get(investigationRunId);

      const latestAiAuditDetails = latestAiAudit
        ? parseJson(latestAiAudit.details_json, {})
        : {};

      const paypalVerification =
        latestAiAuditDetails.paypalVerification || null;

      const proposal = db
        .prepare(`
          SELECT
            rp.id,
            rp.investigation_run_id,
            rp.payment_id,
            rp.simulated,
            rp.proposed_action,
            rp.status,
            rp.approved_by,
            rp.approved_at,
            rp.executed_at,
            rp.created_at,
            smo.merchant_status AS simulated_merchant_status
          FROM reconciliation_proposals rp
          LEFT JOIN simulated_merchant_orders smo
            ON smo.payment_id = rp.payment_id
          WHERE rp.investigation_run_id = ?
          LIMIT 1
        `)
        .get(investigationRunId);

      const auditRows = db
        .prepare(`
          SELECT
            ae.id,
            ae.event_type,
            ae.entity_type,
            ae.entity_id,
            ae.details_json,
            ae.created_at
          FROM audit_events ae
          WHERE (
            ae.entity_type = 'INVESTIGATION'
            AND ae.entity_id = ?
          )
          OR (
            ae.entity_type = 'RECONCILIATION_PROPOSAL'
            AND ae.entity_id IN (
              SELECT id
              FROM reconciliation_proposals
              WHERE investigation_run_id = ?
            )
          )
          ORDER BY ae.id ASC
        `)
        .all(investigationRunId, investigationRunId);

      const auditTimeline = auditRows.map((event) => ({
        id: event.id,
        eventType: event.event_type,
        entityType: event.entity_type,
        entityId: event.entity_id,
        details: parseJson(event.details_json, {}),
        createdAt: event.created_at,
      }));

      return res.json({
        success: true,
        investigation: {
          id: investigation.id,
          paymentId: investigation.payment_id,
          classification: investigation.classification,
          severity: investigation.severity,
          simulated: Boolean(investigation.simulated),

          evidence,

          explanation: investigation.explanation,
          recommendedAction:
            investigation.recommended_action,

          ai: {
            explanation: investigation.ai_explanation,
            recommendedAction:
              investigation.ai_recommended_action,
            model: investigation.ai_model,
            status: investigation.ai_status,
            analyzedAt: investigation.ai_analyzed_at,

            verification: latestAiAudit
              ? {
                  status:
                    latestAiAuditDetails.verificationStatus ||
                    "NOT_AVAILABLE",
                  reason:
                    latestAiAuditDetails.verificationReason || null,
                  validation:
                    latestAiAuditDetails.aiValidation || null,
                  analyzedAt: latestAiAudit.created_at,
                }
              : null,
          },

          paypal: {
            orderId: investigation.paypal_order_id,
            orderStatus: investigation.paypal_status,
            captureId: investigation.paypal_capture_id,
            amount: investigation.amount_value,
            currency: investigation.currency_code,
            evidenceSource: investigation.evidence_source,
            recordedVerifiedAt: investigation.verified_at,
            apiVerification: paypalVerification,
          },

          paymentState: {
            actualMerchantStatus:
              investigation.merchant_status,
            paypalStatus: investigation.paypal_status,
          },

          reconciliation: proposal
            ? {
                proposalId: proposal.id,
                status: proposal.status,
                simulated: Boolean(proposal.simulated),
                proposedAction: proposal.proposed_action,
                approvedBy: proposal.approved_by,
                approvedAt: proposal.approved_at,
                executedAt: proposal.executed_at,
                createdAt: proposal.created_at,
                simulatedMerchantStatus:
                  proposal.simulated_merchant_status,
                actualMerchantRecordChanged: false,
                paypalPaymentChanged: false,
              }
            : null,

          auditTimeline,
        },
      });
    } catch (error) {
      console.error(
        "[ResolveAI] Investigation retrieval failed:",
        error.message
      );

      return res.status(500).json({
        success: false,
        error: "Unable to retrieve investigation details",
      });
    }
  }
);

/**
 * AI-assisted investigation endpoint.
 */
app.post(
  "/api/investigations/:investigationRunId/ai-analysis",
  aiAnalysisLimiter,
  async (req, res) => {
    try {
      const investigationRunId = Number(
        req.params.investigationRunId
      );

      if (
        !Number.isSafeInteger(investigationRunId) ||
        investigationRunId <= 0
      ) {
        return res.status(400).json({
          error: "Invalid investigation run ID",
        });
      }

      const result =
        await aiInvestigationService.analyzeInvestigation(
          investigationRunId
        );

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      if (error.message === "Investigation run not found") {
        return res.status(404).json({
          error: "Investigation run not found",
        });
      }

      console.error(
        "[ResolveAI] AI investigation failed:",
        error.message
      );

      return res.status(500).json({
        error: "AI investigation could not be completed",
      });
    }
  }
);

/**
 * ResolveAI reconciliation API.
 * Demo-only: this workflow updates simulated merchant data,
 * never the actual PayPal payment or merchant record.
 */

// Create or retrieve an idempotent reconciliation proposal.
app.post(
  "/api/investigations/:investigationRunId/reconciliation-proposals",
  (req, res) => {
    try {
      const investigationRunId = Number(
        req.params.investigationRunId
      );

      if (
        !Number.isSafeInteger(investigationRunId) ||
        investigationRunId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid investigation run ID",
        });
      }

      const result =
        reconciliationService.propose(investigationRunId);

      return res.status(result.alreadyExists ? 200 : 201).json({
        success: true,
        simulationOnly: true,
        ...result,
      });
    } catch (error) {
      if (error.message === "Investigation run not found") {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      console.error(
        "[ResolveAI] Proposal creation failed:",
        error.message
      );

      return res.status(409).json({
        success: false,
        error: "Unable to create reconciliation proposal",
      });
    }
  }
);

// Retrieve a reconciliation proposal.
app.get(
  "/api/reconciliation-proposals/:proposalId",
  (req, res) => {
    try {
      const proposalId = Number(req.params.proposalId);

      if (
        !Number.isSafeInteger(proposalId) ||
        proposalId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid proposal ID",
        });
      }

      const proposal =
        reconciliationService.getProposal(proposalId);

      if (!proposal) {
        return res.status(404).json({
          success: false,
          error: "Reconciliation proposal not found",
        });
      }

      return res.json({
        success: true,
        simulationOnly: true,
        proposal,
      });
    } catch (error) {
      console.error(
        "[ResolveAI] Proposal retrieval failed:",
        error.message
      );

      return res.status(500).json({
        success: false,
        error: "Unable to retrieve reconciliation proposal",
      });
    }
  }
);

// Record a demo-operator approval.
app.post(
  "/api/reconciliation-proposals/:proposalId/approve",
  requireSameOrigin,
  requireOperator,
  (req, res) => {
    try {
      const proposalId = Number(req.params.proposalId);
      const approvedBy = req.operator.username;

      if (
        !Number.isSafeInteger(proposalId) ||
        proposalId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid proposal ID",
        });
      }

      const proposal =
        reconciliationService.approve(proposalId, approvedBy);

      return res.json({
        success: true,
        simulationOnly: true,
        proposal,
      });
    } catch (error) {
      if (error.message === "Reconciliation proposal not found") {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      console.error(
        "[ResolveAI] Proposal approval failed:",
        error.message
      );

      return res.status(409).json({
        success: false,
        error:
          "Unable to approve proposal; check its current status and operator identifier",
      });
    }
  }
);


// Execute an approved simulated reconciliation.
app.post(
  "/api/reconciliation-proposals/:proposalId/execute",
  requireSameOrigin,
  requireOperator,
  async (req, res) => {
    try {
      const proposalId = Number(req.params.proposalId);

      if (
        !Number.isSafeInteger(proposalId) ||
        proposalId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid proposal ID",
        });
      }

      const result =
        await reconciliationService.execute(proposalId);

      return res.json({
        success: true,
        simulationOnly: true,
        ...result,
      });
    } catch (error) {
      if (error.message === "Proposal not found") {
        return res.status(404).json({
          success: false,
          error: "Reconciliation proposal not found",
        });
      }

      if (
        error.message === "Fresh PayPal verification is unavailable"
      ) {
        return res.status(503).json({
          success: false,
          error: "PayPal verification is temporarily unavailable. Please retry later.",
          simulationOnly: true,
        });
      }

      console.error(
        "[ResolveAI] Reconciliation execution failed:",
        error.message
      );

      return res.status(409).json({
        success: false,
        error:
          "Unable to execute reconciliation; approval, fresh payment verification, or eligibility may be required",
        simulationOnly: true,
      });
    }
  }
);


// Serve the production React frontend.
const frontendDistPath = path.join(__dirname, "client", "dist");

app.use(express.static(frontendDistPath));

// Support React frontend routes while keeping API routes separate.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) {
    return next();
  }

  res.sendFile(
    path.join(frontendDistPath, "index.html"),
    (error) => {
      if (error) {
        next(error);
      }
    }
  );
});

// Start backend.
app.listen(PORT, () => {
  console.log(
    `ResolveAI backend running at http://localhost:${PORT}`
  );
});
