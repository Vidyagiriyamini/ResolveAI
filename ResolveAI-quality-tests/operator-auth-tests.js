
const Database = require("better-sqlite3");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const {
  createOperatorAuthService,
} = require("../operator-auth-service");

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE operator_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    operator_username TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const validConfig = {
  username: "test-operator",
  password: "Test-Only-Password-123!",
  sessionSecret: crypto.randomBytes(48).toString("hex"),
};

const service = createOperatorAuthService(db, validConfig);

let passed = 0;
let failed = 0;

function test(name, callback) {
  try {
    callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

function expectConfigurationFailure(config) {
  assert.throws(
    () => createOperatorAuthService(db, config),
    /configuration is missing or invalid/
  );
}

test("Valid operator credentials are accepted", () => {
  assert.equal(
    service.authenticate("test-operator", "Test-Only-Password-123!"),
    true
  );
});

test("Incorrect password is rejected", () => {
  assert.equal(
    service.authenticate("test-operator", "Wrong-Password-123"),
    false
  );
});

test("Unknown operator is rejected", () => {
  assert.equal(
    service.authenticate("unknown-operator", "Test-Only-Password-123!"),
    false
  );
});

test("Passwords shorter than 16 characters are rejected at initialization", () => {
  expectConfigurationFailure({
    ...validConfig,
    password: "Short123!",
  });
});

test("Passwords longer than 200 characters are rejected at initialization", () => {
  expectConfigurationFailure({
    ...validConfig,
    password: "A".repeat(201),
  });
});

test("Missing username is rejected at initialization", () => {
  expectConfigurationFailure({
    ...validConfig,
    username: "",
  });
});

test("Username longer than 100 characters is rejected", () => {
  expectConfigurationFailure({
    ...validConfig,
    username: "u".repeat(101),
  });
});

test("Missing session secret is rejected at initialization", () => {
  expectConfigurationFailure({
    ...validConfig,
    sessionSecret: "",
  });
});

test("Session secret shorter than 64 characters is rejected", () => {
  expectConfigurationFailure({
    ...validConfig,
    sessionSecret: "short-secret",
  });
});

test("Session token is created and validated", () => {
  const session = service.createSession("test-operator");

  assert.equal(session.token.length, 64);
  assert.equal(
    service.getSession(session.token).username,
    "test-operator"
  );
});

test("Only token hashes are stored in SQLite", () => {
  const session = service.createSession("test-operator");

  const stored = db.prepare(`
    SELECT token_hash
    FROM operator_sessions
    ORDER BY id DESC
    LIMIT 1
  `).get();

  assert.notEqual(stored.token_hash, session.token);
  assert.equal(stored.token_hash.length, 64);
});

test("Invalid session tokens are rejected", () => {
  assert.equal(service.getSession("invalid-token"), null);
});

test("Malformed login credentials are rejected", () => {
  assert.equal(service.authenticate(null, "Test-Only-Password-123!"), false);
  assert.equal(service.authenticate("test-operator", null), false);
  assert.equal(service.authenticate("", "Test-Only-Password-123!"), false);
  assert.equal(service.authenticate("test-operator", "Short123!"), false);
  assert.equal(
    service.authenticate("test-operator", "A".repeat(201)),
    false
  );
});

test("Unauthorized operators cannot create sessions", () => {
  assert.throws(
    () => service.createSession("unknown-operator"),
    /Unauthorized operator/
  );
});

test("Revoked sessions cannot be reused", () => {
  const session = service.createSession("test-operator");

  assert.equal(service.revokeSession(session.token), true);
  assert.equal(service.getSession(session.token), null);
});

test("Expired sessions are rejected and deleted from SQLite", () => {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  db.prepare(`
    INSERT INTO operator_sessions
      (token_hash, operator_username, expires_at)
    VALUES (?, ?, ?)
  `).run(
    tokenHash,
    "test-operator",
    new Date(Date.now() - 60_000).toISOString()
  );

  assert.equal(service.getSession(token), null);

  const stored = db.prepare(`
    SELECT token_hash
    FROM operator_sessions
    WHERE token_hash = ?
  `).get(tokenHash);

  assert.equal(stored, undefined);
});

test("Expired session cleanup removes expired records", () => {
  const expiredToken = crypto.randomBytes(32).toString("hex");
  const expiredHash = crypto
    .createHash("sha256")
    .update(expiredToken)
    .digest("hex");

  db.prepare(`
    INSERT INTO operator_sessions
      (token_hash, operator_username, expires_at)
    VALUES (?, ?, ?)
  `).run(
    expiredHash,
    "test-operator",
    new Date(Date.now() - 60_000).toISOString()
  );

  assert.equal(service.cleanupExpiredSessions(), 1);

  const stored = db.prepare(`
    SELECT token_hash
    FROM operator_sessions
    WHERE token_hash = ?
  `).get(expiredHash);

  assert.equal(stored, undefined);
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);

db.close();

if (failed > 0) {
  process.exitCode = 1;
}
