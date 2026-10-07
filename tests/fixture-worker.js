/* Browser-only harness. Production background and IndexedDB are unchanged. */
const listeners = [];
let state = null;
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("apois_test_config", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("config");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function load() {
  if (state) return state;
  const db = await database();
  state = await new Promise((resolve) => {
    const request = db.transaction("config").objectStore("config").get("data");
    request.onsuccess = () => resolve(request.result || {});
  });
  db.close();
  return state;
}
async function save(value) {
  const previous = await load();
  const changed = Object.fromEntries(
    Object.entries(value).map(([key, newValue]) => [
      key,
      { oldValue: previous[key], newValue },
    ]),
  );
  state = { ...previous, ...value };
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("config", "readwrite");
    tx.objectStore("config").put(state, "data");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  postMessage({ changed });
}
async function dispatch(message) {
  if (message.type === "RAW_GET") return load();
  if (message.type === "RAW_SET") {
    await save(message.value);
    return { ok: true };
  }
  return new Promise((resolve) => {
    for (const listener of listeners)
      listener(message, { tab: { id: 1, windowId: 1 } }, resolve);
  });
}
self.chrome = {
  storage: { local: { get: load, set: save } },
  runtime: {
    onMessage: { addListener: (fn) => listeners.push(fn) },
    sendMessage: dispatch,
  },
  action: { onClicked: { addListener() {} } },
  tabs: { async update() {}, async sendMessage() {}, async create() {} },
  windows: { async update() {} },
};
const browserImportScripts = importScripts;
self.importScripts = (...urls) =>
  browserImportScripts(
    ...urls.map((url) =>
      ["core.js", "storage.js"].includes(url) ? "/src/" + url : url,
    ),
  );
importScripts("../src/background.js");
self.onmessage = async (event) => {
  try {
    postMessage({
      id: event.data.id,
      result: await dispatch(event.data.message),
    });
  } catch (error) {
    postMessage({
      id: event.data.id,
      result: { ok: false, error: error.message },
    });
  }
};
