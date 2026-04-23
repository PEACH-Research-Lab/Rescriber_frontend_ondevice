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
