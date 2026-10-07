import express from "express";
import QRCode from "qrcode";
import pino from "pino";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from "baileys";

const PORT = Number(process.env.APOIS_BRIDGE_PORT || 3210);
const HOST = "127.0.0.1";
const DATA_ROOT =
  process.env.APOIS_DATA_DIR ||
  path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "APOIS-WhatsApp-Central",
  );
const AUTH_ROOT = path.join(DATA_ROOT, "sessions");

await fs.mkdir(AUTH_ROOT, { recursive: true });

const logger = pino({ level: process.env.APOIS_LOG_LEVEL || "warn" });
const sessions = new Map();

const safeId = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80) || "session";

function publicState(s) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    qrDataUrl: s.qrDataUrl || "",
    phone: s.phone || "",
    userId: s.userId || "",
    updatedAt: s.updatedAt || 0,
    connectedAt: s.connectedAt || 0,
    error: s.error || "",
    chats: [...(s.chats?.values?.() || [])]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 12),
  };
}

async function sessionDir(id) {
  const dir = path.join(AUTH_ROOT, safeId(id));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function normalizeJid(jid = "") {
  return String(jid).replace(/:\d+@/, "@");
}

function messageText(msg) {
  const m = msg?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.fileName ||
    (m.audioMessage ? "🎙 Áudio" : "") ||
    (m.imageMessage ? "🖼 Imagem" : "") ||
    (m.videoMessage ? "🎬 Vídeo" : "") ||
    (m.documentMessage ? "📎 Documento" : "") ||
    ""
  ).slice(0, 180);
}

