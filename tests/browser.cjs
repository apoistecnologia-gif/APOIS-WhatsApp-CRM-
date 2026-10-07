/* Run with PLAYWRIGHT_MODULE and CHROMIUM_PATH when using an existing runtime. */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const server = http.createServer((request, response) => {
  const file = path.resolve(root, "." + request.url.split("?")[0]);
  if (!file.startsWith(root + "/")) {
    response.writeHead(403).end();
    return;
  }
  try {
    const mime = file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".html")
          ? "text/html"
          : "application/octet-stream";
    response.setHeader("content-type", mime);
    response.end(fs.readFileSync(file));
  } catch {
    response.writeHead(404).end();
  }
});
(async () => {
  await new Promise((resolve) => server.listen(8787, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("PAGE ERROR", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error("BROWSER", message.text());
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("http://127.0.0.1:8787/tests/fixture.html");
  await page.locator("#apois-root .apois-panel").waitFor();
  console.log("panel ready");
  await page.waitForFunction(
    () => window.chrome && document.querySelector("[data-current-attendant]"),
  );
  const editor = page.locator("#main footer [contenteditable]");
  assert.equal(await editor.textContent(), "");
  await page.locator("[data-current-attendant]").selectOption("att_franciel");
  assert.equal(await editor.textContent(), "");
  await editor.fill("Olá 🌻");
  assert.equal(await editor.textContent(), "Olá 🌻");
  console.log("native send");
  await editor.press("Enter");
  await page.waitForFunction(() => window.fixtureMessages.length === 1);
  assert.equal(
    await page.evaluate(() => window.fixtureMessages[0]),
    "*_Franciel:_* \nOlá 🌻",
  );
  assert.equal(await editor.textContent(), "");
  await editor.fill("Nova mensagem");
  await page.locator("#main footer button").click();
  assert.equal(await page.evaluate(() => window.fixtureMessages.length), 2);
  await page.locator('[data-stage="waiting"]').click();
  await page.waitForFunction(async () => {
    const data = await chrome.runtime.sendMessage({ type: "RAW_GET" });
    return (
      data.contacts["acc_principal::5587999999999@c.us"]?.stageId === "waiting"
    );
  });
  await page.locator('[data-action="close"]').click();
  await page.locator(".apois-launcher").click();
  console.log("settings");
  await page.locator('[data-action="manage-settings"]').click();
  const bounds = await page.evaluate(() => ({
    chat: document.querySelector("#app").getBoundingClientRect().right,
    drawer: document.querySelector(".apois-manager").getBoundingClientRect().left,
  }));
  assert.ok(bounds.chat <= bounds.drawer + 1, "drawer must reserve its width");
  await page
    .getByRole("button", { name: "Diagnóstico — copiar relatório" })
    .click();
  await page
    .getByText("Relatório de diagnóstico copiado", { exact: true })
    .waitFor();
  const diagnostic = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  assert.equal(diagnostic.version, "3.2.0");
  assert.equal(diagnostic.indexedDB.ok, true);
  await page.locator("button[data-manager-close]").first().click();
  const media = await page.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "MEDIA_PUT",
      id: "audio-test",
      dataUrl: "data:audio/ogg;base64,T2dnUw==",
      mime: "audio/ogg",
      name: "audio.ogg",
    }),
  );
  assert.equal(media.ok, true);
  const read = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "MEDIA_GET", id: "audio-test" }),
  );
  assert.equal(read.dataUrl, "data:audio/ogg;base64,T2dnUw==");
  await page.evaluate(async () => {
    const data = await chrome.runtime.sendMessage({ type: "RAW_GET" });
    data.quickReplies = [
      {
        id: "sequence_test",
        title: "Sequência teste",
        type: "sequence",
        categoryId: "cat_geral",
        sendMode: "send",
        blocks: [
          { id: "one", type: "text", text: "Primeira ação", order: 0 },
          {
            id: "two",
            type: "pix",
            pixKey: "chave@example.com",
            pixHolder: "Titular",
            order: 1,
          },
          {
            id: "three",
            type: "audio",
            mediaId: "audio-test",
            fileName: "audio.ogg",
            mimeType: "audio/ogg",
            order: 2,
          },
        ],
      },
    ];
    await chrome.runtime.sendMessage({ type: "RAW_SET", value: data });
  });
  await page.locator('.qr-main[data-reply="sequence_test"]').waitFor();
  await page.locator('.qr-main[data-reply="sequence_test"]').click();
  await page.waitForFunction(() => window.fixtureMedia.length === 1, {
    timeout: 15000,
  });
  assert.equal(
    await page.evaluate(() => window.fixtureMessages[2]),
    "*_Franciel:_* \nPrimeira ação",
  );
  assert.match(
    await page.evaluate(() => window.fixtureMessages[3]),
    /Chave PIX: chave@example.com/,
  );
  assert.equal(
    await page.evaluate(() => window.fixtureMedia[0].options.isPtt),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.fixtureMedia[0].options.type),
    "audio",
  );
  await page.waitForFunction(async () => {
    const data = await chrome.runtime.sendMessage({type: "RAW_GET"});
    return data.quickReplies[0].useCount === 1;
  });
  await page.locator('[data-action="manage"]').first().click();
  await page.locator('[data-edit-reply="sequence_test"]').click();
  await page.locator("[data-block-duplicate]").first().click();
  assert.equal(await page.locator(".sequence-block").count(), 4);
  await page.locator("[data-block-down]").first().click();
  await page.locator("[data-block-remove]").first().click();
  assert.equal(await page.locator(".sequence-block").count(), 3);
  await page.locator("button[data-manager-close]").first().click();
  const retained = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "MEDIA_DELETE", id: "audio-test" }),
  );
  assert.equal(retained.retained, true);
  console.log("settings");
  await page.locator('[data-action="manage-settings"]').click();
  await page.screenshot({
    path: path.join(root, "docs", "browser-validation.png"),
    fullPage: true,
  });
  await page.setViewportSize({width: 760, height: 960});
  const mobile = await page.evaluate(() => ({
    chat: document.querySelector("#app").getBoundingClientRect().bottom,
    drawer: document.querySelector(".apois-manager").getBoundingClientRect().top,
  }));
  assert.ok(mobile.chat <= mobile.drawer + 1, "small viewport must dock below WhatsApp");
  await page.setViewportSize({width: 1440, height: 960});
  await page.reload();
  await page.locator("#apois-root .apois-panel").waitFor();
  assert.equal(await editor.textContent(), "");
  const data = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "RAW_GET" }),
  );
  assert.equal(
    data.contacts["acc_principal::5587999999999@c.us"].stageId,
    "waiting",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser UI, empty composer, attendant selection, Enter/click signature, pipeline, panel toggle, diagnostics, real IndexedDB, ordered text/PIX/PTT API payload, reload.",
  );
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
