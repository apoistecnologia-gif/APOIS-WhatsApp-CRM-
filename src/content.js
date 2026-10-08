(() => {
  if (window.__APOIS_QUICK_REPLIES__) return;
  window.__APOIS_QUICK_REPLIES__ = true;
  const S = window.APOISStorage;
  const Core = window.APOISCore;
  const executionLock = new Core.ExecutionLock();
  const life = new AbortController();
  const cleanupTasks = [];
  const timers = new Map();
  const managedInterval = (fn, ms) => {
    const id = setInterval(fn, ms);
    timers.set(id, "interval");
    return id;
  };
  const managedTimeout = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.set(id, "timeout");
    return id;
  };
  const managedClearTimeout = (id) => {
    clearTimeout(id);
    timers.delete(id);
  };
  const managedClearInterval = (id) => {
    clearInterval(id);
    timers.delete(id);
  };
  const state = {
    data: null,
    panel: null,
    open: true,
    tab: "replies",
    query: "",
    categoryFilter: "",
    typeFilter: "",
    favoritesOnly: false,
    sortMode: "category",
    collapsedCats: new Set(),
    currentName: "",
    slash: null,
    bridgeReady: false,
    nativeSessions: new Map(),
    bridgeState: { ok: false, error: "Carregando modo nativo..." },
    manager: null,
    managerTab: "replies",
    editReplyId: null,
    pendingMediaFile: null,
    pendingBlockFiles: new Map(),
    recorder: null,
    recordStream: null,
    sendProgress: null,
    sendProgressTimer: null,
    transferOpen: false,
    outgoingSeen: new Set(),
    outgoingPrimedFor: "",
    multiSessions: [],
    multiSyncState: "carregando",
    multiRefreshTimer: null,
    multiPublishing: false,
    multiSetupOpen: false,
    multiSetupAccountId: "",
    bridgeOnline: false,
    bridgeSessions: [],
    bridgeQrTimer: null,
    bridgeError: "",
    activeBridgeAccountId: "__all__",
    transferAccountBusy: false,
    referenceReady: false,
    referenceInjecting: null,
    referencePending: new Map(),
    manualSignedSendBusy: false,
    manualBypass: false,
    referenceError: "",
    referenceAdapterAlive: false,
    referenceActiveChatId: "",
    signatureBridgeReady: false,
    signatureBridgeInjecting: null,
    signaturePending: new Map(),
    referenceActiveChat: null,
    referenceSignatureObserver: null,
    referenceSignatureConfiguredAt: 0,
  };
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>'"]/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[m],
    );
  const sleep = (ms) => new Promise((r) => managedTimeout(r, ms));
  const typeIcon = (t) =>
    ({
      text: "💬",
      pix: "◆",
      image: "🖼️",
      video: "🎬",
      document: "📎",
      audio: "🎙️",
      sequence: "▦",
    })[t] || "💬";
  const normalize = (s) =>
    String(s || "")
      .trim()
      .toLocaleLowerCase("pt-BR");
  function currentAccountId() {
    const ids = (state.data?.accounts || []).map((a) => a.id);
    const saved = state.data?.multiconta?.boundAccountId;
    return ids.includes(saved)
      ? saved
      : state.data?.accounts?.[0]?.id ||
          S.DEFAULT_ACCOUNT_ID ||
          "acc_principal";
  }
  async function setCurrentAccountId(id) {
    if (!id || !state.data?.accounts?.some((a) => a.id === id)) return;
    state.data.multiconta = await S.saveMulticonta({
      boundAccountId: id,
      lastPublishedAt: 0,
    });
    state.transferOpen = false;
    state.outgoingPrimedFor = "";
    state.outgoingSeen = new Set();
    await publishMultiPresence(true).catch(() => {});
    syncCurrent(true);
    render();
    decorateList();
    managedTimeout(() => primeOutgoingMessages(), 120);
  }
  function identityKey(name, accountId = currentAccountId()) {
    const id =
      name === currentChatName() && accountId === currentAccountId()
        ? state.currentChatId || ""
        : "";
    if (id) return S.contactKey(name, accountId, id);
    const matches = Object.values(state.data?.contacts || {}).filter(
      (contact) =>
        contact.accountId === accountId && contact.displayName === name,
    );
    return matches.length === 1 ? matches[0].id : S.contactKey(name, accountId);
  }
  function currentAssignment(name = state.currentName || currentChatName()) {
    const key = identityKey(name, currentAccountId());
    return state.data?.assignments?.[key] || null;
  }
  function attendantById(id) {
    return (state.data?.attendants || []).find((a) => a.id === id) || null;
  }
  function accountById(id) {
    return (state.data?.accounts || []).find((a) => a.id === id) || null;
  }
  async function bridgeRequest(path, method = "GET", body) {
    const res = await chrome.runtime.sendMessage({
      type: "MULTI_BRIDGE_FETCH",
      path,
      method,
      body,
    });
    if (!res?.ok) {
      const error =
        res?.data?.error ||
        res?.error ||
        "Central Multiconta local indisponível";
      const e = new Error(error);
      e.bridgeOffline = !!res?.bridgeOffline;
      throw e;
    }
    return res.data;
  }
  async function loadBridgeSessions(renderAfter = true) {
    try {
      const data = await bridgeRequest("/sessions");
      state.bridgeOnline = true;
      state.bridgeError = "";
      state.bridgeSessions = Array.isArray(data.sessions) ? data.sessions : [];
      state.multiSessions = state.bridgeSessions.map((s) => ({
        deviceId: s.id,
        accountId: s.id,
        accountName: s.name,
        phone: s.phone || "",
        online: s.status === "connected",
        status: s.status,
        qrDataUrl: s.qrDataUrl || "",
        updatedAt: s.updatedAt || 0,
        conversations: s.chats || [],
        profileName: "APOIS Multiconta",
      }));

      // Nunca esconder uma sessão que existe na ponte só porque o cadastro local
      // da conta ainda não existe. Isso corrige o caso "2 conectados, só 1 aparece".
      let changed = false;
      const accounts = [...(state.data?.accounts || [])];
      for (const ses of state.bridgeSessions) {
        let idx = accounts.findIndex((a) => a.id === ses.id);
        if (idx < 0 && ses.phone)
          idx = accounts.findIndex(
            (a) =>
              String(a.phone || "").replace(/\D/g, "") ===
              String(ses.phone || "").replace(/\D/g, ""),
          );
        if (idx < 0) {
          accounts.push({
            id: ses.id,
            name:
              ses.name && ses.name !== ses.id
                ? ses.name
                : `WhatsApp ${accounts.length + 1}`,
            phone: ses.phone || "",
            color: ["#E1061B", "#0F172A", "#2563EB", "#16A34A", "#9333EA"][
              accounts.length % 5
            ],
            active: true,
            order: accounts.length,
          });
          changed = true;
        } else {
          const next = { ...accounts[idx] };
          if (ses.phone && !next.phone) {
            next.phone = ses.phone;
            changed = true;
          }
          if (
            (!next.name || /^WhatsApp \d+$/.test(next.name)) &&
            ses.name &&
            ses.name !== ses.id
          ) {
            next.name = ses.name;
            changed = true;
          }
          accounts[idx] = next;
        }
      }
      if (changed) {
        await chrome.storage.local.set({ accounts });
        state.data = await S.getAll();
      }

      const connected = state.bridgeSessions.filter(
        (x) => x.status === "connected",
      );
      if (
        state.activeBridgeAccountId !== "__all__" &&
        !state.bridgeSessions.some((x) => x.id === state.activeBridgeAccountId)
      ) {
        state.activeBridgeAccountId = connected[0]?.id || "__all__";
      }
      state.multiSyncState = "conectado";
      if (
        renderAfter &&
        state.open &&
        (state.tab === "central" || state.multiSetupOpen)
      )
        render();
      return state.bridgeSessions;
    } catch (e) {
      state.bridgeOnline = false;
      state.bridgeError = e.message || String(e);
      state.multiSyncState = "ponte offline";
      state.bridgeSessions = [];
      state.multiSessions = [];
      if (
        renderAfter &&
        state.open &&
        (state.tab === "central" || state.multiSetupOpen)
      )
        render();
      return [];
    }
  }
  function bridgeSession(accountId) {
    return state.bridgeSessions.find((s) => s.id === accountId) || null;
  }
  async function createAccountForNewSession() {
    const d = state.data || (await S.getAll()),
      used = new Set((state.bridgeSessions || []).map((s) => s.id));
    let available = (d.accounts || []).find(
      (a) => a.active !== false && !used.has(a.id),
    );
    if (available) return available;
    let n = Math.max(2, (d.accounts || []).length + 1),
      name = `WhatsApp ${n}`;
    while ((d.accounts || []).some((a) => a.name === name)) {
      n++;
      name = `WhatsApp ${n}`;
    }
    const colors = ["#E1061B", "#2563EB", "#16A34A", "#9333EA", "#EA580C"];
    const rec = await S.saveAccount({
      name,
      phone: "",
      color: colors[(d.accounts || []).length % colors.length],
      active: true,
    });
    state.data = await S.getAll();
    return rec;
  }

  async function startBridgeSession(accountId) {
    const acc = accountById(accountId);
    if (!acc) throw new Error("Conta não encontrada");
    state.multiSetupAccountId = accountId;
    state.multiSetupOpen = true;
    render();
    try {
      await bridgeRequest("/sessions", "POST", {
        id: accountId,
        name: acc.name,
      });
      await loadBridgeSessions(false);
      managedClearInterval(state.bridgeQrTimer);
      state.bridgeQrTimer = managedInterval(async () => {
        await loadBridgeSessions(false);
        const s = bridgeSession(accountId);
        if (state.multiSetupOpen) render();
        if (
          !s ||
          s.status === "connected" ||
          s.status === "logged_out" ||
          s.status === "error"
        ) {
          managedClearInterval(state.bridgeQrTimer);
          state.bridgeQrTimer = null;
        }
      }, 1300);
      render();
    } catch (e) {
      state.bridgeOnline = false;
      state.bridgeError = e.message || String(e);
      render();
    }
  }
  async function removeBridgeSession(accountId) {
    try {
      await bridgeRequest(
        "/sessions/" + encodeURIComponent(accountId),
        "DELETE",
      );
    } catch {}
    await loadBridgeSessions(false);
    render();
  }

  const MULTI_CONFIG_KEY = "apois_multi_config_v1";
  const MULTI_PRESENCE_PREFIX = "apois_multi_presence_v1_";
  const MULTI_COMMAND_PREFIX = "apois_multi_cmd_v1_";
  const safeKey = (s) =>
    String(s || "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80);
  const multiWorkspace = () =>
    safeKey(state.data?.multiconta?.workspaceId || "apois-central");
  const multiDevice = () =>
    safeKey(state.data?.multiconta?.deviceId || "device");
  const presenceKey = () =>
    `${MULTI_PRESENCE_PREFIX}${multiWorkspace()}_${multiDevice()}`;
  const commandPrefixForMe = () =>
    `${MULTI_COMMAND_PREFIX}${multiWorkspace()}_${multiDevice()}_`;

  function collectRecentChats(limit = 12) {
    const pane = document.querySelector("#pane-side");
    if (!pane) return [];
    let rows = [...pane.querySelectorAll('[role="listitem"]')];
    if (!rows.length)
      rows = [
        ...pane.querySelectorAll(
          '[data-testid="cell-frame-container"],div[tabindex="-1"]',
        ),
      ];
    const out = [],
      seen = new Set();
    for (const row of rows) {
      const title = [...row.querySelectorAll("span[title]")]
        .map((x) => (x.getAttribute("title") || "").trim())
        .find(Boolean);
      if (!title || seen.has(title) || title === "WhatsApp") continue;
      seen.add(title);
      const lines = (row.innerText || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      const preview = (
        lines.find(
          (x) =>
            x !== title &&
            !/^\d{1,2}:\d{2}$/.test(x) &&
            !/^(ontem|hoje|domingo|segunda|terça|quarta|quinta|sexta|sábado)/i.test(
              x,
            ),
        ) || ""
      ).slice(0, 140);
      let unread = 0;
      const badge = [...row.querySelectorAll("[aria-label]")].find((el) =>
        /não lida|unread|mensagem/i.test(el.getAttribute("aria-label") || ""),
      );
      if (badge) {
        const m = (badge.getAttribute("aria-label") || "").match(/\d+/);
        if (m) unread = Number(m[0]) || 0;
      }
      out.push({ name: title, preview, unread });
      if (out.length >= limit) break;
    }
    return out;
  }

  async function publishMultiConfig() {
    try {
      const stamp = Date.now();
      const cfg = {
        version: 1,
        workspaceId: state.data.multiconta.workspaceId || "apois-central",
        updatedAt: stamp,
        accounts: (state.data.accounts || []).map(
          ({ id, name, phone, color, active, order }) => ({
            id,
            name,
            phone,
            color,
            active,
            order,
          }),
        ),
        attendants: (state.data.attendants || []).map(
          ({ id, name, active, order }) => ({ id, name, active, order }),
        ),
      };
      await chrome.storage.sync.set({ [MULTI_CONFIG_KEY]: cfg });
      state.data.multiconta = await S.saveMulticonta({
        configUpdatedAt: stamp,
      });
      state.multiSyncState = "sincronizado";
      return cfg;
    } catch (e) {
      state.multiSyncState = "indisponível";
      console.warn("[APOIS multiconta config]", e);
      return null;
    }
  }

  async function pullMultiConfig() {
    try {
      const got = await chrome.storage.sync.get(MULTI_CONFIG_KEY),
        cfg = got[MULTI_CONFIG_KEY];
      if (
        !cfg ||
        cfg.workspaceId !==
          (state.data.multiconta.workspaceId || "apois-central")
      )
        return false;
      if (
        Number(cfg.updatedAt || 0) <=
        Number(state.data.multiconta.configUpdatedAt || 0)
      )
        return false;
      const patch = {};
      if (Array.isArray(cfg.accounts) && cfg.accounts.length)
        patch.accounts = cfg.accounts;
      if (Array.isArray(cfg.attendants) && cfg.attendants.length)
        patch.attendants = cfg.attendants;
      if (Object.keys(patch).length) await chrome.storage.local.set(patch);
      state.data = await S.getAll();
      state.data.multiconta = await S.saveMulticonta({
        configUpdatedAt: Number(cfg.updatedAt) || Date.now(),
      });
      state.multiSyncState = "sincronizado";
      return true;
    } catch (e) {
      state.multiSyncState = "indisponível";
      return false;
    }
  }

  async function publishMultiPresence(force = false) {
    if (state.multiPublishing || !state.data?.multiconta?.enabled) return;
    const last = Number(state.data.multiconta.lastPublishedAt || 0);
    if (!force && Date.now() - last < 7000) return;
    state.multiPublishing = true;
    try {
      const account = accountById(currentAccountId());
      const payload = {
        version: 1,
        workspaceId: state.data.multiconta.workspaceId || "apois-central",
        deviceId: state.data.multiconta.deviceId,
        profileName: state.data.multiconta.profileName || "Este navegador",
        accountId: currentAccountId(),
        accountName: account?.name || "WhatsApp",
        phone: account?.phone || "",
        color: account?.color || "#E1061B",
        currentChat: state.currentName || currentChatName() || "",
        conversations: collectRecentChats(10),
        updatedAt: Date.now(),
      };
      const json = JSON.stringify(payload);
      if (json.length > 7600)
        payload.conversations = (payload.conversations || []).slice(0, 5);
      await chrome.storage.sync.set({ [presenceKey()]: payload });
      state.data.multiconta = {
        ...state.data.multiconta,
        lastPublishedAt: Date.now(),
      };
      await chrome.storage.local.set({ multiconta: state.data.multiconta });
      state.multiSyncState = "sincronizado";
    } catch (e) {
      state.multiSyncState = "indisponível";
      console.warn("[APOIS multiconta presence]", e);
    } finally {
      state.multiPublishing = false;
    }
  }

  async function loadMultiSessions() {
    return loadBridgeSessions(false);
  }

  async function sendMultiCommand(deviceId, command) {
    const key = `${MULTI_COMMAND_PREFIX}${multiWorkspace()}_${safeKey(deviceId)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await chrome.storage.sync.set({
      [key]: {
        ...command,
        id: key,
        createdAt: Date.now(),
        fromDeviceId: state.data.multiconta.deviceId,
      },
    });
    return key;
  }

  function findConversationRow(name) {
    const pane = document.querySelector("#pane-side");
    if (!pane) return null;
    const titles = [...pane.querySelectorAll("span[title]")];
    const exact = titles.find(
      (x) => (x.getAttribute("title") || "").trim() === name,
    );
    return (
      exact?.closest(
        '[role="listitem"],[data-testid="cell-frame-container"],div[tabindex="-1"]',
      ) ||
      exact?.parentElement ||
      null
    );
  }

  async function processMultiCommand(cmd, key) {
    try {
      if (cmd?.type === "FOCUS_SESSION") {
        await chrome.runtime
          .sendMessage({ type: "FOCUS_WHATSAPP_TAB" })
          .catch(() => {});
      } else if (cmd?.type === "FOCUS_CHAT" && cmd.chatName) {
        await chrome.runtime
          .sendMessage({ type: "FOCUS_WHATSAPP_TAB" })
          .catch(() => {});
        const row = findConversationRow(cmd.chatName);
        if (row) {
          row.click();
          toast(`Abrindo ${cmd.chatName}`);
        } else
          toast(`Conversa "${cmd.chatName}" não está visível nesta sessão`);
      }
    } finally {
      chrome.storage.sync.remove(key).catch(() => {});
    }
  }

  async function processExistingCommands() {
    try {
      const all = await chrome.storage.sync.get(null),
        prefix = commandPrefixForMe();
      for (const [k, v] of Object.entries(all))
        if (k.startsWith(prefix)) await processMultiCommand(v, k);
    } catch {}
  }

  function formatLastSeen(ts) {
    const diff = Math.max(0, Date.now() - Number(ts || 0));
    if (diff < 60000) return "agora";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} h`;
    return new Date(ts).toLocaleDateString("pt-BR");
  }

  function multiSetupModalHtml() {
    if (!state.multiSetupOpen) return "";
    const d = state.data,
      acc =
        accountById(state.multiSetupAccountId) ||
        d.accounts?.find((a) => a.active !== false),
      ses = bridgeSession(acc?.id || "");
    const status = ses?.status || "";
    const connected = status === "connected";
    const waiting =
      status === "qr" || status === "starting" || status === "reconnecting";

    return `<div class="multi-setup-overlay" data-close-multi-setup>
      <div class="multi-setup-modal qr-real-modal" onclick="event.stopPropagation()">
        <button class="multi-setup-close" data-close-multi-setup aria-label="Fechar">×</button>
        <div class="multi-setup-icon">▦</div>
        <span class="multi-setup-kicker">WhatsApp Multiconta</span>
        <h2>${esc(acc?.name || "Novo WhatsApp")}</h2>

        ${
          !state.bridgeOnline
            ? `
          <div class="bridge-offline-card">
            <b>Ative a Central Multiconta local</b>
            <p>Para gerar QR Codes independentes e manter seus 3 números conectados ao mesmo tempo, o APOIS usa uma ponte local no seu computador.</p>
            <ol>
              <li>Feche esta janela.</li>
              <li>Na pasta da extensão, execute <code>INSTALAR-APOIS-MULTICONTA.bat</code>.</li>
              <li>Quando aparecer <b>[OK] Central Multiconta instalada</b>, volte aqui.</li>
            </ol>
            <button class="primary" data-action="bridge-retry">Verificar novamente</button>
            <small>${esc(state.bridgeError || "A ponte local não respondeu em 127.0.0.1:3210.")}</small>
          </div>
        `
            : connected
              ? `
          <div class="qr-connected">
            <div class="qr-success">✓</div>
            <b>${esc(acc?.name || "WhatsApp")} conectado</b>
            <span>${esc(ses?.phone ? "+" + ses.phone : "Sessão vinculada com sucesso")}</span>
            <button data-action="bridge-disconnect" data-account="${esc(acc?.id || "")}">Desconectar este número</button>
          </div>
        `
              : `
          <p class="multi-setup-lead">Escaneie este QR com o celular de <b>${esc(acc?.name || "este número")}</b>. Esse QR é uma sessão própria da Central APOIS e não depende do WhatsApp Web que já está aberto nesta aba.</p>
          <div class="real-qr-wrap ${ses?.qrDataUrl ? "ready" : "loading"}">
            ${ses?.qrDataUrl ? `<img src="${ses.qrDataUrl}" alt="QR Code WhatsApp">` : `<div class="qr-loader"><i></i><b>${waiting ? "Gerando QR Code..." : "Preparando sessão..."}</b><span>Aguarde alguns segundos.</span></div>`}
          </div>
          <div class="qr-phone-steps">
            <b>No celular correspondente:</b>
            <span>WhatsApp → Dispositivos conectados → Conectar um dispositivo → escaneie o QR acima.</span>
          </div>
          ${ses?.error ? `<div class="qr-error">${esc(ses.error)}</div>` : ""}
          <div class="multi-setup-actions">
            <button class="primary" data-action="bridge-start" data-account="${esc(acc?.id || "")}">${ses?.qrDataUrl ? "Gerar outro QR" : "Gerar QR Code"}</button>
            <button data-close-multi-setup>Fechar</button>
          </div>
        `
        }
        <p class="multi-setup-security">Cada número fica com credenciais separadas e criptografadas localmente no seu PC. O APOIS não reutiliza os cookies desta aba do WhatsApp Web.</p>
      </div>
    </div>`;
  }

  function centralMultiHtml() {
    const d = state.data,
      sessions = state.bridgeSessions || [];
    const accountsById = new Map((d.accounts || []).map((a) => [a.id, a]));
    const visibleSessions =
      state.activeBridgeAccountId === "__all__"
        ? sessions
        : sessions.filter((s) => s.id === state.activeBridgeAccountId);
    const registeredIds = new Set((d.accounts || []).map((a) => a.id));
    const cards = [
      ...(d.accounts || [])
        .filter((a) => a.active !== false)
        .map((a) => ({
          account: a,
          session: sessions.find((s) => s.id === a.id) || null,
        })),
      ...sessions
        .filter((s) => !registeredIds.has(s.id))
        .map((s) => ({
          account: {
            id: s.id,
            name: s.name || "WhatsApp",
            phone: s.phone || "",
            color: "#2563EB",
            active: true,
          },
          session: s,
        })),
    ].filter(
      (x) =>
        state.activeBridgeAccountId === "__all__" ||
        x.account.id === state.activeBridgeAccountId,
    );

    return `<div class="multi-central">
      <div class="multi-hero">
        <div><span>Central Multiconta</span><h3>${state.activeBridgeAccountId === "__all__" ? "Todas as contas" : esc(connectedSessionAccount(bridgeSession(state.activeBridgeAccountId) || {}).name || "Conta")}</h3><p>${sessions.filter((s) => s.status === "connected").length} número(s) conectado(s) pela Central APOIS. Use o seletor acima para trocar rapidamente de conta.</p></div>
        <div class="multi-sync ${state.bridgeOnline ? "ok" : "warn"}"><i></i>${state.bridgeOnline ? "Ponte ativa" : "Ponte offline"}</div>
      </div>
      <div class="multi-actions">
        <button class="primary" data-action="multi-add">＋ Conectar novo WhatsApp</button>
        <button data-action="multi-refresh">↻ Atualizar</button>
        <button data-action="manage-multiconta">⚙ Contas</button>
      </div>
      ${!state.bridgeOnline ? `<div class="central-bridge-warning"><b>Central local não iniciada</b><span>Execute <code>INSTALAR-APOIS-MULTICONTA.bat</code> e clique em Atualizar.</span></div>` : ""}
      <div class="multi-account-grid">${
        cards
          .map(({ account: acc, session: ses }) => {
            const connected = ses?.status === "connected",
              hasQr = !!ses?.qrDataUrl;
            const label = connected
              ? "Conectado"
              : hasQr
                ? "Aguardando QR"
                : ses?.status === "reconnecting"
                  ? "Reconectando"
                  : "Desconectado";
            return `<article class="multi-account ${connected ? "online" : "offline"} ${state.activeBridgeAccountId === acc.id ? "selected" : ""}" style="--account:${esc(acc.color || "#E1061B")}">
          <div class="multi-account-top"><span class="multi-account-dot"></span><div><b>${esc(acc.name)}</b><small>${esc((ses?.phone ? "+" + ses.phone : acc.phone) || "Número ainda não vinculado")}</small></div><em>${esc(label)}</em></div>
          <div class="multi-session-meta">${ses ? `<span>${connected ? "Sessão independente ativa" : "Sessão criada"}</span><span>${ses.chats?.length ? `${ses.chats.length} conversa(s) recente(s)` : "Aguardando conversas"}</span><small>Atualizado ${esc(formatLastSeen(ses.updatedAt))}</small>` : "<span>Nenhuma sessão criada</span><small>Clique abaixo para gerar um QR exclusivo.</small>"}</div>
          <div class="multi-account-buttons"><button data-connect-account="${esc(acc.id)}">${connected ? "Detalhes da conta" : hasQr ? "Mostrar QR" : "Conectar via QR"}</button></div>
          ${
            connected && ses?.chats?.length
              ? `<div class="multi-conversations">${ses.chats
                  .slice(0, 8)
                  .map(
                    (cv) =>
                      `<button class="bridge-chat-row" disabled><span><b>${esc(cv.name || cv.jid || "Conversa")}</b><small>${esc(cv.preview || "")}</small></span>${cv.unread ? `<i>${cv.unread}</i>` : ""}</button>`,
                  )
                  .join("")}</div>`
              : ""
          }
        </article>`;
          })
          .join("") ||
        '<div class="manager-empty">Nenhuma conta corresponde ao filtro atual.</div>'
      }</div>
      ${state.activeBridgeAccountId === "__all__" ? `<div class="multi-how"><b>Contas detectadas</b><p>A Central agora mostra também sessões encontradas na ponte mesmo quando o cadastro local da conta ainda não existia. Ao conectar um novo número, o APOIS cria uma conta independente automaticamente.</p></div>` : ""}
      ${multiSetupModalHtml()}
    </div>`;
  }

  function applyWhatsAppLayout() {
    const desiredWidth = state.manager
      ? 520
      : Number(state.data?.settings?.panelWidth) || 410;
    const w = Math.min(desiredWidth, Math.floor(window.innerWidth * 0.45));
    document.documentElement.style.setProperty(
      "--apois-reserved-width",
      `${w}px`,
    );
    document.body.classList.toggle(
      "apois-panel-open",
      !!(state.open || state.manager),
    );
    state.panel?.style.setProperty("--apois-width", `${w}px`);
  }
  window.addEventListener("resize", applyWhatsAppLayout, {
    signal: life.signal,
  });

  // Motor nativo APOIS:
  // não injeta WA-JS nem depende das APIs internas do WhatsApp.
  // Para áudio, entrega o arquivo salvo como um MediaStream temporário ao
  // gravador oficial do próprio WhatsApp e, no final, clica em enviar.
  let pageBridgePromise = null;
  function injectPageScript(src) {
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = src;
      sc.async = false;
      sc.dataset.apoisInjected = "1";
      sc.onload = () => {
        sc.remove();
        resolve();
      };
      sc.onerror = () => {
        sc.remove();
        reject(new Error("Falha ao carregar o modo nativo APOIS"));
      };
      (document.head || document.documentElement).appendChild(sc);
    });
  }

  function normalizeReferenceActiveChat(model) {
    if (!model) return null;

    let rawId = model.id;
    let serialized = "";

    if (typeof rawId === "string") serialized = rawId;
    else if (rawId?._serialized) serialized = String(rawId._serialized);
    else if (rawId?.serialized) serialized = String(rawId.serialized);
    else if (rawId?.user) {
      serialized = `${rawId.user}@${String(rawId.server || "c.us").replace(/^@/, "")}`;
    }

    // Some serialized event payloads can expose __x_id instead.
    if (!serialized) {
      const x = model.__x_id;
      if (typeof x === "string") serialized = x;
      else if (x?._serialized) serialized = String(x._serialized);
      else if (x?.user)
        serialized = `${x.user}@${String(x.server || "c.us").replace(/^@/, "")}`;
    }

    if (!serialized) return null;
    const [user, server = "c.us"] = serialized.split("@");

    return {
      ...model,
      id: {
        server: `@${server}`,
        user,
        _serialized: serialized,
      },
    };
  }

  function extractReferenceChatId(model) {
    return normalizeReferenceActiveChat(model)?.id?._serialized || "";
  }

  function updateReferenceReady() {
    state.referenceReady = !!(
      state.referenceAdapterAlive &&
      state.referenceWebpackReady &&
      state.referenceActiveChatId
    );
  }

  function ensureReferenceListener() {
    if (
      document.documentElement.dataset.apoisReferenceListener === "apois-v320"
    )
      return;
    document.documentElement.dataset.apoisReferenceListener = "apois-v320";

    window.addEventListener("message", (e) => {
      if (e.source !== window || e.data?.type !== "WPP" || !e.data?.id) return;
      state.referenceAdapterAlive = true;
      const p = state.referencePending.get(e.data.id);
      if (!p) {
        updateReferenceReady();
        return;
      }
      state.referencePending.delete(e.data.id);
      managedClearTimeout(p.timer);
      if (e.data.error) {
        p.reject(new Error(e.data.error));
        return;
      }
      try {
        p.resolve(JSON.parse(e.data.response));
      } catch {
        p.resolve(e.data.response);
      }
      updateReferenceReady();
    });

    window.addEventListener("message", (e) => {
      if (e.source !== window || e.data?.type !== "Ev") return;
      state.referenceAdapterAlive = true;

      if (e.data.action === "chat.active_chat") {
        try {
          const model =
            typeof e.data.model === "string"
              ? JSON.parse(e.data.model)
              : e.data.model;
          const active = normalizeReferenceActiveChat(model);
          if (active) {
            state.referenceActiveChat = active;
            state.referenceActiveChatId = active.id._serialized;
            state.currentChatId = active.id._serialized;
            void syncCurrent(true);
          }
        } catch (err) {
          console.warn("[APOIS referência] active_chat inválido", err);
        }

        updateReferenceReady();
        configReferenceSignature();
        if (state.panel) render();
      }

      if (e.data.action === "webpack.full_ready") {
        void ensureReferenceAdapter().catch((error) => {
          state.referenceError = error.message;
        });
        updateReferenceReady();
        if (state.panel) render();
      }
    });
  }

  function referenceCall(type, action, dados, timeout = 20000) {
    ensureReferenceListener();
    const id = `apois_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = managedTimeout(() => {
        state.referencePending.delete(id);
        reject(new Error(`Tempo esgotado em ${type}.${action}`));
      }, timeout);
      state.referencePending.set(id, { resolve, reject, timer });
      window.postMessage(
        { type, action, dados, id, model: "APOIS_WPP" },
        location.origin,
      );
    });
  }

  async function waitReferenceApp(timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const app = document.querySelector("#app .app-wrapper-web,#app");
      if (app) return app;
      await sleep(150);
    }
    throw new Error("WhatsApp Web ainda não terminou de abrir");
  }

  async function ensureReferenceAdapter() {
    if (state.referenceReady) return true;
    if (state.referenceInjecting) return state.referenceInjecting;

    state.referenceInjecting = (async () => {
      ensureReferenceListener();
      await waitReferenceApp();

      // MAIN-world scripts are loaded by the MV3 manifest, before this script.
      // The original adapter answers WPP RPC calls as soon as its dispatcher is alive.
      // A responding dispatcher does not mean WhatsApp modules are ready.
      let lastError = "";
      for (let i = 0; i < 100; i++) {
        try {
          const ready = await referenceCall(
            "Webpack",
            "isFullReady",
            null,
            1800,
          );
          state.referenceWebpackReady = ready === true;
          if (!state.referenceWebpackReady) {
            lastError = "A biblioteca respondeu, mas ainda não está pronta.";
            await sleep(300);
            continue;
          }
          state.referenceAdapterAlive = true;

          // If the chat was already open before the listener attached, hydrate once.
          try {
            const id = await referenceCall("Chat", "getActiveChat", "@", 1800);
            if (id && id !== "undefined") {
              state.referenceActiveChatId = String(id);
              state.currentChatId = String(id);
              void syncCurrent(true);
              state.referenceActiveChat = {
                id: {
                  server: `@${String(id).split("@")[1] || "c.us"}`,
                  user: String(id).split("@")[0],
                  _serialized: String(id),
                },
              };
            }
          } catch {}

          updateReferenceReady();
          return true;
        } catch (e) {
          lastError = e.message || String(e);
          await sleep(220);
        }
      }
      throw new Error(
        "A camada WhatsApp da referência não respondeu" +
          (lastError ? `: ${lastError}` : ""),
      );
    })();

    try {
      return await state.referenceInjecting;
    } finally {
      state.referenceInjecting = null;
    }
  }

  async function referenceActiveChatId() {
    await ensureReferenceAdapter();
    const id = await referenceCall("Chat", "getActiveChat", "@", 4000);
    if (!id || id === "undefined")
      throw new Error("Nenhuma conversa ativa na API interna");
    state.referenceActiveChatId = String(id);
    state.currentChatId = String(id);
    updateReferenceReady();
    return String(id);
  }

  async function ensureNativeBridge() {
    state.bridgeState = {
      ok: false,
      error: "Aguardando MAIN world",
      state: { mode: "native" },
    };
    const id = "native_boot_" + Date.now(),
      pending = waitNative(id, "NATIVE_STATUS", 5000);
    window.postMessage(
      { source: "APOIS_CONTENT_NATIVE", type: "NATIVE_PING", id },
      location.origin,
    );
    const status = await pending;
    clearNativeSession(id);
    return !!status.ok;
  }

  function getNativeSession(id) {
    let s = state.nativeSessions.get(id);
    if (!s) {
      s = { events: new Map(), waiters: new Map(), error: null };
      state.nativeSessions.set(id, s);
    }
    return s;
  }
  function emitNativeEvent(msg) {
    const id = msg.id || "global",
      s = getNativeSession(id);
    if (msg.type === "NATIVE_AUDIO_ERROR") {
      s.error = new Error(msg.error || "Falha no áudio nativo");
      for (const list of s.waiters.values())
        for (const w of list) w.reject(s.error);
      s.waiters.clear();
      return;
    }
    const list = s.waiters.get(msg.type);
    if (list?.length) {
      s.waiters.delete(msg.type);
      for (const w of list) w.resolve(msg);
    } else s.events.set(msg.type, msg);
  }
  function waitNative(id, type, timeout = 10000) {
    const s = getNativeSession(id);
    if (s.error) return Promise.reject(s.error);
    if (s.events.has(type)) {
      const m = s.events.get(type);
      s.events.delete(type);
      return Promise.resolve(m);
    }
    return new Promise((resolve, reject) => {
      const t = managedTimeout(() => {
        const list = s.waiters.get(type) || [];
        s.waiters.set(
          type,
          list.filter((x) => x.resolve !== resolve),
        );
        reject(new Error(`Tempo esgotado aguardando ${type}`));
      }, timeout);
      const item = {
        resolve: (m) => {
          managedClearTimeout(t);
          resolve(m);
        },
        reject: (e) => {
          managedClearTimeout(t);
          reject(e);
        },
      };
      const list = s.waiters.get(type) || [];
      list.push(item);
      s.waiters.set(type, list);
    });
  }
  function clearNativeSession(id) {
    state.nativeSessions.delete(id);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "APOIS_NATIVE") return;
    if (e.data.type === "NATIVE_BRIDGE_READY") {
      state.bridgeState = { ok: true, error: "", state: { mode: "native" } };
      if (state.panel) render();
      return;
    }
    if (e.data.type === "NATIVE_STATUS") {
      state.bridgeState = {
        ok: !!e.data.ok,
        error: e.data.error || "",
        state: { mode: "native", ...e.data },
      };
      const s = getNativeSession(e.data.id || "global");
      const list = s.waiters.get("NATIVE_STATUS");
      if (list?.length) {
        s.waiters.delete("NATIVE_STATUS");
        for (const w of list) w.resolve(e.data);
      } else s.events.set("NATIVE_STATUS", e.data);
      return;
    }
    if (e.data.type?.startsWith("NATIVE_")) emitNativeEvent(e.data);
  });

  window.addEventListener(
    "unload",
    () => {
      life.abort();
      for (const [id, kind] of timers)
        kind === "interval" ? clearInterval(id) : clearTimeout(id);
      timers.clear();
      for (const cleanup of cleanupTasks)
        try {
          cleanup();
        } catch {}
      for (const pending of state.referencePending.values()) {
        managedClearTimeout(pending.timer);
        pending.reject(new Error("Página encerrada"));
      }
      state.referencePending.clear();
      state.referenceSignatureObserver?.disconnect();
      state.recordStream?.getTracks?.().forEach((track) => track.stop());
    },
    { once: true },
  );
  async function copyDiagnostics() {
    state.attendantAssigned = !!assignedAttendantForCurrent();
    const report = JSON.stringify(
      await window.APOISDiagnostics.report(state),
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(report);
      toast("Relatório de diagnóstico copiado");
    } catch {
      const blob = new Blob([report], { type: "application/json" }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "apois-diagnostico.json";
      a.click();
      managedTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Diagnóstico baixado");
    }
  }
  function openKanban() {
    openManager("settings");
    const host =
      state.manager.querySelector(".simple-manager") || state.manager;
    const contacts = Object.values(state.data.contacts).filter(
      (contact) => contact.accountId === currentAccountId(),
    );
    host.innerHTML = `<h2>Funil de atendimento</h2><p>Mova cada conversa para uma etapa. As alterações são salvas neste navegador.</p><div class="apois-kanban">${state.data.stages
      .map(
        (stage) =>
          `<section><h3>${esc(stage.name)}</h3>${contacts
            .filter((contact) => contact.stageId === stage.id)
            .map(
              (contact) =>
                `<article><b>${esc(contact.displayName || contact.name || contact.id)}</b><select data-kanban-contact="${esc(contact.id)}">${state.data.stages.map((option) => `<option value="${esc(option.id)}" ${option.id === contact.stageId ? "selected" : ""}>${esc(option.name)}</option>`).join("")}</select></article>`,
            )
            .join("")}</section>`,
      )
      .join("")}</div>`;
    host.querySelectorAll("[data-kanban-contact]").forEach(
      (select) =>
        (select.onchange = async () => {
          const contact = state.data.contacts[select.dataset.kanbanContact];
          await S.setContactStage(
            contact.displayName,
            currentAccountId(),
            select.value,
            contact.chatId || "",
          );
          state.data = await S.getAll();
          render();
          openKanban();
        }),
    );
  }
  async function init() {
    state.data = await S.getAll();
    state.typeFilter = "";
    state.categoryFilter = "";
    state.favoritesOnly = false;
    state.sortMode = "category";
    state.open = state.data.settings.panelOpen !== false;
    await pullMultiConfig().catch(() => {});
    mount();
    observe();

    // Injeta exatamente a camada WhatsApp usada pela referência.
    // O envio normal do WhatsApp continua disponível até a camada responder.
    ensureReferenceAdapter()
      .then(() => {
        state.referenceError = "";
        configReferenceSignature();
        if (state.panel) render();
      })
      .catch((e) => {
        state.referenceAdapterAlive = false;
        state.referenceReady = false;
        state.referenceError = e.message || String(e);
        console.warn("[APOIS referência] adaptador indisponível", e);
        if (state.panel) render();
      });

    managedInterval(() => {
      if (!state.referenceReady && !state.referenceInjecting)
        void ensureReferenceAdapter().catch((error) => {
          state.referenceError = error.message;
        });
    }, 5000);
    ensureNativeBridge().catch((e) => {
      state.bridgeState = { ok: false, error: e.message || String(e) };
      console.error("[APOIS native bridge]", e);
    });
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area === "sync") {
        const prefix = commandPrefixForMe();
        for (const [k, ch] of Object.entries(changes || {}))
          if (k.startsWith(prefix) && ch.newValue)
            processMultiCommand(ch.newValue, k);
        if (changes[MULTI_CONFIG_KEY]) await pullMultiConfig().catch(() => {});
        if (
          Object.keys(changes || {}).some((k) =>
            k.startsWith(`${MULTI_PRESENCE_PREFIX}${multiWorkspace()}_`),
          )
        )
          loadMultiSessions();
        return;
      }
      if (area === "local") {
        state.data = await S.getAll();
        render();
        decorateList();
      }
    });
    await loadBridgeSessions(false);
    state.multiRefreshTimer = managedInterval(
      () => loadBridgeSessions(false),
      5000,
    );
  }
  function currentChatName() {
    const selectors = [
      "#main header span[title]",
      '#main header [dir="auto"][title]',
      '#main header span[dir="auto"]',
    ];
    for (const sel of selectors) {
      const els = [...document.querySelectorAll(sel)];
      for (const el of els) {
        const t = (el.getAttribute("title") || el.textContent || "").trim();
        if (t && t !== "WhatsApp") return t;
      }
    }
    return "";
  }
  async function syncCurrent(force = false) {
    const name = currentChatName();
    if (!name) {
      if (state.currentName) {
        state.currentName = "";
        state.currentChatId = "";
        state.referenceActiveChatId = "";
        state.referenceActiveChat = null;
        updateReferenceReady();
        render();
      }
      return;
    }
    if (!force && name === state.currentName) return;
    const generation = (state.chatSyncSequence || 0) + 1;
    state.chatSyncSequence = generation;
    state.currentName = name;
    state.currentChatId = "";
    let id = "";
    if (state.referenceAdapterAlive) {
      try {
        id = (await referenceCall("Chat", "getActiveChat", "@", 1500)) || "";
      } catch {}
    }
    if (generation !== state.chatSyncSequence || name !== currentChatName())
      return;
    state.currentChatId = id;
    state.referenceActiveChatId = id;
    updateReferenceReady();
    state.outgoingPrimedFor = "";
    state.outgoingSeen = new Set();
    await S.ensureContact(name, currentAccountId(), id);
    state.data = await S.getAll();
    if (generation !== state.chatSyncSequence || name !== currentChatName())
      return;
    render();
    decorateList();
    decorateChatHeader();
    publishMultiPresence(true).catch(() => {});
    managedTimeout(() => primeOutgoingMessages(), 120);
  }
  function conversationToken() {
    return `${currentAccountId()}::${state.currentChatId || ""}::${currentChatName()}`;
  }
  function assertConversation(expected) {
    if (!Core.sameConversation(expected, conversationToken()))
      throw new Error("A conversa mudou. O envio foi interrompido.");
  }
  function prependAttendantSignature(input, att) {
    const raw = Core.composerText(input),
      signed = Core.signature(raw, att);
    if (!raw.trim() || signed === raw) return false;
    input.focus();
    const range = document.createRange(),
      selection = window.getSelection();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, signed))
      throw new Error("Não foi possível inserir a identificação.");
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: signed,
      }),
    );
    return true;
  }
  function captureNativeSignature(event) {
    if (state.manualBypass || event.isComposing || event.keyCode === 229)
      return;
    const keyboard = event.type === "keydown";
    if (
      keyboard &&
      (event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey)
    )
      return;
    const composer = getComposer();
    if (keyboard && (!composer || !composer.contains(event.target))) return;
    if (state.slash && keyboard) return;
    if (!keyboard) {
      const button = event.target.closest?.('button,[role="button"]');
      if (
        !button ||
        !button.closest("#main footer") ||
        (!button.querySelector(
          '[data-icon="send"],[data-icon="wds-ic-send-filled"],[data-icon="send-filled"]',
        ) &&
          !/enviar|send/i.test(
            button.getAttribute("aria-label") || button.title || "",
          ))
      )
        return;
    }
    const att = assignedAttendantForCurrent();
    if (!att || !Core.composerText(composer).trim()) return;
    if (event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.manualSignedSendBusy) return;
    state.manualSignedSendBusy = true;
    const before = outgoingIdSet(),
      context = {
        att,
        accountId: currentAccountId(),
        name: currentChatName(),
        token: conversationToken(),
      };
    void sendSignedTextThroughAPI(composer, context, before);
  }
  async function sendSignedTextThroughAPI(composer, context, before) {
    try {
      const raw = Core.composerText(composer);
      const signed = Core.signature(raw, context.att);
      await ensureReferenceAdapter();
      assertConversation(context.token);
      const id = await referenceCall("Chat", "getActiveChat", "@", 1800);
      if (
        !id ||
        getComposer() !== composer ||
        Core.composerText(composer) !== raw
      )
        throw new Error(
          "A conversa ou o rascunho mudou. O envio foi cancelado.",
        );
      const result = await referenceCall("Chat", "sendTxt", {
        id,
        msg: signed,
        clearDraft: true,
      });
      if (!result?.accepted)
        throw new Error(
          "A API não confirmou o envio. Confira a conversa antes de tentar novamente.",
        );
      if (result.clearError)
        toast(
          "Mensagem aceita; o campo não pôde ser limpo. Não reenvie o mesmo texto.",
        );
      // Attribution is bookkeeping, not part of the send lock.
      void attributeNextOutgoing(before, 2500, context).catch((error) =>
        window.APOISDiagnostics.record(error, "atribuição"),
      );
    } catch (error) {
      window.APOISDiagnostics.record(error, "assinatura");
      toast(error.message);
    } finally {
      state.manualSignedSendBusy = false;
    }
  }
  function configReferenceSignature() {
    if (state.signatureHandlersBound) return;
    state.signatureHandlersBound = true;
    window.addEventListener("keydown", captureNativeSignature, {
      capture: true,
      signal: life.signal,
    });
    window.addEventListener("click", captureNativeSignature, {
      capture: true,
      signal: life.signal,
    });
  }

  function bindManualOutgoingCapture() {
    configReferenceSignature();
  }

  function keepWhatsAppFloatingMenusVisible() {
    if (!state.open || !state.panel) return;
    const panel = state.panel.querySelector(".apois-panel");
    if (!panel) return;
    const boundary = panel.getBoundingClientRect().left - 8;

    const menus = [
      ...document.querySelectorAll(
        '[role="menu"],[data-testid*="context-menu"],[data-popper-placement]',
      ),
    ].filter(
      (el) => !el.closest("#apois-root,#apois-manager-root") && visible(el),
    );

    for (const menu of menus) {
      if (menu.dataset.apoisMenuShifted === "1") continue;
      const r = menu.getBoundingClientRect();
      if (r.right > boundary && r.width > 80 && r.height > 60) {
        const shift = Math.ceil(r.right - boundary + 10);
        menu.style.setProperty("translate", `-${shift}px 0`, "important");
        menu.dataset.apoisMenuShifted = "1";
      }
    }
  }

  function observe() {
    let timer = null,
      decorTimer = null;
    bindManualOutgoingCapture();

    const mo = new MutationObserver((mutations) => {
      managedClearTimeout(timer);
      timer = managedTimeout(() => syncCurrent(), 110);

      // Mensagens novas entram em vários nós de uma vez. Fazemos uma passada
      // curta logo depois e outra de segurança, sem depender de classe CSS fixa.
      const mayHaveMessage = mutations.some((m) =>
        [...m.addedNodes].some(
          (n) =>
            n?.nodeType === 1 &&
            (n.matches?.(
              '[data-id],.message-out,[data-testid="msg-container"]',
            ) ||
              n.querySelector?.(
                '[data-id],.message-out,[data-testid="msg-container"]',
              )),
        ),
      );
      keepWhatsAppFloatingMenusVisible();
      if (mayHaveMessage) {
        managedClearTimeout(decorTimer);
        decorTimer = managedTimeout(async () => {
          decorateOutgoingMessages();
        }, 90);
        managedTimeout(() => decorateOutgoingMessages(), 450);
      }
    });

    cleanupTasks.push(() => mo.disconnect());
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: false,
    });
    managedInterval(() => {
      syncCurrent();
      bindSlash();
      decorateList();
      decorateChatHeader();
      decorateOutgoingMessages();
      decorateReferenceAttendanceBadges();
      configReferenceSignature();
      keepWhatsAppFloatingMenusVisible();
    }, 500);
    managedTimeout(() => {
      syncCurrent();
      bindSlash();
      decorateList();
      decorateChatHeader();
      managedTimeout(() => {
        primeOutgoingMessages();
        decorateOutgoingMessages();
      }, 220);
    }, 120);
  }
  function mount() {
    const root = document.createElement("div");
    root.id = "apois-root";
    document.body.appendChild(root);
    state.panel = root;
    render();
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        togglePanel();
      }
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "APOIS_TOGGLE_PANEL") togglePanel();
    });
  }
  function togglePanel() {
    state.open = !state.open;
    state.transferOpen = false;
    S.setKey("settings", { ...state.data.settings, panelOpen: state.open });
    render();
  }
  function render() {
    if (!state.panel || !state.data) return;
    state.panel.style.setProperty(
      "--apois-width",
      (state.data.settings.panelWidth || 410) + "px",
    );
    applyWhatsAppLayout();
    const logo = chrome.runtime.getURL("assets/logo-apois.png");
    state.panel.innerHTML = `${state.open ? workflowHtml() : ""}${state.open ? "" : `<button class="apois-launcher" data-action="toggle" title="Abrir APOIS" aria-label="Abrir APOIS"><img src="${logo}" alt="APOIS"><span>Abrir</span></button>`}${state.open ? panelHtml() : ""}`;
    bindPanel();
  }
  function uiIcon(name) {
    const common =
      'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    const paths = {
      tag: '<path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.82 0l3.36-3.36a2 2 0 0 0 0-2.82Z"/><circle cx="7.5" cy="6.5" r=".7" fill="currentColor" stroke="none"/>',
      bolt: '<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
      edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      users:
        '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      settings:
        '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.09V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.09-.4H2v-4h.51A1.7 1.7 0 0 0 4.2 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.6a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 10 2.91V2h4v.91A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.37.39.72.6 1a1.7 1.7 0 0 0 1.09.4H22v4h-.91A1.7 1.7 0 0 0 19.4 15Z"/>',
      close: '<path d="m18 6-12 12M6 6l12 12"/>',
      chevron: '<path d="m9 18 6-6-6-6"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
      star: '<path d="m12 2.5 2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.32l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94Z"/>',
    };
    return `<svg ${common}>${paths[name] || paths.grid}</svg>`;
  }

  function workflowCounts() {
    const counts = Object.fromEntries(
      state.data.stages.map((stage) => [stage.id, 0]),
    );
    for (const contact of Object.values(state.data.contacts || {}))
      if (contact.accountId === currentAccountId())
        counts[contact.stageId || "new"] =
          (counts[contact.stageId || "new"] || 0) + 1;
    return counts;
  }
  function workflowHtml() {
    const counts = workflowCounts(),
      account = accountById(currentAccountId()),
      logo = chrome.runtime.getURL("assets/logo-apois.png");
    const contact =
      state.data.contacts[identityKey(currentChatName(), currentAccountId())];
    return `<div class="apois-workflow-bar"><div class="workflow-brand"><img src="${logo}" alt=""><div><b>APOIS CRM</b><small>${esc(account?.name || "WhatsApp")}</small></div></div>
      <div class="workflow-stages">${state.data.stages.map((stage) => `<button data-stage="${esc(stage.id)}" class="${contact?.stageId === stage.id ? "active" : ""}" title="Mover conversa atual para ${esc(stage.name)}"><span>${esc(stage.name)}</span><i>${counts[stage.id] || 0}</i></button>`).join("")}</div>
      <div class="workflow-actions"><button data-kanban>${uiIcon("grid")}<span>Funil</span></button><button data-workflow-central>${uiIcon("grid")}<span>Central</span></button><button data-workflow-team>${uiIcon("users")}<span>Atendentes</span></button></div></div>`;
  }

  function connectedSessionAccount(s) {
    return (
      accountById(s.id) || {
        id: s.id,
        name: s.name || "WhatsApp",
        phone: s.phone || "",
        color: "#E1061B",
      }
    );
  }
  function accountSessionStripHtml() {
    const sessions = (state.bridgeSessions || []).filter(
      (s) => s.status === "connected",
    );
    const webLogged = !!document.querySelector("#pane-side");
    return `<div class="account-session-strip">
      <div class="account-session-title"><div><span>CONTAS DE ATENDIMENTO</span><b>${sessions.length}${webLogged ? " + Web" : ""} disponível(is)</b></div><button data-action="multi-add-mini" title="Conectar outro número">${uiIcon("plus")}</button></div>
      <div class="account-session-tabs">
        <button class="${state.activeBridgeAccountId === "__all__" ? "active" : ""}" data-session-account="__all__"><i></i><span>Todas</span></button>
        ${webLogged ? `<button data-web-account class="${state.tab !== "central" ? "active" : ""}"><i></i><span>${esc(accountById(currentAccountId())?.name || "WhatsApp principal")} · Web</span></button>` : ""}
        ${sessions
          .map((s) => {
            const a = connectedSessionAccount(s);
            return `<button class="${state.activeBridgeAccountId === s.id ? "active" : ""}" data-session-account="${esc(s.id)}" style="--acc:${esc(a.color || "#E1061B")}"><i></i><span>${esc(a.name)}</span><small>${esc(s.phone ? ("+" + s.phone).slice(-9) : "online")}</small></button>`;
          })
          .join("")}
      </div>
    </div>`;
  }

  function panelHtml() {
    const d = state.data,
      name =
        state.currentName || currentChatName() || "Nenhuma conversa aberta",
      accountId = currentAccountId(),
      contact = d.contacts[identityKey(name, accountId)] || { labels: [] },
      logo = chrome.runtime.getURL("assets/logo-apois.png");
    const acc = accountById(accountId) || d.accounts?.[0];
    return `<aside class="apois-panel">
      <header class="apois-toolhead">
        <button class="tool-logo" data-action="manage" title="APOIS"><img src="${logo}" alt="APOIS"></button>
        <button class="tool-btn ${state.tab === "labels" ? "active" : ""}" data-tab="labels" title="Etiquetas">${uiIcon("tag")}</button>
        <button class="tool-btn ${state.tab === "replies" ? "active" : ""}" data-tab="replies" title="Respostas rápidas">${uiIcon("bolt")}</button>
        <button class="tool-btn" data-action="manage" title="Criar e gerenciar respostas">${uiIcon("edit")}</button>
        <button class="tool-btn ${state.tab === "central" ? "active" : ""}" data-tab="central" title="Central multiconta">${uiIcon("grid")}</button>
        <button class="tool-btn" data-action="manage-team" title="Atendentes e contas">${uiIcon("users")}</button>
        <button class="tool-btn" data-action="manage-settings" title="Configurações">${uiIcon("settings")}</button>
        <span class="tool-spacer"></span>
        <button class="tool-close" data-action="close" title="Fechar">${uiIcon("close")}</button>
      </header>
      ${accountSessionStripHtml()}
      <div class="apois-context"><div><strong>${esc(name)}</strong><span>${esc(acc?.name || "WhatsApp")} • ${(contact.labels || []).length ? `${contact.labels.length} etiqueta(s)` : "sem etiquetas"}</span></div><button class="bridge-status ${state.bridgeState.ok ? "ok" : "warn"}" data-action="ping" title="${esc(state.bridgeState.ok ? "Modo nativo pronto" : state.bridgeState.error || "Verificar modo nativo")}">${state.bridgeState.ok ? "● Nativo" : "● Verificar"}</button></div>
      <section class="apois-body">${state.tab === "central" ? centralMultiHtml() : state.tab === "labels" ? labelsHtml(contact) : repliesHtml()}</section>
      ${serviceFooterHtml(name, contact)}
    </aside>`;
  }
  function normalizeClientJid(jid) {
    jid = String(jid || "").trim();
    if (!jid) return "";
    if (/^\+?\d+$/.test(jid)) return jid.replace(/\D/g, "") + "@s.whatsapp.net";
    return jid.replace(/@c\.us$/i, "@s.whatsapp.net");
  }
  function currentClientJid() {
    const nodes = [...document.querySelectorAll("#main [data-id]")].reverse();
    for (const node of nodes) {
      const raw = node.getAttribute("data-id") || "";
      const m = raw.match(/([0-9]{5,}@(c\.us|s\.whatsapp\.net|lid))/i);
      if (m) return normalizeClientJid(m[1]);
    }
    const name = state.currentName || currentChatName() || "";
    const digits = name.replace(/\D/g, "");
    if (digits.length >= 10) return digits + "@s.whatsapp.net";
    for (const ses of state.bridgeSessions || []) {
      const hit = (ses.chats || []).find(
        (ch) => normalize(ch.name) === normalize(name),
      );
      if (hit?.jid) return normalizeClientJid(hit.jid);
    }
    return "";
  }
  function formatTransferTemplate(template, ctx) {
    const targetPhone = ctx.targetPhone
      ? ` (${ctx.targetPhone.startsWith("+") ? ctx.targetPhone : "+" + ctx.targetPhone})`
      : "";
    return String(template || "")
      .replace(/{{\s*nome\s*}}/gi, ctx.name || "")
      .replace(/{{\s*conta_origem\s*}}/gi, ctx.sourceName || "")
      .replace(/{{\s*conta_destino\s*}}/gi, ctx.targetName || "outro WhatsApp")
      .replace(/{{\s*telefone_destino\s*}}/gi, targetPhone)
      .replace(
        /{{\s*atendente\s*}}/gi,
        ctx.attendantName ? ` Atendente: ${ctx.attendantName}.` : "",
      );
  }
  async function transferConversationToAccount(targetId) {
    if (state.transferAccountBusy) return;
    const name = state.currentName || currentChatName();
    if (!name || name === "Nenhuma conversa aberta")
      return toast("Abra a conversa que deseja transferir");
    const targetSession = bridgeSession(targetId),
      targetAcc =
        accountById(targetId) ||
        connectedSessionAccount(targetSession || { id: targetId });
    if (!targetSession || targetSession.status !== "connected")
      return toast("A conta de destino precisa estar conectada");
    if (
      targetId === currentAccountId() &&
      targetSession.phone &&
      accountById(currentAccountId())?.phone === targetSession.phone
    )
      return toast("Escolha outro número");

    const transferToken = conversationToken(),
      sourceAccountId = currentAccountId();
    let jid = "";
    try {
      jid = normalizeClientJid(await referenceActiveChatId());
    } catch {
      jid = currentClientJid();
    }
    if (!jid) {
      const entered = prompt(
        "Não consegui identificar automaticamente o número do cliente. Digite com DDD e país (ex.: 5587999999999):",
        "",
      );
      jid = normalizeClientJid(entered);
    }
    if (!jid) return toast("Número do cliente não identificado");

    const sourceAcc = accountById(currentAccountId()) || {
      name: "WhatsApp atual",
    };
    const assignment = currentAssignment(name),
      att = attendantById(assignment?.attendantId || "");
    const ctx = {
      name,
      sourceName: sourceAcc.name,
      targetName: targetAcc?.name || targetSession.name || "outro WhatsApp",
      targetPhone: targetSession.phone || targetAcc?.phone || "",
      attendantName: att?.name || "",
    };
    const welcome = formatTransferTemplate(
      state.data.settings.transferWelcomeTemplate,
      ctx,
    );
    const notice = formatTransferTemplate(
      state.data.settings.transferNoticeTemplate,
      ctx,
    );

    if (
      !confirm(
        `Transferir "${name}" para ${ctx.targetName}${ctx.targetPhone ? " (+" + ctx.targetPhone + ")" : ""}?\n\nO cliente será avisado automaticamente e receberá uma mensagem do número de destino.`,
      )
    )
      return;

    state.transferAccountBusy = true;
    state.transferOpen = false;
    render();
    try {
      toast("Transferindo atendimento...", 6000);

      // 1. O novo número fala com o cliente primeiro. Assim a transferência
      // já existe mesmo que o aviso na conversa atual falhe depois.
      assertConversation(transferToken);
      await bridgeRequest(
        `/sessions/${encodeURIComponent(targetId)}/send-text`,
        "POST",
        { jid, text: welcome, requestId: S.uid("transfer") },
      );

      // 2. A conversa atual avisa explicitamente que houve transferência.
      let noticeError = "";
      try {
        assertConversation(transferToken);
        await sendDirectText(notice);
      } catch (error) {
        noticeError = error.message;
        window.APOISDiagnostics.record(error, "aviso transferência");
      }
      if (noticeError)
        toast(
          "O destino recebeu o cliente, mas o aviso na origem falhou: " +
            noticeError,
          8000,
        );

      // 3. CRM: cria o cliente na conta destino, preserva etiquetas e responsável.
      if (S.transferBetweenAccounts) {
        await S.transferBetweenAccounts(
          name,
          sourceAccountId,
          targetId,
          jid,
          att?.id || "",
          `Transferido para ${ctx.targetName}${noticeError ? " • aviso na origem falhou: " + noticeError : ""}`,
          state.currentChatId || "",
        );
      }
      state.data = await S.getAll();
      state.activeBridgeAccountId = targetId;
      state.tab = "central";
      toast(
        noticeError
          ? `Destino recebeu o atendimento. Aviso na origem pendente: ${noticeError}`
          : `Atendimento transferido para ${ctx.targetName}`,
        noticeError ? 8000 : 2600,
      );
      render();
      decorateChatHeader();
    } catch (e) {
      console.error("[APOIS account transfer]", e);
      toast("Falha ao transferir: " + (e.message || e), 7000);
    } finally {
      state.transferAccountBusy = false;
    }
  }

  function serviceFooterHtml(name, contact) {
    const d = state.data,
      accountId = currentAccountId(),
      assignment = currentAssignment(name),
      assigned = attendantById(
        assignment?.attendantId || contact?.assignedTo || "",
      ),
      canUse = name && name !== "Nenhuma conversa aberta";
    const accountOptions = (d.accounts || [])
      .filter((a) => a.active !== false)
      .map(
        (a) =>
          `<option value="${a.id}" ${a.id === accountId ? "selected" : ""}>${esc(a.name)}${a.phone ? " • " + esc(a.phone) : ""}</option>`,
      )
      .join("");
    const attendants = (d.attendants || []).filter((a) => a.active !== false);
    const attendantOptions =
      `<option value="">Sem responsável</option>` +
      attendants
        .map(
          (a) =>
            `<option value="${a.id}" ${a.id === (assigned?.id || "") ? "selected" : ""}>${esc(a.name)}</option>`,
        )
        .join("");
    const targets = (state.bridgeSessions || []).filter(
      (s) => s.status === "connected" && s.id !== accountId,
    );
    const pop = state.transferOpen
      ? `<div class="transfer-pop transfer-pop-v2">
      <div class="transfer-pop-title"><b>Transferir atendimento</b><span>${esc(name)}</span></div>
      <div class="transfer-section"><em>PARA OUTRO ATENDENTE</em>${attendants.map((a) => `<button data-transfer-to="${a.id}" ${!canUse ? "disabled" : ""}><i>↗</i><strong>${esc(a.name)}</strong>${a.id === assigned?.id ? "<small>atual</small>" : ""}</button>`).join("")}</div>
      <div class="transfer-section account-transfer-section"><em>PARA OUTRO WHATSAPP</em>${
        targets.length
          ? targets
              .map((s) => {
                const a = connectedSessionAccount(s);
                return `<button data-transfer-account="${esc(s.id)}" ${!canUse || state.transferAccountBusy ? "disabled" : ""}><i class="wa-dot" style="background:${esc(a.color || "#E1061B")}"></i><strong>${esc(a.name)}</strong><small>${esc(s.phone ? "+" + s.phone : "online")}</small></button>`;
              })
              .join("")
          : '<div class="transfer-empty">Conecte outro número na Central para transferir entre contas.</div>'
      }</div>
      <div class="transfer-info">Ao transferir para outro WhatsApp, o cliente recebe uma mensagem do novo número e também é avisado nesta conversa.</div>
      <button class="transfer-cancel" data-action="transfer-cancel">Cancelar</button>
    </div>`
      : "";
    return `<footer class="apois-service-footer">
      <label><span>Conta desta conversa</span><select data-current-account>${accountOptions}</select></label>
      <label><span>Atendente</span><select data-current-attendant ${!canUse ? "disabled" : ""}>${attendantOptions}</select></label>
      <button class="transfer-btn" data-action="transfer" ${!canUse ? "disabled" : ""}><span>⇄</span>Transferir</button>
      <div class="attendant-mark-status ${assigned ? "active" : ""}" title="${assigned ? `As mensagens serão assinadas como ${esc(assigned.name)}` : "Selecione um atendente"}"><i></i><span>${assigned ? `Assinatura ativa: ${esc(assigned.name)}` : "Assinatura desativada"}</span></div>
      ${pop}
    </footer>`;
  }
  function repliesHtml() {
    const d = state.data,
      q = normalize(state.query);

    // Interface deliberadamente simples:
    // busca + botão de nova resposta + grupos por categoria.
    // Os antigos chips de tipo/categoria/favoritos foram removidos.
    const items = d.quickReplies
      .filter(
        (r) =>
          !q ||
          normalize(
            [
              r.title,
              r.alias,
              r.text,
              r.caption,
              JSON.stringify(r.blocks || []),
              d.categories.find((c) => c.id === r.categoryId)?.name,
            ].join(" "),
          ).includes(q),
      )
      .sort(
        (a, b) =>
          (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title),
      );

    const groups = d.categories
      .map((cat) => ({
        cat,
        items: items.filter((r) => r.categoryId === cat.id),
      }))
      .filter((g) => g.items.length || !q);

    const uncategorized = items.filter(
      (r) => !d.categories.some((cat) => cat.id === r.categoryId),
    );
    const body =
      groups.map((g) => categoryGroup(g.cat, g.items)).join("") +
      (uncategorized.length
        ? categoryGroup({ id: "__none", name: "SEM CATEGORIA" }, uncategorized)
        : "");

    return `<div class="qr-toolbar clean-toolbar">
      <div class="qr-search">
        <span class="search-glyph">${uiIcon("search")}</span>
        <input id="apoisSearch" placeholder="Pesquisar resposta rápida" value="${esc(state.query)}">
        <button data-action="clear" title="Limpar">×</button>
        <button class="grid-action" data-action="new-reply" title="Nova resposta rápida">${uiIcon("plus")}</button>
      </div>
    </div>
    <div class="qr-groups">${body || '<div class="apois-empty"><b>Nenhuma resposta encontrada</b><span>Tente pesquisar por outro termo.</span></div>'}</div>`;
  }
  function categoryGroup(cat, items) {
    const collapsed = state.collapsedCats.has(cat.id);
    return `<section class="qr-group ${collapsed ? "collapsed" : ""}" data-group="${cat.id}"><button class="group-head" data-toggle-cat="${cat.id}"><span class="group-caret">⌃</span><strong>${esc(String(cat.name || "").toUpperCase())}</strong><em>${items.length}</em></button><div class="group-items">${items.map((r) => replyCard(r)).join("")}</div></section>`;
  }
  function replyCard(r) {
    const cat =
      state.data.categories.find((c) => c.id === r.categoryId)?.name || "";
    let sub = cat;
    if (r.alias) sub += `${sub ? " • " : ""}/${esc(r.alias)}`;
    if (r.type === "audio" && r.voiceMode)
      sub += `${sub ? " • " : ""}nota de voz`;
    return `<div class="qr-card" data-reply-row="${r.id}"><button class="qr-main" data-reply="${r.id}" title="Usar resposta"><span class="qr-icon type-${esc(r.type)}">${typeIcon(r.type)}</span><span class="qr-text"><strong>${r.favorite ? "★ " : ""}${esc(r.title)}</strong><small>${sub}</small></span></button><div class="qr-actions"><button data-fav-reply="${r.id}" title="${r.favorite ? "Remover dos favoritos" : "Favoritar"}" class="${r.favorite ? "is-fav" : ""}">${uiIcon("star")}</button><button data-copy-reply="${r.id}" title="Copiar conteúdo">${uiIcon("copy")}</button><button data-menu-reply="${r.id}" title="Editar"><span class="dots">•••</span></button><button data-reply="${r.id}" title="Enviar">${uiIcon("send")}</button></div></div>`;
  }
  function labelsHtml(contact) {
    return `<div class="labels-title"><div><h3>Etiquetas desta conversa</h3><p>Use cores para localizar rapidamente cada atendimento.</p></div><button data-action="manage-labels">+ Nova</button></div><div class="labels-list">${state.data.labels.map((l) => `<button class="label-choice ${(contact.labels || []).includes(l.id) ? "on" : ""}" data-label="${l.id}"><span class="label-bar" style="background:${esc(l.color)}"></span><span class="label-copy"><strong>${esc(l.name)}</strong><small>${(contact.labels || []).includes(l.id) ? "Aplicada nesta conversa" : "Clique para aplicar"}</small></span><i>${(contact.labels || []).includes(l.id) ? "✓" : "+"}</i></button>`).join("")}</div><button class="full-manage" data-action="manage-labels">Gerenciar etiquetas e respostas</button>`;
  }
  function bindPanel() {
    state.panel
      .querySelector("[data-web-account]")
      ?.addEventListener("click", () => {
        state.tab = "replies";
        render();
      });
    state.panel.querySelectorAll("[data-stage]").forEach(
      (button) =>
        (button.onclick = async () => {
          const name = currentChatName();
          if (!name) return toast("Abra uma conversa primeiro");
          await S.setContactStage(
            name,
            currentAccountId(),
            button.dataset.stage,
            state.currentChatId || "",
          );
          state.data = await S.getAll();
          render();
        }),
    );
    state.panel
      .querySelector("[data-kanban]")
      ?.addEventListener("click", () => openKanban());
    // O botão flutuante existe justamente quando o painel está fechado.
    // Portanto o evento de reabrir precisa ser ligado ANTES do retorno abaixo.
    state.panel
      .querySelectorAll('[data-action="close"],[data-action="toggle"]')
      .forEach((b) => (b.onclick = togglePanel));
    state.panel
      .querySelector("[data-workflow-central]")
      ?.addEventListener("click", () => {
        state.tab = "central";
        render();
      });
    state.panel
      .querySelector("[data-workflow-team]")
      ?.addEventListener("click", () => openManager("team"));
    if (!state.open) return;
    state.panel
      .querySelectorAll('[data-action="manage"]')
      .forEach((b) => (b.onclick = () => openManager("replies")));
    state.panel
      .querySelectorAll('[data-action="manage-categories"]')
      .forEach((b) => (b.onclick = () => openManager("categories")));
    state.panel
      .querySelectorAll('[data-action="manage-settings"]')
      .forEach((b) => (b.onclick = () => openManager("settings")));
    state.panel
      .querySelectorAll('[data-action="manage-team"]')
      .forEach((b) => (b.onclick = () => openManager("team")));
    state.panel
      .querySelectorAll('[data-action="manage-labels"]')
      .forEach((b) => (b.onclick = () => openManager("labels")));
    state.panel
      .querySelectorAll('[data-action="new-reply"]')
      .forEach((b) => (b.onclick = () => openManager("replies", "__new")));
    state.panel
      .querySelectorAll('[data-action="ping"]')
      .forEach((b) => (b.onclick = () => pingBridge(true)));
    state.panel.querySelectorAll("[data-dock]").forEach(
      (b) =>
        (b.onclick = () => {
          state.tab = b.dataset.dock;
          state.open = true;
          render();
        }),
    );
    state.panel
      .querySelector('[data-action="clear"]')
      ?.addEventListener("click", () => {
        state.query = "";
        render();
      });
    state.panel.querySelectorAll("[data-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          state.tab = b.dataset.tab;
          render();
        }),
    );
    const search = state.panel.querySelector("#apoisSearch");
    if (search) {
      search.oninput = (e) => {
        state.query = e.target.value;
        render();
        managedTimeout(() => {
          const n = state.panel.querySelector("#apoisSearch");
          if (n) {
            n.focus();
            n.setSelectionRange(n.value.length, n.value.length);
          }
        }, 0);
      };
    }
    state.panel.querySelectorAll("[data-cat]").forEach(
      (b) =>
        (b.onclick = () => {
          state.categoryFilter = b.dataset.cat || "";
          render();
        }),
    );
    state.panel.querySelectorAll("[data-type]").forEach(
      (b) =>
        (b.onclick = () => {
          state.typeFilter = b.dataset.type || "";
          render();
        }),
    );
    state.panel
      .querySelector("[data-favorites]")
      ?.addEventListener("click", () => {
        state.favoritesOnly = !state.favoritesOnly;
        render();
      });
    state.panel.querySelectorAll("[data-reply]").forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          useReply(b.dataset.reply, b.closest(".qr-card") || b);
        }),
    );
    state.panel.querySelectorAll("[data-toggle-cat]").forEach(
      (b) =>
        (b.onclick = () => {
          const id = b.dataset.toggleCat;
          state.collapsedCats.has(id)
            ? state.collapsedCats.delete(id)
            : state.collapsedCats.add(id);
          render();
        }),
    );
    state.panel.querySelectorAll("[data-sort]").forEach(
      (b) =>
        (b.onclick = () => {
          state.sortMode = b.dataset.sort || "category";
          render();
        }),
    );
    state.panel.querySelectorAll("[data-reset-filters]").forEach(
      (b) =>
        (b.onclick = () => {
          state.typeFilter = "";
          state.categoryFilter = "";
          state.favoritesOnly = false;
          state.sortMode = "category";
          render();
        }),
    );
    state.panel.querySelectorAll("[data-copy-reply]").forEach(
      (b) =>
        (b.onclick = async (e) => {
          e.stopPropagation();
          const r = state.data.quickReplies.find(
            (x) => x.id === b.dataset.copyReply,
          );
          if (!r) return;
          let txt = r.type === "pix" ? buildPix(r) : r.text || r.caption || "";
          txt = S.expand(txt, { name: state.currentName || currentChatName() });
          try {
            await navigator.clipboard.writeText(txt);
            toast("Resposta copiada");
          } catch {
            toast("Não foi possível copiar");
          }
        }),
    );
    state.panel.querySelectorAll("[data-menu-reply]").forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          openManager("replies", b.dataset.menuReply);
        }),
    );
    state.panel.querySelectorAll("[data-fav-reply]").forEach(
      (b) =>
        (b.onclick = async (e) => {
          e.stopPropagation();
          const r = state.data.quickReplies.find(
            (x) => x.id === b.dataset.favReply,
          );
          if (!r) return;
          await S.saveReply({ ...r, favorite: !r.favorite });
          state.data = await S.getAll();
          render();
        }),
    );
    state.panel.querySelectorAll("[data-label]").forEach(
      (b) =>
        (b.onclick = async () => {
          const name = state.currentName || currentChatName();
          if (!name) {
            toast("Abra uma conversa primeiro");
            return;
          }
          await S.toggleContactLabel(
            name,
            b.dataset.label,
            currentAccountId(),
            state.currentChatId || "",
          );
          state.data = await S.getAll();
          render();
          decorateList();
        }),
    );
    state.panel
      .querySelector('[data-action="multi-add"]')
      ?.addEventListener("click", async () => {
        const acc = await createAccountForNewSession();
        await startBridgeSession(acc.id);
      });
    state.panel
      .querySelector('[data-action="multi-add-mini"]')
      ?.addEventListener("click", async () => {
        state.tab = "central";
        const acc = await createAccountForNewSession();
        await startBridgeSession(acc.id);
      });
    state.panel.querySelectorAll("[data-session-account]").forEach(
      (b) =>
        (b.onclick = () => {
          state.activeBridgeAccountId = b.dataset.sessionAccount || "__all__";
          state.tab = "central";
          render();
        }),
    );

    state.panel
      .querySelector('[data-action="multi-refresh"]')
      ?.addEventListener("click", async () => {
        await loadBridgeSessions(false);
        toast(
          state.bridgeOnline
            ? "Central atualizada"
            : "Ponte multiconta offline",
        );
        render();
      });
    state.panel
      .querySelector('[data-action="manage-multiconta"]')
      ?.addEventListener("click", () => openManager("multiconta"));
    state.panel.querySelectorAll("[data-connect-account]").forEach(
      (b) =>
        (b.onclick = async () => {
          state.multiSetupAccountId = b.dataset.connectAccount;
          state.multiSetupOpen = true;
          render();
          if (!bridgeSession(b.dataset.connectAccount))
            await startBridgeSession(b.dataset.connectAccount);
        }),
    );
    state.panel.querySelectorAll("[data-close-multi-setup]").forEach(
      (b) =>
        (b.onclick = () => {
          state.multiSetupOpen = false;
          managedClearInterval(state.bridgeQrTimer);
          state.bridgeQrTimer = null;
          render();
        }),
    );
    state.panel
      .querySelector('[data-action="bridge-retry"]')
      ?.addEventListener("click", async () => {
        await loadBridgeSessions(false);
        if (state.bridgeOnline && state.multiSetupAccountId)
          await startBridgeSession(state.multiSetupAccountId);
        else render();
      });
    state.panel
      .querySelector('[data-action="bridge-start"]')
      ?.addEventListener("click", async (e) => {
        await startBridgeSession(
          e.currentTarget.dataset.account || state.multiSetupAccountId,
        );
      });
    state.panel
      .querySelector('[data-action="bridge-disconnect"]')
      ?.addEventListener("click", async (e) => {
        if (
          !confirm(
            "Desconectar este número da Central APOIS? Será necessário escanear um novo QR depois.",
          )
        )
          return;
        await removeBridgeSession(e.currentTarget.dataset.account);
        state.multiSetupOpen = false;
        toast("Sessão desconectada");
        render();
      });

    state.panel.querySelectorAll("[data-bind-account]").forEach(
      (b) =>
        (b.onclick = async () => {
          await setCurrentAccountId(b.dataset.bindAccount);
          await publishMultiConfig();
          await publishMultiPresence(true);
          await loadMultiSessions();
          state.multiSetupOpen = false;
          toast(
            "Esta sessão foi vinculada a " +
              (accountById(b.dataset.bindAccount)?.name || "conta"),
          );
          render();
        }),
    );
    state.panel.querySelectorAll("[data-focus-session]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.focusSession;
          if (id === multiDevice()) {
            await chrome.runtime
              .sendMessage({ type: "FOCUS_WHATSAPP_TAB" })
              .catch(() => {});
            return;
          }
          await sendMultiCommand(id, { type: "FOCUS_SESSION" });
          toast("Abrindo a sessão desse número...");
        }),
    );
    state.panel.querySelectorAll("[data-focus-chat]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.focusChat,
            name = b.dataset.chatName;
          if (id === multiDevice()) {
            const row = findConversationRow(name);
            if (row) row.click();
            else toast("Conversa não está visível na lista");
            return;
          }
          await sendMultiCommand(id, { type: "FOCUS_CHAT", chatName: name });
          toast("Abrindo " + name + " na sessão correta...");
        }),
    );
    const accSel = state.panel.querySelector("[data-current-account]");
    if (accSel) accSel.onchange = () => setCurrentAccountId(accSel.value);
    const attSel = state.panel.querySelector("[data-current-attendant]");
    if (attSel)
      attSel.onchange = async () => {
        const name = state.currentName || currentChatName();
        if (!name) return;
        await S.assignContact(
          name,
          currentAccountId(),
          attSel.value,
          currentAssignment(name)?.attendantId || "",
          "Atribuição direta",
          state.currentChatId || "",
        );
        state.data = await S.getAll();
        state.transferOpen = false;
        state.outgoingPrimedFor = "";
        render();
        decorateChatHeader();
        await primeOutgoingMessages();
        decorateOutgoingMessages();
        configReferenceSignature();
        toast(
          attSel.value
            ? `Atendente ${attendantById(attSel.value)?.name || ""} ativo • o nome será inserido somente ao enviar`
            : "Atendimento sem responsável",
        );
      };
    state.panel
      .querySelector('[data-action="transfer"]')
      ?.addEventListener("click", () => {
        state.transferOpen = !state.transferOpen;
        render();
      });
    state.panel
      .querySelector('[data-action="transfer-cancel"]')
      ?.addEventListener("click", () => {
        state.transferOpen = false;
        render();
      });
    state.panel.querySelectorAll("[data-transfer-to]").forEach(
      (b) =>
        (b.onclick = async () => {
          const name = state.currentName || currentChatName();
          if (!name) return;
          const prev = currentAssignment(name)?.attendantId || "";
          await S.assignContact(
            name,
            currentAccountId(),
            b.dataset.transferTo,
            prev,
            "Transferência manual",
            state.currentChatId || "",
          );
          state.data = await S.getAll();
          state.transferOpen = false;
          render();
          decorateChatHeader();
          decorateOutgoingMessages();
          toast(
            "Atendimento transferido para " +
              (attendantById(b.dataset.transferTo)?.name || "atendente"),
          );
        }),
    );
    state.panel
      .querySelectorAll("[data-transfer-account]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            transferConversationToAccount(b.dataset.transferAccount)),
      );
  }

  const fileToDataURL = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  const typeLabel = (t) =>
    ({
      text: "Texto",
      pix: "PIX",
      image: "Imagem",
      video: "Vídeo",
      document: "Documento",
      audio: "Áudio",
      sequence: "Composta",
    })[t] || t;

  async function audioFileToOggOpus(file) {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined")
      throw new Error(
        "Seu Chrome/Edge não possui o codificador Opus necessário.",
      );
    const cfg = {
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 32000,
      bitrateMode: "variable",
      opus: {
        application: "voip",
        signal: "voice",
        format: "opus",
        frameDuration: 20000,
        complexity: 9,
      },
    };
    const support = await AudioEncoder.isConfigSupported(cfg);
    if (!support?.supported)
      throw new Error("Codificador Opus indisponível neste navegador.");
    const dc = new AudioContext();
    let decoded;
    try {
      decoded = await dc.decodeAudioData((await file.arrayBuffer()).slice(0));
    } catch (e) {
      await dc.close().catch(() => {});
      throw new Error(
        "Não foi possível ler este áudio. Use MP3, M4A, WAV, OGG ou WebM.",
      );
    }
    await dc.close().catch(() => {});
    const frames = Math.max(1, Math.ceil(decoded.duration * 48000)),
      off = new OfflineAudioContext(1, frames, 48000),
      src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0);
    const rendered = await off.startRendering(),
      pcm = rendered.getChannelData(0),
      packets = [];
    let encErr = null;
    const enc = new AudioEncoder({
      output(chunk) {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        packets.push({ bytes, duration: chunk.duration || 20000 });
      },
      error(err) {
        encErr = err;
      },
    });
    enc.configure(cfg);
    for (let o = 0; o < pcm.length; o += 960) {
      const n = Math.min(960, pcm.length - o),
        frame = new Float32Array(n);
      frame.set(pcm.subarray(o, o + n));
      const ad = new AudioData({
        format: "f32",
        sampleRate: 48000,
        numberOfFrames: n,
        numberOfChannels: 1,
        timestamp: Math.round((o * 1e6) / 48000),
        data: frame,
      });
      enc.encode(ad);
      ad.close();
      if (enc.encodeQueueSize > 24) await sleep(0);
    }
    await enc.flush();
    enc.close();
    if (encErr) throw encErr;
    if (!packets.length)
      throw new Error("O áudio ficou vazio após a conversão.");
    const blob = muxOpusPacketsToOgg(packets, pcm.length),
      clean =
        (file.name || "audio")
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9._-]+/g, "-") || "audio";
    return new File([blob], `${clean}.ogg`, {
      type: "audio/ogg;codecs=opus",
      lastModified: Date.now(),
    });
  }
  function muxOpusPacketsToOgg(packets, actualSamples) {
    const serial = (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0;
    let seq = 0;
    const pages = [],
      ascii = (t) => new TextEncoder().encode(t),
      cat = (...parts) => {
        const n = parts.reduce((a, b) => a + b.length, 0),
          o = new Uint8Array(n);
        let p = 0;
        for (const x of parts) {
          o.set(x, p);
          p += x.length;
        }
        return o;
      },
      le16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]),
      le32 = (n) =>
        new Uint8Array([
          n & 255,
          (n >>> 8) & 255,
          (n >>> 16) & 255,
          (n >>> 24) & 255,
        ]),
      u64le = (n) => {
        let x = BigInt(Math.max(0, Math.floor(n)));
        const a = new Uint8Array(8);
        for (let i = 0; i < 8; i++) {
          a[i] = Number(x & 255n);
          x >>= 8n;
        }
        return a;
      };
    const table = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let r = i << 24;
          for (let j = 0; j < 8; j++)
            r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
          t[i] = r >>> 0;
        }
        return t;
      })(),
      crc32 = (buf) => {
        let crc = 0;
        for (const b of buf)
          crc = ((crc << 8) ^ table[((crc >>> 24) ^ b) & 255]) >>> 0;
        return crc >>> 0;
      };
    const page = (packet, headerType, granule) => {
      const seg = [];
      let remain = packet.length;
      while (remain >= 255) {
        seg.push(255);
        remain -= 255;
      }
      seg.push(remain);
      const head = new Uint8Array(27 + seg.length);
      head.set(ascii("OggS"), 0);
      head[4] = 0;
      head[5] = headerType;
      head.set(u64le(granule), 6);
      head.set(le32(serial), 14);
      head.set(le32(seq++), 18);
      head[26] = seg.length;
      head.set(seg, 27);
      const out = cat(head, packet);
      out.set(le32(crc32(out)), 22);
      return out;
    };
    const h = cat(
        ascii("OpusHead"),
        new Uint8Array([1, 1]),
        le16(312),
        le32(48000),
        le16(0),
        new Uint8Array([0]),
      ),
      vendor = ascii("APOIS"),
      tags = cat(ascii("OpusTags"), le32(vendor.length), vendor, le32(0));
    pages.push(page(h, 2, 0));
    pages.push(page(tags, 0, 0));
    let granule = 312;
    packets.forEach((pkt, i) => {
      granule += Math.max(
        1,
        Math.round(((pkt.duration || 20000) * 48000) / 1e6),
      );
      pages.push(
        page(
          pkt.bytes,
          i === packets.length - 1 ? 4 : 0,
          i === packets.length - 1
            ? Math.min(granule, 312 + actualSamples)
            : granule,
        ),
      );
    });
    return new Blob(pages, { type: "audio/ogg;codecs=opus" });
  }

  function openManager(tab = "replies", editId = null) {
    state.managerTab = tab;
    state.editReplyId = editId;
    state.pendingMediaFile = null;
    state.pendingBlockFiles = new Map();
    renderManager();
  }
  function closeManager() {
    document.body.classList.remove("apois-manager-open");
    document.getElementById("apois-manager-root")?.remove();
    state.manager = null;
    applyWhatsAppLayout();
    state.editReplyId = null;
    state.pendingMediaFile = null;
    state.pendingBlockFiles = new Map();
    if (state.recordStream) {
      state.recordStream.getTracks().forEach((t) => t.stop());
      state.recordStream = null;
    }
  }
  function renderManager() {
    document.getElementById("apois-manager-root")?.remove();
    document.body.classList.add("apois-manager-open");
    const root = document.createElement("div");
    root.id = "apois-manager-root";
    document.body.appendChild(root);
    state.manager = root;
    applyWhatsAppLayout();
    root.innerHTML = `<div class="apois-manager-backdrop" data-manager-close></div><section class="apois-manager"><header class="manager-head"><button class="manager-back" data-manager-close title="Voltar">←</button><div><strong>APOIS</strong><span>Respostas rápidas e organização</span></div><button class="manager-close" data-manager-close>${uiIcon("close")}</button></header><nav class="manager-tabs"><button data-mtab="replies" class="${state.managerTab === "replies" ? "active" : ""}">Respostas rápidas</button><button data-mtab="categories" class="${state.managerTab === "categories" ? "active" : ""}">Categorias</button><button data-mtab="labels" class="${state.managerTab === "labels" ? "active" : ""}">Etiquetas</button><button data-mtab="team" class="${state.managerTab === "team" ? "active" : ""}">Atendentes e contas</button><button data-mtab="multiconta" class="${state.managerTab === "multiconta" ? "active" : ""}">Multiconta</button><button data-mtab="settings" class="${state.managerTab === "settings" ? "active" : ""}">Configurações</button></nav><div class="manager-body">${managerBody()}</div></section>`;
    root
      .querySelectorAll("[data-manager-close]")
      .forEach((b) => (b.onclick = closeManager));
    root.querySelectorAll("[data-mtab]").forEach(
      (b) =>
        (b.onclick = () => {
          state.managerTab = b.dataset.mtab;
          state.editReplyId = null;
          renderManager();
        }),
    );
    bindManager();
  }
  function managerBody() {
    if (state.managerTab === "categories") return categoriesManagerHtml();
    if (state.managerTab === "labels") return labelsManagerHtml();
    if (state.managerTab === "team") return teamManagerHtml();
    if (state.managerTab === "multiconta") return multiManagerHtml();
    if (state.managerTab === "settings") return settingsManagerHtml();
    return repliesManagerHtml();
  }
  function repliesManagerHtml() {
    const d = state.data,
      edit =
        state.editReplyId === "__new"
          ? {
              id: "",
              title: "",
              alias: "",
              categoryId: d.categories[0]?.id || "",
              type: "sequence",
              text: "",
              pixMessage: "",
              caption: "",
              blocks: [],
              favorite: false,
              sendMode: "send",
              voiceMode: true,
            }
          : d.quickReplies.find((r) => r.id === state.editReplyId);
    return `<div class="manager-grid"><aside class="manager-list"><div class="manager-list-head"><div><b>Respostas rápidas</b><small>${d.quickReplies.length} cadastradas</small></div><button class="manager-primary" data-new-reply>+ Nova</button></div><div class="manager-mini-search"><input data-manager-search placeholder="Pesquisar"></div><div class="manager-replies">${d.categories
      .map((c) => {
        const rs = d.quickReplies.filter((r) => r.categoryId === c.id);
        if (!rs.length) return "";
        return `<div class="manager-cat"><strong>${esc(c.name)}</strong>${rs
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(
            (r) =>
              `<div class="manager-reply-row ${r.id === state.editReplyId ? "selected" : ""}"><button data-edit-reply="${r.id}"><span>${typeIcon(r.type)}</span><div><b>${esc(r.title)}</b><small>${esc(typeLabel(r.type))}${r.alias ? " • /" + esc(r.alias) : ""}</small></div></button><div class="manager-order"><button data-reply-up="${r.id}" title="Subir">↑</button><button data-reply-down="${r.id}" title="Descer">↓</button></div></div>`,
          )
          .join("")}</div>`;
      })
      .join(
        "",
      )}</div></aside><main class="manager-editor">${edit ? replyEditorHtml(edit) : `<div class="manager-welcome"><div>⚡</div><h2>Cadastre e edite sem sair do WhatsApp</h2><p>Escolha uma resposta à esquerda ou clique em <b>+ Nova</b>. Texto, PIX, áudio, imagem, vídeo e documentos ficam disponíveis imediatamente no painel.</p><button class="manager-primary" data-new-reply>+ Criar resposta rápida</button></div>`}</main></div>`;
  }
  function singleReplyAsBlock(r) {
    const base = sequenceBlockTemplate(r.type || "text");
    if (r.type === "text") return { ...base, type: "text", text: r.text || "" };
    if (r.type === "pix")
      return {
        ...base,
        type: "pix",
        pixKey: r.pixKey || "",
        pixHolder: r.pixHolder || "",
        pixBank: r.pixBank || "",
        pixMessage: r.pixMessage ?? r.text ?? "",
      };
    if (["audio", "image", "video", "document"].includes(r.type))
      return {
        ...base,
        type: r.type,
        caption: r.caption || "",
        mediaId: r.mediaId || null,
        fileName: r.fileName || "",
        mimeType: r.mimeType || "",
      };
    return { ...base, type: "text", text: r.text || "" };
  }

  function replyEditorHtml(r) {
    const isSequence = r.type === "sequence";
    const isNew = !r.id;
    const simpleTypeOptions = `<option value="text" ${r.type === "text" ? "selected" : ""}>Texto</option><option value="audio" ${r.type === "audio" ? "selected" : ""}>Áudio / nota de voz</option><option value="image" ${r.type === "image" ? "selected" : ""}>Imagem</option><option value="video" ${r.type === "video" ? "selected" : ""}>Vídeo</option><option value="document" ${r.type === "document" ? "selected" : ""}>Documento</option><option value="pix" ${r.type === "pix" ? "selected" : ""}>PIX</option>`;
    const actionArea = isSequence
      ? `<input type="hidden" name="type" value="sequence"><div id="inlineDynamicFields">${sequenceFields(r)}</div>`
      : `<div class="legacy-simple-reply">
          <div class="legacy-simple-head"><div><b>Resposta simples</b><span>Esta resposta antiga possui uma única ação.</span></div><button type="button" class="manager-primary add-another-action" data-convert-sequence>＋ Adicionar outra ação</button></div>
          <label>Tipo atual<select name="type" id="inlineReplyType">${simpleTypeOptions}</select></label>
          <div id="inlineDynamicFields">${inlineDynamicFields(r)}</div>
        </div>`;
    return `<form id="apoisInlineReplyForm" class="inline-form action-first-form">
      <div class="inline-title"><div><h2>${r.id ? "Editar resposta rápida" : "Nova resposta rápida"}</h2><p>${r.id ? `Usada ${r.useCount || 0} vezes` : "Uma resposta pode enviar uma ou várias mensagens em sequência"}</p></div>${r.id ? '<div class="inline-title-actions"><button type="button" data-duplicate-reply>Duplicar</button><button type="button" class="manager-danger" data-delete-reply>Excluir</button></div>' : ""}</div>

      <div class="reply-identity-grid">
        <label>Título<input name="title" required value="${esc(r.title || "")}" placeholder="Ex.: Primeiro atendimento"></label>
        <label>Atalho<div class="alias-input"><span>/</span><input name="alias" value="${esc(r.alias || "")}" placeholder="atendimento"></div></label>
        <label>Categoria<select name="categoryId">${state.data.categories.map((c) => `<option value="${c.id}" ${c.id === r.categoryId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      </div>

      <div class="reply-actions-shell">
        ${actionArea}
      </div>

      <div class="inline-bottom">
        <label class="inline-check"><input type="checkbox" name="favorite" ${r.favorite ? "checked" : ""}><span>Favorita</span></label>
        ${isSequence ? '<label class="send-mode sequence-mode">Ao usar<input type="hidden" name="sendMode" value="send"><span>Enviar todas as ações automaticamente, na ordem cadastrada</span></label>' : `<label class="send-mode">Ao usar<select name="sendMode"><option value="insert" ${r.sendMode !== "send" ? "selected" : ""}>Inserir no campo</option><option value="send" ${r.sendMode === "send" ? "selected" : ""}>Enviar imediatamente</option></select></label>`}
      </div>

      <div class="inline-vars">Variáveis disponíveis: <code>{{nome}}</code> <code>{{primeiro_nome}}</code> <code>{{data}}</code> <code>{{hora}}</code></div>
      <div class="inline-actions"><button type="button" data-manager-close-secondary>Cancelar</button><button class="manager-primary" type="submit">Salvar resposta rápida</button></div>
    </form>`;
  }
  function inlineDynamicFields(r) {
    if (r.type === "sequence") return sequenceFields(r);
    if (r.type === "pix")
      return `<div class="pix-editor"><div class="pix-editor-head"><div><b>Resposta PIX</b><span>Cadastre a chave uma vez e envie com um clique.</span></div><span class="pix-badge">PIX</span></div><label>Chave PIX <em>obrigatória</em><input name="pixKey" required value="${esc(r.pixKey || "")}" placeholder="CPF, telefone, e-mail ou chave aleatória"></label><div class="inline-grid"><label>Titular<input name="pixHolder" value="${esc(r.pixHolder || "")}" placeholder="Nome do titular"></label><label>Banco / instituição<input name="pixBank" value="${esc(r.pixBank || "")}" placeholder="Opcional"></label></div><label>Mensagem antes dos dados <small>opcional</small><textarea name="pixMessage" rows="3" placeholder="Ex.: Segue minha chave PIX para pagamento.">${esc(r.pixMessage ?? ((r.text || "").trim() === "Chave PIX:" ? "" : r.text || ""))}</textarea></label><div class="pix-preview" data-pix-preview><b>Prévia</b><pre>${esc(buildPix(r) || "Preencha a chave PIX para visualizar.")}</pre></div></div>`;
    if (["image", "video", "document", "audio"].includes(r.type))
      return `<label>Legenda / texto complementar<textarea name="caption" rows="3">${esc(r.caption || "")}</textarea></label><div class="inline-media"><div><b>${r.mediaId ? "Arquivo salvo" : "Nenhum arquivo salvo"}</b><small>${esc(r.fileName || "Selecione um arquivo")}</small></div><input id="inlineMediaFile" type="file" ${r.type === "image" ? 'accept="image/*"' : r.type === "video" ? 'accept="video/*"' : r.type === "audio" ? 'accept="audio/*"' : 'accept="*/*"'}></div>${r.type === "audio" ? `<div class="inline-record"><button type="button" id="inlineRecordAudio">🎙 Gravar áudio agora</button><span id="inlineRecordStatus">ou importe um áudio</span><audio id="inlineRecordPreview" controls hidden></audio></div><div class="voice-note-info"><b>Áudio será enviado como nota de voz</b><span>A extensão converte localmente para OGG/Opus e usa envio PTT.</span></div>` : ""}`;
    return `<label>Texto<textarea name="text" rows="8" placeholder="Digite sua resposta...">${esc(r.text || "")}</textarea></label>`;
  }
  function sequenceBlockTemplate(type = "text") {
    return {
      id: S.uid("blk"),
      type,
      order: 0,
      text: "",
      caption: "",
      mediaId: null,
      fileName: "",
      mimeType: "",
      pixKey: "",
      pixHolder: "",
      pixBank: "",
      pixMessage: "",
    };
  }
  function sequenceFields(r) {
    const blocks = (Array.isArray(r.blocks) ? r.blocks : []).map((b, i) => ({
      ...b,
      order: i,
    }));
    return `<div class="sequence-editor action-builder" data-sequence-editor>
      <div class="sequence-head action-builder-head">
        <div><span class="action-kicker">AÇÕES DA RESPOSTA RÁPIDA</span><b>O que deve ser enviado?</b><p>Você pode colocar texto + áudio + imagem + PIX + vídeo na mesma resposta. Cada ação abaixo vira uma mensagem separada.</p></div>
        <span class="sequence-count">${blocks.length} ação${blocks.length === 1 ? "" : "ões"}</span>
      </div>

      <div class="sequence-blocks">${
        blocks.length
          ? blocks.map((b, i) => sequenceBlockHtml(b, i)).join("")
          : `<div class="sequence-empty action-empty">
        <div class="empty-action-icon">＋</div>
        <b>Nenhuma ação adicionada ainda</b>
        <span>Escolha abaixo a primeira mensagem que essa resposta deverá enviar.</span>
      </div>`
      }</div>

      <div class="sequence-add action-add-panel">
        <div class="action-add-title"><div><b>＋ Adicionar ação</b><span>Adicione quantas mensagens quiser e organize a ordem.</span></div></div>
        <div class="action-type-grid">
          <button type="button" data-add-block="text"><i>💬</i><span><b>Texto</b><small>Mensagem de texto</small></span></button>
          <button type="button" data-add-block="audio"><i>🎙</i><span><b>Áudio</b><small>Nota de voz</small></span></button>
          <button type="button" data-add-block="image"><i>🖼</i><span><b>Imagem</b><small>Foto separada</small></span></button>
          <button type="button" data-add-block="video"><i>🎬</i><span><b>Vídeo</b><small>Vídeo separado</small></span></button>
          <button type="button" data-add-block="document"><i>📎</i><span><b>Documento</b><small>PDF ou arquivo</small></span></button>
          <button type="button" data-add-block="pix"><i>◆</i><span><b>PIX</b><small>Dados de pagamento</small></span></button>
        </div>
      </div>

      <div class="sequence-note"><b>Um clique envia tudo</b><span>As ações são enviadas de cima para baixo. Use as setas em cada ação para alterar a ordem.</span></div>
    </div>`;
  }
  function sequenceBlockHtml(b, index) {
    const id = b.id || S.uid("blk"),
      t = b.type || "text",
      n = index + 1;
    let body = "";
    if (t === "text")
      body = `<label>Texto<textarea data-block-text rows="4" placeholder="Digite a mensagem...">${esc(b.text || "")}</textarea></label>`;
    else if (t === "pix")
      body = `<div class="seq-grid"><label>Chave PIX<input data-block-pix-key value="${esc(b.pixKey || "")}" placeholder="Chave PIX"></label><label>Titular<input data-block-pix-holder value="${esc(b.pixHolder || "")}"></label></div><div class="seq-grid"><label>Banco<input data-block-pix-bank value="${esc(b.pixBank || "")}"></label><label>Mensagem antes<input data-block-pix-message value="${esc(b.pixMessage || "")}" placeholder="Opcional"></label></div>`;
    else
      body = `<label>${t === "audio" ? "Observação interna / legenda não enviada" : "Legenda opcional"}<textarea data-block-caption rows="2">${esc(b.caption || "")}</textarea></label><div class="sequence-media"><div><b>${b.mediaId ? "Arquivo salvo" : "Selecione um arquivo"}</b><small data-block-file-name>${esc(b.fileName || "Nenhum arquivo")}</small></div><input type="file" data-block-file accept="${t === "image" ? "image/*" : t === "video" ? "video/*" : t === "audio" ? "audio/*" : "*/*"}"></div>${t === "audio" ? '<small class="sequence-voice-note">Será enviado como nota de voz.</small>' : ""}`;
    return `<section class="sequence-block" data-block-id="${esc(id)}" data-block-type="${esc(t)}" data-media-id="${esc(b.mediaId || "")}" data-file-name="${esc(b.fileName || "")}" data-mime-type="${esc(b.mimeType || "")}">
      <header><div class="seq-index">${n}</div><div class="seq-kind"><b>${typeIcon(t)} ${esc(typeLabel(t))}</b><span>${t === "audio" ? "nota de voz" : t === "text" ? "mensagem separada" : t === "image" ? "foto separada" : "item da sequência"}</span></div><div class="seq-actions"><button type="button" data-block-duplicate title="Duplicar ação">⧉</button><button type="button" data-block-up title="Subir">↑</button><button type="button" data-block-down title="Descer">↓</button><button type="button" class="manager-danger" data-block-remove title="Remover">×</button></div></header>${body}
    </section>`;
  }

  function categoriesManagerHtml() {
    return `<div class="simple-manager"><div class="simple-head"><div><h2>Categorias</h2><p>Organize suas respostas como na extensão de referência.</p></div><button class="manager-primary" data-new-category>+ Nova categoria</button></div><div class="simple-list">${state.data.categories.map((c) => `<div><input data-cat-name="${c.id}" value="${esc(c.name)}"><span>${state.data.quickReplies.filter((r) => r.categoryId === c.id).length} respostas</span><button data-cat-up="${c.id}">↑</button><button data-cat-down="${c.id}">↓</button><button data-save-category="${c.id}">Salvar</button><button class="manager-danger" data-delete-category="${c.id}">Excluir</button></div>`).join("")}</div></div>`;
  }
  function labelsManagerHtml() {
    return `<div class="simple-manager"><div class="simple-head"><div><h2>Etiquetas</h2><p>Crie etiquetas coloridas e aplique-as às conversas.</p></div><button class="manager-primary" data-new-label>+ Nova etiqueta</button></div><div class="simple-list">${state.data.labels.map((l) => `<div><input type="color" data-label-color="${l.id}" value="${esc(l.color)}"><input data-label-name="${l.id}" value="${esc(l.name)}"><span>${Object.values(state.data.contacts).filter((c) => (c.labels || []).includes(l.id)).length} contatos</span><button data-save-label="${l.id}">Salvar</button><button class="manager-danger" data-delete-label="${l.id}">Excluir</button></div>`).join("")}</div></div>`;
  }
  function multiManagerHtml() {
    const d = state.data,
      sessions = state.bridgeSessions || [];
    return `<div class="simple-manager multi-manager">
      <div class="simple-head"><div><h2>WhatsApps conectados</h2><p>Gerencie as sessões independentes conectadas por QR Code.</p></div><button class="manager-primary" data-multi-refresh>↻ Atualizar</button></div>
      ${!state.bridgeOnline ? `<div class="bridge-offline-card manager-bridge-card"><b>Central Multiconta local está desligada</b><p>Execute <code>INSTALAR-APOIS-MULTICONTA.bat</code> na pasta da extensão. Isso é necessário apenas na primeira instalação.</p><button class="manager-primary" data-bridge-retry>Verificar novamente</button></div>` : ""}
      <div class="multi-session-list">${(d.accounts || [])
        .filter((a) => a.active !== false)
        .map((acc) => {
          const s = sessions.find((x) => x.id === acc.id),
            connected = s?.status === "connected";
          return `<div class="multi-session-row ${connected ? "online" : "offline"}"><i style="background:${esc(acc.color || "#E1061B")}"></i><div><b>${esc(acc.name)}</b><span>${esc(s?.phone ? "+" + s.phone : acc.phone || "sem número vinculado")}</span><small>${connected ? "Conectado e recebendo eventos" : s?.qrDataUrl ? "QR Code aguardando leitura" : s?.status || "Desconectado"}</small></div><button data-manager-connect="${esc(acc.id)}">${connected ? "Ver" : "QR Code"}</button></div>`;
        })
        .join("")}</div>
      <div class="multi-setup-guide"><b>Arquitetura multiconta</b><p>Essas sessões não usam os cookies da aba atual do WhatsApp Web. Cada QR cria um dispositivo conectado independente, permitindo manter seus 3 números online ao mesmo tempo.</p><p class="multi-security-note">As credenciais ficam somente no seu computador em <code>%LOCALAPPDATA%\\APOIS-WhatsApp-Central</code>.</p></div>
    </div>`;
  }

  function teamManagerHtml() {
    const d = state.data;
    return `<div class="simple-manager team-manager"><div class="simple-head"><div><h2>Atendentes e contas</h2><p>Identifique quem está atendendo e organize seus números do WhatsApp.</p></div></div><div class="team-columns"><section class="team-card"><div class="team-card-head"><div><b>Atendentes</b><span>Responsáveis que podem receber transferências.</span></div><button class="manager-primary" data-new-attendant>+ Atendente</button></div><div class="team-list">${d.attendants.map((a) => `<div class="team-row"><span class="team-avatar">${esc((a.name || "A").slice(0, 1).toUpperCase())}</span><input data-att-name="${a.id}" value="${esc(a.name)}"><label class="team-active"><input type="checkbox" data-att-active="${a.id}" ${a.active !== false ? "checked" : ""}>Ativo</label><button data-save-att="${a.id}">Salvar</button><button class="manager-danger" data-delete-att="${a.id}">Excluir</button></div>`).join("")}</div></section><section class="team-card"><div class="team-card-head"><div><b>Contas / números</b><span>Cadastre as linhas que você atende no APOIS.</span></div><button class="manager-primary" data-new-account>+ Conta</button></div><div class="team-list">${d.accounts.map((a) => `<div class="team-row account-row"><input type="color" data-account-color="${a.id}" value="${esc(a.color || "#E1061B")}"><input data-account-name="${a.id}" value="${esc(a.name)}" placeholder="Nome da conta"><input data-account-phone="${a.id}" value="${esc(a.phone || "")}" placeholder="Número"><label class="team-active"><input type="checkbox" data-account-active="${a.id}" ${a.active !== false ? "checked" : ""}>Ativa</label><button data-save-account="${a.id}">Salvar</button><button class="manager-danger" data-delete-account="${a.id}">Excluir</button></div>`).join("")}</div><div class="multi-note"><b>Central multiconta ativa</b><p>Cadastre os números aqui e depois vincule cada um ao seu próprio perfil do Edge na aba <b>Multiconta</b>. A central do APOIS mostra quais sessões estão online e permite abrir a sessão correta.</p></div></section></div></div>`;
  }
  function settingsManagerHtml() {
    const st = state.data.settings;
    return `<div class="simple-manager settings-manager"><div class="simple-head"><div><h2>Configurações</h2><p>Comportamento da extensão e segurança dos dados.</p></div><button class="manager-primary" data-backup-export>Exportar backup</button></div><div class="settings-grid"><label><span>Painel aberto ao iniciar</span><input type="checkbox" data-setting="panelOpen" ${st.panelOpen ? "checked" : ""}></label><label><span>Atalhos com /</span><input type="checkbox" data-setting="slashCommands" ${st.slashCommands ? "checked" : ""}></label><label><span>Mostrar etiquetas na lista</span><input type="checkbox" data-setting="showLabelDotsInList" ${st.showLabelDotsInList ? "checked" : ""}></label><label><span>Fechar painel após usar</span><input type="checkbox" data-setting="closeAfterUse" ${st.closeAfterUse ? "checked" : ""}></label><label class="range-setting"><span>Largura do painel</span><input type="range" min="380" max="520" step="10" value="${st.panelWidth || 410}" data-setting-range="panelWidth"><b>${st.panelWidth || 410}px</b></label></div><div class="backup-strip"><div><b>Backup completo</b><span>Inclui respostas, categorias, etiquetas e mídias.</span></div><button data-backup-export>Baixar</button><label class="backup-import">Restaurar<input type="file" accept="application/json" data-backup-import hidden></label></div><div class="engine-card"><b>Modo nativo de envio</b><span class="engine-state ${state.bridgeState.ok ? "ok" : "warn"}">${state.bridgeState.ok ? "Pronto" : "Ainda não pronto"}</span><small>${esc(state.bridgeState.error || "PTT direto quando a API estiver pronta; gravador nativo como alternativa.")}</small><button data-action-ping>Verificar agora</button></div></div>`;
  }

  function bindManager() {
    if (state.managerTab === "settings") {
      const host =
        state.manager.querySelector(".simple-manager") || state.manager;
      const button = document.createElement("button");
      button.className = "manager-primary";
      button.textContent = "Diagnóstico — copiar relatório";
      button.onclick = copyDiagnostics;
      host.appendChild(button);
    }
    const r = state.manager;
    if (!r) return;
    r.querySelectorAll("[data-manager-close-secondary]").forEach(
      (b) => (b.onclick = closeManager),
    );
    r.querySelectorAll("[data-new-reply]").forEach(
      (b) =>
        (b.onclick = () => {
          state.editReplyId = "__new";
          renderManager();
        }),
    );
    r.querySelectorAll("[data-edit-reply]").forEach(
      (b) =>
        (b.onclick = () => {
          state.editReplyId = b.dataset.editReply;
          renderManager();
        }),
    );
    r.querySelectorAll("[data-reply-up]").forEach(
      (b) =>
        (b.onclick = async (e) => {
          e.stopPropagation();
          await S.moveReply(b.dataset.replyUp, -1);
          state.data = await S.getAll();
          renderManager();
          render();
        }),
    );
    r.querySelectorAll("[data-reply-down]").forEach(
      (b) =>
        (b.onclick = async (e) => {
          e.stopPropagation();
          await S.moveReply(b.dataset.replyDown, 1);
          state.data = await S.getAll();
          renderManager();
          render();
        }),
    );
    const form = r.querySelector("#apoisInlineReplyForm");
    if (form) bindInlineReplyForm(form);
    const search = r.querySelector("[data-manager-search]");
    if (search)
      search.oninput = () => {
        const q = normalize(search.value);
        r.querySelectorAll("[data-edit-reply]").forEach((b) => {
          const item = state.data.quickReplies.find(
            (x) => x.id === b.dataset.editReply,
          );
          (b.closest(".manager-reply-row") || b).style.display =
            !q ||
            normalize(
              [item?.title, item?.alias, typeLabel(item?.type)].join(" "),
            ).includes(q)
              ? ""
              : "none";
        });
      };
    r.querySelector("[data-new-category]")?.addEventListener(
      "click",
      async () => {
        const rec = await S.saveCategory({ name: "Nova categoria" });
        state.data = await S.getAll();
        state.managerTab = "categories";
        renderManager();
        managedTimeout(
          () =>
            document
              .querySelector(`#apois-manager-root [data-cat-name="${rec.id}"]`)
              ?.focus(),
          0,
        );
      },
    );
    r.querySelectorAll("[data-save-category]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.saveCategory,
            name = r.querySelector(`[data-cat-name="${id}"]`)?.value.trim();
          if (!name) return toast("Digite o nome da categoria");
          await S.saveCategory({ id, name });
          state.data = await S.getAll();
          renderManager();
          render();
        }),
    );
    r.querySelectorAll("[data-cat-up]").forEach(
      (b) =>
        (b.onclick = async () => {
          await S.moveCategory(b.dataset.catUp, -1);
          state.data = await S.getAll();
          renderManager();
          render();
        }),
    );
    r.querySelectorAll("[data-cat-down]").forEach(
      (b) =>
        (b.onclick = async () => {
          await S.moveCategory(b.dataset.catDown, 1);
          state.data = await S.getAll();
          renderManager();
          render();
        }),
    );
    r.querySelectorAll("[data-delete-category]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (state.data.categories.length <= 1)
            return toast("Mantenha ao menos uma categoria");
          if (!confirm("Excluir esta categoria?")) return;
          await S.deleteCategory(b.dataset.deleteCategory);
          state.data = await S.getAll();
          renderManager();
          render();
        }),
    );
    r.querySelector("[data-new-label]")?.addEventListener("click", async () => {
      await S.saveLabel({ name: "Nova etiqueta", color: "#E1061B" });
      state.data = await S.getAll();
      renderManager();
      render();
    });
    r.querySelectorAll("[data-save-label]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.saveLabel,
            name = r.querySelector(`[data-label-name="${id}"]`)?.value.trim(),
            color = r.querySelector(`[data-label-color="${id}"]`)?.value;
          if (!name) return toast("Digite o nome da etiqueta");
          await S.saveLabel({ id, name, color });
          state.data = await S.getAll();
          renderManager();
          render();
          decorateList();
        }),
    );
    r.querySelectorAll("[data-delete-label]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm("Excluir esta etiqueta de todos os contatos?")) return;
          await S.deleteLabel(b.dataset.deleteLabel);
          state.data = await S.getAll();
          renderManager();
          render();
          decorateList();
        }),
    );
    r.querySelector("[data-multi-refresh]")?.addEventListener(
      "click",
      async () => {
        await loadBridgeSessions(false);
        renderManager();
      },
    );
    r.querySelector("[data-bridge-retry]")?.addEventListener(
      "click",
      async () => {
        await loadBridgeSessions(false);
        renderManager();
      },
    );
    r.querySelectorAll("[data-manager-connect]").forEach(
      (b) =>
        (b.onclick = async () => {
          closeManager();
          state.tab = "central";
          state.multiSetupAccountId = b.dataset.managerConnect;
          state.multiSetupOpen = true;
          render();
          if (!bridgeSession(b.dataset.managerConnect))
            await startBridgeSession(b.dataset.managerConnect);
        }),
    );
    r.querySelectorAll("[data-focus-session]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.focusSession;
          if (id === multiDevice()) {
            await chrome.runtime
              .sendMessage({ type: "FOCUS_WHATSAPP_TAB" })
              .catch(() => {});
            return;
          }
          await sendMultiCommand(id, { type: "FOCUS_SESSION" });
          toast("Abrindo sessão...");
        }),
    );
    r.querySelector("[data-new-attendant]")?.addEventListener(
      "click",
      async () => {
        await S.saveAttendant({ name: "Novo atendente" });
        await S.touchSharedConfig();
        state.data = await S.getAll();
        await publishMultiConfig();
        renderManager();
        render();
      },
    );
    r.querySelectorAll("[data-save-att]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.saveAtt,
            name = r.querySelector(`[data-att-name="${id}"]`)?.value.trim(),
            active = !!r.querySelector(`[data-att-active="${id}"]`)?.checked;
          if (!name) return toast("Digite o nome do atendente");
          await S.saveAttendant({ id, name, active });
          await S.touchSharedConfig();
          state.data = await S.getAll();
          await publishMultiConfig();
          renderManager();
          render();
          decorateChatHeader();
        }),
    );
    r.querySelectorAll("[data-delete-att]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm("Excluir este atendente?")) return;
          const ok = await S.deleteAttendant(b.dataset.deleteAtt);
          if (!ok) return toast("Mantenha ao menos um atendente");
          await S.touchSharedConfig();
          state.data = await S.getAll();
          await publishMultiConfig();
          renderManager();
          render();
          decorateChatHeader();
        }),
    );
    r.querySelector("[data-new-account]")?.addEventListener(
      "click",
      async () => {
        const rec = await S.saveAccount({
          name: "Novo WhatsApp",
          phone: "",
          color: "#E1061B",
        });
        await S.touchSharedConfig();
        state.data = await S.getAll();
        await publishMultiConfig();
        renderManager();
        render();
        managedTimeout(
          () => r.querySelector(`[data-account-name="${rec.id}"]`)?.focus(),
          0,
        );
      },
    );
    r.querySelectorAll("[data-save-account]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.saveAccount,
            name = r.querySelector(`[data-account-name="${id}"]`)?.value.trim(),
            phone = r
              .querySelector(`[data-account-phone="${id}"]`)
              ?.value.trim(),
            color = r.querySelector(`[data-account-color="${id}"]`)?.value,
            active = !!r.querySelector(`[data-account-active="${id}"]`)
              ?.checked;
          if (!name) return toast("Digite o nome da conta");
          await S.saveAccount({ id, name, phone, color, active });
          await S.touchSharedConfig();
          state.data = await S.getAll();
          await publishMultiConfig();
          renderManager();
          render();
        }),
    );
    r.querySelectorAll("[data-delete-account]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm("Excluir esta conta do APOIS?")) return;
          const ok = await S.deleteAccount(b.dataset.deleteAccount);
          if (!ok) return toast("Mantenha ao menos uma conta");
          if (currentAccountId() === b.dataset.deleteAccount) {
            const first = state.data.accounts.find(
              (a) => a.id !== b.dataset.deleteAccount,
            )?.id;
            if (first) await setCurrentAccountId(first);
          }
          await S.touchSharedConfig();
          state.data = await S.getAll();
          await publishMultiConfig();
          renderManager();
          render();
          decorateList();
        }),
    );
    r.querySelectorAll("[data-setting]").forEach(
      (el) =>
        (el.onchange = async () => {
          await S.setKey("settings", {
            ...state.data.settings,
            [el.dataset.setting]: el.checked,
          });
          state.data = await S.getAll();
          render();
        }),
    );
    const range = r.querySelector("[data-setting-range]");
    if (range)
      range.oninput = () => {
        range.parentElement.querySelector("b").textContent = range.value + "px";
      };
    if (range)
      range.onchange = async () => {
        await S.setKey("settings", {
          ...state.data.settings,
          panelWidth: Number(range.value),
        });
        state.data = await S.getAll();
        render();
      };
    r.querySelectorAll("[data-backup-export]").forEach(
      (b) => (b.onclick = exportInlineBackup),
    );
    const imp = r.querySelector("[data-backup-import]");
    if (imp) imp.onchange = () => restoreInlineBackup(imp.files?.[0]);
    r.querySelector("[data-action-ping]")?.addEventListener(
      "click",
      async () => {
        await pingBridge(true);
        renderManager();
      },
    );
  }
  function bindSequenceEditor(form) {
    const editor = form.querySelector("[data-sequence-editor]");
    if (!editor) return;
    const list = editor.querySelector(".sequence-blocks");
    const renumber = () => {
      [...list.querySelectorAll(".sequence-block")].forEach((b, i) => {
        const n = b.querySelector(".seq-index");
        if (n) n.textContent = i + 1;
      });
      const count = editor.querySelector(".sequence-count"),
        n = list.querySelectorAll(".sequence-block").length;
      if (count) count.textContent = `${n} item${n === 1 ? "" : "s"}`;
      list.querySelector(".sequence-empty")?.remove();
    };
    editor.querySelectorAll("[data-add-block]").forEach(
      (btn) =>
        (btn.onclick = () => {
          const b = sequenceBlockTemplate(btn.dataset.addBlock);
          const holder = document.createElement("div");
          holder.innerHTML = sequenceBlockHtml(
            b,
            list.querySelectorAll(".sequence-block").length,
          );
          list.appendChild(holder.firstElementChild);
          bindSequenceEditor(form);
          renumber();
        }),
    );
    list.querySelectorAll(".sequence-block").forEach((block) => {
      const id = block.dataset.blockId;
      const rem = block.querySelector("[data-block-remove]");
      if (rem)
        rem.onclick = () => {
          state.pendingBlockFiles.delete(id);
          block.remove();
          renumber();
          if (!list.querySelector(".sequence-block"))
            list.innerHTML =
              '<div class="sequence-empty">Adicione texto, áudio, imagem, vídeo, documento ou PIX.</div>';
        };
      const duplicate = block.querySelector("[data-block-duplicate]");
      if (duplicate)
        duplicate.onclick = () => {
          const source = collectSequenceBlocks(form).find(
              (item) => item.id === id,
            ),
            copy = { ...source, id: S.uid("blk") };
          const pending = state.pendingBlockFiles.get(id);
          if (pending) state.pendingBlockFiles.set(copy.id, pending);
          const holder = document.createElement("div");
          holder.innerHTML = sequenceBlockHtml(copy, 0);
          list.insertBefore(holder.firstElementChild, block.nextElementSibling);
          bindSequenceEditor(form);
          renumber();
        };
      const up = block.querySelector("[data-block-up]");
      if (up)
        up.onclick = () => {
          const prev = block.previousElementSibling;
          if (prev?.classList.contains("sequence-block"))
            list.insertBefore(block, prev);
          renumber();
        };
      const down = block.querySelector("[data-block-down]");
      if (down)
        down.onclick = () => {
          const next = block.nextElementSibling;
          if (next?.classList.contains("sequence-block"))
            list.insertBefore(next, block);
          renumber();
        };
      const file = block.querySelector("[data-block-file]");
      if (file)
        file.onchange = () => {
          const f = file.files?.[0];
          if (!f) return;
          state.pendingBlockFiles.set(id, f);
          const name = block.querySelector("[data-block-file-name]");
          if (name) name.textContent = f.name;
        };
    });
    renumber();
  }
  function collectSequenceBlocks(form) {
    return [...form.querySelectorAll(".sequence-block")].map((el, i) => {
      const type = el.dataset.blockType,
        id = el.dataset.blockId || S.uid("blk");
      return {
        id,
        type,
        order: i,
        text: el.querySelector("[data-block-text]")?.value || "",
        caption: el.querySelector("[data-block-caption]")?.value || "",
        mediaId: el.dataset.mediaId || null,
        fileName: el.dataset.fileName || "",
        mimeType: el.dataset.mimeType || "",
        pixKey: el.querySelector("[data-block-pix-key]")?.value.trim() || "",
        pixHolder:
          el.querySelector("[data-block-pix-holder]")?.value.trim() || "",
        pixBank: el.querySelector("[data-block-pix-bank]")?.value.trim() || "",
        pixMessage:
          el.querySelector("[data-block-pix-message]")?.value.trim() || "",
      };
    });
  }
  async function saveSequenceBlocks(form, existing) {
    const blocks = collectSequenceBlocks(form);
    if (!blocks.length)
      throw new Error("Adicione pelo menos um item à resposta composta.");
    const oldMedia = new Set(
      (existing.blocks || []).map((b) => b.mediaId).filter(Boolean),
    );
    const saved = [];
    for (const block of blocks) {
      const file = state.pendingBlockFiles.get(block.id);
      if (["image", "video", "document", "audio"].includes(block.type)) {
        if (!file && !block.mediaId)
          throw new Error(
            `Selecione o arquivo do item ${block.order + 1} (${typeLabel(block.type)}).`,
          );
        if (file) {
          let media = file;
          if (block.type === "audio") {
            toast(`Convertendo áudio do item ${block.order + 1}...`);
            media = await audioFileToOggOpus(file);
          }
          const mediaId = S.uid("media"),
            dataUrl = await fileToDataURL(media),
            res = await chrome.runtime.sendMessage({
              type: "MEDIA_PUT",
              id: mediaId,
              dataUrl,
              mime: media.type,
              name: media.name,
              size: media.size,
            });
          if (!res?.ok)
            throw new Error(res?.error || "Falha ao salvar mídia da sequência");
          block.mediaId = mediaId;
          block.fileName = media.name;
          block.mimeType = media.type;
        }
      }
      if (block.type === "text" && !block.text.trim())
        throw new Error(`Digite o texto do item ${block.order + 1}.`);
      if (block.type === "pix" && !block.pixKey)
        throw new Error(`Informe a chave PIX do item ${block.order + 1}.`);
      saved.push(block);
    }
    const newMedia = new Set(saved.map((b) => b.mediaId).filter(Boolean));
    for (const mediaId of oldMedia)
      if (!newMedia.has(mediaId))
        chrome.runtime
          .sendMessage({ type: "MEDIA_DELETE", id: mediaId })
          .catch(() => {});
    return saved;
  }
  async function duplicateMedia(mediaId) {
    if (!mediaId) return null;
    const m = await chrome.runtime.sendMessage({
      type: "MEDIA_GET",
      id: mediaId,
    });
    if (!m?.ok) return mediaId;
    const id = S.uid("media");
    await chrome.runtime.sendMessage({
      type: "MEDIA_PUT",
      id,
      dataUrl: m.dataUrl,
      mime: m.mime,
      name: m.name,
      size: m.size,
      duration: m.duration || 0,
    });
    return id;
  }
  function bindInlineReplyForm(form) {
    form
      .querySelector("[data-convert-sequence]")
      ?.addEventListener("click", () => {
        const existing =
          state.data.quickReplies.find((x) => x.id === state.editReplyId) || {};
        const first = singleReplyAsBlock(existing);
        const shell = form.querySelector(".reply-actions-shell");
        if (!shell) return;
        shell.innerHTML = `<input type="hidden" name="type" value="sequence"><div id="inlineDynamicFields">${sequenceFields({ ...existing, type: "sequence", blocks: [first] })}</div>`;
        const bottom = form.querySelector(".inline-bottom .send-mode");
        if (bottom) {
          bottom.classList.add("sequence-mode");
          bottom.innerHTML =
            'Ao usar<input type="hidden" name="sendMode" value="send"><span>Enviar todas as ações automaticamente, na ordem cadastrada</span>';
        }
        state.pendingBlockFiles = new Map();
        bindSequenceEditor(form);
        toast("Agora você pode adicionar várias ações nesta resposta");
      });
    const type = form.querySelector("#inlineReplyType");
    if (type)
      type.onchange = () => {
        const existing =
          state.data.quickReplies.find((x) => x.id === state.editReplyId) || {};
        form.querySelector("#inlineDynamicFields").innerHTML =
          inlineDynamicFields({
            ...existing,
            type: type.value,
            blocks: type.value === "sequence" ? existing.blocks || [] : [],
          });
        const bottom = form.querySelector(".inline-bottom .send-mode");
        if (bottom) {
          if (type.value === "sequence") {
            bottom.classList.add("sequence-mode");
            bottom.innerHTML =
              'Ao usar<input type="hidden" name="sendMode" value="send"><span>Enviar toda a sequência automaticamente</span>';
          } else {
            bottom.classList.remove("sequence-mode");
            const current =
              existing.sendMode || (type.value === "pix" ? "send" : "insert");
            bottom.innerHTML = `Ao usar<select name="sendMode"><option value="insert" ${current !== "send" ? "selected" : ""}>Inserir no campo</option><option value="send" ${current === "send" ? "selected" : ""}>Enviar imediatamente</option></select>`;
          }
        }
        if (type.value === "pix" && state.editReplyId === "__new") {
          const sm = form.querySelector('[name="sendMode"]');
          if (sm) sm.value = "send";
        }
        state.pendingMediaFile = null;
        state.pendingBlockFiles = new Map();
        bindInlineRecord(form);
        bindPixEditor(form);
        bindSequenceEditor(form);
      };
    bindInlineRecord(form);
    bindPixEditor(form);
    bindSequenceEditor(form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form),
        type = fd.get("type"),
        existing =
          state.data.quickReplies.find((x) => x.id === state.editReplyId) || {};
      try {
        const alias = String(fd.get("alias") || "")
          .trim()
          .replace(/^\//, "");
        if (
          alias &&
          state.data.quickReplies.some(
            (x) =>
              x.id !== existing.id && normalize(x.alias) === normalize(alias),
          )
        )
          throw new Error("Já existe uma resposta com o atalho /" + alias);
        if (type === "sequence") {
          const blocks = await saveSequenceBlocks(form, existing);
          const oldSingleMedia = existing.mediaId || null;
          const rec = await S.saveReply({
            ...existing,
            id: existing.id || "",
            title: String(fd.get("title") || "").trim(),
            alias,
            categoryId: fd.get("categoryId"),
            type: "sequence",
            blocks,
            favorite: fd.get("favorite") === "on",
            sendMode: "send",
            text: "",
            caption: "",
            pixMessage: "",
            pixKey: "",
            pixHolder: "",
            pixBank: "",
            mediaId: null,
            fileName: "",
            mimeType: "",
          });
          if (
            oldSingleMedia &&
            !blocks.some((b) => b.mediaId === oldSingleMedia)
          )
            chrome.runtime
              .sendMessage({ type: "MEDIA_DELETE", id: oldSingleMedia })
              .catch(() => {});
          state.editReplyId = rec.id;
          state.pendingBlockFiles = new Map();
          state.data = await S.getAll();
          toast("Resposta composta salva");
          renderManager();
          render();
          return;
        }
        let mediaId = existing.mediaId || null,
          fileName = existing.fileName || "",
          mimeType = existing.mimeType || "";
        const file =
          state.pendingMediaFile ||
          form.querySelector("#inlineMediaFile")?.files?.[0];
        if (
          ["image", "video", "document", "audio"].includes(type) &&
          !file &&
          !existing.mediaId
        )
          throw new Error("Selecione ou grave o arquivo desta resposta.");
        if (
          ["image", "video", "document", "audio"].includes(type) &&
          existing.type &&
          existing.type !== type &&
          !file
        )
          throw new Error(
            "Ao trocar o tipo de mídia, selecione um novo arquivo.",
          );
        if (file) {
          let media = file;
          if (type === "audio") {
            toast("Convertendo áudio para OGG/Opus...");
            media = await audioFileToOggOpus(file);
          }
          mediaId = S.uid("media");
          const dataUrl = await fileToDataURL(media),
            res = await chrome.runtime.sendMessage({
              type: "MEDIA_PUT",
              id: mediaId,
              dataUrl,
              mime: media.type,
              name: media.name,
              size: media.size,
            });
          if (!res?.ok) throw new Error(res?.error || "Falha ao salvar mídia");
          fileName = media.name;
          mimeType = media.type;
        }
        let text = String(fd.get("text") || ""),
          pixMessage = String(fd.get("pixMessage") || "").trim(),
          pixKey = String(fd.get("pixKey") || "").trim(),
          pixHolder = String(fd.get("pixHolder") || "").trim(),
          pixBank = String(fd.get("pixBank") || "").trim();
        if (type === "pix") {
          if (!pixKey) throw new Error("Informe a chave PIX.");
          text = "";
        }
        const oldBlockMedia = (existing.blocks || [])
          .map((b) => b.mediaId)
          .filter(Boolean);
        const rec = await S.saveReply({
          ...existing,
          id: existing.id || "",
          title: String(fd.get("title") || "").trim(),
          alias,
          categoryId: fd.get("categoryId"),
          type,
          text,
          pixMessage,
          caption: String(fd.get("caption") || ""),
          pixKey,
          pixHolder,
          pixBank,
          blocks: [],
          favorite: fd.get("favorite") === "on",
          sendMode: fd.get("sendMode") || (type === "pix" ? "send" : "insert"),
          voiceMode: type === "audio",
          mediaId,
          fileName,
          mimeType,
        });
        for (const oldId of oldBlockMedia)
          chrome.runtime
            .sendMessage({ type: "MEDIA_DELETE", id: oldId })
            .catch(() => {});
        state.editReplyId = rec.id;
        state.pendingMediaFile = null;
        state.data = await S.getAll();
        toast("Resposta rápida salva");
        renderManager();
        render();
      } catch (err) {
        console.error("[APOIS save reply]", err);
        toast("Não foi possível salvar: " + (err.message || err));
      }
    };
    form
      .querySelector("[data-delete-reply]")
      ?.addEventListener("click", async () => {
        if (!confirm("Excluir esta resposta rápida?")) return;
        await S.deleteReply(state.editReplyId);
        state.editReplyId = null;
        state.data = await S.getAll();
        toast("Resposta excluída");
        renderManager();
        render();
      });
    form
      .querySelector("[data-duplicate-reply]")
      ?.addEventListener("click", async () => {
        const src = state.data.quickReplies.find(
          (x) => x.id === state.editReplyId,
        );
        if (!src) return;
        let mediaId = await duplicateMedia(src.mediaId || null),
          blocks = [];
        for (const b of src.blocks || [])
          blocks.push({
            ...b,
            id: S.uid("blk"),
            mediaId: await duplicateMedia(b.mediaId || null),
          });
        const rec = await S.saveReply({
          ...src,
          id: "",
          title: src.title + " (cópia)",
          alias: "",
          mediaId,
          blocks,
          useCount: 0,
          lastUsedAt: null,
          createdAt: Date.now(),
        });
        state.editReplyId = rec.id;
        state.data = await S.getAll();
        toast("Resposta duplicada");
        renderManager();
        render();
      });
  }

  function bindPixEditor(form) {
    const box = form.querySelector(".pix-editor");
    if (!box) return;
    const update = () => {
      const temp = {
        type: "pix",
        pixKey: form.querySelector('[name="pixKey"]')?.value || "",
        pixHolder: form.querySelector('[name="pixHolder"]')?.value || "",
        pixBank: form.querySelector('[name="pixBank"]')?.value || "",
        pixMessage: form.querySelector('[name="pixMessage"]')?.value || "",
      };
      const pre = form.querySelector("[data-pix-preview] pre");
      if (pre)
        pre.textContent =
          buildPix(temp) || "Preencha a chave PIX para visualizar.";
    };
    box
      .querySelectorAll("input,textarea")
      .forEach((el) => el.addEventListener("input", update));
    update();
  }

  function bindInlineRecord(form) {
    const btn = form.querySelector("#inlineRecordAudio");
    if (!btn) return;
    const status = form.querySelector("#inlineRecordStatus"),
      preview = form.querySelector("#inlineRecordPreview");
    btn.onclick = async () => {
      if (state.recorder && state.recorder.state === "recording") {
        state.recorder.stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        state.recordStream = stream;
        const chunks = [],
          mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm",
          rec = new MediaRecorder(stream, { mimeType: mime });
        state.recorder = rec;
        rec.ondataavailable = (e) => {
          if (e.data?.size) chunks.push(e.data);
        };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          state.recordStream = null;
          const blob = new Blob(chunks, { type: mime }),
            file = new File([blob], `audio-${Date.now()}.webm`, { type: mime });
          state.pendingMediaFile = file;
          preview.src = URL.createObjectURL(blob);
          preview.hidden = false;
          status.textContent = `Gravação pronta • ${(blob.size / 1024).toFixed(0)} KB`;
          btn.textContent = "🎙 Gravar novamente";
        };
        rec.start(250);
        status.textContent = "Gravando... clique para parar";
        btn.textContent = "⏹ Parar gravação";
      } catch (err) {
        toast("Não foi possível acessar o microfone: " + (err.message || err));
      }
    };
  }

  async function exportInlineBackup() {
    try {
      toast("Preparando backup...");
      const data = await S.getAll(),
        media = await chrome.runtime.sendMessage({ type: "MEDIA_EXPORT" }),
        payload = {
          format: "APOIS_QUICK_REPLIES_BACKUP",
          version: 2,
          exportedAt: new Date().toISOString(),
          data,
          media: media?.items || [],
        },
        blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        }),
        a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download =
        "apois-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      managedTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Backup gerado");
    } catch (e) {
      toast("Falha ao gerar backup: " + (e.message || e));
    }
  }
  async function restoreInlineBackup(file) {
    if (!file) return;
    try {
      const payload = Core.validateBackup(JSON.parse(await file.text()));
      const normalized = S.normalize(payload.data);
      if (
        !confirm(
          "Restaurar este backup substitui as configurações atuais. Deseja continuar?",
        )
      )
        return;
      const mapping = new Map(
        payload.media.map((media) => [media.id, S.uid("media")]),
      );
      const media = payload.media.map((item) => ({
        ...item,
        id: mapping.get(item.id),
      }));
      for (const reply of normalized.quickReplies)
        for (const item of [reply, ...reply.blocks])
          if (item.mediaId) item.mediaId = mapping.get(item.mediaId);
      const response = await chrome.runtime.sendMessage({
        type: "MEDIA_RESTORE",
        items: media,
      });
      if (!response?.ok)
        throw new Error(response?.error || "Falha ao restaurar mídias");
      await S.restoreData(normalized);
      state.data = await S.getAll();
      toast("Backup restaurado");
      renderManager();
      render();
      decorateList();
    } catch (error) {
      window.APOISDiagnostics.record(error, "backup");
      toast("Falha ao restaurar: " + error.message);
    }
  }

  function outgoingIdSet() {
    return new Set(
      outgoingMessageNodes().map(messageIdFromNode).filter(Boolean),
    );
  }
  function attendantSignaturePrefix(att = assignedAttendantForCurrent()) {
    return att?.name ? `*_${att.name}:_*` : "";
  }
  function hasAnyAttendantSignature(text = "") {
    return (
      /^\*_[^*\n]{1,80}:_\*(?:\s*\n|\s{2,})/.test(String(text)) ||
      /^\*_[^*\n]{1,80}:_\*$/.test(String(text).trim())
    );
  }
  function applyAttendantSignature(
    text = "",
    att = assignedAttendantForCurrent(),
  ) {
    return Core.signature(text, att);
  }

  function escapeRegExp(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function clearLegacyPreloadedSignature() {
    const input =
      document.querySelector("#main footer div[contenteditable=true]") ||
      getComposer();
    if (!input) return false;
    const raw = (input.innerText || input.textContent || "")
      .replace(/\u00a0/g, " ")
      .trim();
    if (!raw) return false;
    let rest = raw;
    const attendants = (state.data?.attendants || [])
      .map((a) => a?.name)
      .filter(Boolean);
    for (const name of attendants) {
      const n = escapeRegExp(name);
      rest = rest.replace(new RegExp(`\\*_\\s*${n}\\s*:_\\*`, "gi"), " ");
      rest = rest.replace(new RegExp(`\\*\\s*${n}\\s*:\\s*\\*`, "gi"), " ");
      rest = rest.replace(
        new RegExp(`_?\\*?\\s*${n}\\s*:\\s*\\*?_?`, "gi"),
        " ",
      );
    }
    const residue = rest.replace(/[\s*_:\-–—|•·]+/g, "").trim();
    if (residue !== "") return false;
    try {
      input.focus();
      const sel = window.getSelection(),
        range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("delete", false, null);
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
          data: null,
        }),
      );
    } catch {
      input.textContent = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  function referenceComposer() {
    return (
      document.querySelector("footer div[contenteditable=true]") ||
      getComposer()
    );
  }

  function referenceComposerText() {
    return Core.composerText(referenceComposer());
  }

  const REFERENCE_SELECTORS = {
    assChat: ["#main > div.x1n2onr6.x1vjfegm.x1cqoux5.x14yy4lh"],
    assInput: [
      "._1VZX7 ._3Uu1_, ._ak1r > div",
      "#main footer div[contenteditable=true]",
    ],
    assBtn: [
      "#main > footer > div > div > span > div > div._ak1r > div > div.x9f619.x78zum5.x6s0dn4",
      "#main > footer > div.copyable-area > div > span > div > div._ak1r > div.x123j3cw",
    ],
    assEmoji: [
      '#main > footer > div.copyable-area > div > span > div > div._ak1m > div > button[tabindex="-1"]',
    ],
    assCitacao: [
      "#main > footer > div:nth-child(3) > div > div:nth-child(4) > div > div > div > button",
      "#main > footer > div:nth-child(3) > div > div > span > div > div > div.x9f619 > button",
    ],
    mainAudio: ["footer > div.copyable-area > div", "#main footer > div"],
  };

  function referenceQuery(name) {
    for (const sel of REFERENCE_SELECTORS[name] || []) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function replaceEditableText(el, text) {
    if (!el) return false;
    try {
      // Use somente quando realmente precisamos substituir um campo vazio/preview.
      // Para mensagem já digitada usamos prependAttendantSignature(), abaixo.
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("insertText", false, String(text ?? ""));
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: String(text ?? ""),
        }),
      );
      return true;
    } catch (e) {
      console.warn("[APOIS assinatura] falha ao alterar campo:", e);
      return false;
    }
  }

  function visibleEditableBoxes(scope = document) {
    return [
      ...scope.querySelectorAll(
        '[contenteditable="true"][role="textbox"],div[contenteditable="true"]',
      ),
    ].filter((el) => {
      if (el.closest("#apois-root,#apois-manager-root")) return false;
      const r = el.getBoundingClientRect(),
        st = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        st.display !== "none" &&
        st.visibility !== "hidden"
      );
    });
  }
  function signAttachmentCaptionNow() {
    const att = assignedAttendantForCurrent();
    if (!att) return false;
    const boxes = visibleEditableBoxes(
      document.querySelector("#main") || document,
    );
    const composer = getComposer();
    const candidates = boxes.filter(
      (el) => el !== composer && !el.closest("footer"),
    );
    const box = candidates.at(-1);
    if (!box) return false;
    return prependAttendantSignature(box, att);
  }

  function assignedAttendantForCurrent() {
    const name = state.currentName || currentChatName();
    if (!name) return null;
    const ass = currentAssignment(name);
    const contact =
      state.data?.contacts?.[identityKey(name, currentAccountId())] || null;
    const selected =
      state.panel?.querySelector?.("[data-current-attendant]")?.value || "";
    const id = ass?.attendantId || contact?.assignedTo || selected || "";
    const attendant = attendantById(id);
    return attendant?.active === false ? null : attendant;
  }
  async function saveAttributionForNode(
    node,
    att,
    context = { accountId: currentAccountId(), name: currentChatName() },
  ) {
    if (!node || !att) return null;
    const id = messageIdFromNode(node);
    if (!id) return null;
    attributionBadge(node, att, accountById(currentAccountId()));
    state.outgoingSeen.add(id);
    try {
      const rec = await S.saveMessageAttribution(
        id,
        context.accountId,
        context.name,
        att.id,
      );
      if (rec)
        state.data.messageAttributions = {
          ...(state.data.messageAttributions || {}),
          [rec.key]: rec,
        };
      return rec;
    } catch (e) {
      console.warn("[APOIS attribution explicit]", e);
      return null;
    }
  }
  async function attributeNextOutgoing(
    before,
    timeout = 8000,
    context = {
      att: assignedAttendantForCurrent(),
      accountId: currentAccountId(),
      name: currentChatName(),
      token: conversationToken(),
    },
  ) {
    const att = context.att;
    if (!att) return null;
    const end = Date.now() + timeout;
    let newestRight = null;

    while (Date.now() < end) {
      if (context.token !== conversationToken()) return null;
      const candidates = messageCandidateNodes();

      // 1. Novo ID genuíno.
      for (let i = candidates.length - 1; i >= 0; i--) {
        const node = candidates[i],
          id = messageIdFromNode(node);
        if (id && !before.has(id) && isOutgoingMessageNode(node)) {
          return saveAttributionForNode(node, att, context);
        }
      }

      // 2. Fallback geométrico: último bubble do lado direito surgido/alterado.
      for (let i = candidates.length - 1; i >= 0; i--) {
        const node = candidates[i];
        if (looksOutgoingByGeometry(node)) {
          newestRight = node;
          break;
        }
      }
      if (newestRight) {
        const id = messageIdFromNode(newestRight);
        if (id && !before.has(id)) {
          await sleep(160);
          return saveAttributionForNode(newestRight, att, context);
        }
      }

      await sleep(100);
    }
    return null;
  }

  function getComposer() {
    const all = [
      ...document.querySelectorAll(
        '#main footer [contenteditable="true"][role="textbox"],#main footer div[contenteditable="true"],footer [contenteditable="true"][role="textbox"]',
      ),
    ];
    return all.find((el) => el.offsetParent !== null) || all[0] || null;
  }
  function setComposerText(text, append = false) {
    const input = getComposer();
    if (!input) {
      toast("Campo de mensagem não encontrado");
      return false;
    }
    input.focus();
    const range = document.createRange(),
      selection = window.getSelection();
    range.selectNodeContents(input);
    if (append) range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand("insertText", false, String(text));
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: String(text),
      }),
    );
    return ok;
  }
  async function sendComposer() {
    await sleep(100);
    const footer = document.querySelector("#main footer");
    const icon = footer?.querySelector('[data-icon="send"]');
    const btn =
      icon?.closest('button,[role="button"]') ||
      [...(footer?.querySelectorAll("button") || [])].find((b) =>
        /enviar|send/i.test(b.getAttribute("aria-label") || b.title || ""),
      );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }
  function buildPix(r) {
    const lines = [],
      intro = String(
        r.pixMessage ??
          (String(r.text || "").trim() === "Chave PIX:" ? "" : r.text || ""),
      ).trim(),
      key = String(r.pixKey || "").trim(),
      holder = String(r.pixHolder || "").trim(),
      bank = String(r.pixBank || "").trim();
    if (intro) lines.push(intro);
    if (key) lines.push(`Chave PIX: ${key}`);
    if (holder) lines.push(`Titular: ${holder}`);
    if (bank) lines.push(`Banco: ${bank}`);
    return lines.join("\n");
  }
  async function sendSequenceReply(r, ctx) {
    const blocks = [...(r.blocks || [])].sort(
      (a, b) => (a.order || 0) - (b.order || 0),
    );
    if (!blocks.length)
      throw new Error("Esta resposta composta não possui itens.");
    toast(`Enviando sequência • ${blocks.length} itens`, 3500);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i],
        item = { ...b, title: `${r.title} • ${i + 1}/${blocks.length}` };
      assertConversation(ctx.conversationToken || conversationToken());
      if (b.type === "text") {
        const txt = S.expand(b.text || "", ctx);
        if (txt.trim()) await sendDirectText(txt);
      } else if (b.type === "pix") {
        const txt = S.expand(buildPix(b), ctx);
        if (!txt.trim()) throw new Error(`PIX do item ${i + 1} está vazio.`);
        await sendDirectText(txt);
      } else if (b.type === "audio") {
        await sendVoiceReply(item, ctx);
      } else if (["image", "video", "document"].includes(b.type)) {
        await sendDirectMedia(item, ctx);
      } else throw new Error(`Tipo desconhecido no item ${i + 1}.`);
      if (i < blocks.length - 1) await sleep(500);
    }
    toast("Sequência enviada");
  }

  async function useReply(id, button) {
    try {
      return await executionLock.run(() => useReplyUnlocked(id, button));
    } catch (error) {
      toast(error.message);
    }
  }
  async function useReplyUnlocked(id, button) {
    const r = state.data.quickReplies.find((x) => x.id === id);
    if (!r) return;
    const name = state.currentName || currentChatName();
    if (!name) {
      toast("Abra uma conversa primeiro");
      return;
    }
    button?.classList.add("busy");
    try {
      const ctx = { name, conversationToken: conversationToken() };
      if (r.type === "sequence") {
        await sendSequenceReply(r, ctx);
      } else if (r.type === "text" || r.type === "pix") {
        const raw = r.type === "pix" ? buildPix(r) : r.text;
        if (r.type === "pix" && !String(raw || "").trim()) {
          toast("Cadastre a chave PIX antes de usar");
          openManager("replies", r.id);
          return;
        }
        const txt = S.expand(raw, ctx);
        const mode =
          r.type === "pix" && r.id === "qr_pix" && r.sendMode === "insert"
            ? "send"
            : r.sendMode;
        if (mode === "send") {
          toast(r.type === "pix" ? "Enviando PIX..." : "Enviando...");
          await sendDirectText(txt);
          toast(r.type === "pix" ? "PIX enviado" : "Enviado");
        } else setComposerText(txt);
      } else if (r.type === "audio") {
        await sendVoiceReply(r, ctx);
      } else {
        toast("Enviando mídia...");
        await sendDirectMedia(r, ctx);
        toast("Mídia enviada");
      }
      await S.recordUse(r.id, r.type);
      state.data = await S.getAll();
      if (state.data.settings.closeAfterUse) {
        state.open = false;
      }
      render();
    } catch (e) {
      window.APOISDiagnostics.record(e, "resposta rápida");
      console.error("[APOIS]", e);
      toast("Não foi possível usar esta resposta: " + (e.message || e));
    } finally {
      button?.classList.remove("busy");
    }
  }

  async function getMedia(r) {
    if (!r.mediaId) throw new Error("Nenhum arquivo cadastrado");
    const res = await chrome.runtime.sendMessage({
      type: "MEDIA_GET",
      id: r.mediaId,
    });
    if (!res?.ok) throw new Error("Arquivo de mídia não encontrado");
    const blob = await (await fetch(res.dataUrl)).blob();
    return {
      blob,
      file: new File([blob], res.name || r.fileName || "arquivo", {
        type: res.mime || r.mimeType || blob.type,
      }),
      ...res,
    };
  }
  function findAttachButton() {
    const footer = document.querySelector("#main footer");
    if (!footer) return null;
    const icon = footer.querySelector(
      '[data-icon="plus-rounded"],[data-icon="clip"]',
    );
    if (icon) return icon.closest('button,[role="button"]');
    return [...footer.querySelectorAll('button,[role="button"]')].find((b) =>
      /anexar|attach|adicionar/i.test(
        b.getAttribute("aria-label") || b.title || "",
      ),
    );
  }
  function selectInput(type) {
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter(
      (i) => i.offsetParent !== null || i.accept || i.multiple,
    );
    if (!inputs.length) return null;
    if (type === "image" || type === "video")
      return (
        inputs.find((i) => /image|video/.test(i.accept || "")) || inputs[0]
      );
    if (type === "document" || type === "audio")
      return (
        inputs.find((i) => !i.accept || !/image|video/.test(i.accept)) ||
        inputs.at(-1)
      );
    return inputs[0];
  }
  async function attachMediaReply(r, ctx) {
    const m = await getMedia(r);
    let input = selectInput(r.type);
    if (!input) {
      findAttachButton()?.click();
      await sleep(350);
      input = selectInput(r.type);
    }
    if (!input) throw new Error("Seletor de anexo do WhatsApp não encontrado");
    const dt = new DataTransfer();
    dt.items.add(m.file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    toast("Mídia carregada");
    await sleep(750);
    const caption = S.expand(r.caption || "", ctx);
    if (caption) {
      const boxes = [
        ...document.querySelectorAll(
          '[contenteditable="true"][role="textbox"]',
        ),
      ].filter((x) => x.offsetParent !== null);
      const box = boxes.at(-1);
      if (box && box !== getComposer()) {
        box.focus();
        document.execCommand("insertText", false, caption);
        box.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: caption,
            inputType: "insertText",
          }),
        );
      }
    }
    if (state.data.settings.mediaAutoSend) {
      await sleep(250);
      const dialogs = [
        ...document.querySelectorAll('[role="dialog"],div'),
      ].filter((x) => x.offsetParent !== null);
      const scope = dialogs.at(-1) || document;
      const send =
        scope
          .querySelector('[data-icon="send"]')
          ?.closest('button,[role="button"]') ||
        [...scope.querySelectorAll("button")].find((b) =>
          /enviar|send/i.test(b.getAttribute("aria-label") || b.title || ""),
        );
      send?.click();
    }
  }

  async function pingBridge(showToast = false) {
    try {
      await ensureNativeBridge();
      const id = "native_ping_" + Date.now();
      const p = waitNative(id, "NATIVE_STATUS", 5000);
      window.postMessage(
        { source: "APOIS_CONTENT_NATIVE", type: "NATIVE_PING", id },
        "*",
      );
      const msg = await p;
      state.bridgeState = {
        ok: !!msg.ok,
        error: "",
        state: { mode: "native", ...msg },
      };
      clearNativeSession(id);
      if (showToast) toast("Modo nativo pronto");
      return !!msg.ok;
    } catch (e) {
      state.bridgeState = { ok: false, error: e.message || String(e) };
      if (showToast)
        toast("Modo nativo indisponível: " + state.bridgeState.error);
      return false;
    }
  }

  async function sendDirectText(text) {
    const expected = conversationToken(),
      before = outgoingIdSet(),
      input = getComposer();
    if (!input) throw new Error("Campo de mensagem não encontrado");
    const draft = Core.composerText(input),
      att = assignedAttendantForCurrent();
    state.manualBypass = true;
    try {
      assertConversation(expected);
      if (!setComposerText(applyAttendantSignature(text, att)))
        throw new Error("Campo de mensagem indisponível");
      assertConversation(expected);
      if (!(await sendComposer()))
        throw new Error("Botão Enviar não encontrado");
      const end = Date.now() + 5000;
      while (
        Date.now() < end &&
        conversationToken() === expected &&
        Core.composerText(getComposer()).trim()
      )
        await sleep(80);
      if (conversationToken() !== expected)
        throw new Error(
          "A conversa mudou após acionar o envio; confira a conversa anterior.",
        );
      if (Core.composerText(getComposer()).trim())
        throw new Error(
          "O WhatsApp não confirmou o envio. Confira antes de tentar novamente.",
        );
      if (draft) setComposerText(draft);
    } finally {
      state.manualBypass = false;
    }
    await attributeNextOutgoing(before, 2500).catch(() => {});
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      st.visibility !== "hidden" &&
      st.display !== "none"
    );
  }
  function footerScope() {
    return (
      document.querySelector("#main footer") || document.querySelector("footer")
    );
  }
  function findVoiceButton() {
    const footer = footerScope();
    if (!footer) return null;
    const selectors = [
      '[data-icon="ptt"]',
      '[data-icon="mic"]',
      '[data-icon="microphone"]',
      '[data-icon="voice-message"]',
      '[data-icon="audio-record"]',
      '[data-testid*="ptt"]',
      '[data-testid*="mic"]',
    ];
    for (const sel of selectors) {
      const icon = [...footer.querySelectorAll(sel)].find(visible);
      const btn = icon?.closest('button,[role="button"]');
      if (btn && visible(btn)) return btn;
    }
    const re =
      /mensagem de voz|gravar(?: mensagem)?|microfone|voice message|voice note|record voice|microphone|record audio/i;
    return (
      [...footer.querySelectorAll('button,[role="button"]')].find((b) => {
        if (!visible(b)) return false;
        const txt = [
          b.getAttribute("aria-label"),
          b.getAttribute("title"),
          b.getAttribute("data-testid"),
          b.textContent,
        ]
          .filter(Boolean)
          .join(" ");
        return re.test(txt);
      }) || null
    );
  }
  function findRecordingSendButton() {
    const scope = document.querySelector("#main") || document;
    const icons = [...scope.querySelectorAll('[data-icon="send"]')].filter(
      visible,
    );
    for (const icon of icons) {
      const btn = icon.closest('button,[role="button"]');
      if (btn && visible(btn)) return btn;
    }
    const re = /enviar|send/i;
    return (
      [...scope.querySelectorAll('button,[role="button"]')].find((b) => {
        if (!visible(b)) return false;
        const txt = [
          b.getAttribute("aria-label"),
          b.getAttribute("title"),
          b.getAttribute("data-testid"),
        ]
          .filter(Boolean)
          .join(" ");
        return re.test(txt);
      }) || null
    );
  }
  function composerSnapshot() {
    const el = getComposer();
    if (!el) return { el: null, text: "" };
    return { el, text: el.innerText || el.textContent || "" };
  }
  function clearComposerForVoice() {
    const el = getComposer();
    if (!el) return "";
    const text = el.innerText || el.textContent || "";
    if (text) {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
        }),
      );
    }
    return text;
  }
  async function restoreComposer(text) {
    if (!text) return;
    await sleep(500);
    const el = getComposer();
    if (!el) return;
    el.focus();
    document.execCommand("insertText", false, text);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }

  async function waitForButton(fn, timeout = 5000, step = 80) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const b = fn();
      if (b) return b;
      await sleep(step);
    }
    return null;
  }

  function formatProgressTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(sec / 60),
      s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function progressIcon(kind) {
    return (
      {
        audio: "🎙",
        image: "🖼",
        video: "🎬",
        document: "📎",
        text: "💬",
        pix: "◆",
      }[kind] || "↥"
    );
  }
  function ensureSendProgress() {
    let box = document.getElementById("apois-send-progress");
    if (box) return box;
    box = document.createElement("div");
    box.id = "apois-send-progress";
    box.innerHTML = `<div class="asp-card">
      <div class="asp-icon">↥</div>
      <div class="asp-main">
        <div class="asp-top"><strong>APOIS</strong><span class="asp-status">Preparando...</span><em class="asp-elapsed">00:00</em></div>
        <div class="asp-title"></div>
        <div class="asp-track"><i></i></div>
        <div class="asp-detail"></div>
      </div>
    </div>`;
    document.body.appendChild(box);
    return box;
  }
  function showSendProgress(
    kind,
    title,
    status = "Preparando...",
    percent = 3,
    detail = "",
  ) {
    managedClearInterval(state.sendProgressTimer);
    const now = Date.now();
    state.sendProgress = {
      kind,
      title,
      status,
      percent,
      detail,
      startedAt: now,
      total: 0,
      phaseStartedAt: now,
    };
    const box = ensureSendProgress();
    box.className = "show";
    box.querySelector(".asp-icon").textContent = progressIcon(kind);
    box.querySelector(".asp-status").textContent = status;
    box.querySelector(".asp-title").textContent = title || "Resposta rápida";
    box.querySelector(".asp-detail").textContent =
      detail || "Aguarde enquanto o WhatsApp prepara o envio.";
    box.querySelector(".asp-track i").style.width =
      `${Math.max(2, Math.min(100, percent))}%`;
    box.querySelector(".asp-elapsed").textContent = "00:00";
    state.sendProgressTimer = managedInterval(() => {
      const p = state.sendProgress;
      if (!p) return;
      const elapsed = (Date.now() - p.startedAt) / 1000;
      const el = box.querySelector(".asp-elapsed");
      if (el) el.textContent = formatProgressTime(elapsed);
    }, 500);
  }
  function updateSendProgress(status, percent, detail = "") {
    const p = state.sendProgress;
    if (!p) return;
    if (status) p.status = status;
    if (Number.isFinite(percent)) p.percent = percent;
    if (detail !== undefined && detail !== "") p.detail = detail;
    const box = ensureSendProgress();
    box.classList.add("show");
    box.querySelector(".asp-status").textContent = p.status || "Enviando...";
    box.querySelector(".asp-detail").textContent = p.detail || "";
    if (Number.isFinite(p.percent))
      box.querySelector(".asp-track i").style.width =
        `${Math.max(2, Math.min(100, p.percent))}%`;
  }
  function startAudioTimedProgress(duration, title) {
    const total = Math.max(0.1, Number(duration) || 0);
    const started = Date.now();
    if (state.sendProgress) state.sendProgress.total = total;
    managedClearInterval(state.sendProgressTimer);
    const box = ensureSendProgress();
    state.sendProgressTimer = managedInterval(() => {
      const elapsed = Math.min(total, (Date.now() - started) / 1000);
      const pct = 15 + (elapsed / total) * 75;
      updateSendProgress(
        "Enviando áudio",
        pct,
        `${title || "Áudio"} • ${formatProgressTime(elapsed)} / ${formatProgressTime(total)}`,
      );
      const el = box.querySelector(".asp-elapsed");
      if (el)
        el.textContent = formatProgressTime(
          (Date.now() - (state.sendProgress?.startedAt || started)) / 1000,
        );
    }, 350);
  }
  function finishSendProgress(message = "Enviado", detail = "") {
    managedClearInterval(state.sendProgressTimer);
    state.sendProgressTimer = null;
    const p = state.sendProgress || {};
    const box = ensureSendProgress();
    box.className = "show success";
    box.querySelector(".asp-status").textContent = message;
    box.querySelector(".asp-detail").textContent =
      detail || "Envio concluído pelo WhatsApp.";
    box.querySelector(".asp-track i").style.width = "100%";
    managedTimeout(() => {
      box.classList.remove("show", "success", "error");
      state.sendProgress = null;
    }, 2600);
  }
  function failSendProgress(error) {
    managedClearInterval(state.sendProgressTimer);
    state.sendProgressTimer = null;
    const box = ensureSendProgress();
    box.className = "show error";
    box.querySelector(".asp-status").textContent = "Falha no envio";
    box.querySelector(".asp-detail").textContent = String(
      error?.message || error || "Erro desconhecido",
    );
    managedTimeout(() => {
      box.classList.remove("show", "success", "error");
      state.sendProgress = null;
    }, 6500);
  }

  async function sendNativeVoice(r, ctx) {
    showSendProgress(
      "audio",
      r.title || "Áudio",
      "Carregando áudio...",
      3,
      "Lendo a resposta rápida salva.",
    );
    const m = await chrome.runtime.sendMessage({
      type: "MEDIA_GET",
      id: r.mediaId,
    });
    if (!m?.ok) {
      const e = new Error("Arquivo de áudio não encontrado");
      failSendProgress(e);
      throw e;
    }
    await ensureNativeBridge();

    const id =
      "voice_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const previousText = clearComposerForVoice();

    try {
      updateSendProgress(
        "Preparando nota de voz...",
        7,
        "Preparando o áudio para o gravador do WhatsApp.",
      );
      const armed = waitNative(id, "NATIVE_AUDIO_ARMED", 12000);
      window.postMessage(
        {
          source: "APOIS_CONTENT_NATIVE",
          type: "NATIVE_AUDIO_PREPARE",
          id,
          dataUrl: m.dataUrl,
          mimeType: m.mime || r.mimeType || "",
        },
        "*",
      );
      const info = await armed;

      updateSendProgress(
        "Abrindo gravador...",
        11,
        `${r.title || "Áudio"} • duração ${formatProgressTime(info.duration || 0)}`,
      );

      const mic = await waitForButton(findVoiceButton, 5000);
      if (!mic)
        throw new Error("Botão de mensagem de voz do WhatsApp não encontrado");
      const micDesc = [
        mic.getAttribute("aria-label"),
        mic.getAttribute("title"),
        mic.getAttribute("data-testid"),
        mic.querySelector("[data-icon]")?.getAttribute("data-icon"),
      ]
        .filter(Boolean)
        .join(" | ");
      console.debug(
        "[APOIS] botão de voz detectado:",
        micDesc || mic.outerHTML.slice(0, 180),
      );

      const captured = waitNative(id, "NATIVE_STREAM_CAPTURED", 10000);
      const fire = (type, Ctor, extra = {}) => {
        try {
          mic.dispatchEvent(
            new Ctor(type, {
              bubbles: true,
              cancelable: true,
              view: window,
              ...extra,
            }),
          );
        } catch {}
      };
      mic.focus?.();
      fire("pointerdown", PointerEvent, {
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
      });
      fire("mousedown", MouseEvent, { button: 0, buttons: 1 });
      fire("pointerup", PointerEvent, {
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
      });
      fire("mouseup", MouseEvent, { button: 0, buttons: 0 });
      mic.click();
      await captured;

      updateSendProgress(
        "Gravador conectado",
        14,
        "O WhatsApp começou a receber o áudio.",
      );
      await sleep(450);

      const started = waitNative(id, "NATIVE_AUDIO_STARTED", 5000);
      const ended = waitNative(
        id,
        "NATIVE_AUDIO_ENDED",
        Math.max(15000, Math.ceil((info.duration || 0) * 1000) + 10000),
      );
      window.postMessage(
        { source: "APOIS_CONTENT_NATIVE", type: "NATIVE_AUDIO_START", id },
        "*",
      );
      await started;

      // Este método reproduz o áudio para o gravador do WhatsApp em tempo real.
      // O indicador mostra exatamente quanto falta.
      startAudioTimedProgress(info.duration || 0, r.title || "Áudio");
      await ended;

      managedClearInterval(state.sendProgressTimer);
      state.sendProgressTimer = null;
      updateSendProgress(
        "Finalizando nota de voz...",
        93,
        "Áudio recebido. Preparando o envio no WhatsApp.",
      );

      const send = await waitForButton(findRecordingSendButton, 5000);
      if (!send) throw new Error("Botão de enviar da gravação não encontrado");
      const beforeOutgoing = outgoingIdSet();
      assertConversation(ctx.conversationToken || conversationToken());
      send.click();
      await attributeNextOutgoing(beforeOutgoing, 9000);

      updateSendProgress(
        "Confirmando envio...",
        98,
        "O WhatsApp está finalizando a mensagem.",
      );
      window.postMessage(
        { source: "APOIS_CONTENT_NATIVE", type: "NATIVE_AUDIO_FINISH", id },
        "*",
      );
      await sleep(650);
      finishSendProgress(
        "Áudio enviado",
        `${r.title || "Nota de voz"} • concluído`,
      );
    } catch (e) {
      window.postMessage(
        { source: "APOIS_CONTENT_NATIVE", type: "NATIVE_AUDIO_CANCEL", id },
        "*",
      );
      failSendProgress(e);
      throw e;
    } finally {
      clearNativeSession(id);
      await restoreComposer(previousText);
    }
  }

  async function sendNativeAttachment(r, ctx) {
    const label =
      { image: "imagem", video: "vídeo", document: "arquivo" }[r.type] ||
      "arquivo";
    showSendProgress(
      r.type,
      r.title || r.fileName || label,
      `Preparando ${label}...`,
      8,
      "Carregando o arquivo salvo.",
    );
    try {
      const m = await getMedia(r);
      updateSendProgress(
        `Abrindo ${label}...`,
        24,
        "Preparando a tela de envio do WhatsApp.",
      );
      let input = selectInput(r.type);
      if (!input) {
        const attach = findAttachButton();
        if (!attach)
          throw new Error("Botão de anexar do WhatsApp não encontrado");
        attach.click();
        await sleep(350);
        input = selectInput(r.type);
      }
      if (!input) throw new Error("Campo de anexo do WhatsApp não encontrado");
      const dt = new DataTransfer();
      dt.items.add(m.file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      updateSendProgress(
        `Carregando ${label}...`,
        52,
        `${r.fileName || m.name || r.title || label}`,
      );
      await sleep(750);

      const rawCaption = S.expand(r.caption || "", ctx);
      const caption =
        r.type === "image" || r.type === "video"
          ? applyAttendantSignature(rawCaption)
          : rawCaption;
      if (caption) {
        const boxes = [
          ...document.querySelectorAll(
            '[contenteditable="true"][role="textbox"],div[contenteditable="true"]',
          ),
        ].filter(visible);
        const box =
          boxes
            .filter((x) => x !== getComposer() && !x.closest("footer"))
            .at(-1) || boxes.at(-1);
        if (box && box !== getComposer()) {
          const current = (box.innerText || box.textContent || "").trim();
          if (!current) {
            box.focus();
            document.execCommand("insertText", false, caption);
            box.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                data: caption,
                inputType: "insertText",
              }),
            );
          }
        }
      }
      updateSendProgress(
        `Enviando ${label}...`,
        78,
        "O WhatsApp está processando o envio.",
      );
      const send = await waitForButton(() => {
        const dialogs = [
          ...document.querySelectorAll('[role="dialog"]'),
        ].filter(visible);
        const scope =
          dialogs.at(-1) || document.querySelector("#main") || document;
        const icon = [...scope.querySelectorAll('[data-icon="send"]')].find(
          visible,
        );
        return (
          icon?.closest('button,[role="button"]') ||
          [...scope.querySelectorAll('button,[role="button"]')].find(
            (b) =>
              visible(b) &&
              /enviar|send/i.test(
                (b.getAttribute("aria-label") || "") + " " + (b.title || ""),
              ),
          )
        );
      }, 6000);
      if (!send) throw new Error("Botão de enviar anexo não encontrado");
      const beforeOutgoing = outgoingIdSet();
      assertConversation(ctx.conversationToken || conversationToken());
      send.click();
      await attributeNextOutgoing(beforeOutgoing, 9000);
      updateSendProgress(
        `Finalizando ${label}...`,
        96,
        "Envio acionado no WhatsApp.",
      );
      await sleep(550);
      finishSendProgress(
        `${label[0].toUpperCase() + label.slice(1)} enviado`,
        r.title || r.fileName || "Concluído",
      );
    } catch (e) {
      failSendProgress(e);
      throw e;
    }
  }

  async function sendDirectMedia(r, ctx) {
    const expected = ctx.conversationToken || conversationToken();
    assertConversation(expected);
    let ready = false;
    try {
      ready = await referenceCall("Webpack", "isFullReady", null, 1000);
    } catch {}
    if (ready) {
      const media = await getMedia(r),
        chatID = await referenceActiveChatId();
      assertConversation(expected);
      showSendProgress(
        r.type,
        r.title || r.fileName,
        "Preparando mídia...",
        5,
        "Envio direto pelo WhatsApp",
      );
      try {
        updateSendProgress(
          "Enviando...",
          40,
          "Aguardando aceitação pelo WhatsApp",
        );
        const before = outgoingIdSet();
        await referenceCall(
          "Chat",
          "sendMedia",
          {
            id: chatID,
            mediaType: r.type,
            dataUrl: media.dataUrl,
            fileName: media.name,
            caption:
              r.type === "audio"
                ? ""
                : applyAttendantSignature(S.expand(r.caption || "", ctx)),
          },
          120000,
        );
        await attributeNextOutgoing(before, 2500);
        finishSendProgress("Enviado", r.title || r.fileName);
        return;
      } catch (error) {
        failSendProgress(error);
        throw new Error(
          error.message + " Confira a conversa antes de tentar novamente.",
        );
      }
    }
    if (r.type === "audio") return sendNativeVoice(r, ctx);
    return sendNativeAttachment(r, ctx);
  }
  async function sendVoiceReply(r, ctx) {
    return sendDirectMedia(r, ctx);
  }

  function bindSlash() {
    if (!state.data?.settings.slashCommands) return;
    const el = getComposer();
    if (!el || el.dataset.apoisSlash) return;
    el.dataset.apoisSlash = "1";
    el.addEventListener("input", () => {
      const txt = (el.innerText || el.textContent || "").trim();
      if (txt.startsWith("/") && !txt.includes("\n")) showSlash(txt.slice(1));
      else hideSlash();
    });
    el.addEventListener("keydown", (e) => {
      if (!state.slash) return;
      if (e.key === "Escape") {
        hideSlash();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...state.slash.querySelectorAll(".slash-row")];
        let i = rows.findIndex((x) => x.classList.contains("sel"));
        i = (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        rows.forEach((x, j) => x.classList.toggle("sel", j === i));
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const sel =
          state.slash.querySelector(".slash-row.sel") ||
          state.slash.querySelector(".slash-row");
        if (sel) {
          e.preventDefault();
          hideSlash();
          setComposerText("");
          useReply(sel.dataset.reply);
        }
      }
    });
  }
  function showSlash(q) {
    const term = normalize(q);
    const items = state.data.quickReplies
      .filter(
        (r) =>
          !term ||
          normalize(r.alias).startsWith(term) ||
          normalize(r.title).includes(term),
      )
      .slice(0, 8);
    if (!items.length) {
      hideSlash();
      return;
    }
    if (!state.slash) {
      state.slash = document.createElement("div");
      state.slash.className = "apois-slash";
      document.body.appendChild(state.slash);
    }
    const comp = getComposer(),
      rect = comp.getBoundingClientRect();
    state.slash.style.left = Math.max(10, rect.left) + "px";
    state.slash.style.bottom = window.innerHeight - rect.top + 8 + "px";
    state.slash.style.width = Math.min(440, rect.width) + "px";
    state.slash.innerHTML = `<div class="slash-head">APOIS • respostas rápidas</div>${items.map((r, i) => `<button class="slash-row ${i === 0 ? "sel" : ""}" data-reply="${r.id}"><span>${typeIcon(r.type)}</span><b>${esc(r.title)}</b><small>${r.alias ? "/" + esc(r.alias) : ""}</small></button>`).join("")}`;
    state.slash.querySelectorAll(".slash-row").forEach(
      (b) =>
        (b.onmousedown = (e) => {
          e.preventDefault();
          hideSlash();
          setComposerText("");
          useReply(b.dataset.reply);
        }),
    );
  }
  function hideSlash() {
    state.slash?.remove();
    state.slash = null;
  }

  function messageIdFromNode(node) {
    if (!node) return "";
    if (node.dataset?.apoisMsgId) return node.dataset.apoisMsgId;
    const own = node.getAttribute?.("data-id");
    if (own) {
      try {
        node.dataset.apoisMsgId = own;
      } catch {}
      return own;
    }
    const idEl =
      node.closest?.("[data-id]") || node.querySelector?.("[data-id]");
    if (idEl?.getAttribute("data-id")) {
      const v = idEl.getAttribute("data-id");
      try {
        node.dataset.apoisMsgId = v;
      } catch {}
      return v;
    }
    const copy = node.querySelector?.("[data-pre-plain-text]"),
      pre = copy?.getAttribute("data-pre-plain-text") || "";
    const clone = node.cloneNode?.(true);
    clone
      ?.querySelectorAll?.(".apois-message-attendant")
      .forEach((x) => x.remove());
    const text = (
      clone?.innerText ||
      clone?.textContent ||
      node.innerText ||
      node.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(-220);
    if (!pre && !text) return "";
    let h = 2166136261;
    const src = `${state.currentName || currentChatName()}|${pre}|${text}`;
    for (let i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const id = `dom_${(h >>> 0).toString(36)}`;
    try {
      node.dataset.apoisMsgId = id;
    } catch {}
    return id;
  }
  function canonicalMessageNode(node) {
    if (!node) return null;
    return (
      node.closest?.("[data-id]") ||
      node.closest?.('[data-testid="msg-container"]') ||
      node.closest?.(".message-out,.message-in") ||
      node
    );
  }
  function messageCandidateNodes() {
    const main = document.querySelector("#main");
    if (!main) return [];
    const out = new Set();

    for (const el of main.querySelectorAll(
      '[data-id],[data-testid="msg-container"],.message-out,.message-in',
    )) {
      const n = canonicalMessageNode(el);
      if (n) out.add(n);
    }

    for (const icon of main.querySelectorAll(
      '[data-icon="msg-check"],[data-icon="msg-dblcheck"],[data-icon="msg-dblcheck-ack"],[data-icon="msg-time"]',
    )) {
      const n = canonicalMessageNode(icon);
      if (n) out.add(n);
    }

    return [...out].filter((n) => {
      try {
        const r = n.getBoundingClientRect();
        return (
          r.width > 18 && r.height > 12 && r.bottom > 0 && r.top < innerHeight
        );
      } catch {
        return false;
      }
    });
  }
  function looksOutgoingByGeometry(node) {
    if (!node) return false;
    if (node.matches?.(".message-in") || node.querySelector?.(".message-in"))
      return false;
    if (node.matches?.(".message-out") || node.querySelector?.(".message-out"))
      return true;

    try {
      const main = document.querySelector("#main");
      if (!main) return false;
      const mr = main.getBoundingClientRect(),
        r = node.getBoundingClientRect();
      if (!r.width || !r.height) return false;

      // Bubbles de saída ficam claramente no lado direito da área da conversa.
      // Usamos a borda direita e o centro para não depender de classes ofuscadas.
      const center = r.left + r.width / 2;
      const chatCenter = mr.left + mr.width / 2;
      const rightGap = mr.right - r.right;
      const leftGap = r.left - mr.left;

      if (center > chatCenter + mr.width * 0.04 && rightGap < leftGap)
        return true;
    } catch {}
    return false;
  }
  function isOutgoingMessageNode(node) {
    if (!node) return false;
    const id = String(node.getAttribute?.("data-id") || "");

    if (/^true[_-]/i.test(id) || /(^|_)true_/i.test(id)) return true;
    if (/^false[_-]/i.test(id) || /(^|_)false_/i.test(id)) return false;

    if (node.matches?.(".message-out") || node.querySelector?.(".message-out"))
      return true;
    if (
      node.querySelector?.(
        '[data-icon="msg-check"],[data-icon="msg-dblcheck"],[data-icon="msg-dblcheck-ack"],[data-icon="msg-time"]',
      )
    )
      return true;

    return looksOutgoingByGeometry(node);
  }
  function outgoingMessageNodes() {
    return messageCandidateNodes().filter(isOutgoingMessageNode);
  }
  function attributionHost(node) {
    if (!node) return null;
    let bubble = node.matches?.(".message-out")
      ? node
      : node.querySelector?.(".message-out") ||
          node.matches?.('[data-testid="msg-container"]')
        ? node
        : node.querySelector?.('[data-testid="msg-container"]') || node;

    // Se o canonical wrapper ocupar a linha toda, tente usar o descendente
    // visual menor para o selo acompanhar a bolha.
    try {
      const nr = node.getBoundingClientRect(),
        br = bubble.getBoundingClientRect();
      if (br.width > nr.width * 0.95) {
        const children = [...node.querySelectorAll("div")].filter((x) => {
          const r = x.getBoundingClientRect();
          return (
            r.width > 50 &&
            r.height > 20 &&
            r.width < nr.width * 0.82 &&
            r.right > nr.left + nr.width * 0.55
          );
        });
        if (children.length)
          bubble = children.sort(
            (a, b) =>
              a.getBoundingClientRect().width - b.getBoundingClientRect().width,
          )[0];
      }
    } catch {}

    bubble.classList?.add("apois-attribution-host");
    return bubble;
  }
  function attributionBadge(node, att, acc) {
    const target = attributionHost(node);
    if (!target || !att) return;
    target.dataset.apoisAttendant = att.name || "Atendente";
    target.dataset.apoisAccount = acc?.name || "";
    target.dataset.apoisAttributed = "1";
    target.setAttribute(
      "aria-description",
      `Enviado por ${att.name || "Atendente"}${acc?.name ? " • " + acc.name : ""}`,
    );
    // A identificação visual principal agora é a assinatura REAL da mensagem,
    // seguindo a extensão de referência. Não inserimos badge sobre a bolha.
    target.querySelector?.(":scope > .apois-attribution-inline")?.remove();
    target.querySelector?.(":scope > .apois-message-attendant")?.remove();
  }
  async function primeOutgoingMessages() {
    const name = state.currentName || currentChatName();
    if (!name) return;
    const scope = `${currentAccountId()}::${normalize(name)}`;
    if (state.outgoingPrimedFor === scope) return;
    state.outgoingPrimedFor = scope;
    state.outgoingSeen = new Set();
    for (const node of outgoingMessageNodes()) {
      const id = messageIdFromNode(node);
      if (!id) continue;
      state.outgoingSeen.add(id);
      const rec = S.getMessageAttribution?.(state.data, id, currentAccountId());
      if (rec) {
        const att = attendantById(rec.attendantId);
        if (att) attributionBadge(node, att, accountById(rec.accountId));
      }
    }
  }
  async function decorateOutgoingMessages() {
    const name = state.currentName || currentChatName();
    if (!name) return;
    await primeOutgoingMessages();
    const currentAtt = assignedAttendantForCurrent();
    for (const node of outgoingMessageNodes()) {
      const id = messageIdFromNode(node);
      if (!id) continue;
      const stored = S.getMessageAttribution?.(
        state.data,
        id,
        currentAccountId(),
      );
      if (stored) {
        const att = attendantById(stored.attendantId);
        if (att) attributionBadge(node, att, accountById(stored.accountId));
        state.outgoingSeen.add(id);
        continue;
      }
      if (state.outgoingSeen.has(id)) continue;
      state.outgoingSeen.add(id);
      // Só marca mensagens que surgiram DEPOIS da conversa ter sido preparada,
      // evitando atribuir o histórico antigo ao atendente atual.
      if (currentAtt) {
        attributionBadge(node, currentAtt, accountById(currentAccountId()));
        try {
          const rec = await S.saveMessageAttribution(
            id,
            currentAccountId(),
            name,
            currentAtt.id,
          );
          state.data.messageAttributions = {
            ...(state.data.messageAttributions || {}),
            [rec.key]: rec,
          };
        } catch (e) {
          console.warn("[APOIS attribution]", e);
        }
      }
    }
  }

  function decorateChatHeader() {
    const header = document.querySelector("#main header");
    if (!header) return;
    const name = state.currentName || currentChatName(),
      existing = header.querySelector(".apois-chat-owner");
    if (!name) {
      existing?.remove();
      return;
    }
    const ass = currentAssignment(name),
      att = attendantById(ass?.attendantId || ""),
      acc = accountById(currentAccountId());
    if (!att && !acc) {
      existing?.remove();
      return;
    }
    const key = `${currentAccountId()}|${att?.id || ""}|${name}`;
    if (existing?.dataset.key === key) return;
    existing?.remove();
    const badge = document.createElement("div");
    badge.className = "apois-chat-owner";
    badge.dataset.key = key;
    badge.title = `APOIS • ${acc?.name || "WhatsApp"}${att ? " • Atendente: " + att.name : ""}`;
    badge.innerHTML = `<span class="owner-dot"></span><b>${esc(att?.name || "Sem atendente")}</b><small>${esc(acc?.name || "WhatsApp")}</small>`;
    header.appendChild(badge);
  }
  function decorateReferenceAttendanceBadges() {
    const pane = document.querySelector("#pane-side");
    if (!pane || !state.data) return;

    let rows = [...pane.querySelectorAll('[role="listitem"]')];
    if (!rows.length)
      rows = [
        ...pane.querySelectorAll(
          '[aria-selected],[data-testid="cell-frame-container"]',
        ),
      ];

    for (const row of rows) {
      const titleEl = [...row.querySelectorAll("span[title]")].find((el) => {
        const t = (el.getAttribute("title") || "").trim();
        return t && t !== "WhatsApp";
      });
      const name = (titleEl?.getAttribute("title") || "").trim();
      if (!name) continue;

      const ass =
        state.data.assignments?.[identityKey(name, currentAccountId())];
      const contact =
        state.data.contacts?.[identityKey(name, currentAccountId())];
      const att = attendantById(ass?.attendantId || contact?.assignedTo || "");

      let badge = row.querySelector(
        'span[data-id="atendimento"][data-apois-owned="1"]',
      );

      if (!att) {
        badge?.remove();
        continue;
      }

      const target =
        row.querySelector("div._ak8l > div._ak8j > div._ak8i") ||
        titleEl?.parentElement ||
        row;

      if (!badge) {
        badge = document.createElement("span");
        badge.dataset.id = "atendimento";
        badge.dataset.apoisOwned = "1";
        badge.className = "apois-reference-attendant-badge";
        target.prepend(badge);
      }
      badge.textContent = att.name;
      badge.title = `Atendimento ativo: ${att.name}`;
    }
  }

  function decorateList() {
    if (!state.data?.settings.showLabelDotsInList) return;
    const sidebar =
      document.querySelector("#pane-side") ||
      document.querySelector('[aria-label*="lista de conversas" i]');
    if (!sidebar) return;
    const titles = [...sidebar.querySelectorAll("span[title]")];
    for (const t of titles) {
      const name = (t.getAttribute("title") || "").trim();
      if (!name) continue;
      const c = state.data.contacts[identityKey(name, currentAccountId())];
      const row =
        t.closest('[role="listitem"]') ||
        t.closest('div[tabindex="-1"]') ||
        t.parentElement?.parentElement;
      if (!row) continue;
      row.querySelector(".apois-row-labels")?.remove();
      t.parentElement?.querySelector(".apois-row-labels")?.remove();
      if (!c?.labels?.length) continue;
      const labels = c.labels
        .map((id) => state.data.labels.find((x) => x.id === id))
        .filter(Boolean);
      if (!labels.length) continue;
      const first = labels[0],
        box = document.createElement("span");
      box.className = "apois-row-labels";
      box.title = labels.map((x) => x.name).join(", ");
      box.innerHTML = `<i style="background:${esc(first.color)}"></i><b>${esc(first.name)}</b>${labels.length > 1 ? `<em>+${labels.length - 1}</em>` : ""}`;
      (t.parentElement || row).appendChild(box);
    }
  }
  function toast(msg, duration = 2600) {
    let t = document.getElementById("apois-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "apois-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    managedClearTimeout(t._tm);
    t._tm = managedTimeout(() => t.classList.remove("show"), duration);
  }

  init().catch((error) => {
    window.APOISDiagnostics.record(error, "inicialização");
    console.error("[APOIS init]", error);
    toast("APOIS não iniciou: " + error.message, 8000);
  });
})();