function updateChatFromMessage(s, msg) {
  const jid = normalizeJid(msg?.key?.remoteJid || "");
  if (!jid || jid === "status@broadcast") return;
  const prev = s.chats.get(jid) || { jid, name: jid.split("@")[0], unread: 0 };
  const fromMe = !!msg?.key?.fromMe;
  s.chats.set(jid, {
    ...prev,
    jid,
    preview: messageText(msg),
    unread: fromMe ? prev.unread || 0 : (prev.unread || 0) + 1,
    updatedAt:
      Number(msg?.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
  });
}

async function disconnectSocket(s) {
  try {
    s.sock?.ws?.close?.();
  } catch {}
  try {
    s.sock?.end?.(new Error("APOIS session restart"));
  } catch {}
  s.sock = null;
}

async function startSession(id, name = "") {
  id = safeId(id);
  let s = sessions.get(id);
  if (s?.starting) return publicState(s);
  if (!s) {
    s = {
      id,
      name: name || id,
      status: "starting",
      qrDataUrl: "",
      phone: "",
      userId: "",
      updatedAt: Date.now(),
      connectedAt: 0,
      error: "",
      sock: null,
      starting: false,
      reconnectTimer: null,
      chats: new Map(),
    };
    sessions.set(id, s);
  } else if (name) {
    s.name = name;
  }

  if (s.status === "connected" && s.sock) return publicState(s);

  clearTimeout(s.reconnectTimer);
  s.deleted = false;
  if (s.status === "logged_out")
    await fs.rm(path.join(AUTH_ROOT, id), { recursive: true, force: true });
  s.starting = true;
  s.status = "starting";
  s.error = "";
  s.updatedAt = Date.now();

  try {
    const dir = await sessionDir(id);
    await fs.writeFile(
      path.join(dir, "apois-meta.json"),
      JSON.stringify({ name: s.name }),
      { mode: 0o600 },
    );
    const { state, saveCreds } = await useMultiFileAuthState(dir);

    await disconnectSocket(s);

    const sock = makeWASocket({
      auth: state,
      logger: logger.child({ session: id }),
      printQRInTerminal: false,
      browser: Browsers.windows("APOIS CRM"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });
    s.sock = sock;
    s.starting = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("contacts.upsert", (contacts) => {
      for (const ct of contacts || []) {
        const jid = normalizeJid(ct.id || "");
        if (!jid) continue;
        const prev = s.chats.get(jid);
        if (prev) {
          s.chats.set(jid, {
            ...prev,
            name: ct.notify || ct.name || ct.verifiedName || prev.name,
          });
        }
      }
    });

    sock.ev.on("chats.upsert", (chats) => {
      for (const chat of chats || []) {
        const jid = normalizeJid(chat.id || "");
        if (!jid) continue;
        const prev = s.chats.get(jid) || {};
        s.chats.set(jid, {
          jid,
          name: chat.name || prev.name || jid.split("@")[0],
          preview: prev.preview || "",
          unread: Number(chat.unreadCount ?? prev.unread ?? 0),
          updatedAt:
            Number(chat.conversationTimestamp || 0) * 1000 ||
            prev.updatedAt ||
            Date.now(),
        });
      }
    });

    sock.ev.on(
      "messaging-history.set",
      ({ chats = [], contacts = [], messages = [] }) => {
        for (const chat of chats) {
          const jid = normalizeJid(chat.id || "");
          if (!jid) continue;
          const prev = s.chats.get(jid) || {};
          s.chats.set(jid, {
            jid,
            name: chat.name || prev.name || jid.split("@")[0],
            preview: prev.preview || "",
            unread: Number(chat.unreadCount ?? prev.unread ?? 0),
            updatedAt:
              Number(chat.conversationTimestamp || 0) * 1000 ||
              prev.updatedAt ||
              Date.now(),
          });
        }
        for (const ct of contacts) {
          const jid = normalizeJid(ct.id || "");
          if (!jid) continue;
          const prev = s.chats.get(jid);
          if (prev)
            s.chats.set(jid, {
              ...prev,
              name: ct.notify || ct.name || ct.verifiedName || prev.name,
            });
        }
        for (const msg of messages) updateChatFromMessage(s, msg);
      },
    );

    sock.ev.on("messages.upsert", ({ messages = [] }) => {
      for (const msg of messages) updateChatFromMessage(s, msg);
      s.updatedAt = Date.now();
    });

    sock.ev.on("connection.update", async (update) => {
      if (s.deleted || s.sock !== sock) return;
      const { connection, lastDisconnect, qr } = update;
      s.updatedAt = Date.now();

      if (qr) {
        s.status = "qr";
        s.error = "";
        try {
          s.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 360,
            margin: 2,
            errorCorrectionLevel: "M",
          });
        } catch (e) {
          s.error = "Falha ao renderizar QR: " + (e?.message || e);
        }
      }

      if (connection === "open") {
        s.status = "connected";
        s.qrDataUrl = "";
        s.error = "";
        s.userId = normalizeJid(sock.user?.id || "");
        s.phone = s.userId.split("@")[0] || "";
        s.connectedAt = Date.now();
        s.updatedAt = Date.now();
        clearTimeout(s.reconnectTimer);
      }

      if (connection === "close") {
        const code =
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.data?.statusCode ||
          lastDisconnect?.error?.statusCode ||
          0;

        const loggedOut = code === DisconnectReason.loggedOut;
        s.sock = null;
        s.qrDataUrl = "";
        s.updatedAt = Date.now();

        if (loggedOut) {
          s.status = "logged_out";
          s.error = "Sessão desconectada pelo WhatsApp";
        } else {
          s.status = "reconnecting";
          s.error = lastDisconnect?.error?.message || "";
          clearTimeout(s.reconnectTimer);
          s.reconnectTimer = setTimeout(() => {
            startSession(s.id, s.name).catch((err) => {
              s.status = "error";
              s.error = err?.message || String(err);
              s.updatedAt = Date.now();
            });
          }, 2500);
        }
      }
    });

    return publicState(s);
  } catch (error) {
    s.starting = false;
    s.status = "error";
    s.error = error?.message || String(error);
    throw error;
  }
}

async function removeSession(id, logout = false) {
  id = safeId(id);
  const s = sessions.get(id);
  if (s) {
    s.deleted = true;
    clearTimeout(s.reconnectTimer);
  }
  if (s?.sock && logout) {
    try {
      await s.sock.logout();
    } catch {}
  }
  await disconnectSocket(s || {});
  sessions.delete(id);
  await fs.rm(path.join(AUTH_ROOT, id), { recursive: true, force: true });
}

