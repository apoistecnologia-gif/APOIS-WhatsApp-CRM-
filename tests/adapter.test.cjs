const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
function adapter() {
  let callback,
    calls = [];
  const responses = [];
  const win = {
    WPP: {
      webpack: { isFullReady: true },
      chat: {
        getActiveChat: () => ({ id: { _serialized: "one@c.us" } }),
        async sendFileMessage(id, data, options) {
          calls.push({ id, data, options });
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { id: { _serialized: "msg" } };
        },
      },
    },
    addEventListener: (type, fn) => {
      callback = fn;
    },
    postMessage: (value) => responses.push(value),
  };
  const context = vm.createContext({
    window: win,
    location: { origin: "https://web.whatsapp.com" },
    console,
    Map,
    Promise,
  });
  vm.runInContext(
    fs.readFileSync(require.resolve("../src/whatsapp-adapter.js"), "utf8"),
    context,
  );
  return {
    win,
    calls,
    responses,
    request: (data) =>
      callback({ source: win, origin: "https://web.whatsapp.com", data }),
  };
}
test("PTT uses the reference payload and duplicate in-flight IDs send only once", async () => {
  const a = adapter();
  const request = {
    model: "APOIS_WPP",
    type: "Chat",
    action: "sendMedia",
    id: "apois_ref_test",
    dados: {
      id: "one@c.us",
      mediaType: "audio",
      dataUrl: "data:audio/ogg;base64,YQ==",
    },
  };
  a.request(request);
  a.request(request);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].options.isPtt, true);
  assert.equal(a.calls[0].options.type, "audio");
  assert.equal(JSON.parse(a.responses[0].response).accepted, true);
});
test("stale chat and forbidden supplier actions are rejected before sending", async () => {
  const a = adapter();
  a.request({
    model: "APOIS_WPP",
    type: "Chat",
    action: "sendMedia",
    id: "apois_ref_stale",
    dados: { id: "two@c.us", mediaType: "audio" },
  });
  a.request({
    model: "APOIS_WPP",
    type: "IA",
    action: "text",
    id: "apois_ref_forbidden",
    dados: {},
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(a.calls.length, 0);
  assert.match(a.responses[0].error, /conversa mudou/);
  assert.match(a.responses[1].error, /não permitida/);
});
