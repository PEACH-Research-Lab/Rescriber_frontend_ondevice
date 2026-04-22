// mappings.js — viewer/editor for Rescriber's chrome.storage.local data.

const STORAGE_KEYS = [
  "piiToPlaceholder",
  "placeholderToPii",
  "entityCounts",
  "actionHistory",
  "abstractMappings",
];

let state = {
  piiToPlaceholder: {},
  placeholderToPii: {},
  entityCounts: {},
  actionHistory: [],
  abstractMappings: {},
  collapsed: new Set(),
  filter: "",
};

function getStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS, (data) => resolve(data || {}));
  });
}

function setStorage(partial) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(partial, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function removeStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1600);
}

function entityTypeFromPlaceholder(placeholder) {
  return String(placeholder || "").replace(/[0-9]+$/, "");
}

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );
}

function matchesFilter(convId, pii, placeholder) {
  const f = state.filter.trim().toLowerCase();
  if (!f) return true;
  return (
    convId.toLowerCase().includes(f) ||
    String(pii).toLowerCase().includes(f) ||
    String(placeholder).toLowerCase().includes(f)
  );
}

async function load() {
  const data = await getStorage();
  state.piiToPlaceholder = data.piiToPlaceholder || {};
  state.placeholderToPii = data.placeholderToPii || {};
  state.entityCounts = data.entityCounts || {};
  state.actionHistory = Array.isArray(data.actionHistory)
    ? data.actionHistory
    : [];
  state.abstractMappings = data.abstractMappings || {};
  render();
}

function render() {
  renderPii();
  renderRawSection(
    "entityCountsCount",
    "entityCountsRaw",
    state.entityCounts
  );
  renderRawSection(
    "actionHistoryCount",
    "actionHistoryRaw",
    state.actionHistory,
    state.actionHistory.length
  );
  renderRawSection(
    "abstractMappingsCount",
    "abstractMappingsRaw",
    state.abstractMappings
  );
}

function renderRawSection(countId, preId, value, explicitCount) {
  const count =
    explicitCount !== undefined
      ? explicitCount
      : value && typeof value === "object"
      ? Object.keys(value).length
      : 0;
  document.getElementById(countId).textContent = count;
  document.getElementById(preId).textContent = JSON.stringify(value, null, 2);
}

function renderPii() {
  const body = document.getElementById("piiBody");
  const convIds = Object.keys(state.piiToPlaceholder);
  let totalVisible = 0;
  let totalAll = 0;

  // count all entries (ignore filter for top count)
  for (const convId of convIds) {
    const m = state.piiToPlaceholder[convId];
    if (m && typeof m === "object") totalAll += Object.keys(m).length;
  }

  if (convIds.length === 0) {
    body.innerHTML = `<div class="empty">No PII mappings stored.</div>`;
    document.getElementById("piiCount").textContent = "0";
    return;
  }

  const sortedConvIds = convIds.slice().sort((a, b) => {
    if (a === "no-url") return 1;
    if (b === "no-url") return -1;
    return a.localeCompare(b);
  });

  const parts = [];
  for (const convId of sortedConvIds) {
    const mapping = state.piiToPlaceholder[convId] || {};
    const entries = Object.entries(mapping);
    const visibleEntries = entries.filter(([pii, placeholder]) =>
      matchesFilter(convId, pii, placeholder)
    );
    if (visibleEntries.length === 0) continue;
    totalVisible += visibleEntries.length;

    const collapsed = state.collapsed.has(convId);
    const rows = visibleEntries
      .map(([pii, placeholder]) => {
        const type = entityTypeFromPlaceholder(placeholder);
        return `
          <tr>
            <td class="pii">${escapeHtml(pii)}</td>
            <td class="pii">${escapeHtml(placeholder)}</td>
            <td>${escapeHtml(type)}</td>
            <td class="actions">
              <button class="icon danger" data-action="delete-entry"
                data-conv="${escapeHtml(convId)}"
                data-pii="${escapeHtml(pii)}"
                data-placeholder="${escapeHtml(placeholder)}">Delete</button>
            </td>
          </tr>`;
      })
      .join("");

    parts.push(`
      <div class="conversation ${collapsed ? "collapsed" : ""}" data-conv="${escapeHtml(
      convId
    )}">
        <header data-action="toggle-conv" data-conv="${escapeHtml(convId)}">
          <div>
            <span class="caret">▼</span>
            <span class="conv-id" title="${escapeHtml(convId)}">${escapeHtml(
      convId
    )}</span>
            <span class="conv-meta">${entries.length} entr${
      entries.length === 1 ? "y" : "ies"
    }${
      visibleEntries.length !== entries.length
        ? ` · ${visibleEntries.length} matching`
        : ""
    }</span>
          </div>
          <button class="icon danger" data-action="delete-conv" data-conv="${escapeHtml(
            convId
          )}">Delete conversation</button>
        </header>
        <table>
          <thead>
            <tr>
              <th>PII text</th>
              <th>Placeholder</th>
              <th>Entity type</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`);
  }

  document.getElementById("piiCount").textContent = state.filter
    ? `${totalVisible} / ${totalAll}`
    : String(totalAll);

  body.innerHTML =
    parts.length > 0
      ? parts.join("")
      : `<div class="empty">No entries match the filter.</div>`;
}

