const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
const assert = require("node:assert/strict");
assert.equal(manifest.manifest_version, 3);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.update_url, undefined);
const referenced = [
  manifest.background.service_worker,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((script) => [
    ...script.js,
    ...(script.css || []),
  ]),
  ...manifest.web_accessible_resources.flatMap(
    (resource) => resource.resources,
  ),
];
for (const file of referenced)
  assert.ok(fs.existsSync(path.join(root, file)), `Missing ${file}`);
const prohibited =
  /backend\.lotsofwms|wascript\.com\.br|cobrancas\.uppermesh|perfeittogroup|18772241042@|18334363285@|18002428478@/i;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (/\.(js|mjs|cjs)$/.test(file)) {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
      if (
        !file.includes(`${path.sep}tests${path.sep}`) &&
        !file.includes(`${path.sep}scripts${path.sep}`)
      ) {
        assert.ok(
          !prohibited.test(fs.readFileSync(file, "utf8")),
          `Supplier endpoint in ${file}`,
        );
      }
    }
  }
}
walk(root);
console.log(
  "PASS: MV3, all referenced files, JavaScript syntax, no supplier endpoints or remote update URL.",
);
