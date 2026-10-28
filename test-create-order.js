require("dotenv").config();

const PAYPAL_BASE_URL =
  "https://api-m.sandbox.paypal.com";

async function createSandboxOrder() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

  if (
    process.env.PAYPAL_ENV !== "sandbox" ||
    !clientId ||
    !clientSecret
  ) {
    console.error("Missing credentials or Sandbox configuration.");
    process.exitCode = 1;
    return;
  }

  try {
    // 1. Obtain a temporary OAuth access token.
    const authResponse = await fetch(
      `${PAYPAL_BASE_URL}/v1/oauth2/token`,
      {
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
      }
    );

    if (!authResponse.ok) {
      console.error("PayPal authentication failed:", authResponse.status);
      process.exitCode = 1;
      return;
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    if (!accessToken) {
      console.error("PayPal did not return an access token.");
      process.exitCode = 1;
      return;
    }

    // 2. Create a Sandbox order. This does not charge the buyer.
    const orderResponse = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": crypto.randomUUID()
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: "RESOLVEAI-TEST-001",
              description: "ResolveAI Sandbox test purchase",
              amount: {
                currency_code: "USD",
                value: "10.00"
              }
            }
          ],
          application_context: {
            brand_name: "ResolveAI Demo",
            user_action: "PAY_NOW",
            return_url: "http://localhost:3000/paypal-success",
            cancel_url: "http://localhost:3000/paypal-cancel"
          }
        })
      }
    );

    const orderData = await orderResponse.json();

    if (!orderResponse.ok) {
      console.error("Order creation failed. HTTP status:", orderResponse.status);
      console.error("PayPal error:", orderData.name || "Unknown error");
      console.error("Details:", JSON.stringify(orderData.details || []));
      process.exitCode = 1;
      return;
    }

    const approvalLink = orderData.links?.find(
      link => link.rel === "payer-action" || link.rel === "approve"
    )?.href;

    console.log("SUCCESS: PayPal Sandbox order created.");
    console.log("Order ID:", orderData.id);
    console.log("Order status:", orderData.status);
    console.log("Amount: USD 10.00");
    console.log("Approval link:", approvalLink || "Not returned");
    console.log("Access token: hidden");
  } catch {
    console.error("Could not connect to PayPal Sandbox.");
    process.exitCode = 1;
  }
}

const crypto = require("node:crypto");
createSandboxOrder();