(() => {
  "use strict";
  if (window.APOISDiagnostics) return;
  const recent = [];
  const redact = (value) =>
    String(value || "")
      .replace(/\b\d{7,}\b/g, "[número]")
      .slice(0, 500);
  window.APOISDiagnostics = {
    record(error, scope = "APOIS") {
      recent.unshift({
        at: new Date().toISOString(),
        scope,
        error: redact(error?.message || error),
      });
      if (recent.length > 30) recent.pop();
    },
    async report(state) {
      let database;
      try {
        database = await chrome.runtime.sendMessage({ type: "MEDIA_LIST" });
      } catch (error) {
        database = { ok: false, error: redact(error) };
      }
      return {
        generatedAt: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
        contentScript: true,
        mainWorld: !!state.bridgeState?.ok,
        whatsappDetected: !!document.querySelector("#app"),
        loggedIn: !!document.querySelector("#pane-side"),
        activeChat: !!state.currentName,
        accountId: state.data?.multiconta?.boundAccountId || "",
        attendantAssigned: !!state.attendantAssigned,
        internalAPI: !!state.referenceReady,
        localBridge: {
          online: !!state.bridgeOnline,
          error: redact(state.bridgeError),
        },
        indexedDB: {
          ok: !!database?.ok,
          mediaCount: database?.items?.length || 0,
        },
        sessions: (state.bridgeSessions || []).map((session) => ({
          id: session.id,
          status: session.status,
          updatedAt: session.updatedAt,
          error: redact(session.error),
        })),
        recentErrors: [...recent],
      };
    },
  };
})();
