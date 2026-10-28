
const { askOllama } = require("./ollama-client");

async function test() {
  try {
    console.log("[ResolveAI] Testing local AI integration...");

    const incident = {
      scenario: "SIMULATED_TEST_ONLY",
      paypalOrderStatus: "COMPLETED",
      paypalCaptureStatus: "COMPLETED",
      merchantOrderStatus: "PENDING",
      amount: "10.00",
      currency: "USD",
    };

    const prompt = `
Analyze this fictional payment incident:

${JSON.stringify(incident, null, 2)}

Explain:
1. What is the discrepancy?
2. What is the possible business impact?
3. What evidence should be verified?
4. What is the safest recommended next action?

Do not invent facts or execute any payment actions.
`;

    const answer = await askOllama(prompt);

    console.log("\n[ResolveAI] AI Investigation Result:\n");
    console.log(answer);
    console.log("\n[ResolveAI] Ollama integration test completed.");
  } catch (error) {
    console.error(
      "[ResolveAI] Ollama integration test failed:",
      error.message
    );
    process.exitCode = 1;
  }
}

test();
