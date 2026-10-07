(() => {
  const VERSION = 13;
  const now = () => Date.now();
  const uid = (p = "id") =>
    `${p}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const DEFAULT_ACCOUNT_ID = "acc_principal";

  const DEFAULTS = {
    schemaVersion: VERSION,
    settings: {
      panelOpen: true,
      panelWidth: 410,
      showLabelDotsInList: true,
      slashCommands: true,
      closeAfterUse: false,
      mediaAutoSend: false,
      voiceAutoSend: true,
      textDefaultMode: "insert",
      maxSearchResults: 60,
      transferNoticeTemplate:
        "Seu atendimento foi transferido para {{conta_destino}}{{telefone_destino}}. Você receberá uma mensagem por esse número para continuar o atendimento.",
      transferWelcomeTemplate:
        "Olá, {{nome}}! Seu atendimento foi transferido para este número. A partir de agora continuaremos seu atendimento por aqui.{{atendente}}",
      accent: "#E1061B",
    },
    stages: [
      { id: "new", name: "Novo contato", color: "#64748b", order: 0 },
      { id: "active", name: "Em atendimento", color: "#E1061B", order: 1 },
      { id: "waiting", name: "Aguardando cliente", color: "#d97706", order: 2 },
      {
        id: "done",
        name: "Atendimento finalizado",
        color: "#16a34a",
        order: 3,
      },
      { id: "client", name: "Já é cliente", color: "#0F172A", order: 4 },
    ],
    categories: [
      { id: "cat_geral", name: "Geral", order: 0 },
      { id: "cat_atendimento", name: "Atendimento", order: 1 },
      { id: "cat_pagamento", name: "Pagamento / PIX", order: 2 },
    ],
    labels: [
      { id: "lab_cliente", name: "Cliente", color: "#16a34a", order: 0 },
      {
        id: "lab_aguardando",
        name: "Aguardando pagamento",
        color: "#EAB308",
        order: 1,
      },
      { id: "lab_retorno", name: "Retornar", color: "#0EA5E9", order: 2 },
      { id: "lab_finalizado", name: "Finalizado", color: "#0F172A", order: 3 },
    ],
    attendants: [
      { id: "att_franciel", name: "Franciel", active: true, order: 0 },
    ],
    accounts: [
      {
        id: DEFAULT_ACCOUNT_ID,
        name: "WhatsApp principal",
        phone: "",
        color: "#E1061B",
        active: true,
        order: 0,
      },
    ],
    assignments: {},
    transferLog: [],
    messageAttributions: {},
    multiconta: {
      enabled: true,
      workspaceId: "apois-central",
      deviceId: uid("device"),
      profileName: "Este navegador",
      boundAccountId: DEFAULT_ACCOUNT_ID,
      configUpdatedAt: 0,
      lastPublishedAt: 0,
    },
    quickReplies: [
      {
        id: "qr_boasvindas",
        title: "Boas-vindas",
        alias: "ola",
        categoryId: "cat_geral",
        type: "text",
        text: "Olá, {{nome}}! Como posso ajudar?",
        favorite: true,
        useCount: 0,
        sendMode: "insert",
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: "qr_pix",
        title: "Chave PIX",
        alias: "pix",
        categoryId: "cat_pagamento",
        type: "pix",
        text: "",
        pixMessage: "",
        pixKey: "",
        pixHolder: "",
        pixBank: "",
        favorite: true,
        useCount: 0,
        sendMode: "send",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    contacts: {},
    usage: { total: 0, byType: {}, recent: [] },
  };

  const normalizeName = (name) =>
    String(name || "")
      .trim()
      .toLocaleLowerCase("pt-BR")
      .replace(/\s+/g, " ");
  function contactKey(name, accountId = DEFAULT_ACCOUNT_ID, chatId = "") {
    const identity = String(chatId || "").replace(
      /@s\.whatsapp\.net$/,
      "@c.us",
    );
    const n = /^\d+(?:-\d+)?@(c\.us|lid|g\.us)$/.test(identity)
      ? identity
      : normalizeName(name);
    return n ? `${accountId || DEFAULT_ACCOUNT_ID}::${n}` : "";
  }
  const assignmentKey = contactKey;

  const normalize = (raw) => {
    const data = Object.fromEntries(
      Object.entries(raw || {}).filter(([key]) => Object.hasOwn(DEFAULTS, key)),
    );
    if (Number(data.schemaVersion) > VERSION)
      throw new Error(
        "Dados de versão mais nova. Atualize a extensão antes de abrir.",
      );
    const out = {
      ...clone(DEFAULTS),
      ...data,
      schemaVersion: VERSION,
      stages:
        Array.isArray(data.stages) && data.stages.length
          ? data.stages
          : clone(DEFAULTS.stages),
      settings: { ...clone(DEFAULTS.settings), ...(data.settings || {}) },
      categories:
        Array.isArray(data.categories) && data.categories.length
          ? data.categories
          : clone(DEFAULTS.categories),
      labels: Array.isArray(data.labels) ? data.labels : clone(DEFAULTS.labels),
      quickReplies: Array.isArray(data.quickReplies)
        ? data.quickReplies
        : clone(DEFAULTS.quickReplies),
      attendants:
        Array.isArray(data.attendants) && data.attendants.length
          ? data.attendants
          : clone(DEFAULTS.attendants),
      accounts:
        Array.isArray(data.accounts) && data.accounts.length
          ? data.accounts
          : clone(DEFAULTS.accounts),
      assignments:
        data.assignments && typeof data.assignments === "object"
          ? data.assignments
          : {},
      transferLog: Array.isArray(data.transferLog) ? data.transferLog : [],
      messageAttributions:
        data.messageAttributions && typeof data.messageAttributions === "object"
          ? data.messageAttributions
          : {},
      multiconta: { ...clone(DEFAULTS.multiconta), ...(data.multiconta || {}) },
      contacts:
        data.contacts && typeof data.contacts === "object" ? data.contacts : {},
      usage: { ...clone(DEFAULTS.usage), ...(data.usage || {}) },
    };
    if (
      (Number(data.schemaVersion) || 0) < 8 &&
      Number(out.settings.panelWidth || 0) < 390
    )
      out.settings.panelWidth = 410;

    out.quickReplies = out.quickReplies.map((q, i) => ({
      id: q.id || uid("qr"),
      title: q.title || q.name || `Resposta ${i + 1}`,
      alias: q.alias || "",
      categoryId:
        q.categoryId ||
        (q.category === "Pagamento" ? "cat_pagamento" : "cat_geral"),
      type: q.type || "text",
      text: q.text || "",
      caption: q.caption || "",
      mediaId: q.mediaId || null,
      fileName: q.fileName || "",
      mimeType: q.mimeType || "",
      voiceMode: q.type === "audio" ? true : !!q.voiceMode,
      favorite: !!q.favorite,
      useCount: Number(q.useCount) || 0,
      order: Number.isFinite(q.order) ? q.order : i,
      sendMode:
        q.id === "qr_pix" &&
        q.type === "pix" &&
        !q.pixKey &&
        String(q.text || "").trim() === "Chave PIX:"
          ? "send"
          : q.sendMode || "insert",
      createdAt: q.createdAt || now(),
      updatedAt: q.updatedAt || now(),
      pixKey: q.pixKey || "",
      pixHolder: q.pixHolder || "",
      pixBank: q.pixBank || "",
      pixMessage:
        q.pixMessage ??
        (q.type === "pix" && String(q.text || "").trim() !== "Chave PIX:"
          ? q.text || ""
          : ""),
      blocks: Array.isArray(q.blocks)
        ? q.blocks
            .map((b, bi) => ({
              id: b.id || uid("blk"),
              type: b.type || "text",
              order: Number.isFinite(b.order) ? b.order : bi,
              text: b.text || "",
              caption: b.caption || "",
              mediaId: b.mediaId || null,
              fileName: b.fileName || "",
              mimeType: b.mimeType || "",
              pixKey: b.pixKey || "",
              pixHolder: b.pixHolder || "",
              pixBank: b.pixBank || "",
              pixMessage: b.pixMessage || "",
            }))
            .sort((a, b) => a.order - b.order)
        : [],
    }));
    out.labels = out.labels
      .map((l, i) => ({
        id: l.id || uid("lab"),
        name: l.name || `Etiqueta ${i + 1}`,
        color: l.color || "#64748b",
        order: Number.isFinite(l.order) ? l.order : i,
      }))
      .sort((a, b) => a.order - b.order);
    out.categories = out.categories
      .map((c, i) => ({
        id: c.id || uid("cat"),
        name: c.name || `Categoria ${i + 1}`,
        order: Number.isFinite(c.order) ? c.order : i,
      }))
      .sort((a, b) => a.order - b.order);
    out.attendants = out.attendants
      .map((a, i) => ({
        id: a.id || uid("att"),
        name: a.name || `Atendente ${i + 1}`,
        active: a.active !== false,
        order: Number.isFinite(a.order) ? a.order : i,
      }))
      .sort((a, b) => a.order - b.order);
    out.accounts = out.accounts
      .map((a, i) => ({
        id: a.id || uid("acc"),
        name: a.name || `WhatsApp ${i + 1}`,
        phone: a.phone || "",
        color: a.color || "#E1061B",
        active: a.active !== false,
        order: Number.isFinite(a.order) ? a.order : i,
      }))
      .sort((a, b) => a.order - b.order);
    if (!out.accounts.some((a) => a.id === out.multiconta.boundAccountId))
      out.multiconta.boundAccountId = out.accounts[0]?.id || DEFAULT_ACCOUNT_ID;
    if (!out.multiconta.deviceId) out.multiconta.deviceId = uid("device");
    if (!out.multiconta.workspaceId)
      out.multiconta.workspaceId = "apois-central";

    // Migração v7 -> v8: contatos antigos não tinham escopo por conta.
    const migratedContacts = {};
    for (const [k, v] of Object.entries(out.contacts || {})) {
      const nk = k.includes("::") ? k : `${DEFAULT_ACCOUNT_ID}::${k}`;
      migratedContacts[nk] = {
        ...v,
        id: nk,
        accountId: v.accountId || nk.split("::")[0] || DEFAULT_ACCOUNT_ID,
      };
    }
    for (const contact of Object.values(migratedContacts)) {
      contact.stageId = out.stages.some(
        (stage) => stage.id === (contact.stageId || contact.stage),
      )
        ? contact.stageId || contact.stage
        : "new";
    }
    out.contacts = migratedContacts;
    return out;
  };

  async function getAll() {
    const raw = await chrome.storage.local.get(null);
    const data = normalize(raw);
    if (raw.schemaVersion !== VERSION)
      await chrome.storage.local.set({ ...data, schemaVersion: VERSION });
    return data;
  }
  async function setKey(key, value) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error("Chave desconhecida");
    await chrome.storage.local.set({ [key]: value });
    return value;
  }
  async function saveReply(reply) {
    const d = await getAll(),
      i = d.quickReplies.findIndex((x) => x.id === reply.id);
    const rec = {
      id: reply.id || uid("qr"),
      title: "Sem título",
      alias: "",
      categoryId: "cat_geral",
      type: "text",
      text: "",
      caption: "",
      favorite: false,
      useCount: 0,
      order: d.quickReplies.length,
      sendMode: "insert",
      createdAt: now(),
      ...reply,
      updatedAt: now(),
    };
    if (rec.type === "audio") rec.voiceMode = true;
    if (i >= 0) d.quickReplies[i] = { ...d.quickReplies[i], ...rec };
    else d.quickReplies.push(rec);
    await setKey("quickReplies", d.quickReplies);
    return rec;
  }
  async function deleteReply(id) {
    const d = await getAll();
    const r = d.quickReplies.find((x) => x.id === id);
    await setKey(
      "quickReplies",
      d.quickReplies.filter((x) => x.id !== id),
    );
    const ids = new Set(
      [r?.mediaId, ...(r?.blocks || []).map((b) => b.mediaId)].filter(Boolean),
    );
    for (const mediaId of ids)
      chrome.runtime
        .sendMessage({ type: "MEDIA_DELETE", id: mediaId })
        .catch(() => {});
  }
  async function recordUse(id, type) {
    const d = await getAll();
    d.quickReplies = d.quickReplies.map((q) =>
      q.id === id
        ? { ...q, useCount: (q.useCount || 0) + 1, lastUsedAt: now() }
        : q,
    );
    d.usage.total = (d.usage.total || 0) + 1;
    d.usage.byType[type] = (d.usage.byType[type] || 0) + 1;
    d.usage.recent = [{ id, type, at: now() }, ...(d.usage.recent || [])].slice(
      0,
      100,
    );
    await chrome.storage.local.set({
      quickReplies: d.quickReplies,
      usage: d.usage,
    });
  }
  async function ensureContact(
    name,
    accountId = DEFAULT_ACCOUNT_ID,
    chatId = "",
  ) {
    const d = await getAll(),
      key = contactKey(name, accountId, chatId);
    const legacyKey = contactKey(name, accountId);
    if (
      chatId &&
      key !== legacyKey &&
      !d.contacts[key] &&
      d.contacts[legacyKey] &&
      !d.contacts[legacyKey].chatId
    ) {
      d.contacts[key] = { ...d.contacts[legacyKey], id: key, chatId };
      delete d.contacts[legacyKey];
      if (d.assignments[legacyKey]) {
        d.assignments[key] = { ...d.assignments[legacyKey], key };
        delete d.assignments[legacyKey];
        await setKey("assignments", d.assignments);
      }
    }
    if (!key) return null;
    const prev = d.contacts[key] || {
      id: key,
      displayName: name,
      accountId,
      labels: [],
      stageId: "new",
      createdAt: now(),
    };
    d.contacts[key] = {
      ...prev,
      displayName: name || prev.displayName,
      accountId,
      chatId: chatId || prev.chatId || "",
      updatedAt: now(),
    };
    await setKey("contacts", d.contacts);
    return d.contacts[key];
  }
  async function setContactStage(name, accountId, stageId, chatId = "") {
    const data = await getAll();
    if (!data.stages.some((stage) => stage.id === stageId))
      throw new Error("Etapa inválida");
    const key = contactKey(name, accountId, chatId);
    const contact = data.contacts[key];
    if (!contact) throw new Error("Contato não encontrado");
    data.contacts[key] = { ...contact, stageId, updatedAt: now() };
    await setKey("contacts", data.contacts);
    return data.contacts[key];
  }
  async function restoreData(data) {
    const normalized = normalize(data);
    await chrome.storage.local.set(normalized);
    return normalized;
  }
  async function toggleContactLabel(
    name,
    labelId,
    accountId = DEFAULT_ACCOUNT_ID,
    chatId = "",
  ) {
    const d = await getAll(),
      key = contactKey(name, accountId, chatId);
    if (!key) return null;
    const prev = d.contacts[key] || {
      id: key,
      displayName: name,
      accountId,
      labels: [],
      stageId: "new",
      createdAt: now(),
    };
    const labels = new Set(prev.labels || []);
    labels.has(labelId) ? labels.delete(labelId) : labels.add(labelId);
    d.contacts[key] = {
      ...prev,
      displayName: name,
      accountId,
      labels: [...labels],
      updatedAt: now(),
    };
    await setKey("contacts", d.contacts);
    return d.contacts[key];
  }
  async function assignContact(
    name,
    accountId,
    attendantId,
    fromAttendantId = null,
    note = "",
    chatId = "",
  ) {
    const d = await getAll(),
      key = assignmentKey(name, accountId, chatId);
    if (!key) return null;
    const previous = d.assignments[key]?.attendantId || null;
    const rec = {
      key,
      contactName: name,
      accountId: accountId || DEFAULT_ACCOUNT_ID,
      attendantId: attendantId || "",
      assignedAt: now(),
      updatedAt: now(),
    };
    d.assignments[key] = rec;
    const ck = contactKey(name, accountId, chatId),
      prev = d.contacts[ck] || {
        id: ck,
        displayName: name,
        accountId,
        labels: [],
        stageId: "new",
        createdAt: now(),
      };
    d.contacts[ck] = {
      ...prev,
      assignedTo: attendantId || "",
      updatedAt: now(),
    };
    d.transferLog = [
      {
        id: uid("transfer"),
        contactName: name,
        accountId: accountId || DEFAULT_ACCOUNT_ID,
        fromAttendantId: fromAttendantId || previous || "",
        toAttendantId: attendantId || "",
        note,
        at: now(),
      },
      ...(d.transferLog || []),
    ].slice(0, 1000);
    await chrome.storage.local.set({
      assignments: d.assignments,
      contacts: d.contacts,
      transferLog: d.transferLog,
    });
    return rec;
  }
  async function transferBetweenAccounts(
    name,
    fromAccountId,
    toAccountId,
    clientJid = "",
    attendantId = "",
    note = "",
    chatId = "",
  ) {
    const d = await getAll(),
      fromId = fromAccountId || DEFAULT_ACCOUNT_ID,
      toId = toAccountId || DEFAULT_ACCOUNT_ID;
    if (!name || !toId) return null;
    const sourceKey = contactKey(name, fromId, chatId),
      targetKey = contactKey(name, toId, clientJid);
    const source = d.contacts[sourceKey] || {
      id: sourceKey,
      displayName: name,
      accountId: fromId,
      labels: [],
      createdAt: now(),
    };
    const target = d.contacts[targetKey] || {
      id: targetKey,
      displayName: name,
      accountId: toId,
      labels: [...(source.labels || [])],
      createdAt: now(),
    };
    d.contacts[targetKey] = {
      ...target,
      displayName: name,
      accountId: toId,
      chatId: clientJid || target.chatId || "",
      labels: [
        ...new Set([...(target.labels || []), ...(source.labels || [])]),
      ],
      stageId: source.stageId || target.stageId || "new",
      assignedTo: attendantId || target.assignedTo || "",
      updatedAt: now(),
    };
    if (attendantId) {
      d.assignments[targetKey] = {
        key: targetKey,
        contactName: name,
        accountId: toId,
        attendantId,
        assignedAt: now(),
        updatedAt: now(),
      };
    }
    d.transferLog = [
      {
        id: uid("transfer_account"),
        type: "account",
        contactName: name,
        clientJid: String(clientJid || ""),
        fromAccountId: fromId,
        toAccountId: toId,
        attendantId: attendantId || "",
        note: note || "Transferência entre números",
        at: now(),
      },
      ...(d.transferLog || []),
    ].slice(0, 1000);
    await chrome.storage.local.set({
      contacts: d.contacts,
      assignments: d.assignments,
      transferLog: d.transferLog,
    });
    return d.transferLog[0];
  }

  async function saveAttendant(att) {
    const d = await getAll(),
      i = d.attendants.findIndex((x) => x.id === att.id);
    const rec = {
      id: att.id || uid("att"),
      name: "Atendente",
      active: true,
      order: d.attendants.length,
      ...att,
    };
    if (i >= 0) d.attendants[i] = { ...d.attendants[i], ...rec };
    else d.attendants.push(rec);
    await setKey("attendants", d.attendants);
    return rec;
  }
  async function deleteAttendant(id) {
    const d = await getAll();
    if (d.attendants.length <= 1) return false;
    const attendants = d.attendants.filter((x) => x.id !== id);
    const assignments = {};
    for (const [k, v] of Object.entries(d.assignments || {}))
      assignments[k] = v.attendantId === id ? { ...v, attendantId: "" } : v;
    await chrome.storage.local.set({ attendants, assignments });
    return true;
  }
  async function saveAccount(acc) {
    const d = await getAll(),
      i = d.accounts.findIndex((x) => x.id === acc.id);
    const rec = {
      id: acc.id || uid("acc"),
      name: "WhatsApp",
      phone: "",
      color: "#E1061B",
      active: true,
      order: d.accounts.length,
      ...acc,
    };
    if (i >= 0) d.accounts[i] = { ...d.accounts[i], ...rec };
    else d.accounts.push(rec);
    await setKey("accounts", d.accounts);
    return rec;
  }
  async function deleteAccount(id) {
    const d = await getAll();
    if (d.accounts.length <= 1) return false;
    await setKey(
      "accounts",
      d.accounts.filter((x) => x.id !== id),
    );
    return true;
  }
  async function saveLabel(label) {
    const d = await getAll(),
      i = d.labels.findIndex((x) => x.id === label.id);
    const rec = {
      id: label.id || uid("lab"),
      name: "Etiqueta",
      color: "#E1061B",
      order: d.labels.length,
      ...label,
    };
    if (i >= 0) d.labels[i] = { ...d.labels[i], ...rec };
    else d.labels.push(rec);
    await setKey("labels", d.labels);
    return rec;
  }
  async function deleteLabel(id) {
    const d = await getAll();
    const labels = d.labels.filter((x) => x.id !== id);
    const contacts = {};
    for (const [k, v] of Object.entries(d.contacts))
      contacts[k] = { ...v, labels: (v.labels || []).filter((x) => x !== id) };
    await chrome.storage.local.set({ labels, contacts });
  }
  async function saveCategory(cat) {
    const d = await getAll(),
      i = d.categories.findIndex((x) => x.id === cat.id);
    const rec = {
      id: cat.id || uid("cat"),
      name: "Categoria",
      order: d.categories.length,
      ...cat,
    };
    if (i >= 0) d.categories[i] = { ...d.categories[i], ...rec };
    else d.categories.push(rec);
    await setKey("categories", d.categories);
    return rec;
  }
  async function deleteCategory(id) {
    const d = await getAll();
    const fallback = d.categories.find((x) => x.id !== id)?.id || "cat_geral";
    await chrome.storage.local.set({
      categories: d.categories.filter((x) => x.id !== id),
      quickReplies: d.quickReplies.map((q) =>
        q.categoryId === id ? { ...q, categoryId: fallback } : q,
      ),
    });
  }
  async function moveReply(id, dir) {
    const d = await getAll();
    const item = d.quickReplies.find((x) => x.id === id);
    if (!item) return;
    const same = d.quickReplies
      .filter((x) => x.categoryId === item.categoryId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = same.findIndex((x) => x.id === id),
      j = Math.max(0, Math.min(same.length - 1, i + dir));
    if (i === j) return;
    [same[i], same[j]] = [same[j], same[i]];
    same.forEach((x, k) => (x.order = k));
    const map = new Map(same.map((x) => [x.id, x]));
    d.quickReplies = d.quickReplies.map((x) => map.get(x.id) || x);
    await setKey("quickReplies", d.quickReplies);
  }
  async function moveCategory(id, dir) {
    const d = await getAll();
    const arr = [...d.categories].sort((a, b) => a.order - b.order),
      i = arr.findIndex((x) => x.id === id),
      j = Math.max(0, Math.min(arr.length - 1, i + dir));
    if (i < 0 || i === j) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    arr.forEach((x, k) => (x.order = k));
    await setKey("categories", arr);
  }
  async function saveMulticonta(patch) {
    const d = await getAll();
    const rec = { ...d.multiconta, ...patch };
    await setKey("multiconta", rec);
    return rec;
  }
  async function touchSharedConfig() {
    const d = await getAll(),
      rec = { ...d.multiconta, configUpdatedAt: Date.now() };
    await setKey("multiconta", rec);
    return rec;
  }

  function expand(text, ctx = {}) {
    const first = (ctx.name || "").trim().split(/\s+/)[0] || "";
    return String(text || "")
      .replace(/{{\s*nome\s*}}/gi, ctx.name || "")
      .replace(/{{\s*primeiro_nome\s*}}/gi, first)
      .replace(/{{\s*telefone\s*}}/gi, ctx.phone || "")
      .replace(/{{\s*data\s*}}/gi, new Date().toLocaleDateString("pt-BR"))
      .replace(
        /{{\s*hora\s*}}/gi,
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
  }

  function attributionKey(messageId, accountId = DEFAULT_ACCOUNT_ID) {
    return `${accountId || DEFAULT_ACCOUNT_ID}::${String(messageId || "").trim()}`;
  }
  async function saveMessageAttribution(
    messageId,
    accountId,
    contactName,
    attendantId,
  ) {
    if (!messageId || !attendantId) return null;
    const d = await getAll(),
      key = attributionKey(messageId, accountId);
    const prev = d.messageAttributions[key] || {};
    const rec = {
      ...prev,
      key,
      messageId: String(messageId),
      accountId: accountId || DEFAULT_ACCOUNT_ID,
      contactName: contactName || prev.contactName || "",
      attendantId,
      createdAt: prev.createdAt || now(),
      updatedAt: now(),
    };
    d.messageAttributions[key] = rec;
    const entries = Object.entries(d.messageAttributions)
      .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
      .slice(0, 5000);
    d.messageAttributions = Object.fromEntries(entries);
    await setKey("messageAttributions", d.messageAttributions);
    return rec;
  }
  function getMessageAttribution(
    data,
    messageId,
    accountId = DEFAULT_ACCOUNT_ID,
  ) {
    return (
      data?.messageAttributions?.[attributionKey(messageId, accountId)] || null
    );
  }

  globalThis.APOISStorage = {
    setContactStage,
    restoreData,
    VERSION,
    DEFAULTS,
    DEFAULT_ACCOUNT_ID,
    uid,
    getAll,
    setKey,
    saveReply,
    deleteReply,
    recordUse,
    contactKey,
    assignmentKey,
    ensureContact,
    toggleContactLabel,
    assignContact,
    saveAttendant,
    deleteAttendant,
    saveAccount,
    deleteAccount,
    saveLabel,
    deleteLabel,
    saveCategory,
    deleteCategory,
    moveReply,
    moveCategory,
    expand,
    normalize,
    saveMulticonta,
    touchSharedConfig,
    transferBetweenAccounts,
    attributionKey,
    saveMessageAttribution,
    getMessageAttribution,
  };
  if (typeof window !== "undefined") {
    const api = globalThis.APOISStorage;
    for (const name of [
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
    ]) {
      api[name] = async (...args) => {
        const result = await chrome.runtime.sendMessage({
          type: "STORAGE_RPC",
          method: name,
          args,
        });
        if (!result?.ok)
          throw new Error(result?.error || "Falha no armazenamento");
        return result.value;
      };
    }
  }
})();
