// Transformers.js supports only "simple" and "none" (unlike Python transformers,
// which also supports "first" / "average" / "max").
const VALID_AGGREGATIONS = ["simple", "none"];
const DEFAULT_AGGREGATION = "simple";
const DEFAULT_THRESHOLD = 0;
const VALID_SEGMENTATIONS = ["sentence", "whole"];
const DEFAULT_SEGMENTATION = "whole";

document.getElementById("saveButton").addEventListener("click", () => {
  const debugLogging = document.getElementById("debugLogging").checked;

  const aggregationRaw = document.getElementById("privacyFilterAggregation").value;
  const privacyFilterAggregation = VALID_AGGREGATIONS.includes(aggregationRaw)
    ? aggregationRaw
    : DEFAULT_AGGREGATION;

  const thresholdRaw = parseFloat(
    document.getElementById("privacyFilterThreshold").value
  );
  const privacyFilterThreshold = Number.isFinite(thresholdRaw)
    ? Math.min(Math.max(thresholdRaw, 0), 1)
    : DEFAULT_THRESHOLD;

  const segmentationRaw = document.getElementById("privacyFilterSegmentation").value;
  const privacyFilterSegmentation = VALID_SEGMENTATIONS.includes(segmentationRaw)
    ? segmentationRaw
    : DEFAULT_SEGMENTATION;

  chrome.storage.sync.set(
    {
      privacyFilterAggregation,
      privacyFilterThreshold,
      privacyFilterSegmentation,
      debugLogging,
    },
    () => {
      alert("Settings saved.");
    }
  );
});

chrome.storage.sync.get(
  [
    "privacyFilterAggregation",
    "privacyFilterThreshold",
    "privacyFilterSegmentation",
    "debugLogging",
  ],
  (result) => {
    if (VALID_AGGREGATIONS.includes(result.privacyFilterAggregation)) {
      document.getElementById("privacyFilterAggregation").value =
        result.privacyFilterAggregation;
    }
    if (
      typeof result.privacyFilterThreshold === "number" &&
      result.privacyFilterThreshold >= 0 &&
      result.privacyFilterThreshold <= 1
    ) {
      document.getElementById("privacyFilterThreshold").value = String(
        result.privacyFilterThreshold
      );
    }
    if (VALID_SEGMENTATIONS.includes(result.privacyFilterSegmentation)) {
      document.getElementById("privacyFilterSegmentation").value =
        result.privacyFilterSegmentation;
    }
    document.getElementById("debugLogging").checked = !!result.debugLogging;
  }
);

document.getElementById("viewStoredDataButton").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("mappings.html") });
});
