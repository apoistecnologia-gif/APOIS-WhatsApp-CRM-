(() => {
  if (window.__APOIS_NATIVE_VOICE_V2__) return;
  window.__APOIS_NATIVE_VOICE_V2__ = true;

  const post = (type, payload = {}) =>
    window.postMessage(
      { source: "APOIS_NATIVE", type, ...payload },
      location.origin,
    );

  let session = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cleanup(reason = "") {
    const s = session;
    if (!s) return;
    try {
      s.restore?.();
    } catch {}
    try {
      if (s.source && s.source.playbackState !== "finished") {
        // BufferSource não possui stop seguro após onended em todos os builds.
        try {
          s.source.stop();
        } catch {}
      }
    } catch {}
    try {
      s.stream?.getTracks?.().forEach((t) => t.stop());
    } catch {}
    try {
      s.ctx?.close?.();
    } catch {}
    clearTimeout(s.captureTimer);
    clearTimeout(s.hardTimer);
    session = null;
    if (reason) console.debug("[APOIS native voice] cleanup:", reason);
  }

  function dataUrlToArrayBuffer(dataUrl) {
    const comma = String(dataUrl || "").indexOf(",");
    if (comma < 0) throw new Error("Áudio inválido: Data URL ausente");
    const header = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    if (/;base64/i.test(header)) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(body)).buffer;
  }

  async function prepare(req) {
    cleanup("nova sessão");
    if (!req?.id || !req?.dataUrl)
      throw new Error("Dados do áudio incompletos");
    if (!navigator.mediaDevices) throw new Error("MediaDevices não disponível");

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("AudioContext não disponível");

    const ctx = new AudioCtx();
    await ctx.resume().catch(() => {});
    const ab = dataUrlToArrayBuffer(req.dataUrl);
    const buffer = await new Promise((resolve, reject) => {
      const copy = ab.slice(0);
      const maybe = ctx.decodeAudioData(copy, resolve, reject);
      if (maybe && typeof maybe.then === "function")
        maybe.then(resolve, reject);
    });

    const destination = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);

    // Um GainNode zerado conectado ao destino físico mantém o grafo sendo
    // processado sem reproduzir o áudio nos alto-falantes.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(silent);
    silent.connect(ctx.destination);

    const mediaDevices = navigator.mediaDevices;
    const proto = Object.getPrototypeOf(mediaDevices);
    const originalProto = proto?.getUserMedia;
    const originalOwn = Object.prototype.hasOwnProperty.call(
      mediaDevices,
      "getUserMedia",
    )
      ? mediaDevices.getUserMedia
      : null;
    const OriginalMediaRecorder = window.MediaRecorder;

    let captured = false;
    let captureMethod = "";
    let started = false;
    let restored = false;

    const announceCapture = (method) => {
      if (captured) return;
      captured = true;
      captureMethod = method;
      clearTimeout(session?.captureTimer);
      post("NATIVE_STREAM_CAPTURED", {
        id: req.id,
        method,
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
      });
      if (method === "getUserMedia") {
        post("NATIVE_MIC_CAPTURED", {
          id: req.id,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
        });
      } else {
        post("NATIVE_RECORDER_CAPTURED", {
          id: req.id,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
        });
      }
    };

    const restore = () => {
      if (restored) return;
      restored = true;
      try {
        if (proto && originalProto) proto.getUserMedia = originalProto;
      } catch {}
      try {
        if (originalOwn) mediaDevices.getUserMedia = originalOwn;
        else delete mediaDevices.getUserMedia;
      } catch {}
      try {
        if (
          OriginalMediaRecorder &&
          window.MediaRecorder !== OriginalMediaRecorder
        ) {
          window.MediaRecorder = OriginalMediaRecorder;
        }
      } catch {}
    };

    const fallbackGetUserMedia = function (...args) {
      if (originalOwn) return originalOwn.apply(mediaDevices, args);
      if (originalProto) return originalProto.apply(this, args);
      return Promise.reject(new Error("getUserMedia original indisponível"));
    };

    const patched = function (constraints, ...rest) {
      const wantsAudio = !!(
        constraints?.audio === true ||
        (constraints?.audio && typeof constraints.audio === "object")
      );
      if (!wantsAudio || captured) {
        return fallbackGetUserMedia.call(this, constraints, ...rest);
      }
      announceCapture("getUserMedia");
      // Não restaura ainda: alguns builds do WhatsApp consultam novamente
      // getUserMedia durante a preparação do gravador.
      return Promise.resolve(destination.stream);
    };

    try {
      if (proto && originalProto) proto.getUserMedia = patched;
      try {
        mediaDevices.getUserMedia = patched;
      } catch {}

      // WhatsApp atual pode reutilizar um MediaStream já aberto e não chamar
      // getUserMedia novamente. Nesse caso interceptamos o construtor do
      // MediaRecorder e trocamos somente o stream da gravação pelo áudio salvo.
      if (OriginalMediaRecorder) {
        const RecorderProxy = new Proxy(OriginalMediaRecorder, {
          construct(target, args, newTarget) {
            let useArgs = args;
            try {
              const suppliedStream = args?.[0];
              const looksLikeStream =
                suppliedStream &&
                typeof suppliedStream.getAudioTracks === "function";
              if (!captured && looksLikeStream) {
                useArgs = [destination.stream, ...args.slice(1)];
                announceCapture("MediaRecorder");
                // Depois que o gravador já recebeu o nosso stream, não precisamos
                // manter o construtor global interceptado.
                setTimeout(() => {
                  try {
                    window.MediaRecorder = OriginalMediaRecorder;
                  } catch {}
                }, 0);
              }
            } catch (e) {
              console.warn("[APOIS native voice] MediaRecorder proxy:", e);
            }
            return Reflect.construct(target, useArgs, target);
          },
          get(target, prop, receiver) {
            return Reflect.get(target, prop, receiver);
          },
        });
        try {
          window.MediaRecorder = RecorderProxy;
        } catch {}
      }
    } catch (e) {
      await ctx.close().catch(() => {});
      throw new Error(
        "Não foi possível interceptar o gravador do WhatsApp: " +
          (e?.message || e),
      );
    }

    session = {
      id: req.id,
      ctx,
      buffer,
      destination,
      stream: destination.stream,
      source,
      silent,
      restore,
      started: false,
      captured: false,
      captureMethod: "",
    };

    source.onended = () => {
      post("NATIVE_AUDIO_ENDED", { id: req.id, duration: buffer.duration });
      // Não fecha imediatamente: o WhatsApp ainda precisa clicar em enviar.
      if (session?.id === req.id) {
        session.hardTimer = setTimeout(() => cleanup("fim normal"), 8000);
      }
    };

    session.captureTimer = setTimeout(() => {
      if (session?.id === req.id && !captured) {
        post("NATIVE_AUDIO_ERROR", {
          id: req.id,
          error: "O WhatsApp não iniciou o gravador após o clique",
        });
        cleanup("microfone não capturado");
      }
    }, 8000);

    post("NATIVE_AUDIO_ARMED", {
      id: req.id,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    });
  }

  async function start(req) {
    if (!session || session.id !== req.id) {
      throw new Error("Sessão de áudio não encontrada");
    }
    if (session.started) return;
    session.started = true;
    await session.ctx.resume().catch(() => {});
    // Pequena folga para o MediaRecorder do WhatsApp começar de fato.
    await sleep(320);
    session.source.start(0);
    post("NATIVE_AUDIO_STARTED", {
      id: req.id,
      duration: session.buffer.duration,
    });
  }

  function finish(req) {
    if (!session || session.id !== req.id) return;
    // O envio já foi clicado pela camada de conteúdo; agora pode liberar tudo.
    setTimeout(() => cleanup("enviado"), 1000);
  }

  async function handle(req) {
    try {
      if (req.type === "NATIVE_PING") {
        post("NATIVE_STATUS", {
          id: req.id,
          ok: true,
          audioContext: !!(window.AudioContext || window.webkitAudioContext),
          mediaDevices: !!navigator.mediaDevices,
          getUserMedia:
            typeof navigator.mediaDevices?.getUserMedia === "function",
          mediaRecorder: typeof window.MediaRecorder === "function",
        });
        return;
      }
      if (req.type === "NATIVE_AUDIO_PREPARE") return await prepare(req);
      if (req.type === "NATIVE_AUDIO_START") return await start(req);
      if (req.type === "NATIVE_AUDIO_FINISH") return finish(req);
      if (req.type === "NATIVE_AUDIO_CANCEL") return cleanup("cancelado");
    } catch (e) {
      console.error("[APOIS native voice]", e);
      post("NATIVE_AUDIO_ERROR", {
        id: req.id,
        error: String(e?.message || e),
        stack: String(e?.stack || ""),
      });
      cleanup("erro");
    }
  }

  window.addEventListener("message", (e) => {
    if (
      e.source !== window ||
      e.origin !== location.origin ||
      e.data?.source !== "APOIS_CONTENT_NATIVE"
    )
      return;
    void handle(e.data);
  });

  window.addEventListener("unload", () => cleanup("página encerrada"), {
    once: true,
  });
  post("NATIVE_BRIDGE_READY", { ok: true });
})();
