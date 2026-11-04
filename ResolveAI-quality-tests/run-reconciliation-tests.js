
const Database = require("better-sqlite3");
const {
    createReconciliationService
} = require("../reconciliation-service");

const db = new Database(":memory:");

db.exec(`
CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    paypal_order_id TEXT NOT NULL,
    paypal_capture_id TEXT NOT NULL,
    paypal_status TEXT NOT NULL,
    merchant_status TEXT NOT NULL,
    amount_value TEXT NOT NULL,
    currency_code TEXT NOT NULL
);

CREATE TABLE investigation_runs (
    id INTEGER PRIMARY KEY,
    payment_id INTEGER NOT NULL,
    classification TEXT NOT NULL,
    simulated INTEGER NOT NULL,
    evidence_json TEXT NOT NULL
);

CREATE TABLE incidents (
    id INTEGER PRIMARY KEY,
    payment_id INTEGER NOT NULL,
    incident_type TEXT NOT NULL,
    simulated INTEGER NOT NULL
);

CREATE TABLE simulated_merchant_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL UNIQUE,
    merchant_status TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE reconciliation_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_run_id INTEGER NOT NULL UNIQUE,
    payment_id INTEGER NOT NULL,
    simulated INTEGER NOT NULL,
    proposed_action TEXT NOT NULL,
    status TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    executed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    orderId: "TEST-ORDER-001",
    captureId: "TEST-CAPTURE-001",
    paypalStatus: "COMPLETED",
    captureStatus: "COMPLETED",
    amount: "10.00",
    currency: "USD",
    merchantStatus: "PENDING"
};


function seedScenario(overrides = {}) {
    const payment = {
        paypal_order_id: "TEST-ORDER-001",
        paypal_capture_id: "TEST-CAPTURE-001",
        paypal_status: "COMPLETED",
        merchant_status: "PENDING",
        amount_value: "10.00",
        currency_code: "USD",
        ...overrides.payment
    };

    const investigationEvidence = {
        ...evidence,
        ...overrides.evidence
    };

    db.prepare(`
        INSERT INTO payments (
            id, paypal_order_id, paypal_capture_id,
            paypal_status, merchant_status,
            amount_value, currency_code
        )
        VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(
        payment.paypal_order_id,
        payment.paypal_capture_id,
        payment.paypal_status,
        payment.merchant_status,
        payment.amount_value,
        payment.currency_code
    );

    db.prepare(`
        INSERT INTO investigation_runs (
            id, payment_id, classification, simulated, evidence_json
        )
        VALUES (1, 1, ?, ?, ?)
    `).run(
        overrides.classification ||
            "SIMULATED_RECONCILIATION_MISMATCH",
        overrides.simulated === undefined
            ? 1
            : overrides.simulated,
        JSON.stringify(investigationEvidence)
    );

    db.prepare(`
        INSERT INTO incidents (
            id, payment_id, incident_type, simulated
        )
        VALUES (1, 1, 'SIMULATED_RECONCILIATION_MISMATCH', 1)
    `).run();

    const freshPayPalResponse = {
        verifiedByPayPalApi: true,
        orderId: payment.paypal_order_id,
        orderStatus: "COMPLETED",
        captureId: payment.paypal_capture_id,
        captureStatus: "COMPLETED",
        captureAmount: {
            currency_code: payment.currency_code,
            value: payment.amount_value
        },
        captureBelongsToOrder: true,
        orderCaptureMatches: true
    };

    const verifier = overrides.verifier ||
        (async () => freshPayPalResponse);

    return createReconciliationService(db, {
        verifyPayPalEvidence: verifier
    });
}


function resetDatabase() {
    db.exec(`
        DELETE FROM audit_events;
        DELETE FROM reconciliation_proposals;
        DELETE FROM simulated_merchant_orders;
        DELETE FROM incidents;
        DELETE FROM investigation_runs;
        DELETE FROM payments;
    `);
}

