const assert = require("node:assert/strict");
const http = require("node:http");

const {
  createOllamaClient,
} = require("../ollama-client");

let passed = 0;
let failed = 0;

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);

    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/api/chat`,
      });
    });
  });
}

async function closeServer(server) {
  server.closeAllConnections();

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json",
  });

  response.end(JSON.stringify(data));
}

async function runTest(name, callback) {
  try {
    await callback();
    passed++;
    console.log("PASS:", name);
  } catch (error) {
    failed++;
    console.error("FAIL:", name);
    console.error(error.message);
  }
}

async function main() {
  await runTest("Rejects an empty prompt", async () => {
    const client = createOllamaClient();

    await assert.rejects(
      client.askOllama("   "),
      /non-empty prompt/
    );
  });

  await runTest("Rejects a prompt exceeding the configured byte limit", async () => {
    let requestCount = 0;

    const { server, url } = await startServer((request, response) => {
      requestCount++;
      sendJson(response, {
        message: { content: "Unexpected response" },
      });
    });

    try {
      const client = createOllamaClient({
        url,
        maxPromptBytes: 4,
      });

      await assert.rejects(
        client.askOllama("12345"),
        /prompt exceeded/
      );

      assert.equal(requestCount, 0);
    } finally {
      await closeServer(server);
    }
  });

  await runTest("Sends the expected Ollama request and accepts a valid response", async () => {
    let receivedRequest;
    let receivedBody;

    const { server, url } = await startServer(async (request, response) => {
      receivedRequest = request;
      receivedBody = JSON.parse(await readRequestBody(request));

      sendJson(response, {
        message: {
          content: "Valid test investigation report",
        },
      });
    });

    try {
      const client = createOllamaClient({
        url,
        model: "test-model",
      });

      const result = await client.askOllama("Investigate payment evidence");

      assert.equal(result, "Valid test investigation report");
      assert.equal(receivedRequest.method, "POST");
      assert.equal(
        receivedRequest.headers["content-type"],
        "application/json"
      );
      assert.equal(receivedBody.model, "test-model");
      assert.equal(receivedBody.stream, false);
      assert.equal(receivedBody.messages.length, 2);
      assert.equal(receivedBody.messages[0].role, "system");
      assert.equal(receivedBody.messages[1].role, "user");
      assert.equal(
        receivedBody.messages[1].content,
        "Investigate payment evidence"
      );
      assert.equal(receivedBody.options.temperature, 0.1);
    } finally {
      await closeServer(server);
    }
  });

  await runTest("Rejects HTTP error responses", async () => {
    const { server, url } = await startServer((request, response) => {
      sendJson(response, { error: "Simulated server failure" }, 503);
    });

    try {
      const client = createOllamaClient({ url });

      await assert.rejects(
        client.askOllama("Test prompt"),
        /HTTP 503/
      );
    } finally {
      await closeServer(server);
    }
  });

  await runTest("Rejects malformed JSON responses", async () => {
    const { server, url } = await startServer((request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
      });

      response.end("{invalid-json");
    });

    try {
      const client = createOllamaClient({ url });

      await assert.rejects(
        client.askOllama("Test prompt"),
        /malformed JSON/
      );
    } finally {
      await closeServer(server);
    }
  });

  await runTest("Rejects missing or empty model response content", async () => {
    const responses = [
      {},
      { message: {} },
      { message: { content: "" } },
      { message: { content: "   " } },
      { message: { content: 123 } },
    ];

    for (const data of responses) {
      const { server, url } = await startServer((request, response) => {
        sendJson(response, data);
      });

      try {
        const client = createOllamaClient({ url });

        await assert.rejects(
          client.askOllama("Test prompt"),
          /invalid or empty response/
        );
      } finally {
        await closeServer(server);
      }
    }
  });

  await runTest("Rejects oversized chunked response bodies", async () => {
    const { server, url } = await startServer((request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      });

      response.write('{"message":{"content":"');
      response.write("A".repeat(100));
      response.end('"}}');
    });

    try {
      const client = createOllamaClient({
        url,
        maxResponseBytes: 64,
      });

      await assert.rejects(
        client.askOllama("Test prompt"),
        /response exceeded/
      );
    } finally {
      await closeServer(server);
    }
  });

  await runTest("Rejects oversized declared response bodies", async () => {
    const { server, url } = await startServer((request, response) => {
      const body = JSON.stringify({
        message: { content: "A".repeat(100) },
      });

      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      });

      response.end(body);
    });

    try {
      const client = createOllamaClient({
        url,
        maxResponseBytes: 64,
      });

      await assert.rejects(
        client.askOllama("Test prompt"),
        /response exceeded/
      );
    } finally {
      await closeServer(server);
    }
  });

  await runTest("Aborts requests that exceed the configured timeout", async () => {
    const { server, url } = await startServer((request, response) => {
      setTimeout(() => {
        if (!response.destroyed) {
          sendJson(response, {
            message: { content: "Late response" },
          });
        }
      }, 250);
    });

    try {
      const client = createOllamaClient({
        url,
        timeoutMs: 40,
      });

      await assert.rejects(
        client.askOllama("Test prompt")
      );
    } finally {
      await closeServer(server);
    }
  });

  console.log("\n========================================");
  console.log("Ollama Transport Test Results");
  console.log("========================================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log("\nAll Ollama transport tests passed.");
  }
}

main().catch((error) => {
  console.error("Ollama transport test runner failed:", error);
  process.exitCode = 1;
});
