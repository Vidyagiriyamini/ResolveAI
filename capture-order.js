
require("dotenv").config();
const crypto = require("node:crypto");

const BASE_URL = "https://api-m.sandbox.paypal.com";

// Use the existing order ID from test-create-order.js.
const ORDER_ID = "76X26948US493801D";

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are missing from .env");
  }

  const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials"
    })
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("PayPal authentication returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(`PayPal authentication failed: HTTP ${response.status}`);
  }

  if (!data.access_token) {
    throw new Error("PayPal did not return an access token.");
  }

  return data.access_token;
}

async function readResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { rawResponse: text };
  }
}

async function main() {
  if (process.env.PAYPAL_ENV !== "sandbox") {
    throw new Error("This script is restricted to PayPal Sandbox.");
  }

  if (!ORDER_ID || ORDER_ID === "PASTE_YOUR_ORDER_ID_HERE") {
    throw new Error("Enter the existing Sandbox Order ID.");
  }

  const token = await getAccessToken();

  // Step 1: Retrieve the existing order.
  const lookup = await fetch(
    `${BASE_URL}/v2/checkout/orders/${encodeURIComponent(ORDER_ID)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const order = await readResponse(lookup);

  if (!lookup.ok) {
    console.error("Order lookup failed. HTTP status:", lookup.status);
    console.error("PayPal response:", JSON.stringify(order));
    console.error(
      "Check that the Order ID belongs to this Sandbox app and account."
    );
    process.exitCode = 1;
    return;
  }

  console.log("Order ID:", order.id);
  console.log("Current order status:", order.status);

  // Step 2: Stop if the order is already completed.
  if (order.status === "COMPLETED") {
    console.log("Order is already completed. No capture needed.");
    return;
  }

  // Step 3: Only capture an approved order.
  if (order.status !== "APPROVED") {
    console.log(
      "Order is not APPROVED. No capture attempted."
    );
    console.log(
      "Approve the order in PayPal Sandbox before continuing."
    );
    return;
  }

  // Step 4: Capture the approved order.
  const capture = await fetch(
    `${BASE_URL}/v2/checkout/orders/${encodeURIComponent(ORDER_ID)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID()
      },
      body: JSON.stringify({})
    }
  );

  const result = await readResponse(capture);

  console.log("Capture HTTP status:", capture.status);
  console.log("PayPal order status:", result.status || "Not returned");

  for (const unit of result.purchase_units || []) {
    for (const payment of unit.payments?.captures || []) {
      console.log("Capture ID:", payment.id || "Not returned");
      console.log("Capture status:", payment.status || "Not returned");
      console.log("Capture amount:", JSON.stringify(payment.amount || {}));
    }
  }

  if (!capture.ok) {
    console.error("Capture failed:", result.name || "Unknown error");
    console.error(
      "Details:",
      JSON.stringify(
        (result.details || []).map(detail => ({
          issue: detail.issue,
          description: detail.description
        }))
      )
    );
    console.error(
      "Do not retry blindly; inspect the returned status first."
    );
    process.exitCode = 1;
    return;
  }

  if (result.status === "COMPLETED") {
    console.log("SUCCESS: PayPal order completed.");
  } else {
    console.log(
      "Capture response received, but completion is not confirmed."
    );
  }
}

main().catch(error => {
  console.error("Error:", error.message);
  process.exitCode = 1;
});
