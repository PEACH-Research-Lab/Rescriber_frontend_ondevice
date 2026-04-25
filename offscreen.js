// offscreen.js — Runs the openai/privacy-filter model via Transformers.js
// inside an MV3 offscreen document. WebGPU is used when available; on a
// transient WebGPU runtime failure the pipeline is rebuilt and the inference
// is retried up to MAX_WEBGPU_RETRIES times. Only after those retries are
// exhausted does the code fall back to WASM — and once that fallback happens,
// subsequent requests in this session stay on WASM to avoid repeating the
// retry storm on every call. The fallback decision is not persisted across
// sessions, so a browser/extension reload will re-attempt WebGPU.

console.log("[offscreen] script loading");

const MODEL_ID = "openai/privacy-filter";

// Tunable operating point. Defaults are applied at module load; real values
// come from chrome.storage.sync via loadSettings() and storage.onChanged,
// both wired up below in a try/catch so a storage-API failure can never
// prevent the message listener (registered first) from coming online.
// Transformers.js only supports "simple" and "none"; word-level strategies
// (first/average/max) are Python-transformers only.
const VALID_AGGREGATIONS = new Set(["simple", "none"]);
const DEFAULT_AGGREGATION = "simple";
const DEFAULT_THRESHOLD = 0;

let currentAggregation = DEFAULT_AGGREGATION;
let currentThreshold = DEFAULT_THRESHOLD;

// Map of privacy-filter labels → Rescriber taxonomy placeholders.
// Privacy-filter outputs 8 entity_group values (entity_group comes from
// BIOES-decoded spans with aggregation_strategy: "simple").
const LABEL_MAP = {
  private_person: "NAME",
  private_email: "EMAIL",
  private_phone: "PHONE_NUMBER",
  private_address: "ADDRESS",
  private_url: "URL",
  private_date: "TIME",
  private_account_number: "ID_NUMBER",
  account_number: "ID_NUMBER",
  private_secret: "KEYS",
  secret: "KEYS",
};

let pipelinePromise = null;
let pipelineDevice = null;
// Flipped to true once a WebGPU request has retried MAX_WEBGPU_RETRIES times
// and still failed. From that point on, getPipeline() builds WASM directly
// so we don't replay the retry storm on every subsequent request.
let webgpuGaveUp = false;

// How many times to rebuild the pipeline and retry a single inference after
// a transient WebGPU runtime error (e.g. "Invalid dispatch group size",
// device-lost). The cap prevents an unbounded retry loop on a truly broken
// driver; each retry rebuilds the pipeline from scratch.
const MAX_WEBGPU_RETRIES = 3;

async function buildPipeline(device, dtype) {
  const mod = await import(
    chrome.runtime.getURL("vendor/transformers.min.js")
  );
  const { pipeline, env } = mod;

  env.allowLocalModels = false;
  env.allowRemoteModels = true;

  const vendorBase = chrome.runtime.getURL("vendor/");
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = vendorBase;
    env.backends.onnx.wasm.numThreads = 1;
  }

  console.log(
    `[offscreen] Loading privacy-filter model (device=${device}, dtype=${dtype})…`
  );
  const t0 = performance.now();
  const classifier = await pipeline("token-classification", MODEL_ID, {
    device,
    dtype,
  });
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`[offscreen] Model ready (${ms}ms)`);
  return classifier;
}

async function getPipeline() {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    // q4 triggers the GatherBlockQuantized WebGPU kernel which fails with
    // "Invalid dispatch group size" on some drivers; q4f16 uses a different
    // gather path and is stable across the GPUs we've tested.
    const hasWebGPU =
      !webgpuGaveUp &&
      typeof navigator !== "undefined" &&
      "gpu" in navigator;
    const device = hasWebGPU ? "webgpu" : "wasm";
    const dtype = hasWebGPU ? "q4f16" : "q8";
    const classifier = await buildPipeline(device, dtype);
    pipelineDevice = device;
    return classifier;
  })();

  try {
    return await pipelinePromise;
  } catch (err) {
    // Allow retry on next call if loading failed.
    pipelinePromise = null;
    throw err;
  }
}

// Runtime errors from the WebGPU backend (OrtRun / dispatch-size failures,
// device-lost, etc.) are not recoverable on the same pipeline instance —
// the pipeline must be rebuilt before the next inference.
function isWebGPURuntimeError(err) {
  const msg = (err && (err.message || String(err))) || "";
  return (
    /OrtRun|dispatch group size|GatherBlockQuantized|WebGPU|device lost/i.test(
      msg
    )
  );
}

