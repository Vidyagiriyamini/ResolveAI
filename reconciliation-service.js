
const ACTION = "MARK_SIMULATED_MERCHANT_COMPLETED";

function normalizeMoney(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return null;
  }

  const [whole, fraction = ""] = text.split(".");
  const cents = `${fraction}00`.slice(0, 2);

  return `${whole.replace(/^0+(?=\d)/, "")}.${cents}`;
}

function createReconciliationService(db, options = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("A valid database connection is required");
  }

  const verifyPayPalEvidence = options.verifyPayPalEvidence;

  if (
    verifyPayPalEvidence !== undefined &&
    typeof verifyPayPalEvidence !== "function"
  ) {
    throw new Error("PayPal evidence verifier must be a function");
  }

  function requirePositiveId(value) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("A valid positive ID is required");
    }
  }

  function getProposal(proposalId) {
    requirePositiveId(proposalId);

    return (
      db.prepare(`
        SELECT
          id,
          investigation_run_id AS investigationRunId,
          payment_id AS paymentId,
          simulated,
          proposed_action AS proposedAction,
          status,
          approved_by AS approvedBy,
          approved_at AS approvedAt,
          executed_at AS executedAt,
          created_at AS createdAt
        FROM reconciliation_proposals
        WHERE id = ?
      `).get(proposalId) || null
    );
  }

  function audit(eventType, proposalId, details) {
    db.prepare(`
      INSERT INTO audit_events (
        event_type,
        entity_type,
        entity_id,
        details_json
      )
      VALUES (?, 'RECONCILIATION_PROPOSAL', ?, ?)
    `).run(eventType, proposalId, JSON.stringify(details));
  }

  function getEligibleInvestigation(investigationRunId) {
    const record = db.prepare(`
      SELECT
        i.id AS investigation_id,
        i.payment_id,
        i.classification,
        i.simulated AS investigation_simulated,
        i.evidence_json,
        p.paypal_order_id,
        p.paypal_capture_id,
        p.paypal_status,
        p.merchant_status,
        p.amount_value,
        p.currency_code
      FROM investigation_runs i
      JOIN payments p ON p.id = i.payment_id
      WHERE i.id = ?
    `).get(investigationRunId);

    if (!record) {
      throw new Error("Investigation not found");
    }

    if (
      record.investigation_simulated !== 1 ||
      record.classification !==
        "SIMULATED_RECONCILIATION_MISMATCH"
    ) {
      throw new Error(
        "Only simulated reconciliation investigations are supported"
      );
    }

    const incident = db.prepare(`
      SELECT id
      FROM incidents
      WHERE payment_id = ?
        AND incident_type = 'SIMULATED_RECONCILIATION_MISMATCH'
        AND simulated = 1
      ORDER BY id DESC
      LIMIT 1
    `).get(record.payment_id);

    if (!incident) {
      throw new Error(
        "Matching simulated incident was not found"
      );
    }

    let evidence;

    try {
      evidence = JSON.parse(record.evidence_json);
    } catch {
      throw new Error("Invalid investigation evidence");
    }

    if (
      !evidence ||
      evidence.orderId !== record.paypal_order_id ||
      evidence.captureId !== record.paypal_capture_id ||
      evidence.paypalStatus !== record.paypal_status ||
      evidence.captureStatus !== "COMPLETED" ||
      normalizeMoney(evidence.amount) !==
        normalizeMoney(record.amount_value) ||
      evidence.currency !== record.currency_code ||
      evidence.merchantStatus !== "PENDING" ||
      record.paypal_status !== "COMPLETED"
    ) {
      throw new Error(
        "Recorded evidence is not eligible for reconciliation"
      );
    }

    return record;
  }

  const proposeTransaction = db.transaction(
    (investigationRunId) => {
      const record = getEligibleInvestigation(
        investigationRunId
      );

      const existing = db.prepare(`
        SELECT id
        FROM reconciliation_proposals
        WHERE investigation_run_id = ?
      `).get(investigationRunId);

      if (existing) {
        return {
          alreadyExists: true,
          proposal: getProposal(existing.id),
        };
      }

      // This is an isolated simulated merchant record.
      // Never update payments.merchant_status here.
      db.prepare(`
        INSERT OR IGNORE INTO simulated_merchant_orders (
          payment_id,
          merchant_status
        )
        VALUES (?, 'PENDING')
      `).run(record.payment_id);

      const simulatedOrder = db.prepare(`
        SELECT merchant_status
        FROM simulated_merchant_orders
        WHERE payment_id = ?
      `).get(record.payment_id);

      if (simulatedOrder?.merchant_status !== "PENDING") {
        throw new Error(
          "Simulated merchant order is not pending"
        );
      }

      const result = db.prepare(`
        INSERT INTO reconciliation_proposals (
          investigation_run_id,
          payment_id,
          simulated,
          proposed_action,
          status
        )
        VALUES (?, ?, 1, ?, 'PENDING_APPROVAL')
      `).run(
        investigationRunId,
        record.payment_id,
        ACTION
      );

      audit(
        "RECONCILIATION_PROPOSED",
        result.lastInsertRowid,
        {
          investigationRunId,
          paymentId: record.payment_id,
          simulated: true,
          proposedAction: ACTION,
          paypalStatus: record.paypal_status,
          simulatedMerchantStatus: "PENDING",
          actualMerchantStatusUnchanged:
            record.merchant_status,
        }
      );

      return {
        alreadyExists: false,
        proposal: getProposal(
          Number(result.lastInsertRowid)
        ),
      };
    }
  );

  function propose(investigationRunId) {
    requirePositiveId(investigationRunId);
    return proposeTransaction(investigationRunId);
  }

  const approveTransaction = db.transaction(
    (proposalId, approvedBy) => {
      const proposal = getProposal(proposalId);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== "PENDING_APPROVAL") {
        throw new Error(
          "Only pending proposals can be approved"
        );
      }

      if (
        typeof approvedBy !== "string" ||
        !/^[A-Za-z0-9 _.-]{2,80}$/.test(
          approvedBy.trim()
        )
      ) {
        throw new Error(
          "A valid operator identifier is required"
        );
      }

      db.prepare(`
        UPDATE reconciliation_proposals
        SET
          status = 'APPROVED',
          approved_by = ?,
          approved_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'PENDING_APPROVAL'
      `).run(approvedBy.trim(), proposalId);

      audit("RECONCILIATION_APPROVED", proposalId, {
        approvedBy: approvedBy.trim(),
        simulated: true,
        proposedAction: ACTION,
      });

      return getProposal(proposalId);
    }
  );

  function approve(proposalId, approvedBy) {
    requirePositiveId(proposalId);
    return approveTransaction(proposalId, approvedBy);
  }

  async function verifyFreshPayPalEvidence(proposal) {
    if (typeof verifyPayPalEvidence !== "function") {
      throw new Error(
        "Fresh PayPal verification is not configured"
      );
    }

    // Re-read the payment and investigation before contacting PayPal.
    const investigation = getEligibleInvestigation(
      proposal.investigationRunId
    );

    if (
      investigation.payment_id !== proposal.paymentId ||
      proposal.simulated !== 1 ||
      proposal.proposedAction !== ACTION
    ) {
      throw new Error(
        "Proposal no longer matches the investigation"
      );
    }

    let fresh;

    try {
      fresh = await verifyPayPalEvidence(
        investigation.paypal_order_id,
        investigation.paypal_capture_id
      );
    } catch {
      throw new Error(
        "Fresh PayPal verification is unavailable"
      );
    }

    const valid =
      fresh &&
      fresh.verifiedByPayPalApi === true &&
      fresh.orderId === investigation.paypal_order_id &&
      fresh.captureId === investigation.paypal_capture_id &&
      fresh.orderStatus === "COMPLETED" &&
      fresh.captureStatus === "COMPLETED" &&
      fresh.captureBelongsToOrder === true &&
      fresh.orderCaptureMatches === true &&
      fresh.captureAmount &&
      normalizeMoney(fresh.captureAmount.value) ===
        normalizeMoney(investigation.amount_value) &&
      fresh.captureAmount.currency_code ===
        investigation.currency_code;

    if (!valid) {
      throw new Error(
        "Fresh PayPal evidence does not match the approved payment"
      );
    }

    // Preserve the exact investigation evidence that was verified.
    return {
      paymentId: investigation.payment_id,
      paypalOrderId: investigation.paypal_order_id,
      paypalCaptureId: investigation.paypal_capture_id,
      paypalStatus: investigation.paypal_status,
      amountValue: investigation.amount_value,
      currencyCode: investigation.currency_code,
      evidenceJson: investigation.evidence_json,
    };
  }

  const executeTransaction = db.transaction(
    (proposalId, verifiedSnapshot) => {
      const proposal = getProposal(proposalId);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status === "EXECUTED") {
        return {
          alreadyExecuted: true,
          proposal,
        };
      }

      if (proposal.status !== "APPROVED") {
        throw new Error(
          "Proposal must be approved before execution"
        );
      }

      // Recheck the investigation and payment evidence.
      const investigation = getEligibleInvestigation(
        proposal.investigationRunId
      );

      if (
        investigation.payment_id !== proposal.paymentId ||
        proposal.simulated !== 1 ||
        proposal.proposedAction !== ACTION
      ) {
        throw new Error(
          "Proposal no longer matches the investigation"
        );
      }

      // The database evidence must still match the exact snapshot
      // that passed fresh PayPal verification.
      if (
        !verifiedSnapshot ||
        investigation.payment_id !== verifiedSnapshot.paymentId ||
        investigation.paypal_order_id !== verifiedSnapshot.paypalOrderId ||
        investigation.paypal_capture_id !== verifiedSnapshot.paypalCaptureId ||
        investigation.paypal_status !== verifiedSnapshot.paypalStatus ||
        investigation.amount_value !== verifiedSnapshot.amountValue ||
        investigation.currency_code !== verifiedSnapshot.currencyCode ||
        investigation.evidence_json !== verifiedSnapshot.evidenceJson
      ) {
        throw new Error(
          "Investigation evidence changed after fresh PayPal verification"
        );
      }

      const result = db.prepare(`
        UPDATE simulated_merchant_orders
        SET
          merchant_status = 'COMPLETED',
          updated_at = CURRENT_TIMESTAMP
        WHERE payment_id = ?
          AND merchant_status = 'PENDING'
      `).run(proposal.paymentId);

      if (result.changes !== 1) {
        throw new Error(
          "Simulated merchant state could not be reconciled"
        );
      }

      const update = db.prepare(`
        UPDATE reconciliation_proposals
        SET
          status = 'EXECUTED',
          executed_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'APPROVED'
      `).run(proposalId);

      if (update.changes !== 1) {
        throw new Error(
          "Proposal execution state could not be saved"
        );
      }

      audit("RECONCILIATION_EXECUTED", proposalId, {
        paymentId: proposal.paymentId,
        investigationRunId: proposal.investigationRunId,
        simulated: true,
        previousSimulatedMerchantStatus: "PENDING",
        newSimulatedMerchantStatus: "COMPLETED",
        paypalPaymentChanged: false,
        actualMerchantRecordChanged: false,
      });

      return {
        alreadyExecuted: false,
        proposal: getProposal(proposalId),
      };
    }
  );

  async function execute(proposalId) {
    requirePositiveId(proposalId);

    const currentProposal = getProposal(proposalId);

    if (!currentProposal) {
      throw new Error("Proposal not found");
    }

    // Preserve idempotency without making another PayPal request.
    if (currentProposal.status === "EXECUTED") {
      return {
        alreadyExecuted: true,
        proposal: currentProposal,
      };
    }

    if (currentProposal.status !== "APPROVED") {
      throw new Error(
        "Proposal must be approved before execution"
      );
    }

    // Network verification happens outside the SQLite transaction.
    const verifiedSnapshot =
      await verifyFreshPayPalEvidence(currentProposal);

    // The transaction compares current evidence with the verified snapshot.
    return executeTransaction(proposalId, verifiedSnapshot);
  }

  return {
    getProposal,
    propose,
    approve,
    execute,
  };
}

module.exports = {
  createReconciliationService,
};
