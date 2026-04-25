// privacy_filter.js — Content-script-side wrapper for the privacy_filter
// detection mode. Sends the user message to the background service worker,
// which spins up (or reuses) an offscreen document running the
// openai/privacy-filter model via Transformers.js.

import { dlog } from "./debug.js";

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
// Returns each non-empty segment with its starting offset in the original
// text, so caller can translate sentence-local entity offsets back to
// message-global ones. Falls back to the full text as a single segment when
// no boundary matches.
function splitIntoSentences(text) {
  const segments = [];
  const splitRegex = /(?<=[.!?\n])\s+/g;
  let lastEnd = 0;
  let m;
  while ((m = splitRegex.exec(text)) !== null) {
    const seg = text.slice(lastEnd, m.index);
    const trimmed = seg.trim();
    if (trimmed.length > 0) {
      const offset = lastEnd + (seg.length - seg.trimStart().length);
      segments.push({ text: trimmed, offset });
    }
    lastEnd = m.index + m[0].length;
  }
  const tail = text.slice(lastEnd);
  const trimmedTail = tail.trim();
  if (trimmedTail.length > 0) {
    const offset = lastEnd + (tail.length - tail.trimStart().length);
    segments.push({ text: trimmedTail, offset });
  }
  return segments.length > 0 ? segments : [{ text, offset: 0 }];
}

const VALID_SEGMENTATIONS = new Set(["sentence", "whole"]);
const DEFAULT_SEGMENTATION = "whole";

async function getSegmentationMode() {
  try {
    const { privacyFilterSegmentation } = await chrome.storage.sync.get(
      "privacyFilterSegmentation"
    );
    return VALID_SEGMENTATIONS.has(privacyFilterSegmentation)
      ? privacyFilterSegmentation
      : DEFAULT_SEGMENTATION;
  } catch (e) {
    return DEFAULT_SEGMENTATION;
  }
}

export async function getPrivacyFilterResponseDetect(
  userMessage,
  onResultCallback
) {
  dlog(`[privacy_filter:detect] Input chars=${userMessage.length}`);
  const t0 = performance.now();

  const segmentation = await getSegmentationMode();

  if (segmentation === "whole") {
    const response = await callPrivacyFilter(userMessage);
    if (response.fellBackToWasm) showWebGPUFallbackToast();
    const entities = response.results || [];
    if (entities.length > 0 && onResultCallback) {
      await onResultCallback([...entities]);
    }
    const ms = (performance.now() - t0).toFixed(0);
    dlog(
      `[privacy_filter:detect] Done (${ms}ms, device=${
        response.device || "?"
      }, mode=whole): ${entities.length} entities`
    );
    return entities;
  }

  const sentences = splitIntoSentences(userMessage);
  dlog(
    `[privacy_filter:detect] Split into ${sentences.length} sentence(s)`
  );

  const allEntities = [];
  let device = null;

  for (let i = 0; i < sentences.length; i++) {
    const { text: sentence, offset: segOffset } = sentences[i];
    const response = await callPrivacyFilter(sentence);
    device = response.device || device;
    if (response.fellBackToWasm) showWebGPUFallbackToast();
    const entities = response.results || [];
    // Entity offsets come back relative to the sentence we sent; shift them
    // so they're relative to the full userMessage.
    for (const e of entities) {
      if (typeof e.start === "number") e.start += segOffset;
      if (typeof e.end === "number") e.end += segOffset;
    }
    dlog(
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
  dlog(
    `[privacy_filter:detect] Done (${ms}ms, device=${
      device || "?"
    }, mode=sentence): ${allEntities.length} entities across ${
      sentences.length
    } sentence(s)`
  );

  return allEntities;
}
