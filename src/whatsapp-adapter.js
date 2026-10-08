/* Owned dispatcher. No supplier backend, AI, billing, selectors or sockets. */
(() => {
  "use strict";
  if (window.__APOIS_ADAPTER__) return;
  window.__APOIS_ADAPTER__ = true;
  const handled = new Map();
  const inflight = new Map();
  const cleanId = (value) =>
    typeof value === "string" ? value : value?._serialized || "";
  const activeId = () => cleanId(window.WPP?.chat?.getActiveChat()?.id);
  const post = (id, response, error) =>
    window.postMessage(
      { type: "WPP", id, response: JSON.stringify(response ?? null), error },
      location.origin,
    );

  async function dispatch({ type, action, dados }) {
    const wpp = window.WPP;
    if (type === "Webpack" && action === "isFullReady")
      return !!wpp?.webpack?.isFullReady;
    if (!wpp?.webpack?.isFullReady)
      throw new Error("A API interna do WhatsApp ainda não está pronta.");
    if (type === "Chat" && action === "getActiveChat") return activeId();
    if (type === "Chat" && action === "setInputText") {
      if (dados.id !== activeId()) throw new Error("A conversa mudou.");
      await wpp.chat.setInputText(dados.txt || "", dados.id);
      return true;
    }
    if (type === "Chat" && action === "sendTxt") {
      if (dados.id !== activeId())
        throw new Error("A conversa mudou antes do envio.");
      const composer = document.querySelector(
        '#main footer [contenteditable="true"][role="textbox"]',
      );
      const draft = composer?.textContent;
      const quote = document.querySelector(
        '#main [data-testid="quoted-message"],#main [data-testid="quoted-msg"],#main .quoted-mention,#main > footer > div:nth-child(3) > div > div:nth-child(4) > div > div > div,#main > footer > div:nth-child(3) > div > div > span > div > div',
      );
      const fiberKey = Object.keys(quote || {}).find((key) =>
        key.startsWith("__reactFiber$"),
      );
      const children = quote?.[fiberKey]?.memoizedProps?.children;
      const quotedMsg = children?.[0]?.key || children?.key || undefined;
      const sent = await wpp.chat.sendTextMessage(
        dados.id,
        String(dados.msg || ""),
        {
          waitForAck: false,
          quotedMsg,
        },
      );
      let clearError = "";
      if (
        dados.clearDraft &&
        activeId() === dados.id &&
        composer?.isConnected &&
        composer.textContent === draft
      ) {
        try {
          await wpp.chat.setInputText("", dados.id);
        } catch (error) {
          clearError = String(error?.message || error);
        }
      }
      return { id: cleanId(sent?.id), accepted: true, clearError };
    }
    if (type === "Chat" && action === "sendMedia") {
      if (dados.id !== activeId())
        throw new Error("A conversa mudou antes do envio.");
      if (!["image", "video", "document", "audio"].includes(dados.mediaType))
        throw new Error("Tipo de mídia inválido.");
      const sent = await wpp.chat.sendFileMessage(dados.id, dados.dataUrl, {
        createChat: true,
        type: dados.mediaType,
        isPtt: dados.mediaType === "audio",
        caption: dados.caption || "",
        filename: dados.fileName || "arquivo",
        waitForAck: false,
      });
      return { id: cleanId(sent?.id), accepted: true };
    }
    throw new Error("Operação não permitida no adaptador APOIS.");
  }

  if (typeof window.WPP?.on === "function") {
    window.WPP.on("webpack.full_ready", () => {
      window.postMessage(
        { type: "Ev", action: "webpack.full_ready" },
        location.origin,
      );
    });
    window.WPP.on("chat.active_chat", (chat) => {
      const id = cleanId(chat?.id);
      window.postMessage(
        {
          type: "Ev",
          action: "chat.active_chat",
          model: JSON.stringify({ id: { _serialized: id } }),
        },
        location.origin,
      );
    });
  }
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      msg?.model !== "APOIS_WPP" ||
      !/^apois_ref_[\w]+$/.test(msg.id || "")
    )
      return;
    if (handled.has(msg.id)) {
      const value = handled.get(msg.id);
      post(msg.id, value.response, value.error);
      return;
    }
    // Repeated request IDs reuse the same Promise, including when still sending.
    if (!inflight.has(msg.id))
      inflight.set(
        msg.id,
        dispatch(msg).then(
          (response) => ({ response }),
          (error) => ({ error: String(error?.message || error) }),
        ),
      );
    inflight.get(msg.id).then((value) => {
      handled.set(msg.id, value);
      inflight.delete(msg.id);
      if (handled.size > 300) handled.delete(handled.keys().next().value);
      post(msg.id, value.response, value.error);
    });
  });
})();
