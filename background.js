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

// --- Non-streaming via messages (kept for simple calls) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
