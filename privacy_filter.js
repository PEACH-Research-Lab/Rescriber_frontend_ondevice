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

export async function getPrivacyFilterResponseDetect(
  userMessage,
  onResultCallback
) {
  console.log("[privacy_filter:detect] Input:", userMessage.slice(0, 200));
  const t0 = performance.now();

  const response = await callPrivacyFilter(userMessage);
  const entities = response.results || [];

  const ms = (performance.now() - t0).toFixed(0);
  console.log(
    `[privacy_filter:detect] Done (${ms}ms, device=${
      response.device || "?"
    }): ${entities.length} entities`
  );

  if (onResultCallback && entities.length > 0) {
    await onResultCallback(entities);
  }

  return entities;
}
