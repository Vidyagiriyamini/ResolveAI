let mode = "success";
let callCount = 0;
let lastPrompt = "";

const validReport = `
Summary:
The available evidence identifies a payment reconciliation mismatch.

Verified Evidence:
PayPal API verification confirms the order and capture are COMPLETED for USD 10.00.

Possible Explanation:
The simulated merchant record may not have been updated after payment completion. This is a hypothesis, not a confirmed cause.

Missing Evidence:
Independent merchant-side transaction logs and fulfillment records are not available.

Recommended Next Steps:
1. Review the verified payment evidence.
2. Confirm the merchant-side record independently.
3. Obtain human approval before any reconciliation action.
4. Do not charge the customer again.
`;

async function askOllama(prompt) {
  callCount++;
  lastPrompt = prompt;

  if (mode === "failure") {
    throw new Error("Simulated Ollama failure for testing");
  }

  return validReport;
}

function setMode(nextMode) {
  if (nextMode !== "success" && nextMode !== "failure") {
    throw new Error("Unsupported test mode");
  }

  mode = nextMode;
}

function resetCallCount() {
  callCount = 0;
  lastPrompt = "";
}

function getCallCount() {
  return callCount;
}

function getLastPrompt() {
  return lastPrompt;
}

module.exports = {
  askOllama,
  setMode,
  resetCallCount,
  getCallCount,
  getLastPrompt
};
