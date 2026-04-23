// privacy_filter.js — Content-script-side wrapper for the privacy_filter
// detection mode. Sends the user message to the background service worker,
// which spins up (or reuses) an offscreen document running the
// openai/privacy-filter model via Transformers.js.

async function callPrivacyFilter(text) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "privacy_filter", text },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      }
    );
  });
}

// Shown once per page load, the first time the offscreen doc tells us it
// gave up on WebGPU and rebuilt the pipeline on WASM.
let fallbackToastShown = false;
function showWebGPUFallbackToast() {
  if (fallbackToastShown) return;
  fallbackToastShown = true;
  try {
    const el = document.createElement("div");
    el.textContent =
      "Rescriber: WebGPU inference failed, switched to CPU (WASM). Detection will be slower.";
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      maxWidth: "360px",
      padding: "10px 14px",
      background: "rgba(30, 30, 30, 0.92)",
      color: "#fff",
      font: "13px/1.4 system-ui, -apple-system, sans-serif",
      borderRadius: "6px",
      boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
      opacity: "0",
      transition: "opacity 200ms ease",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = "1"));
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 5000);
  } catch (e) {
    // DOM unavailable — nothing to show.
  }
}

// Split on sentence boundaries (., !, ?, or newline) followed by whitespace.
// Falls back to the full text as a single segment when no boundary matches.
function splitIntoSentences(text) {
  const parts = text
    .split(/(?<=[.!?\n])\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [text];
}

export async function getPrivacyFilterResponseDetect(
  userMessage,
  onResultCallback
) {
  console.log("[privacy_filter:detect] Input:", userMessage.slice(0, 200));
  const t0 = performance.now();

  const sentences = splitIntoSentences(userMessage);
  console.log(
    `[privacy_filter:detect] Split into ${sentences.length} sentence(s)`
  );

  const allEntities = [];
  let device = null;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const response = await callPrivacyFilter(sentence);
    device = response.device || device;
    if (response.fellBackToWasm) showWebGPUFallbackToast();
    const entities = response.results || [];
    console.log(
      `[privacy_filter:detect] Sentence ${i + 1}/${sentences.length} (${
        sentence.length
      } chars): ${entities.length} entities`
    );
    if (entities.length > 0) {
      allEntities.push(...entities);
      if (onResultCallback) {
        await onResultCallback([...allEntities]);
      }
    }
  }

  const ms = (performance.now() - t0).toFixed(0);
  console.log(
    `[privacy_filter:detect] Done (${ms}ms, device=${device || "?"}): ${
      allEntities.length
    } entities across ${sentences.length} sentence(s)`
  );

  return allEntities;
}
