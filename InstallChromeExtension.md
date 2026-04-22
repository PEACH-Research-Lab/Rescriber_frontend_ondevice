1. Download this git repo
2. (First time only) Fetch the Transformers.js vendor bundle used by the default
   "Privacy Filter" detection mode. Transformers.js 4.2.0+ is required — earlier
   versions do not support the `openai_privacy_filter` model class.
   ```
   cd vendor
   curl -L -O https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js
   # ONNX Runtime Web assets (single-threaded WebGPU uses the asyncify variant;
   # jsep is kept as a fallback).
   ORT=https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist
   curl -L -O $ORT/ort-wasm-simd-threaded.asyncify.mjs
   curl -L -O $ORT/ort-wasm-simd-threaded.asyncify.wasm
   curl -L -O $ORT/ort-wasm-simd-threaded.jsep.mjs
   curl -L -O $ORT/ort-wasm-simd-threaded.jsep.wasm
   ```
3. Open Chrome browser
4. Go to `chrome://extensions/`
5. Enable Developer mode ![image](https://github.com/jigglypuff96/inline_pii_replacer/assets/49411569/9c89c2e2-498f-4b1f-93cd-4ae168d2f01e)
6. Click "Load Unpackaged"
7. Select the downloaded folder
8. Goes to ChatGPT and try it out! First detection downloads the
   `openai/privacy-filter` model (~30–50 MB), cached thereafter.

https://github.com/jigglypuff96/inline_pii_replacer/assets/49411569/fcf3a176-baf0-4eee-b01d-790751406ebc
