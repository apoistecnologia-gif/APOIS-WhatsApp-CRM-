const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "apois-bridge-test-"),
  );
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: path.resolve(__dirname, "../apois-multiconta-bridge"),
    env: {
      ...process.env,
      APOIS_DATA_DIR: directory,
      APOIS_BRIDGE_PORT: "3219",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Bridge startup timeout")),
        10000,
      );
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("ativa em")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on("exit", (code) => reject(Error("Bridge exited " + code)));
      child.stderr.on("data", (chunk) => console.error(chunk.toString()));
    });
    const base = "http://127.0.0.1:3219";
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await fetch(base + "/sessions")).status, 403);
    const authorized = await fetch(base + "/sessions", {
      headers: { "x-apois-bridge": "1" },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual((await authorized.json()).sessions, []);
    assert.equal(
      (
        await fetch(base + "/sessions", {
          headers: { "x-apois-bridge": "1", origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/sessions/missing/send-text", {
          method: "POST",
          headers: {
            "x-apois-bridge": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({ jid: "5587999999999", text: "test" }),
        })
      ).status,
      409,
    );
    console.log(
      "PASS: bridge boots with locked dependencies; health, isolated empty sessions, header/origin gates, offline send rejection.",
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
