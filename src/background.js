importScripts("core.js", "storage.js");
let storageQueue = Promise.resolve();
const storageMethods = new Set([
  "getAll",
  "setKey",
  "saveReply",
  "deleteReply",
  "recordUse",
  "ensureContact",
  "toggleContactLabel",
  "assignContact",
  "saveAttendant",
  "deleteAttendant",
  "saveAccount",
  "deleteAccount",
  "saveLabel",
  "deleteLabel",
  "saveCategory",
  "deleteCategory",
  "moveReply",
  "moveCategory",
  "saveMulticonta",
  "touchSharedConfig",
  "transferBetweenAccounts",
  "saveMessageAttribution",
  "setContactStage",
  "restoreData",
]);
const DB = "apois_media_db",
  STORE = "media",
  DBV = 1;
function dbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, DBV);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE))
        r.result.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode),
      s = t.objectStore(STORE);
    let value;
    try {
      value = fn(s);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => {
      db.close();
      resolve(value);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
    t.onabort = () => {
      db.close();
      reject(t.error);
    };
  });
}
async function putMedia({ id, buffer, dataUrl, mime, name, size, duration }) {
  let blob;
  if (dataUrl) {
    blob = await (await fetch(dataUrl)).blob();
  } else {
    blob = new Blob([buffer], { type: mime || "application/octet-stream" });
  }
  await tx("readwrite", (s) =>
    s.put({
      id,
      blob,
      mime: blob.type,
      name: name || "arquivo",
      size: size || blob.size,
      duration: duration || 0,
      updatedAt: Date.now(),
    }),
  );
  return { ok: true, id, size: blob.size };
}
async function getRecord(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    r.onsuccess = () => {
      db.close();
      resolve(r.result || null);
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
async function delMedia(id) {
  await tx("readwrite", (s) => s.delete(id));
  return { ok: true };
}
async function listMedia() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    r.onsuccess = () => {
      db.close();
      resolve((r.result || []).map(({ blob, ...m }) => m));
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const f = new FileReader();
    f.onload = () => resolve(f.result);
    f.onerror = () => reject(f.error);
    f.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "STORAGE_RPC") {
      if (!storageMethods.has(msg.method) || !Array.isArray(msg.args))
        throw new Error("Operação inválida");
      const job = storageQueue.then(() =>
        globalThis.APOISStorage[msg.method](...msg.args),
      );
      storageQueue = job.catch(() => {});
      return { ok: true, value: await job };
    }
    if (msg?.type === "MEDIA_RESTORE") {
      const entries = msg.items;
      globalThis.APOISCore.validateBackup({
        format: "APOIS_QUICK_REPLIES_BACKUP",
        data: { quickReplies: [] },
        media: entries,
      });
      const records = [];
      for (const entry of entries) {
        const blob = await (await fetch(entry.dataUrl)).blob();
        records.push({ ...entry, blob, dataUrl: undefined });
      }
      const db = await dbOpen();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        for (const record of records)
          transaction.objectStore(STORE).put(record);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
      return { ok: true };
    }
    if (msg?.type === "MEDIA_PUT") return putMedia(msg);
    if (msg?.type === "MEDIA_GET") {
      const r = await getRecord(msg.id);
      if (!r) return { ok: false };
      return {
        ok: true,
        id: r.id,
        dataUrl: await blobToDataURL(r.blob),
        mime: r.mime,
        name: r.name,
        size: r.size,
        duration: r.duration || 0,
      };
    }
    if (msg?.type === "MEDIA_DELETE") {
      const raw = await chrome.storage.local.get(null);
      if (
        (raw.quickReplies || []).some((reply) =>
          [reply, ...(reply.blocks || [])].some(
            (item) => item.mediaId === msg.id,
          ),
        )
      )
        return { ok: true, retained: true };
      return delMedia(msg.id);
    }
    if (msg?.type === "MEDIA_LIST")
      return { ok: true, items: await listMedia() };
    if (msg?.type === "MEDIA_EXPORT") {
      const items = await listMedia(),
        out = [];
      for (const m of items) {
        const r = await getRecord(m.id);
        out.push({ ...m, dataUrl: await blobToDataURL(r.blob) });
      }
      return { ok: true, items: out };
    }
    if (msg?.type === "FOCUS_WHATSAPP_TAB") {
      if (sender?.tab?.id)
        await chrome.tabs
          .update(sender.tab.id, { active: true })
          .catch(() => {});
      if (sender?.tab?.windowId != null)
        await chrome.windows
          .update(sender.tab.windowId, { focused: true })
          .catch(() => {});
      return { ok: true };
    }
    if (msg?.type === "MULTI_BRIDGE_FETCH") {
      const method = String(msg.method || "GET").toUpperCase();
      const bridgePath = String(msg.path || "/health");
      if (
        !/^\/(?:health|sessions(?:\/[a-zA-Z0-9_-]+(?:\/(?:start|chats|send-text|logout))?)?)$/.test(
          bridgePath,
        )
      )
        throw new Error("Caminho da Central inválido");
      const url = "http://127.0.0.1:3210" + bridgePath;
      const opts = { method, headers: { "x-apois-bridge": "1" } };
      if (msg.body !== undefined && method !== "GET" && method !== "HEAD") {
        opts.headers["content-type"] = "application/json";
        opts.body = JSON.stringify(msg.body);
      }
      try {
        const response = await fetch(url, {
          ...opts,
          signal: AbortSignal.timeout(15000),
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { ok: false, error: text || "HTTP " + response.status };
        }
        return {
          ok: response.ok && data?.ok !== false,
          status: response.status,
          data,
        };
      } catch (e) {
        return {
          ok: false,
          status: 0,
          error: String(e?.message || e),
          bridgeOffline: true,
        };
      }
    }
    return { ok: false, error: "unknown" };
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id && tab.url?.startsWith("https://web.whatsapp.com/")) {
    chrome.tabs
      .sendMessage(tab.id, { type: "APOIS_TOGGLE_PANEL" })
      .catch(() => {});
  } else {
    chrome.tabs.create({ url: "https://web.whatsapp.com/" });
  }
});
