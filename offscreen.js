// offscreen.js — Runs the openai/privacy-filter model via Transformers.js
// inside an MV3 offscreen document. WebGPU is used when available, with WASM
// fallback. The pipeline is created once on first request and cached.

const MODEL_ID = "openai/privacy-filter";

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
let webgpuDisabled = false;

async function getPipeline() {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    const mod = await import(
      chrome.runtime.getURL("vendor/transformers.min.js")
    );
    const { pipeline, env } = mod;

    // Allow remote model downloads from huggingface.co (data, not code —
    // MV3's remote-code restriction does not apply to model weights).
    env.allowLocalModels = false;
    env.allowRemoteModels = true;

    // Point onnxruntime-web at the bundled WASM + loader so it doesn't try
    // to fetch them from a CDN. These files live next to transformers.min.js
    // in the extension's vendor/ folder.
    const vendorBase = chrome.runtime.getURL("vendor/");
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = vendorBase;
      // Single-threaded is sufficient; extensions rarely get cross-origin
      // isolation needed for SharedArrayBuffer.
      env.backends.onnx.wasm.numThreads = 1;
    }

    // Prefer WebGPU; fall back to WASM if unavailable or previously failed.
    // q4 triggers the GatherBlockQuantized WebGPU kernel which fails with
    // "Invalid dispatch group size" on some drivers; q4f16 uses a different
    // gather path and is stable across the GPUs we've tested.
    const hasWebGPU =
      !webgpuDisabled && typeof navigator !== "undefined" && "gpu" in navigator;
    const device = hasWebGPU ? "webgpu" : "wasm";
    const dtype = hasWebGPU ? "q4f16" : "q8";
    pipelineDevice = device;

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
// device-lost, etc.) are not recoverable on the same pipeline — rebuild on
// WASM and mark WebGPU disabled for the rest of this offscreen document.
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
    .map((e) => ({
      entity_type: LABEL_MAP[e.entity_group] || "UNKNOWN",
      text: (e.word || "").trim(),
      score: e.score,
    }))
    .filter((e) => e.text.length > 0 && e.entity_type !== "UNKNOWN");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type !== "privacy_filter:run") return false;

  (async () => {
    const t0 = performance.now();
    const run = async () => {
      const classifier = await getPipeline();
      const raw = await classifier(request.text || "", {
        aggregation_strategy: "simple",
      });
      return mapEntities(raw);
    };
    try {
      let entities;
      let fellBackToWasm = false;
      try {
        entities = await run();
      } catch (err) {
        if (pipelineDevice === "webgpu" && isWebGPURuntimeError(err)) {
          console.warn(
            `[offscreen] WebGPU inference failed (${err.message}); falling back to WASM.`
          );
          webgpuDisabled = true;
          pipelinePromise = null;
          entities = await run();
          fellBackToWasm = true;
        } else {
          throw err;
        }
      }
      const ms = (performance.now() - t0).toFixed(0);
      console.log(
        `[offscreen] ✓ ${entities.length} entities (${ms}ms, ${pipelineDevice})`
      );
      sendResponse({
        results: entities,
        device: pipelineDevice,
        fellBackToWasm,
      });
    } catch (err) {
      const ms = (performance.now() - t0).toFixed(0);
      console.error(`[offscreen] ✗ (${ms}ms):`, err);
      sendResponse({ error: err.message || String(err) });
    }
  })();

  return true; // async response
});

// Preload the pipeline so first detection has minimal latency.
getPipeline().catch((err) => {
  console.error("[offscreen] Preload failed:", err);
});
