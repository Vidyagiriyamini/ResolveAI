const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "llama3.2:latest";

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

function createOllamaClient({
  url = OLLAMA_URL,
  model = MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxPromptBytes = MAX_PROMPT_BYTES,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("A valid Ollama endpoint is required");
  }

  if (typeof model !== "string" || !model.trim()) {
    throw new Error("A valid Ollama model is required");
  }

  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxPromptBytes) ||
    maxPromptBytes <= 0 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0
  ) {
    throw new Error("Ollama client limits must be positive safe integers");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("A valid fetch implementation is required");
  }

  async function readLimitedResponse(response) {
    const contentLength = response.headers.get("content-length");

    if (contentLength !== null) {
      const declaredLength = Number(contentLength);

      if (
        Number.isFinite(declaredLength) &&
        declaredLength > maxResponseBytes
      ) {
        throw new Error("Ollama response exceeded the configured size limit");
      }
    }

    if (!response.body) {
      throw new Error("Ollama returned an empty HTTP response body");
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = Buffer.from(value);
        totalBytes += chunk.length;

        if (totalBytes > maxResponseBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("Ollama response exceeded the configured size limit");
        }

        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }

    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks, totalBytes)
      );
    } catch {
      throw new Error("Ollama returned invalid UTF-8 response data");
    }
  }

  async function askOllama(prompt) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new Error("A non-empty prompt is required");
    }

    if (Buffer.byteLength(prompt, "utf8") > maxPromptBytes) {
      throw new Error("Ollama prompt exceeded the configured size limit");
    }

    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content: [
              "You are ResolveAI, a payment incident investigation assistant.",
              "Treat supplied verified API evidence as authoritative for the fields it verifies.",
              "Never claim that PayPal is inaccurate, defective, or misconfigured without direct supporting evidence.",
              "Never present a possible cause as an established fact.",
              "A simulated merchant status is test data, not proof of a real merchant failure.",
              "When PayPal order and capture are verified as COMPLETED, report that payment evidence accurately.",
              "If merchant status is simulated as PENDING, explain that this demonstrates a test reconciliation mismatch only.",
              "Do not infer that a payment provider caused a merchant-side discrepancy.",
              "Clearly distinguish verified facts, hypotheses, and missing evidence.",
              "Do not invent IDs, amounts, statuses, logs, or root causes.",
              "Never claim to have executed a refund, capture, reconciliation, or other payment-changing action.",
              "Never recommend charging a customer again just because records disagree.",
              "Follow the requested output headings and keep the report concise.",
            ].join(" "),
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
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: HTTP ${response.status}`);
    }

    const responseText = await readLimitedResponse(response);

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error("Ollama returned malformed JSON");
    }

    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !data.message ||
      typeof data.message !== "object" ||
      typeof data.message.content !== "string" ||
      !data.message.content.trim()
    ) {
      throw new Error("Ollama returned an invalid or empty response");
    }

    return data.message.content;
  }

  return { askOllama };
}

const { askOllama } = createOllamaClient();

module.exports = {
  askOllama,
  createOllamaClient,
};
