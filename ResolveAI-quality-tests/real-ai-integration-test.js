const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  createAiInvestigationService,
} = require("../ai-investigation-service");

const {
  askOllama,
} = require("../ollama-client");

async function main() {
  const db = new Database(":memory:");

  try {
    db.exec(`
      CREATE TABLE investigation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL,
        classification TEXT NOT NULL,
        severity TEXT NOT NULL,
        simulated INTEGER NOT NULL,
        evidence_json TEXT NOT NULL,
        explanation TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
        ai_explanation TEXT,
        ai_recommended_action TEXT,
        ai_model TEXT,
        ai_status TEXT,
        ai_analyzed_at TEXT
      );

      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        details_json TEXT NOT NULL
      );
    `);

    const evidence = {
      orderId: "REAL-AI-TEST-ORDER-001",
      captureId: "REAL-AI-TEST-CAPTURE-001",
      paypalStatus: "COMPLETED",
      captureStatus: "COMPLETED",
      amount: "10.00",
      currency: "USD",
      merchantStatus: "PENDING",
    };

    const investigationId = db.prepare(`
      INSERT INTO investigation_runs (
        payment_id,
        classification,
        severity,
        simulated,
        evidence_json,
        explanation,
        recommended_action
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      "SIMULATED_RECONCILIATION_MISMATCH",
      "HIGH",
      1,
      JSON.stringify(evidence),
      "A simulated reconciliation mismatch was identified.",
      "Review the evidence and reconcile only after human approval."
    ).lastInsertRowid;

    const service = createAiInvestigationService(db, {
      verifyPayPalEvidence: async (orderId, captureId) => {
        assert.equal(orderId, evidence.orderId);
        assert.equal(captureId, evidence.captureId);

        return {
          verifiedByPayPalApi: true,
          orderId,
          captureId,
          orderStatus: "COMPLETED",
          captureStatus: "COMPLETED",
          captureAmount: {
            value: "10.00",
            currency_code: "USD",
          },
          captureBelongsToOrder: true,
          orderCaptureMatches: true,
        };
      },
      askOllama: async (prompt) => {
        const response = await askOllama(prompt);
        return response;
      },
    });

    console.log("\n--- REAL RESOLVEAI AI INVESTIGATION ---");
    console.log("Model: llama3.2:latest");
    console.log("PayPal verification: Controlled test fixture");
    console.log("Database: Isolated in-memory SQLite");
    console.log("AI transport: Production Ollama client");

    const result = await service.analyzeInvestigation(
      Number(investigationId)
    );

    console.log("\n--- INVESTIGATION RESULT ---");
    console.log("Status:", result.status);
    console.log("AI generation:", result.aiGenerationStatus);
    console.log("PayPal verification:", result.paypalVerification.status);
    console.log("Model:", result.model);
    console.log("Validation:", result.aiValidation.reason);

    console.log("\n--- GENERATED REPORT ---");
    console.log(result.aiExplanation);

    assert.equal(
      result.paypalVerification.status,
      "VERIFIED",
      "PayPal evidence must be verified before AI generation"
    );

    assert.equal(
      result.status,
      "COMPLETED",
      "Real AI investigation must complete without fallback"
    );

    assert.equal(
      result.aiGenerationStatus,
      "GENERATED",
      "Expected a genuinely AI-generated report"
    );

    assert.equal(
      result.model,
      "llama3.2:latest",
      "Expected the configured model attribution"
    );

    assert.equal(
      result.aiValidation.passed,
      true,
      "AI report must pass ResolveAI validation"
    );

    const requiredSections = [
      "Summary:",
      "Verified Evidence:",
      "Possible Explanation:",
      "Missing Evidence:",
      "Recommended Next Steps:",
    ];

    for (const section of requiredSections) {
      assert.ok(
        result.aiExplanation.includes(section),
        `Missing required report section: ${section}`
      );
    }

    const stored = db.prepare(`
      SELECT
        ai_explanation,
        ai_recommended_action,
        ai_model,
        ai_status,
        ai_analyzed_at
      FROM investigation_runs
      WHERE id = ?
    `).get(investigationId);

    assert.ok(stored, "Investigation must exist in the database");
    assert.equal(stored.ai_status, "COMPLETED");
    assert.equal(stored.ai_model, "llama3.2:latest");
    assert.equal(stored.ai_explanation, result.aiExplanation);
    assert.equal(
      stored.ai_recommended_action,
      "Review the evidence and reconcile only after human approval."
    );
    assert.ok(stored.ai_analyzed_at);

    const audit = db.prepare(`
      SELECT event_type, entity_type, entity_id, details_json
      FROM audit_events
      WHERE entity_id = ?
    `).get(investigationId);

    assert.ok(audit, "AI investigation must create an audit event");
    assert.equal(audit.event_type, "AI_ANALYSIS_COMPLETED");
    assert.equal(audit.entity_type, "INVESTIGATION");
    assert.equal(audit.entity_id, investigationId);

    const auditDetails = JSON.parse(audit.details_json);

    assert.equal(auditDetails.analysisStatus, "COMPLETED");
    assert.equal(auditDetails.aiGenerationStatus, "GENERATED");
    assert.equal(auditDetails.verificationStatus, "VERIFIED");

    console.log("\n========================================");
    console.log("REAL AI INTEGRATION TEST RESULTS");
    console.log("========================================");
    console.log("PASS: Real Llama 3.2 generation");
    console.log("PASS: PayPal verification gate");
    console.log("PASS: Five-section report validation");
    console.log("PASS: Database persistence");
    console.log("PASS: Audit event persistence");
    console.log("\nAll real AI integration checks passed.");
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("\nREAL AI INTEGRATION TEST FAILED");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
