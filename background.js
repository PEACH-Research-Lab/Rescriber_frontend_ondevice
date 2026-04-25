// background.js — Routes privacy-filter inference requests from the content
// script to the offscreen document, where Transformers.js runs the
// openai/privacy-filter token-classification model on WebGPU/WASM.

// Debug-logging gate (inlined here because the SW is a classic script, not a
// module). Default off so prompts/PII don't reach the SW console in shipped
// builds; flip via chrome.storage.sync.set({ debugLogging: true }).
let DEBUG = false;
chrome.storage.sync.get("debugLogging").then(({ debugLogging }) => {
  DEBUG = !!debugLogging;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.debugLogging) {
    DEBUG = !!changes.debugLogging.newValue;
  }
});
const dlog = (...a) => { if (DEBUG) console.debug(...a); };

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

// chrome.offscreen.createDocument resolves when the document exists, not when
// its script has finished evaluating and registered its onMessage listener.
// Sending to the doc in that window throws "Receiving end does not exist".
// Retry with a short backoff so the first request after a cold start works.
async function sendToOffscreen(msg, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (err) {
      const noReceiver = /Receiving end does not exist/.test(err?.message || "");
      if (!noReceiver || i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "privacy_filter:warmup") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        dlog("[privacy_filter] ✓ warmup: offscreen document ready");
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
    dlog(`[privacy_filter] ➜ chars=${(request.text || "").length}`);

    (async () => {
      try {
        await ensureOffscreenDocument();
        const response = await sendToOffscreen({
          type: "privacy_filter:run",
          text: request.text,
        });
        const ms = (performance.now() - t0).toFixed(0);
        if (response?.error) {
          console.error(`[privacy_filter] ✗ (${ms}ms): ${response.error}`);
        } else {
          dlog(
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
});
