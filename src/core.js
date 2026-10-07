/* Pure CRM rules; shared by the extension and Node tests. */
(function (root) {
  "use strict";
  function signature(text, attendant) {
    const raw = String(text ?? "");
    if (!attendant?.name || attendant.active === false || !raw.trim())
      return raw;
    if (/^\*_[^*\n]{1,80}:_\*(?:\s*\n|\s{2,}|$)/.test(raw)) return raw;
    const name = String(attendant.name)
      .replace(/[\r\n*_]/g, "")
      .trim();
    return name ? `*_${name}:_* \n${raw}` : raw;
  }
  function composerText(element) {
    if (!element) return "";
    // innerText preserves paragraphs; IMG emoji have an alt instead of text.
    const copy = element.cloneNode(true);
    copy
      .querySelectorAll("img[alt]")
      .forEach((img) => img.replaceWith(img.alt));
    function read(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeName === "BR") return "\n";
      let value = "";
      for (const child of node.childNodes) {
        if (
          ["DIV", "P"].includes(child.nodeName) &&
          value &&
          !value.endsWith("\n")
        )
          value += "\n";
        value += read(child);
      }
      if (
        ["DIV", "P"].includes(node.nodeName) &&
        node !== copy &&
        !value.endsWith("\n")
      )
        value += "\n";
      return value;
    }
    return read(copy)
      .replace(/\n$/, "")
      .replace(/\u00a0/g, " ");
  }
  function sameConversation(expected, current) {
    return !!expected && expected === current;
  }
  function validateBackup(payload) {
    if (
      payload?.format !== "APOIS_QUICK_REPLIES_BACKUP" ||
      !payload.data ||
      !Array.isArray(payload.data.quickReplies)
    ) {
      throw new Error("Backup inválido: respostas ausentes.");
    }
    const media = payload.media;
    if (!Array.isArray(media))
      throw new Error("Backup inválido: mídias ausentes.");
    const ids = new Set();
    for (const item of media) {
      if (
        !item?.id ||
        ids.has(item.id) ||
        !/^data:[^,]*;base64,[A-Za-z0-9+/=\s]*$/.test(item.dataUrl || "")
      ) {
        throw new Error("Backup inválido: mídia corrompida ou repetida.");
      }
      ids.add(item.id);
    }
    for (const reply of payload.data.quickReplies) {
      for (const item of [reply, ...(reply.blocks || [])]) {
        if (item.mediaId && !ids.has(item.mediaId))
          throw new Error("Backup incompleto: falta mídia de uma resposta.");
      }
    }
    return payload;
  }
  class ExecutionLock {
    constructor() {
      this.active = false;
    }
    async run(task) {
      if (this.active) throw new Error("Aguarde o envio atual terminar.");
      this.active = true;
      try {
        return await task();
      } finally {
        this.active = false;
      }
    }
  }
  const api = {
    signature,
    composerText,
    sameConversation,
    validateBackup,
    ExecutionLock,
  };
  root.APOISCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
