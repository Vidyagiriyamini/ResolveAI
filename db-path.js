
const path = require("node:path");
const fs = require("node:fs");

function getDatabasePath() {
  const configuredPath = process.env.RESOLVEAI_DB_PATH;

  const databasePath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(__dirname, "resolveai.db");

  // Create the parent directory if it does not exist.
  fs.mkdirSync(path.dirname(databasePath), {
    recursive: true,
  });

  return databasePath;
}

module.exports = { getDatabasePath };
