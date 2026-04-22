// background.js — Proxies requests from content scripts to local Ollama instance.
// Supports both streaming (via ports) and non-streaming (via messages).

const OLLAMA_BASE = "http://localhost:11434";

// --- Streaming via ports ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ollama-stream") return;

  port.onMessage.addListener(async (request) => {
    const t0 = performance.now();
    const model = request.model || "?";
    const userMsg =
      request.messages?.find((m) => m.role === "user")?.content || "";
    const preview = userMsg.slice(0, 120) + (userMsg.length > 120 ? "…" : "");
    console.log(`[Ollama:stream] ➜ model=${model}\n  user: "${preview}"`);

    const url = `${OLLAMA_BASE}/api/chat`;
    const payload = {
      model: request.model,
      messages: request.messages,
      stream: true,
      format: request.format || "json",
      options: request.options || { temperature: 0 },
    };

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const ms = (performance.now() - t0).toFixed(0);
      console.error(`[Ollama:stream] ✗ (${ms}ms): ${err.message}`);
      port.postMessage({ type: "error", error: `Cannot reach Ollama: ${err.message}` });
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const ms = (performance.now() - t0).toFixed(0);
      console.error(`[Ollama:stream] ✗ (${ms}ms): ${response.status} ${text}`);
      port.postMessage({ type: "error", error: `Ollama ${response.status}: ${text}` });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            const token = chunk.message?.content || "";
            if (token) {
              port.postMessage({ type: "token", content: token });
            }
            if (chunk.done) {
              const ms = (performance.now() - t0).toFixed(0);
              console.log(`[Ollama:stream] ✓ (${ms}ms) eval_count=${chunk.eval_count || 0}`);
              port.postMessage({
                type: "done",
                stats: {
                  total_duration: chunk.total_duration,
                  prompt_eval_count: chunk.prompt_eval_count,
                  eval_count: chunk.eval_count,
                  eval_duration: chunk.eval_duration,
                },
              });
            }
          } catch (e) {
            // Partial line, skip
          }
        }
      }
    } catch (err) {
      const ms = (performance.now() - t0).toFixed(0);
      console.error(`[Ollama:stream] ✗ read error (${ms}ms): ${err.message}`);
      port.postMessage({ type: "error", error: err.message });
    }
  });
});

// --- Presidio proxy ---
const PRESIDIO_BASE = "http://localhost:5002";

// --- Privacy-filter offscreen document ---
// The offscreen document loads Transformers.js + the openai/privacy-filter
// model. Service workers can't run WebGPU reliably, so inference lives there.
const OFFSCREEN_URL = "offscreen.html";

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification:
        "Run the openai/privacy-filter token-classification model (Transformers.js + WebGPU) for on-device PII detection.",
    });
  } catch (err) {
    // Another concurrent call may have created the document first.
    if (!(await chrome.offscreen.hasDocument())) throw err;
  }
}

// --- Non-streaming via messages (kept for simple calls) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "privacy_filter:warmup") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        console.log("[privacy_filter] ✓ warmup: offscreen document ready");
        sendResponse({ ok: true });
      } catch (err) {
        console.error(`[privacy_filter] ✗ warmup: ${err.message}`);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (request.type === "privacy_filter") {
    const t0 = performance.now();
    const preview = (request.text || "").slice(0, 120);
    console.log(`[privacy_filter] ➜ "${preview}"`);

    (async () => {
      try {
        await ensureOffscreenDocument();
        const response = await chrome.runtime.sendMessage({
          type: "privacy_filter:run",
          text: request.text,
        });
        const ms = (performance.now() - t0).toFixed(0);
        if (response?.error) {
          console.error(`[privacy_filter] ✗ (${ms}ms): ${response.error}`);
        } else {
          console.log(
            `[privacy_filter] ✓ (${ms}ms): ${
              response?.results?.length || 0
            } entities`
          );
        }
        sendResponse(response);
      } catch (err) {
        const ms = (performance.now() - t0).toFixed(0);
        console.error(`[privacy_filter] ✗ (${ms}ms): ${err.message}`);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (request.type === "presidio") {
    const t0 = performance.now();
    const url = `${PRESIDIO_BASE}${request.endpoint}`;
    console.log(`[Presidio] ➜ ${request.endpoint}`);

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Presidio ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const ms = (performance.now() - t0).toFixed(0);
        console.log(`[Presidio] ✓ (${ms}ms): ${data.results?.length || 0} entities`);
        sendResponse(data);
      })
      .catch((err) => {
        const ms = (performance.now() - t0).toFixed(0);
        console.error(`[Presidio] ✗ (${ms}ms): ${err.message}`);
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (request.type === "ollama") {
    const t0 = performance.now();
    const model = request.payload?.model || "?";
    const userMsg =
      request.payload?.messages?.find((m) => m.role === "user")?.content || "";
    const preview = userMsg.slice(0, 120) + (userMsg.length > 120 ? "…" : "");
    console.log(
      `[Ollama] ➜ ${request.endpoint} model=${model}\n  user: "${preview}"`
    );

    fetchOllama(request.endpoint, request.payload)
      .then((data) => {
        const ms = (performance.now() - t0).toFixed(0);
        const reply = data.message?.content || JSON.stringify(data).slice(0, 200);
        console.log(
          `[Ollama] ✓ ${request.endpoint} (${ms}ms)\n  response: ${reply.slice(0, 300)}`
        );
        sendResponse(data);
      })
      .catch((err) => {
        const ms = (performance.now() - t0).toFixed(0);
        console.error(`[Ollama] ✗ ${request.endpoint} (${ms}ms): ${err.message}`);
        sendResponse({ error: err.message });
      });
    return true;
  }
});

async function fetchOllama(endpoint, payload) {
  const url = `${OLLAMA_BASE}${endpoint}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach Ollama at ${OLLAMA_BASE}. Is Ollama running? (${err.message})`
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama ${response.status}: ${text}`);
  }

  return await response.json();
}