function mapEntities(raw) {
  return raw
    .map((e) => {
      const word = e.word || "";
      const text = word.trim();
      // BPE word reconstruction can include leading/trailing whitespace; shift
      // start/end inward by the same amount we trim, so offsets keep pointing
      // exactly at the text we kept.
      let start =
        typeof e.start === "number" ? e.start : null;
      let end = typeof e.end === "number" ? e.end : null;
      if (start !== null && end !== null) {
        start += word.length - word.trimStart().length;
        end -= word.length - word.trimEnd().length;
      }
      return {
        entity_type: LABEL_MAP[e.entity_group] || "UNKNOWN",
        text,
        score: e.score,
        start,
        end,
      };
    })
    .filter(
      (e) =>
        e.text.length > 0 &&
        e.entity_type !== "UNKNOWN" &&
        (typeof e.score !== "number" || e.score >= currentThreshold)
    );
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type !== "privacy_filter:run") return false;

  (async () => {
    const t0 = performance.now();
    const text = request.text || "";

    // Empty / whitespace-only input produces zero-length token tensors, which
    // is itself one source of the "dispatch group size (0, 1, 1)" error.
    // Short-circuit without hitting the model.
    if (!text.trim()) {
      sendResponse({ results: [], device: pipelineDevice, retries: 0 });
      return;
    }

    const runOnce = async () => {
      const classifier = await getPipeline();
      const raw = await classifier(text, {
        aggregation_strategy: currentAggregation,
      });
      return mapEntities(raw);
    };

    let entities;
    let retries = 0;
    let fellBackToWasm = false;
    try {
      while (true) {
        try {
          entities = await runOnce();
          break;
        } catch (err) {
          const onWebgpu = pipelineDevice === "webgpu";
          const webgpuErr = isWebGPURuntimeError(err);

          // (1) Retry on WebGPU up to the cap.
          if (onWebgpu && webgpuErr && retries < MAX_WEBGPU_RETRIES) {
            retries += 1;
            console.warn(
              `[offscreen] WebGPU inference failed (attempt ${retries}/${MAX_WEBGPU_RETRIES}): ${err.message}. Rebuilding pipeline and retrying…`
            );
            pipelinePromise = null;
            continue;
          }

          // (2) Retries exhausted — fall back to WASM once, and make the
          // fallback sticky for the rest of this session so we don't retry
          // WebGPU on every subsequent request.
          if (onWebgpu && webgpuErr && !fellBackToWasm) {
            console.warn(
              `[offscreen] WebGPU retries exhausted (${retries}/${MAX_WEBGPU_RETRIES}): ${err.message}. Falling back to WASM for this and future requests in this session.`
            );
            webgpuGaveUp = true;
            fellBackToWasm = true;
            pipelinePromise = null;
            continue;
          }

          // (3) Non-WebGPU error, or WASM also failed — give up.
          throw err;
        }
      }
      const ms = (performance.now() - t0).toFixed(0);
      const retryNote = retries
        ? `, ${retries} webgpu retr${retries === 1 ? "y" : "ies"}`
        : "";
      const fallbackNote = fellBackToWasm ? ", fell back to wasm" : "";
      console.log(
        `[offscreen] ✓ ${entities.length} entities (${ms}ms, ${pipelineDevice}${retryNote}${fallbackNote})`
      );
      sendResponse({
        results: entities,
        device: pipelineDevice,
        retries,
        fellBackToWasm,
      });
    } catch (err) {
      const ms = (performance.now() - t0).toFixed(0);
      console.error(
        `[offscreen] ✗ (${ms}ms, after ${retries} webgpu retr${
          retries === 1 ? "y" : "ies"
        }${fellBackToWasm ? " + wasm fallback" : ""}):`,
        err
      );
      sendResponse({
        error: err.message || String(err),
        retries,
        fellBackToWasm,
      });
    }
  })();

  return true; // async response
});

console.log("[offscreen] message listener registered");

// Settings wiring runs AFTER the message listener is registered, so even if
// chrome.storage is unavailable or throws, the listener is already in place
// and the doc can still respond to privacy_filter:run requests.
async function loadSettings() {
  try {
    const { privacyFilterAggregation, privacyFilterThreshold } =
      await chrome.storage.sync.get([
        "privacyFilterAggregation",
        "privacyFilterThreshold",
      ]);
    if (VALID_AGGREGATIONS.has(privacyFilterAggregation)) {
      currentAggregation = privacyFilterAggregation;
    }
    if (
      typeof privacyFilterThreshold === "number" &&
      privacyFilterThreshold >= 0 &&
      privacyFilterThreshold <= 1
    ) {
      currentThreshold = privacyFilterThreshold;
    }
    console.log(
      `[offscreen] Settings: aggregation=${currentAggregation} threshold=${currentThreshold}`
    );
  } catch (e) {
    console.warn("[offscreen] Failed to load settings; using defaults:", e);
  }
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.privacyFilterAggregation) {
      const next = changes.privacyFilterAggregation.newValue;
      if (VALID_AGGREGATIONS.has(next)) currentAggregation = next;
    }
    if (changes.privacyFilterThreshold) {
      const next = changes.privacyFilterThreshold.newValue;
      if (typeof next === "number" && next >= 0 && next <= 1) {
        currentThreshold = next;
      }
    }
  });
  loadSettings();
} catch (e) {
  console.warn("[offscreen] Settings wiring failed; using defaults:", e);
}

// Preload the pipeline so first detection has minimal latency.
getPipeline().catch((err) => {
  console.error("[offscreen] Preload failed:", err);
});