async function runTest(name, callback) {
    try {
        resetDatabase();
        await callback();
        console.log("PASS:", name);
    } catch (error) {
        console.error("FAIL:", name);
        console.error(error.message);
        process.exitCode = 1;
    }
}

async function main() {
    await runTest("Completed payment allows simulated proposal", async () => {
        const service = seedScenario();
        const result = service.propose(1);

        if (!result.proposal || result.proposal.status !== "PENDING_APPROVAL") {
            throw new Error("Expected a pending approval proposal");
        }

        if (result.proposal.simulated !== 1) {
            throw new Error("Proposal must be marked simulated");
        }
    });

    await runTest("Non-simulated investigation is rejected", async () => {
        const service = seedScenario({ simulated: 0 });

        let rejected = false;
        try {
            service.propose(1);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Non-simulated investigation was accepted");
        }
    });

    await runTest("Mismatched payment evidence is rejected", async () => {
        const service = seedScenario({
            evidence: { amount: "20.00" }
        });

        let rejected = false;
        try {
            service.propose(1);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Mismatched evidence was accepted");
        }
    });

    await runTest("Execution without approval is rejected", async () => {
        const service = seedScenario();
        const proposal = service.propose(1).proposal;

        let rejected = false;
        try {
            await service.execute(proposal.id);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Unapproved proposal was executed");
        }
    });

    await runTest("Approved proposal executes only simulated merchant update", async () => {
        const service = seedScenario();
        const proposal = service.propose(1).proposal;

        service.approve(proposal.id, "Test Operator");
        const result = await service.execute(proposal.id);

        if (result.proposal.status !== "EXECUTED") {
            throw new Error("Expected EXECUTED proposal status");
        }

        const simulated = db.prepare(`
            SELECT merchant_status
            FROM simulated_merchant_orders
            WHERE payment_id = 1
        `).get();

        const actualPayment = db.prepare(`
            SELECT merchant_status, paypal_status
            FROM payments
            WHERE id = 1
        `).get();

        if (simulated.merchant_status !== "COMPLETED") {
            throw new Error("Simulated merchant status was not completed");
        }

        if (
            actualPayment.merchant_status !== "PENDING" ||
            actualPayment.paypal_status !== "COMPLETED"
        ) {
            throw new Error("Actual payment record was changed");
        }
    });

    await runTest("Repeated execution is idempotent", async () => {
        const service = seedScenario();
        const proposal = service.propose(1).proposal;

        service.approve(proposal.id, "Test Operator");

        await service.execute(proposal.id);
        const second = await service.execute(proposal.id);

        if (second.alreadyExecuted !== true) {
            throw new Error("Expected alreadyExecuted on repeated execution");
        }

        const count = db.prepare(`
            SELECT COUNT(*) AS count
            FROM reconciliation_proposals
        `).get().count;

        if (count !== 1) {
            throw new Error("Duplicate proposal was created");
        }
    });

    await runTest("Pending PayPal capture blocks reconciliation", async () => {
        const service = seedScenario({
            evidence: { captureStatus: "PENDING" }
        });

        let rejected = false;

        try {
            service.propose(1);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error(
                "Reconciliation accepted a payment with a pending capture"
            );
        }
    });

    await runTest("Missing capture status blocks reconciliation", async () => {
        const service = seedScenario({
            evidence: { captureStatus: undefined }
        });

        let rejected = false;

        try {
            service.propose(1);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Missing capture status was accepted");
        }
    });

    await runTest("Incorrect capture ID blocks reconciliation", async () => {
        const service = seedScenario({
            evidence: { captureId: "WRONG-CAPTURE-ID" }
        });

        let rejected = false;

        try {
            service.propose(1);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Incorrect capture ID was accepted");
        }
    });

    await runTest("Incomplete PayPal order blocks reconciliation", async () => {
        const service = seedScenario({
            payment: { paypal_status: "PENDING" },
            evidence: { paypalStatus: "PENDING" }
        });

        let rejected = false;

        try {
            service.propose(1);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Incomplete PayPal order was accepted");
        }
    });

    await runTest("Changed evidence after approval blocks execution", async () => {
        const service = seedScenario();
        const proposal = service.propose(1).proposal;

        service.approve(proposal.id, "Test Operator");

        db.prepare(`
            UPDATE investigation_runs
            SET evidence_json = ?
            WHERE id = 1
        `).run(JSON.stringify({
            ...evidence,
            captureStatus: "PENDING"
        }));

        let rejected = false;

        try {
            await service.execute(proposal.id);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Execution accepted changed payment evidence");
        }

        const savedProposal = service.getProposal(proposal.id);

        if (savedProposal.status !== "APPROVED") {
            throw new Error("Rejected execution changed proposal status");
        }
    });

    await runTest("Evidence changed during fresh PayPal verification blocks execution", async () => {
        let service;

        service = seedScenario({
            verifier: async () => {
                // Simulate another process changing the payment
                // while fresh PayPal verification is in progress.
                db.prepare(`
                    UPDATE payments
                    SET amount_value = '25.00'
                    WHERE id = 1
                `).run();

                db.prepare(`
                    UPDATE investigation_runs
                    SET evidence_json = ?
                    WHERE id = 1
                `).run(JSON.stringify({
                    ...evidence,
                    amount: "25.00"
                }));

                // PayPal verification still returns evidence
                // for the original $10.00 payment.
                return {
                    verifiedByPayPalApi: true,
                    orderId: "TEST-ORDER-001",
                    orderStatus: "COMPLETED",
                    captureId: "TEST-CAPTURE-001",
                    captureStatus: "COMPLETED",
                    captureAmount: {
                        currency_code: "USD",
                        value: "10.00"
                    },
                    captureBelongsToOrder: true,
                    orderCaptureMatches: true
                };
            }
        });

        const proposal = service.propose(1).proposal;
        service.approve(proposal.id, "Test Operator");

        let rejected = false;

        try {
            await service.execute(proposal.id);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error(
                "Execution accepted payment evidence changed during verification"
            );
        }

        const savedProposal = service.getProposal(proposal.id);

        if (savedProposal.status !== "APPROVED") {
            throw new Error(
                "Rejected execution changed proposal status"
            );
        }

        const merchantOrder = db.prepare(`
            SELECT merchant_status
            FROM simulated_merchant_orders
            WHERE payment_id = 1
        `).get();

        if (merchantOrder.merchant_status !== "PENDING") {
            throw new Error(
                "Rejected execution changed simulated merchant status"
            );
        }
    });


    await runTest("Fresh PayPal verification is required before execution", async () => {
        let verifierCalls = 0;

        const service = seedScenario({
            verifier: async (orderId, captureId) => {
                verifierCalls++;

                if (
                    orderId !== "TEST-ORDER-001" ||
                    captureId !== "TEST-CAPTURE-001"
                ) {
                    throw new Error("Unexpected PayPal identifiers");
                }

                return {
                    verifiedByPayPalApi: true,
                    orderId: "TEST-ORDER-001",
                    orderStatus: "COMPLETED",
                    captureId: "TEST-CAPTURE-001",
                    captureStatus: "COMPLETED",
                    captureAmount: {
                        currency_code: "USD",
                        value: "10.00"
                    },
                    captureBelongsToOrder: true,
                    orderCaptureMatches: true
                };
            }
        });

        const proposal = service.propose(1).proposal;
        service.approve(proposal.id, "Test Operator");

        const result = await service.execute(proposal.id);

        if (verifierCalls !== 1) {
            throw new Error("Fresh PayPal verifier was not called exactly once");
        }

        if (result.proposal.status !== "EXECUTED") {
            throw new Error("Valid fresh PayPal evidence did not allow execution");
        }
    });

    await runTest("Fresh PayPal order mismatch blocks execution", async () => {
        const service = seedScenario({
            verifier: async () => ({
                verifiedByPayPalApi: true,
                orderId: "WRONG-ORDER-ID",
                orderStatus: "COMPLETED",
                captureId: "TEST-CAPTURE-001",
                captureStatus: "COMPLETED",
                captureAmount: {
                    currency_code: "USD",
                    value: "10.00"
                },
                captureBelongsToOrder: true,
                orderCaptureMatches: true
            })
        });

        const proposal = service.propose(1).proposal;
        service.approve(proposal.id, "Test Operator");

        let rejected = false;

        try {
            await service.execute(proposal.id);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Execution accepted a mismatched PayPal order");
        }

        const savedProposal = service.getProposal(proposal.id);

        if (savedProposal.status !== "APPROVED") {
            throw new Error("Mismatch changed the proposal status");
        }

        const simulated = db.prepare(`
            SELECT merchant_status
            FROM simulated_merchant_orders
            WHERE payment_id = 1
        `).get();

        if (!simulated || simulated.merchant_status !== "PENDING") {
            throw new Error(
                "Failed PayPal verification changed the simulated merchant status"
            );
        }
    });

    await runTest("Incomplete fresh PayPal capture blocks execution", async () => {
        const service = seedScenario({
            verifier: async () => ({
                verifiedByPayPalApi: true,
                orderId: "TEST-ORDER-001",
                orderStatus: "COMPLETED",
                captureId: "TEST-CAPTURE-001",
                captureStatus: "PENDING",
                captureAmount: {
                    currency_code: "USD",
                    value: "10.00"
                },
                captureBelongsToOrder: true,
                orderCaptureMatches: true
            })
        });

        const proposal = service.propose(1).proposal;
        service.approve(proposal.id, "Test Operator");

        let rejected = false;

        try {
            await service.execute(proposal.id);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Execution accepted an incomplete PayPal capture");
        }

        const savedProposal = service.getProposal(proposal.id);

        if (savedProposal.status !== "APPROVED") {
            throw new Error("Incomplete capture changed the proposal status");
        }
    });

    await runTest("Unavailable PayPal verification blocks execution", async () => {
        const service = seedScenario({
            verifier: async () => {
                throw new Error("Simulated PayPal API outage");
            }
        });

        const proposal = service.propose(1).proposal;
        service.approve(proposal.id, "Test Operator");

        let rejected = false;

        try {
            await service.execute(proposal.id);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Execution continued when PayPal verification was unavailable");
        }

        const savedProposal = service.getProposal(proposal.id);

        if (savedProposal.status !== "APPROVED") {
            throw new Error("PayPal outage changed the proposal status");
        }
    });

    await runTest("Fresh PayPal amount and currency mismatch blocks execution", async () => {
        const service = seedScenario({
            verifier: async () => ({
                verifiedByPayPalApi: true,
                orderId: "TEST-ORDER-001",
                orderStatus: "COMPLETED",
                captureId: "TEST-CAPTURE-001",
                captureStatus: "COMPLETED",
                captureAmount: {
                    currency_code: "EUR",
                    value: "20.00"
                },
                captureBelongsToOrder: true,
                orderCaptureMatches: true
            })
        });

        const proposal = service.propose(1).proposal;
        service.approve(proposal.id, "Test Operator");

        let rejected = false;

        try {
            await service.execute(proposal.id);
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Execution accepted mismatched PayPal amount or currency");
        }

        const savedProposal = service.getProposal(proposal.id);

        if (savedProposal.status !== "APPROVED") {
            throw new Error("Amount or currency mismatch changed the proposal status");
        }
    });

    await runTest("Invalid operator identifier blocks approval", async () => {
        const service = seedScenario();
        const proposal = service.propose(1).proposal;

        let rejected = false;

        try {
            service.approve(proposal.id, "<script>");
        } catch {
            rejected = true;
        }

        if (!rejected) {
            throw new Error("Invalid operator identifier was accepted");
        }

        const savedProposal = service.getProposal(proposal.id);

        if (savedProposal.status !== "PENDING_APPROVAL") {
            throw new Error("Invalid approval changed proposal status");
        }
    });


}

main().finally(() => db.close());