async function deleteEntry(convId, pii, placeholder) {
  if (state.piiToPlaceholder[convId]) {
    delete state.piiToPlaceholder[convId][pii];
    if (Object.keys(state.piiToPlaceholder[convId]).length === 0) {
      delete state.piiToPlaceholder[convId];
    }
  }
  if (state.placeholderToPii[convId]) {
    delete state.placeholderToPii[convId][placeholder];
    if (Object.keys(state.placeholderToPii[convId]).length === 0) {
      delete state.placeholderToPii[convId];
    }
  }
  // decrement entityCounts for this conversation/type
  const type = entityTypeFromPlaceholder(placeholder);
  if (type && state.entityCounts[convId] && state.entityCounts[convId][type]) {
    state.entityCounts[convId][type] -= 1;
    if (state.entityCounts[convId][type] <= 0) {
      delete state.entityCounts[convId][type];
    }
    if (Object.keys(state.entityCounts[convId]).length === 0) {
      delete state.entityCounts[convId];
    }
  }

  await setStorage({
    piiToPlaceholder: state.piiToPlaceholder,
    placeholderToPii: state.placeholderToPii,
    entityCounts: state.entityCounts,
  });
  render();
  toast("Entry deleted");
}

async function deleteConversation(convId) {
  if (
    !confirm(
      `Delete all ${
        Object.keys(state.piiToPlaceholder[convId] || {}).length
      } PII mapping(s) for this conversation? This cannot be undone.`
    )
  ) {
    return;
  }
  delete state.piiToPlaceholder[convId];
  delete state.placeholderToPii[convId];
  delete state.entityCounts[convId];
  await setStorage({
    piiToPlaceholder: state.piiToPlaceholder,
    placeholderToPii: state.placeholderToPii,
    entityCounts: state.entityCounts,
  });
  render();
  toast("Conversation cleared");
}

async function clearPiiAll() {
  if (
    !confirm(
      "Delete ALL PII mappings across every conversation? This cannot be undone."
    )
  ) {
    return;
  }
  state.piiToPlaceholder = {};
  state.placeholderToPii = {};
  await setStorage({
    piiToPlaceholder: {},
    placeholderToPii: {},
  });
  render();
  toast("All PII mappings cleared");
}

async function clearKey(key, label) {
  if (!confirm(`Clear "${label}"? This cannot be undone.`)) return;
  await removeStorage([key]);
  state[key] = Array.isArray(state[key]) ? [] : {};
  render();
  toast(`${label} cleared`);
}

async function clearEverything() {
  if (
    !confirm(
      "Clear ALL Rescriber data (PII mappings, entity counts, action history, abstract mappings)? This cannot be undone."
    )
  ) {
    return;
  }
  await removeStorage(STORAGE_KEYS);
  state.piiToPlaceholder = {};
  state.placeholderToPii = {};
  state.entityCounts = {};
  state.actionHistory = [];
  state.abstractMappings = {};
  render();
  toast("All stored data cleared");
}

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "delete-entry") {
    deleteEntry(
      target.dataset.conv,
      target.dataset.pii,
      target.dataset.placeholder
    );
  } else if (action === "delete-conv") {
    e.stopPropagation();
    deleteConversation(target.dataset.conv);
  } else if (action === "toggle-conv") {
    const convId = target.dataset.conv;
    if (state.collapsed.has(convId)) state.collapsed.delete(convId);
    else state.collapsed.add(convId);
    renderPii();
  }
});

document.getElementById("refreshBtn").addEventListener("click", load);
document.getElementById("clearPiiBtn").addEventListener("click", clearPiiAll);
document
  .getElementById("clearEntityCountsBtn")
  .addEventListener("click", () => clearKey("entityCounts", "Entity Counts"));
document
  .getElementById("clearActionHistoryBtn")
  .addEventListener("click", () => clearKey("actionHistory", "Action History"));
document
  .getElementById("clearAbstractMappingsBtn")
  .addEventListener("click", () =>
    clearKey("abstractMappings", "Abstract Mappings")
  );
document.getElementById("clearAllBtn").addEventListener("click", clearEverything);

document.getElementById("search").addEventListener("input", (e) => {
  state.filter = e.target.value;
  renderPii();
});

// Re-render if storage changes from another surface (content script, etc.).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!STORAGE_KEYS.some((k) => k in changes)) return;
  load();
});

load();
