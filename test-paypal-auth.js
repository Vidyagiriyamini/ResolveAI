require("dotenv").config();

async function testPayPalAuthentication() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

  if (process.env.PAYPAL_ENV !== "sandbox") {
    console.error("FAILED: Sandbox environment required.");
    return;
  }

  if (!clientId || !clientSecret) {
    console.error("FAILED: Missing PayPal credentials in .env");
    return;
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  try {
    const response = await fetch(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials"
        })
      }
    );

    if (!response.ok) {
      console.error(
        `FAILED: PayPal returned HTTP ${response.status}`
      );
      return;
    }

    const data = await response.json();

    if (
      typeof data.access_token !== "string" ||
      !data.access_token
    ) {
      console.error("FAILED: No access token received.");
      return;
    }

    console.log("SUCCESS: PayPal Sandbox authenticated!");
    console.log("Environment: Sandbox");
    console.log("Access token: Received (hidden)");
    console.log("Token type:", data.token_type);
    console.log("Expires in:", data.expires_in, "seconds");

  } catch {
    console.error(
      "FAILED: Could not connect to PayPal Sandbox."
    );
  }
}

testPayPalAuthentication();