async function restoreSessions() {
  let dirs = [];
  try {
    dirs = await fs.readdir(AUTH_ROOT, { withFileTypes: true });
  } catch {}
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let name = d.name;
    try {
      name =
        JSON.parse(
          await fs.readFile(
            path.join(AUTH_ROOT, d.name, "apois-meta.json"),
            "utf8",
          ),
        ).name || d.name;
    } catch {}
    startSession(d.name, name).catch((err) => {
      const s = sessions.get(d.name);
      if (s) {
        s.status = "error";
        s.error = err?.message || String(err);
        s.updatedAt = Date.now();
      }
    });
  }
}

const app = express();
let server;
async function shutdown() {
  for (const session of sessions.values()) {
    session.deleted = true;
    clearTimeout(session.reconnectTimer);
    await disconnectSocket(session);
  }
  server?.close();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "APOIS WhatsApp Multiconta",
    version: "1.1.0",
    sessions: sessions.size,
  });
});

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const origin = req.get("origin");
  if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
    return res.status(403).json({ ok: false, error: "origem não permitida" });
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.get("host") || ""))
    return res.status(403).json({ ok: false, error: "host não permitido" });
  if (req.get("x-apois-bridge") !== "1")
    return res.status(403).json({ ok: false, error: "forbidden" });
  next();
});

app.get("/sessions", (_req, res) => {
  res.json({ ok: true, sessions: [...sessions.values()].map(publicState) });
});

app.post("/sessions", async (req, res) => {
  try {
    const id = safeId(req.body?.id);
    const name = String(req.body?.name || id).slice(0, 120);
    if (!id)
      return res.status(400).json({ ok: false, error: "id obrigatório" });
    const session = await startSession(id, name);
    res.json({ ok: true, session });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/sessions/:id/start", async (req, res) => {
  try {
    const session = await startSession(
      req.params.id,
      req.body?.name || req.params.id,
    );
    res.json({ ok: true, session });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/sessions/:id", (req, res) => {
  const s = sessions.get(safeId(req.params.id));
  if (!s)
    return res.status(404).json({ ok: false, error: "sessão não encontrada" });
  res.json({ ok: true, session: publicState(s) });
});

app.get("/sessions/:id/chats", (req, res) => {
  const s = sessions.get(safeId(req.params.id));
  if (!s)
    return res.status(404).json({ ok: false, error: "sessão não encontrada" });
  res.json({ ok: true, chats: publicState(s).chats });
});

app.post("/sessions/:id/send-text", async (req, res) => {
  const s = sessions.get(safeId(req.params.id));
  if (!s?.sock || s.status !== "connected")
    return res.status(409).json({ ok: false, error: "sessão não conectada" });
  let jid = String(req.body?.jid || "").trim();
  const text = String(req.body?.text || "");
  if (/^\+?\d+$/.test(jid)) jid = jid.replace(/\D/g, "") + "@s.whatsapp.net";
  jid = jid.replace(/@c\.us$/i, "@s.whatsapp.net");
  if (!jid || !text)
    return res
      .status(400)
      .json({ ok: false, error: "jid e text obrigatórios" });
  try {
    const requestId = String(req.body?.requestId || "");
    if (requestId && !/^[a-zA-Z0-9_-]{1,160}$/.test(requestId))
      return res.status(400).json({ ok: false, error: "requestId inválido" });
    s.sentRequests ||= new Map();
    const signature = JSON.stringify([jid, text]);
    const existing = requestId && s.sentRequests.get(requestId);
    if (existing && existing.signature !== signature)
      return res
        .status(409)
        .json({ ok: false, error: "requestId já usado com outro conteúdo" });
    const promise = existing?.promise || s.sock.sendMessage(jid, { text });
    if (requestId && !existing) {
      s.sentRequests.set(requestId, { signature, promise });
      if (s.sentRequests.size > 300)
        s.sentRequests.delete(s.sentRequests.keys().next().value);
    }
    const sent = await promise;
    res.json({ ok: true, id: sent?.key?.id || "" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/sessions/:id/logout", async (req, res) => {
  try {
    await removeSession(req.params.id, true);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.delete("/sessions/:id", async (req, res) => {
  try {
    await removeSession(req.params.id, false);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

server = app.listen(PORT, HOST, async () => {
  console.log(`[APOIS] Central Multiconta ativa em http://${HOST}:${PORT}`);
  console.log(`[APOIS] Dados locais: ${DATA_ROOT}`);
  await restoreSessions();
});
