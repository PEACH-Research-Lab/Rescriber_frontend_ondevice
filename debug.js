// debug.js — Gates non-error logging behind a user-controlled flag so prompt
// text and PII never reach the console in the default ship state. Toggle the
// "debugLogging" option in the extension's Options page (or run
// `chrome.storage.sync.set({ debugLogging: true })` from a SW console) to
// enable verbose output. console.error stays unconditional — it does not
// carry PII today and you want it in any user-submitted bug report.

let _enabled = false;

(async () => {
  try {
    const { debugLogging } = await chrome.storage.sync.get("debugLogging");
    _enabled = !!debugLogging;
  } catch (_) {
    // chrome.storage unavailable in this context; stay off.
  }
})();

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.debugLogging) _enabled = !!changes.debugLogging.newValue;
  });
} catch (_) {}

// console.debug is hidden at Chrome's default log level, so even when the
// flag is on a casual screenshot is unlikely to capture these.
export const dlog = (...a) => {
  if (_enabled) console.debug(...a);
};
export const dwarn = (...a) => {
  if (_enabled) console.warn(...a);
};
export const derr = (...a) => console.error(...a);

export function isDebugEnabled() {
  return _enabled;
}
