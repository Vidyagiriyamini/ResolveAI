
const path = require("node:path");
require("dotenv").config();

const Database = require("better-sqlite3");

const ORDER_ID = "5SK84774459287357";
const EXPECTED_CAPTURE_ID = "630529516H486291E";

async function main() {
  let db;

  try {
    if (process.env.PAYPAL_ENV !== "sandbox") {
      throw new Error(
        "This script only runs in PayPal Sandbox."
      );
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("PayPal Sandbox credentials missing.");
    }

    const baseUrl = "https://api-m.sandbox.paypal.com";

    console.log("\n=== ResolveAI Payment Evidence Sync ===");
    console.log("Environment: SANDBOX");
    console.log("Order ID:", ORDER_ID);

    // 1. Authenticate securely with PayPal
    const credentials = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const authResponse = await fetch(
      `${baseUrl}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      }
    );

    if (!authResponse.ok) {
      throw new Error(
        `PayPal authentication failed: HTTP ${authResponse.status}`
      );
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    console.log("PayPal authentication: SUCCESS");

    // 2. Retrieve existing PayPal order
    const orderResponse = await fetch(
      `${baseUrl}/v2/checkout/orders/${ORDER_ID}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!orderResponse.ok) {
      throw new Error(
        `PayPal order lookup failed: HTTP ${orderResponse.status}`
      );
    }

    const order = await orderResponse.json();

    const captures = (order.purchase_units || []).flatMap(
      (unit) => unit.payments?.captures || []
    );

    const capture = captures.find(
      (item) => item.id === EXPECTED_CAPTURE_ID
    );

    if (
      order.id !== ORDER_ID ||
      order.status !== "COMPLETED" ||
      !capture ||
      capture.status !== "COMPLETED"
    ) {
      throw new Error(
        "PayPal order/capture verification did not pass."
      );
    }

    // 3. Independently verify capture details
    const captureResponse = await fetch(
      `${baseUrl}/v2/payments/captures/${EXPECTED_CAPTURE_ID}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!captureResponse.ok) {
      throw new Error(
        `Capture verification failed: HTTP ${captureResponse.status}`
      );
    }

    const verifiedCapture = await captureResponse.json();

    const amount = verifiedCapture.amount;

    if (
      verifiedCapture.id !== EXPECTED_CAPTURE_ID ||
      verifiedCapture.status !== "COMPLETED" ||
      verifiedCapture.supplementary_data?.related_ids
        ?.order_id !== ORDER_ID ||
      capture.amount?.currency_code !==
        amount?.currency_code ||
      capture.amount?.value !== amount?.value
    ) {
      throw new Error(
        "Capture evidence does not match the PayPal order."
      );
    }

    if (
      !amount ||
      !/^\d+(\.\d{1,2})?$/.test(amount.value) ||
      !/^[A-Z]{3}$/.test(amount.currency_code)
    ) {
      throw new Error("Invalid PayPal payment amount.");
    }

    console.log("\nPayPal verification: PASSED");
    console.log("Order status:", order.status);
    console.log("Capture status:", verifiedCapture.status);
    console.log(
      "Amount:",
      amount.value,
      amount.currency_code
    );

    // 4. Open ResolveAI database
    db = new Database(
      path.join(__dirname, "resolveai.db")
    );

    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");

    // Add evidence fields without deleting existing data
    const columns = db
      .prepare("PRAGMA table_info(payments)")
      .all()
      .map((column) => column.name);

    const newColumns = {
      paypal_capture_id: "TEXT",
      amount_value: "TEXT",
      currency_code: "TEXT",
      evidence_source: "TEXT",
      verified_at: "TEXT",
    };

    for (const [name, type] of Object.entries(newColumns)) {
      if (!columns.includes(name)) {
        db.exec(
          `ALTER TABLE payments ADD COLUMN ${name} ${type}`
        );
        console.log("Database column added:", name);
      }
    }

    // 5. Save verified evidence safely
    const savePayment = db.transaction(() => {
      const existing = db
        .prepare(
          "SELECT * FROM payments WHERE paypal_order_id = ?"
        )
        .get(ORDER_ID);

      // Never silently overwrite merchant-side status
      // or previously recorded capture evidence.
      if (
        existing?.paypal_capture_id &&
        existing.paypal_capture_id !== EXPECTED_CAPTURE_ID
      ) {
        throw new Error(
          "Existing capture ID conflicts with verified evidence."
        );
      }

      if (
        existing?.amount_value &&
        existing.amount_value !== amount.value
      ) {
        throw new Error(
          "Existing amount conflicts with verified evidence."
        );
      }

      if (
        existing?.currency_code &&
        existing.currency_code !== amount.currency_code
      ) {
        throw new Error(
          "Existing currency conflicts with verified evidence."
        );
      }

      if (existing) {
        db.prepare(`
          UPDATE payments
          SET paypal_status = ?,
              paypal_capture_id = ?,
              amount_value = ?,
              currency_code = ?,
              evidence_source = ?,
              verified_at = ?
          WHERE paypal_order_id = ?
        `).run(
          order.status,
          EXPECTED_CAPTURE_ID,
          amount.value,
          amount.currency_code,
          "PAYPAL_SANDBOX_API",
          new Date().toISOString(),
          ORDER_ID
        );
      } else {
        db.prepare(`
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
          ORDER_ID,
          order.status,
          "UNKNOWN",
          EXPECTED_CAPTURE_ID,
          amount.value,
          amount.currency_code,
          "PAYPAL_SANDBOX_API",
          new Date().toISOString()
        );
      }

      return db.prepare(`
        SELECT
          id,
          paypal_order_id,
          paypal_status,
          merchant_status,
          paypal_capture_id,
          amount_value,
          currency_code,
          evidence_source,
          verified_at
        FROM payments
        WHERE paypal_order_id = ?
      `).get(ORDER_ID);
    });

    const saved = savePayment();

    console.log("\n=== Saved SQLite Record ===");
    console.log(JSON.stringify(saved, null, 2));

    console.log("\nRESULT: SUCCESS");
    console.log("No payment was created or captured.");
    console.log("No incident was automatically created.");
  } catch (error) {
    console.error("\nRESULT: FAILED");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (db) {
      db.close();
    }
  }
}

main();
