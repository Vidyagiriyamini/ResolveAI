const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are missing");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  let response;

  try {
    response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("PayPal authentication request failed or timed out");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("PayPal returned an invalid authentication response");
  }

  if (
    !response.ok ||
    typeof data.access_token !== "string" ||
    data.access_token.length === 0 ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  ) {
    throw new Error("PayPal authentication failed");
  }

  return data.access_token;
}

module.exports = { getPayPalAccessToken };
