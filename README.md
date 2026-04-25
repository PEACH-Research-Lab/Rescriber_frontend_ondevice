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

### Install (recommended)

1. Download **`rescriber-v1.0.0.zip`** from the
   [latest release](https://github.com/PEACH-Research-Lab/Rescriber_frontend_ondevice/releases/latest).
   The zip already includes the Transformers.js and ONNX Runtime Web assets
   under `vendor/`, so no `curl` / build step is needed.
2. Unzip it. You'll get a `rescriber-v1.0.0/` folder.
3. Load the extension:
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked** and select the unzipped `rescriber-v1.0.0/` folder
   - Confirm **Rescriber** appears in the list

### Install from source (for developers)

If you're cloning the repo instead of using the release zip, the `vendor/`
folder is empty and you'll need to fetch the runtime assets yourself
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
  Requires `ollama pull llama3` and running ollama as a background service.
- **Cloud LLM (OpenAI)** — uses the OpenAI API. Paste a key in the
  options page.
- **Presidio** — requires `python presidio_server.py` on port 5002.

---

## Uninstall

1. `chrome://extensions` → locate **Rescriber** → **Remove**.
2. Delete the repo folder.
3. If you were running the backend server, stop it (`Ctrl+C` in its terminal)
   and delete its folder.

## Licenses

Rescriber's own source is MIT — see [LICENSE](LICENSE). The bundled
Transformers.js and ONNX Runtime Web assets in `vendor/` carry their
upstream licenses; full notices are in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Paper

[Rescriber: Smaller-LLM-Powered User-Led Data Minimization for LLM-Based Chatbots](https://dl.acm.org/doi/10.1145/3706598.3713701)
— Jijie Zhou, Eryue Xu, Yaoyao Wu, Tianshi Li. CHI '25.

```bibtex
@inproceedings{Zhou_2025,
  series    = {CHI '25},
  title     = {Rescriber: Smaller-LLM-Powered User-Led Data Minimization for LLM-Based Chatbots},
  url       = {http://dx.doi.org/10.1145/3706598.3713701},
  DOI       = {10.1145/3706598.3713701},
  booktitle = {Proceedings of the 2025 CHI Conference on Human Factors in Computing Systems},
  publisher = {ACM},
  author    = {Zhou, Jijie and Xu, Eryue and Wu, Yaoyao and Li, Tianshi},
  year      = {2025},
  month     = apr,
  pages     = {1–28},
  collection= {CHI '25}
}
```
