document.getElementById("saveButton").addEventListener("click", () => {
  const apiOption = document.querySelector(
    'input[name="apiOption"]:checked'
  ).value;
  const apiKey = document.getElementById("apiKey").value;
  const ollamaModel = document.getElementById("ollamaModel").value.trim() || "llama3";
  const detectionMode = document.querySelector(
    'input[name="detectionMode"]:checked'
  ).value;

  chrome.storage.sync.set({ apiOption, openaiApiKey: apiKey, ollamaModel, detectionMode }, () => {
    alert("Settings saved.");
  });
});

chrome.storage.sync.get(["apiOption", "openaiApiKey", "ollamaModel", "detectionMode"], (result) => {
  if (result.apiOption) {
    document.querySelector(
      `input[name="apiOption"][value="${result.apiOption}"]`
    ).checked = true;
  }
  if (result.apiOption === "own" && result.openaiApiKey) {
    document.getElementById("apiKey").value = result.openaiApiKey;
  }
  if (result.ollamaModel) {
    document.getElementById("ollamaModel").value = result.ollamaModel;
  }
  if (result.detectionMode) {
    const radio = document.querySelector(
      `input[name="detectionMode"][value="${result.detectionMode}"]`
    );
    if (radio) radio.checked = true;
  }
  updateSections();
});

// Disable or enable the API key input based on the selected option
document.querySelectorAll('input[name="apiOption"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    document.getElementById("apiKey").disabled = radio.value !== "own";
  });
});

// Show/hide sections based on detection mode
function updateSections() {
  const mode = document.querySelector('input[name="detectionMode"]:checked').value;
  document.getElementById("privacyFilterSection").style.display = mode === "privacy_filter" ? "" : "none";
  document.getElementById("ollamaSection").style.display = mode === "ondevice" ? "" : "none";
  document.getElementById("presidioSection").style.display = mode === "presidio" ? "" : "none";
}

document.querySelectorAll('input[name="detectionMode"]').forEach((radio) => {
  radio.addEventListener("change", updateSections);
});

document.getElementById("viewStoredDataButton").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("mappings.html") });
});
