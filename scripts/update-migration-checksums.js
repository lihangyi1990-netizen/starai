const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Regenerates infra/migrations/checksums.sha256.
//
// Exists because the manifest used to be maintained by hand, and hand-editing
// broke it twice: 095_link_admin_users_to_tuna_users.up.sql ended up listed
// twice (two people appended to the same file) while 097_ailxp_seedance_assets
// was never added at all, which made `verify-migrations.js` fail.
//
// The hashing here MUST stay identical to verify-migrations.js -- read as utf8,
// normalize CRLF to LF, then sha256 -- or the two scripts will disagree and CI
// will reject a manifest this script just wrote.
//
// Run after adding or renaming a migration:
//   node scripts/update-migration-checksums.js

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "infra", "migrations");
const manifestPath = path.join(dir, "checksums.sha256");

const ups = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith(".up.sql"))
  .sort();

const lines = ups.map((name) => {
  const content = fs.readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n");
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  return `${digest}  ${name}`;
});

// Two spaces between digest and name, LF endings, trailing newline: the format
// verify-migrations.js parses with /^([a-f0-9]{64})\s{2}(.+\.up\.sql)$/.
const next = lines.join("\n") + "\n";
const previous = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";

if (previous === next) {
  console.log(`checksums.sha256 already up to date (${ups.length} migrations).`);
  process.exit(0);
}

fs.writeFileSync(manifestPath, next);

const previousNames = previous
  .split(/\r?\n/)
  .map((line) => line.match(/^[a-f0-9]{64}\s{2}(.+\.up\.sql)$/)?.[1])
  .filter(Boolean);
const added = ups.filter((name) => !previousNames.includes(name));
const removed = previousNames.filter((name) => !ups.includes(name));
const duplicates = previousNames.filter((name, i) => previousNames.indexOf(name) !== i);

console.log(`Wrote ${ups.length} checksums to infra/migrations/checksums.sha256.`);
if (added.length) console.log(`  added: ${added.join(", ")}`);
if (removed.length) console.log(`  removed: ${removed.join(", ")}`);
if (duplicates.length) console.log(`  de-duplicated: ${[...new Set(duplicates)].join(", ")}`);
