# Rescriber

Chrome extension that detects PII in your ChatGPT prompts and lets you replace
it with placeholders before sending. Detection runs entirely in your browser
via the [`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter)
token-classification model loaded with Transformers.js — no server, no API key,
no prompt text leaves the machine.

> Rescriber is an independent project and is not affiliated with, endorsed by,
> or sponsored by OpenAI. The model name `openai/privacy-filter` reflects the
> Hugging Face publisher of the underlying open-weights model.

This branch (`release/cws-1.0.1`) is the Chrome Web Store release build. It
keeps only the Privacy Filter detection mode; the multi-backend variants
(OpenAI cloud, Ollama, Presidio) live on `main`.

---

## Quick start

### Prerequisites

- Google Chrome with WebGPU support (Chrome 113+). WASM fallback runs if
  WebGPU is disabled, just slower.

### Install (recommended)

1. Download the latest `rescriber-v1.0.1.zip` release.
2. Unzip it.
3. Open `chrome://extensions/`, enable **Developer mode**, click
   **Load unpacked**, and select the unzipped folder.

### Install from source

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
3. The first scan downloads the `openai/privacy-filter` model (~30–50 MB) from
   `huggingface.co`. Cached afterwards.
4. When PII is detected, a panel lists the findings. For each item you can:
   - **Replace** — swap the value for a placeholder like `[NAME1]`
   - **Revert** — undo the last replace on the current message
5. Placeholders are mapped locally per-conversation, so when the assistant
   replies with a placeholder you see the original value restored in-place.

---

## What the extension stores, and where

- `chrome.storage.local`: per-conversation PII↔placeholder mappings, entity
  counts, action history, and abstract mappings. Never leaves your machine.
- `chrome.storage.sync`: small UI preferences only (segmentation, aggregation,
  threshold, debug-logging flag, enabled flag). No prompt or PII content.
- Model cache: ONNX weights downloaded on first use are stored by the browser's
  cache for the extension's origin.

You can view and clear all stored data from the options page →
**View stored data**.

---

## Network requests

The extension only makes outbound network requests to:

- `https://huggingface.co` and `https://*.huggingface.co` (model config,
  tokenizer, weights for `openai/privacy-filter`)

Prompts and detected PII are processed locally and never sent over the network.

---

## Uninstall

`chrome://extensions` → locate **Rescriber** → **Remove**.

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
