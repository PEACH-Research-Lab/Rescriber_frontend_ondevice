// presidio.js — Calls the local Presidio server for PII detection.
// No LLM needed: uses NER + regex recognizers via Microsoft Presidio.

import { dlog } from "./debug.js";

const PRESIDIO_BASE = "http://localhost:5002";

async function callPresidio(text, scoreThreshold = 0.4) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "presidio",
        endpoint: "/analyze",
        payload: { text, score_threshold: scoreThreshold },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              `Presidio request failed: ${chrome.runtime.lastError.message}`
            )
          );
          return;
        }
        if (response?.error) {
          reject(
            new Error(
              `Presidio server unreachable at ${PRESIDIO_BASE} (${response.error})`
            )
          );
          return;
        }
        resolve(response);
      }
    );
  });
}

export async function getPresidioResponseDetect(userMessage, onResultCallback) {
  dlog(`[presidio:detect] Input chars=${userMessage.length}`);
  const t0 = performance.now();

  const response = await callPresidio(userMessage);
  const entities = response.results || [];

  const ms = (performance.now() - t0).toFixed(0);
  dlog(`[presidio:detect] Done (${ms}ms): ${entities.length} entities`);

  // Presidio returns all results at once (no streaming), so call back once
  if (onResultCallback && entities.length > 0) {
    await onResultCallback(entities);
  }

  return entities;
}
