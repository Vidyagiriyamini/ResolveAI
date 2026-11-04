
const crypto = require("node:crypto");

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const PASSWORD_HASH_BYTES = 64;
const MIN_PASSWORD_LENGTH = 16;
const MAX_PASSWORD_LENGTH = 200;
const MAX_USERNAME_LENGTH = 100;
const MIN_SESSION_SECRET_LENGTH = 64;

function createOperatorAuthService(db, config = {}) {
  const username =
    config.username ?? process.env.RESOLVEAI_OPERATOR_USERNAME;

  const password =
    config.password ?? process.env.RESOLVEAI_OPERATOR_PASSWORD;

  const sessionSecret =
    config.sessionSecret ?? process.env.RESOLVEAI_SESSION_SECRET;

  if (
    typeof username !== "string" ||
    username.length === 0 ||
    username.length > MAX_USERNAME_LENGTH ||
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    typeof sessionSecret !== "string" ||
    sessionSecret.length < MIN_SESSION_SECRET_LENGTH
  ) {
    throw new Error(
      "Operator authentication configuration is missing or invalid. Username must be 1-100 characters, password 16-200 characters, and session secret at least 64 characters."
    );
  }

  const passwordSalt = crypto
    .createHmac("sha256", sessionSecret)
    .update(`resolveai-operator:${username}`)
    .digest();

  const passwordHash = crypto.scryptSync(
    password,
    passwordSalt,
    PASSWORD_HASH_BYTES
  );

  const insertSession = db.prepare(`
    INSERT INTO operator_sessions
      (token_hash, operator_username, expires_at)
    VALUES (?, ?, ?)
  `);

  const findSession = db.prepare(`
    SELECT operator_username, expires_at
    FROM operator_sessions
    WHERE token_hash = ?
  `);

  const deleteSession = db.prepare(`
    DELETE FROM operator_sessions
    WHERE token_hash = ?
  `);

  function hashToken(token) {
    return crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
  }

  function authenticate(candidateUsername, candidatePassword) {
    if (
      typeof candidateUsername !== "string" ||
      typeof candidatePassword !== "string" ||
      candidateUsername.length === 0 ||
      candidateUsername.length > MAX_USERNAME_LENGTH ||
      candidatePassword.length < MIN_PASSWORD_LENGTH ||
      candidatePassword.length > MAX_PASSWORD_LENGTH
    ) {
      return false;
    }

    const candidateSalt = crypto
      .createHmac("sha256", sessionSecret)
      .update(`resolveai-operator:${candidateUsername}`)
      .digest();

    const candidateHash = crypto.scryptSync(
      candidatePassword,
      candidateSalt,
      PASSWORD_HASH_BYTES
    );

    const usernameMatches = candidateUsername === username;

    const passwordMatches = crypto.timingSafeEqual(
      candidateHash,
      passwordHash
    );

    return usernameMatches && passwordMatches;
  }

  function createSession(operatorUsername) {
    if (operatorUsername !== username) {
      throw new Error("Unauthorized operator.");
    }

    const token = crypto.randomBytes(32).toString("hex");

    const expiresAt = new Date(
      Date.now() + SESSION_DURATION_MS
    ).toISOString();

    insertSession.run(
      hashToken(token),
      username,
      expiresAt
    );

    return { token, expiresAt };
  }

  function getSession(token) {
    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token)
    ) {
      return null;
    }

    const tokenHash = hashToken(token);
    const session = findSession.get(tokenHash);

    if (!session) return null;

    if (Date.parse(session.expires_at) <= Date.now()) {
      deleteSession.run(tokenHash);
      return null;
    }

    return {
      username: session.operator_username,
      expiresAt: session.expires_at,
    };
  }

  function revokeSession(token) {
    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token)
    ) {
      return false;
    }

    return deleteSession.run(hashToken(token)).changes > 0;
  }

  function cleanupExpiredSessions() {
    return db.prepare(`
      DELETE FROM operator_sessions
      WHERE expires_at <= ?
    `).run(new Date().toISOString()).changes;
  }

  return {
    authenticate,
    createSession,
    getSession,
    revokeSession,
    cleanupExpiredSessions,
  };
}

module.exports = { createOperatorAuthService };
