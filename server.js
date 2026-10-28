
const crypto = require("node:crypto");
const path = require("node:path");
require("dotenv").config();

const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(
  path.join(__dirname, "resolveai.db")
);

db.pragma("foreign_keys = ON");

app.use(express.json());

// PayPal environment
const PAYPAL_BASE_URL =
  process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

// Log incoming API requests in the backend terminal.
// Do not log credentials, tokens, or request bodies.
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    console.log(
      `[ResolveAI] ${req.method} ${req.path} | HTTP ${res.statusCode} | ${Date.now() - startedAt}ms`
    );
  });

  next();
});

// Get PayPal OAuth access token
async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are missing from .env");
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error("PayPal authentication failed");
  }

  return data.access_token;
}

// Backend health check
app.get("/", (req, res) => {
  const result = {
    message: "ResolveAI Backend Running",
    status: "success",
    environment: process.env.PAYPAL_ENV || "sandbox",
  };

  console.log("[ResolveAI] Backend health:", result);
  res.json(result);
});

// Database health check
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

// Create PayPal Sandbox order
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

    // Avoid printing the approval URL.
    console.log("[ResolveAI] Order created:", {
      orderId: order.id,
      status: order.status,
    });

    res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Order creation error:",
      error.message
    );

    res.status(500).json({
      error: "Unable to create a PayPal Sandbox order",
    });
  }
});

// Capture approved PayPal order
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

    res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Capture endpoint error:",
      error.message
    );

    res.status(500).json({
      error: "Unable to process the PayPal capture",
    });
  }
});

// NEW: Verify an existing PayPal order (read-only)
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
      "\n[ResolveAI] Verified PayPal order:\n",
      JSON.stringify(result, null, 2)
    );

    res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Order lookup error:",
      error.message
    );

    res.status(500).json({
      error: "Unable to verify PayPal order",
    });
  }
});

// Verify existing PayPal capture (read-only)
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
      "\n[ResolveAI] Verified PayPal capture:\n",
      JSON.stringify(result, null, 2)
    );

    res.json(result);
  } catch (error) {
    console.error(
      "[ResolveAI] Capture lookup error:",
      error.message
    );

    res.status(500).json({
      error: "Unable to retrieve PayPal capture details",
    });
  }
});

// Start backend
app.listen(PORT, () => {
  console.log(
    `ResolveAI backend running at http://localhost:${PORT}`
  );
});
