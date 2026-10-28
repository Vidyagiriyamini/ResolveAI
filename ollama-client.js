const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "llama3.2:latest";

async function askOllama(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("A non-empty prompt is required");
  }

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are ResolveAI, a payment incident investigation assistant. " +
            "Use only verified evidence provided in the request. " +
            "Do not invent payment statuses, transaction IDs, or facts. " +
            "If evidence is missing, explicitly say so. " +
            "Recommend safe next steps, but never claim to have executed " +
            "a refund, capture, or other payment-changing action.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      options: {
        temperature: 0.1,
      },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  const answer = data.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("Ollama returned an empty response");
  }

  return answer;
}

module.exports = { askOllama };