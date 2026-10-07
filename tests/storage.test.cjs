const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
function storage() {
  let data = {};
  const context = vm.createContext({
    console,
    Date,
    Math,
    chrome: {
      storage: {
        local: {
          async get() {
            return structuredClone(data);
          },
          async set(value) {
            data = { ...data, ...structuredClone(value) };
          },
        },
      },
      runtime: {
        async sendMessage() {
          return { ok: true };
        },
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(require.resolve("../src/storage.js"), "utf8"),
    context,
  );
  return {
    api: context.APOISStorage,
    raw: () => data,
    seed: (value) => {
      data = value;
    },
  };
}
test("schema migration is idempotent, scopes old contacts and excludes supplier tokens", async () => {
  const { api, raw, seed } = storage();
  seed({
    schemaVersion: 7,
    contacts: { maria: { displayName: "Maria", labels: [] } },
    supplierToken: "must-not-import",
    labels: [],
  });
  const first = await api.getAll();
  const second = await api.getAll();
  assert.equal(first.contacts["acc_principal::maria"].stageId, "new");
  assert.equal(first.schemaVersion, 13);
  assert.deepEqual(
    JSON.parse(JSON.stringify(first)),
    JSON.parse(JSON.stringify(second)),
  );
  assert.equal(first.supplierToken, undefined);
  assert.equal(first.labels.length, 0);
  assert.equal(raw().schemaVersion, 13);
});
test("future schema is rejected without downgrading data", async () => {
  const { api, raw, seed } = storage();
  seed({ schemaVersion: 99 });
  await assert.rejects(api.getAll(), /mais nova/);
  assert.equal(raw().schemaVersion, 99);
});
test("stage persists and transfer preserves labels and attendant across accounts", async () => {
  const { api } = storage();
  await api.ensureContact("Maria");
  await api.toggleContactLabel("Maria", "lab_cliente");
  await api.assignContact("Maria", "acc_principal", "att_franciel");
  await api.setContactStage("Maria", "acc_principal", "waiting");
  await api.transferBetweenAccounts(
    "Maria",
    "acc_principal",
    "acc_destino",
    "5587999999999@s.whatsapp.net",
    "att_franciel",
    "teste",
  );
  const data = await api.getAll();
  assert.equal(data.contacts["acc_principal::maria"].stageId, "waiting");
  assert.equal(
    data.contacts["acc_destino::5587999999999@c.us"].labels[0],
    "lab_cliente",
  );
  assert.equal(
    data.assignments["acc_destino::5587999999999@c.us"].attendantId,
    "att_franciel",
  );
  assert.equal(data.transferLog[0].fromAccountId, "acc_principal");
});

test("equal display names remain separate when WhatsApp IDs are available", async () => {
  const { api } = storage();
  await api.ensureContact("Maria", "acc_principal", "111@c.us");
  await api.ensureContact("Maria", "acc_principal", "222@c.us");
  await api.setContactStage("Maria", "acc_principal", "done", "111@c.us");
  const data = await api.getAll();
  assert.equal(data.contacts["acc_principal::111@c.us"].stageId, "done");
  assert.equal(data.contacts["acc_principal::222@c.us"].stageId, "new");
});
