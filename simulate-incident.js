const Database = require("better-sqlite3");

const db = new Database("resolveai.db");

try {
  // Clearly synthetic data: no PayPal API call or payment is made.
  const simulatedOrderId = "SIMULATED-RESOLVEAI-001";

  const payment = db.prepare(`
    INSERT INTO payments (
      paypal_order_id,
      paypal_status,
      merchant_status
    )
    VALUES (?, ?, ?)
    ON CONFLICT(paypal_order_id) DO UPDATE SET
      paypal_status = excluded.paypal_status,
      merchant_status = excluded.merchant_status
  `).run(
    simulatedOrderId,
    "COMPLETED",
    "PENDING"
  );

  const savedPayment = db.prepare(`
    SELECT id, paypal_order_id, paypal_status, merchant_status
    FROM payments
    WHERE paypal_order_id = ?
  `).get(simulatedOrderId);

  if (
    savedPayment.paypal_status === "COMPLETED" &&
    savedPayment.merchant_status === "PENDING"
  ) {
    db.prepare(`
      INSERT INTO incidents (payment_id, incident_type, status)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM incidents
        WHERE payment_id = ?
          AND incident_type = ?
          AND status = 'OPEN'
      )
    `).run(
      savedPayment.id,
      "PAYMENT_COMPLETED_ORDER_PENDING",
      "OPEN",
      savedPayment.id,
      "PAYMENT_COMPLETED_ORDER_PENDING"
    );
  }

  const incident = db.prepare(`
    SELECT id, payment_id, incident_type, status, created_at
    FROM incidents
    WHERE payment_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(savedPayment.id);

  console.log("\n--- ResolveAI Incident Simulation ---");
  console.log("Synthetic order:", savedPayment.paypal_order_id);
  console.log("PayPal status:", savedPayment.paypal_status);
  console.log("Merchant status:", savedPayment.merchant_status);
  console.log("Incident:", incident?.incident_type ?? "None detected");
  console.log("Incident status:", incident?.status ?? "N/A");
  console.log("Incident ID:", incident?.id ?? "N/A");
  console.log("\nNo PayPal API call or payment was made.");
} finally {
  db.close();
}
