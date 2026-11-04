
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  createAiInvestigationService,
} = require("./ai-investigation-service");

const db = new Database(path.join(__dirname, "resolveai.db"));

async function main() {
  try {
    const investigation = db.prepare(`
      SELECT id, classification, severity, simulated, evidence_json
      FROM investigation_runs
      ORDER BY id DESC
      LIMIT 1
    `).get();

    if (!investigation) {
      throw new Error(
        "No investigation runs found. An existing investigation is required."
      );
    }

    const evidence = JSON.parse(investigation.evidence_json);

    console.log("\n=== Existing investigation selected ===");
    console.log(JSON.stringify({
      id: investigation.id,
      classification: investigation.classification,
      severity: investigation.severity,
      simulated: investigation.simulated,
    }, null, 2));

    if (
      typeof evidence.orderId !== "string" ||
      typeof evidence.captureId !== "string"
    ) {
      throw new Error(
        "The selected investigation is missing its recorded PayPal order or capture ID."
      );
    }

    // Controlled mock: no PayPal API request is made by this test.
    // This represents matching, completed Sandbox evidence.
    const mockVerifyPayPalEvidence = async (orderId, captureId) => ({
      verifiedByPayPalApi: true,
      orderId,
      orderStatus: evidence.paypalStatus,
      captureId,
      captureStatus:
        typeof evidence.captureStatus === "string"
          ? evidence.captureStatus
          : "COMPLETED",
      captureAmount: {
        value: evidence.amount,
        currency_code: evidence.currency,
      },
      captureBelongsToOrder: true,
      orderCaptureMatches: true,
    });

    console.log("\n=== Running AI investigation with mocked PayPal evidence ===");
    console.log("No real PayPal API request or payment-changing action will be made.");

    const service = createAiInvestigationService(db, {
      verifyPayPalEvidence: mockVerifyPayPalEvidence,
    });

    const result = await service.analyzeInvestigation(investigation.id);

    console.log("\n=== AI investigation result ===");
    console.log(JSON.stringify(result, null, 2));

    const saved = db.prepare(`
      SELECT
        ai_status,
        ai_model,
        ai_analyzed_at,
        ai_explanation,
        ai_recommended_action
      FROM investigation_runs
      WHERE id = ?
    `).get(investigation.id);

    const audit = db.prepare(`
      SELECT event_type, entity_type, entity_id, created_at, details_json
      FROM audit_events
      WHERE event_type = 'AI_ANALYSIS_COMPLETED'
        AND entity_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(investigation.id);

    console.log("\n=== Saved AI fields ===");
    console.log(JSON.stringify(saved, null, 2));

    console.log("\n=== Latest AI audit event ===");
    console.log(JSON.stringify(audit ?? null, null, 2));

    if (
      saved?.ai_status !== "COMPLETED" ||
      !saved?.ai_explanation ||
      !audit
    ) {
      throw new Error(
        "AI result or audit event verification failed."
      );
    }

    if (
      result.paypalVerification?.status !== "VERIFIED" &&
      result.paypalVerification?.status !== "MISMATCH"
    ) {
      throw new Error(
        "Unexpected PayPal verification outcome from the mock."
      );
    }

    console.log("\nPASS: AI analysis was saved and audited.");
    console.log("PayPal verification outcome:", result.paypalVerification.status);
    console.log("No real PayPal API request, capture, or refund was made.");
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("\nAI investigation test failed:", error.message);
  process.exitCode = 1;
});
