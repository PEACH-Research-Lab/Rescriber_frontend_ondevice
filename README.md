# Rescriber

Chrome extension that detects PII in your ChatGPT prompts and lets you
replace it with placeholders (or abstract it) before sending.

The default **Privacy Filter** mode runs the
[`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter)
model entirely in your browser via Transformers.js — no server, no API key,
no data leaves the machine. Other backends (Ollama, OpenAI, Presidio) are
available in the options page but are not required.

---

## Quick start (Privacy Filter, default)

### Prerequisites

- Google Chrome with WebGPU support (Chrome 113+). WASM fallback runs if
  WebGPU is disabled, just slower.

### Install

1. Clone or download this repo.

2. Fetch the Transformers.js + ONNX Runtime Web assets into `vendor/`
   (first time only):

   ```bash
   cd vendor
   curl -L -O https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js
   ORT=https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist
   curl -L -O $ORT/ort-wasm-simd-threaded.asyncify.mjs
   curl -L -O $ORT/ort-wasm-simd-threaded.asyncify.wasm
   curl -L -O $ORT/ort-wasm-simd-threaded.jsep.mjs
   curl -L -O $ORT/ort-wasm-simd-threaded.jsep.wasm
   ```

   Transformers.js 4.2.0+ is required — earlier versions don't know the
   `openai_privacy_filter` model class.

3. Load the extension:
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked** and select the repo folder
   - Confirm **Rescriber** appears in the list

See [InstallChromeExtension.md](InstallChromeExtension.md) for a walk-through
with screenshots.

### Use

1. Go to [chatgpt.com](https://chatgpt.com/).
2. A small detect button appears next to the composer. Start typing — after
   a short pause the extension scans the message.
3. The first scan downloads the `openai/privacy-filter` model (~30–50 MB,
   cached afterwards).
4. When PII is detected, a panel lists the findings. For each item you can:
   - **Replace** — swap the value for a placeholder like `[NAME1]`
   - **Abstract** — rewrite the surrounding sentence to remove the detail
     (requires OpenAI mode; not used by the default Privacy Filter flow)
   - **Revert** — undo the last replace/abstract on the current message

Placeholders are mapped locally per-conversation, so when the assistant
replies with a placeholder you see the original value restored in-place.

---

## Other detection modes

Open the extension's options page (right-click the toolbar icon →
**Options**) to switch modes:

- **Privacy Filter** (default) — in-browser, no setup beyond the vendor
  download above.
- **On-Device LLM (Ollama)** — runs a local Llama model via Ollama.
  Requires `ollama pull llama3` and the Rescriber backend server.
- **Cloud LLM (OpenAI)** — uses the OpenAI API. Paste a key in the
  options page.
- **Presidio** — requires `python presidio_server.py` on port 5002.

The Ollama and Presidio modes need the
[Rescriber_backend](https://github.com/jigglypuff96/Rescriber_backend) repo
running; consult that repo's README for setup.

---

## Uninstall

1. `chrome://extensions` → locate **Rescriber** → **Remove**.
2. Delete the repo folder.
3. If you were running the backend server, stop it (`Ctrl+C` in its terminal)
   and delete its folder.
