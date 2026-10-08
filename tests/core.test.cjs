const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signature,
  validateBackup,
  ExecutionLock,
  sameConversation,
} = require("../src/core.js");
test("attendant signature keeps empty drafts unchanged and is applied once", () => {
  const attendant = { name: "Franciel", active: true };
  assert.equal(signature("", attendant), "");
  assert.equal(signature("  ", attendant), "  ");
  assert.equal(
    signature("Olá 🌻\nTudo bem?", attendant),
    "*_Franciel:_*\nOlá 🌻\nTudo bem?",
  );
  assert.equal(
    signature(signature("Olá", attendant), attendant),
    "*_Franciel:_*\nOlá",
  );
  assert.equal(signature("Olá", { name: "Artur", active: false }), "Olá");
});
test("one execution at a time; lock releases after failure", async () => {
  const lock = new ExecutionLock();
  let release;
  const pending = lock.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    lock.run(async () => {}),
    /Aguarde/,
  );
  release();
  await pending;
  await assert.rejects(
    lock.run(async () => {
      throw Error("failed");
    }),
  );
  assert.equal(await lock.run(async () => 42), 42);
});
test("same name in different accounts is not the same conversation", () => {
  assert.equal(sameConversation("a::Maria", "b::Maria"), false);
  assert.equal(sameConversation("", ""), false);
});
test("backup rejects missing/corrupt/duplicate media before writes", () => {
  const payload = {
    format: "APOIS_QUICK_REPLIES_BACKUP",
    data: { quickReplies: [{ type: "sequence", blocks: [{ mediaId: "m" }] }] },
    media: [],
  };
  assert.throws(() => validateBackup(payload), /falta mídia/);
  payload.media = [{ id: "m", dataUrl: "data:audio/ogg;base64,YQ==" }];
  assert.equal(validateBackup(payload), payload);
  payload.media.push(payload.media[0]);
  assert.throws(() => validateBackup(payload), /repetida/);
});
