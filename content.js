let enabled;
let previousEnabled;
let detectedEntities = [];
let piiMappings = {};
let entityCounts = {};

let currentConversationId = window.helper.getActiveConversationId();
let typingTimer;
const doneTypingInterval = 1000;
let isCheckingConversationChange = false;

console.log("Content script loaded!");

chrome.runtime.onMessage.addListener(async function (
  request,
  sender,
  sendResponse
) {
  if (request.action === "toggleEnabled") {
    window.helper.toggleEnabled(request.enabled);
    const { addDetectButton, removeDetectButton } = await import(
      chrome.runtime.getURL("buttonWidget.js")
    );
    if (request.enabled) {
      addDetectButton();
    } else {
      removeDetectButton();
    }

    sendResponse({ status: "Enabled status toggled" });
  }
});

async function checkForConversationChange() {
  if (isCheckingConversationChange || !window.helper.enabled) {
    return;
  }
  isCheckingConversationChange = true;
  try {
    const newConversationId = window.helper.getActiveConversationId();
    if (
      previousEnabled !== window.helper.enabled &&
      window.helper.enabled == true
    ) {
      previousEnabled = window.helper.enabled;
      currentConversationId = newConversationId;
      removeTooltipAndPanel();
      document.removeEventListener("input", typingHandler);
      document.removeEventListener("paste", typingHandler);
      document.addEventListener("input", typingHandler);
      document.addEventListener("paste", typingHandler);
      const { addDetectButton } = await import(
        chrome.runtime.getURL("buttonWidget.js")
      );
      addDetectButton();
    }
    if (newConversationId !== currentConversationId) {
      await handleConversationChange(newConversationId);
    }
  } finally {
    isCheckingConversationChange = false;
  }
}

async function handleConversationChange(newConversationId) {
  if (currentConversationId === "no-url" && newConversationId !== "no-url") {
    const isNewUrl = await checkIfNewUrl(newConversationId);
    if (isNewUrl) {
      await window.helper.updateCurrentConversationPIIToCloud();
    }
  }
  previousEnabled = window.helper.enabled;
  currentConversationId = newConversationId;
  removeTooltipAndPanel();
  document.removeEventListener("input", typingHandler);
  document.removeEventListener("paste", typingHandler);
  document.addEventListener("input", typingHandler);
  document.addEventListener("paste", typingHandler);
  const { addDetectButton } = await import(
    chrome.runtime.getURL("buttonWidget.js")
  );
  addDetectButton();
  checkAllMessagesForReplacement();
  await window.helper.setCurrentEntitiesFromCloud();
  const { showInitialDetectIcon } = await import(
    chrome.runtime.getURL("buttonWidget.js")
  );
  showInitialDetectIcon();
  window.helper.setShowInfoForNew(false);
  window.helper.entityCounts = {};
}

async function checkIfNewUrl(newConversationId) {
  const storedUrls = await window.helper.getFromStorage("knownUrls");
  const knownUrls = storedUrls.knownUrls || [];
  if (!knownUrls.includes(newConversationId)) {
    knownUrls.push(newConversationId);
    await window.helper.setToStorage({ knownUrls });
    return true;
  }
  return false;
}

function typingHandler(e) {
  const input = window.helper.getUserInputElement();
  if (input.parentElement.contains(e.target)) {
    window.helper.setShowInfoForNew(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(doneTyping, doneTypingInterval);
  }
}

async function doneTyping() {
  if (!window.helper.enabled) {
    return;
  }
  showLoadingIndicator();
  await window.helper.handleDetectAndUpdatePanel();
  const detectedEntities = window.helper.getCurrentEntities();

  let noFound;
  if (!detectedEntities) {
    updateDetectButtonToIntial();
    return;
  }
  if (detectedEntities.length > 0) {
    noFound = false;
  } else {
    noFound = true;
  }
  updateDetectButtonWithResults(noFound);
}

function showLoadingIndicator() {
  const detectButton = document.getElementById("detect-next-to-input-button");
  if (detectButton) {
    detectButton.innerHTML = `<span class="loader"></span>`;
  }
}

function updateDetectButtonToIntial() {
  const detectButton = document.getElementById("detect-next-to-input-button");
  if (detectButton) {
    detectButton.innerHTML = `<span class="detect-circle"></span>`;
  }
}

function updateDetectButtonWithResults(noFound) {
  const detectButton = document.getElementById("detect-next-to-input-button");
  if (detectButton) {
    detectButton.innerHTML = `<span class="detected-circle"></span>`;
    const detectedCircle = detectButton.querySelector(".detected-circle");
    const extensionId = chrome.runtime.id;
    if (noFound) {
      detectedCircle.style.backgroundImage = `url(chrome-extension://${extensionId}/images/check4.png)`;
    } else {
      detectedCircle.style.backgroundImage = `url(chrome-extension://${extensionId}/images/magnifier5.png)`;
    }

    detectButton.addEventListener("click", async () => {
      if (detectedCircle) {
        await window.helper.highlightDetectedWords();
      }
    });
  }
}

function removeTooltipAndPanel() {
  const tooltip = document.querySelector(".pii-highlight-tooltip");
  if (tooltip) {
    tooltip.remove();
  }

  const panel = document.getElementById("pii-replacement-panel");
  if (panel) {
    panel.remove();
  }
}

setInterval(async () => {
  try {
    await checkForConversationChange();
  } catch (error) {
    console.error(error);
  }
});

const processingQueue = [];
let isProcessing = false;

function isStreaming() {
  return !!document.querySelector('button[data-testid="stop-button"]');
}

function enqueueAndReplace(target) {
  // If the target element has already been processed, return early
  if (!target || target.hasAttribute("data-replaced")) return;

  // Don't replace assistant messages while still streaming — the DOM
  // replacement is destructive and corrupts partially-received text.
  // These will be picked up once streaming finishes.
  const isAssistant =
    target.getAttribute("data-message-author-role") === "assistant";
  if (isAssistant && isStreaming()) return;

  // Mark the target as processed to avoid duplicate additions
  target.setAttribute("data-replaced", "true");

  // Add the target to the queue
  processingQueue.push(target);
  processQueue();
}

async function processQueue() {
  // If processing is already ongoing, return to prevent duplicate calls
  if (isProcessing) return;

  isProcessing = true;
  while (processingQueue.length > 0) {
    const target = processingQueue.shift();
    await checkAndReplace(target);
  }
  isProcessing = false;
}

// Check if the text content is empty, ignoring zero-width and whitespace characters
function isContentEmpty(text) {
  return text.replace(/[\s\u200B\u00A0\uFEFF]/g, "").trim() === "";
}

// Determine if the content is fully loaded
function isContentFullyLoaded(target) {
  // First, check the basic conditions
  if (
    target === undefined ||
    target.textContent.trim() === "" ||
    isContentEmpty(target.textContent)
  ) {
    return false;
  }

  // If it's an `assistant` message, check the child elements' `::after` content
  const isAssistant =
    target.getAttribute("data-message-author-role") === "assistant";
  if (isAssistant && !areAfterElementsLoaded(target)) {
    return false;
  }

  // If all conditions are met, return true
  return true;
}

// Check if the `::after` pseudo-element content of child elements is fully loaded
function areAfterElementsLoaded(target) {
  const elements = target.querySelectorAll("*");
  for (let element of elements) {
    const afterContent = window.getComputedStyle(element, "::after").content;
    if (afterContent && afterContent !== "none" && afterContent !== '""') {
      console.log("Element with loading indicator found:", element);
      return false;
    }
  }
  return true;
}

async function checkAndReplace(target) {
  if (!target) return;

  const waitForContentLoad = () => {
    if (!isContentFullyLoaded(target)) {
      console.log("Waiting for content to load...");
      requestAnimationFrame(waitForContentLoad);
    } else {
      console.log("Content loaded, performing replace:", target);
      window.helper.checkMessageRenderedAndReplace(target);
    }
  };

  waitForContentLoad();
}

const observer = new MutationObserver((mutations) => {
  if (!window.helper.enabled) return;

  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      let target = mutation.target.closest(
        '[data-message-author-role="assistant"], [data-message-author-role="user"]'
      );

      if (target) {
        console.log("Children of message element (or deeper) changed:", target);
        enqueueAndReplace(target);
      }
    }
  });
});

function observeMessageElement(element) {
  observer.observe(element, {
    childList: true,
    subtree: true,
  });
}

document
  .querySelectorAll(
    '[data-message-author-role="assistant"], [data-message-author-role="user"]'
  )
  .forEach((element) => {
    observeMessageElement(element);
  });

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

setInterval(() => {
  document
    .querySelectorAll(
      '[data-message-author-role="assistant"]:not([data-replaced]), [data-message-author-role="user"]:not([data-replaced])'
    )
    .forEach((element) => {
      enqueueAndReplace(element);
    });

  // Detect writing blocks that appeared after the message was already processed
  document
    .querySelectorAll('[data-message-author-role="assistant"][data-replaced]')
    .forEach((element) => {
      const unprocessedBlocks = element.querySelectorAll(
        '[data-writing-block="true"]:not([data-pii-wb-processed])'
      );
      if (unprocessedBlocks.length > 0) {
        unprocessedBlocks.forEach((b) =>
          b.setAttribute("data-pii-wb-processed", "true")
        );
        window.helper.checkMessageRenderedAndReplace(element);
      }
    });
}, 500);

function observeStopButton() {
  let wasStreaming = false;

  const stopButtonObserver = new MutationObserver((mutations) => {
    const stopButton = document.querySelector(
      'button[data-testid="stop-button"]'
    );
    if (stopButton) {
      wasStreaming = true;
      // Once user send out the message, then stop button would show up, and send button will be replaced
      // then we remove tooltip and panel
      removeTooltipAndPanel();
    } else if (wasStreaming) {
      // Stop button disappeared — streaming just finished.
      // Now it's safe to run replacement on assistant messages that
      // were skipped during streaming.
      wasStreaming = false;
      document
        .querySelectorAll(
          '[data-message-author-role="assistant"]:not([data-replaced])'
        )
        .forEach((el) => {
          enqueueAndReplace(el);
        });
    }
  });

  stopButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

async function waitForInitializeButton() {
  if (!chrome.runtime?.id) return; // Extension context invalidated
  const { initializeButton } = await import(
    chrome.runtime.getURL("buttonWidget.js")
  );
  if (document.querySelector("[data-testid='send-button']")) {
    initializeButton();
  } else {
    requestAnimationFrame(waitForInitializeButton);
  }
}

// Apply replacements on page load
async function initialize() {
  if (!window.helper.enabled) {
    return;
  }

  console.log("calling initialize button");
  // initializeButton();
  await requestAnimationFrame(waitForInitializeButton);
  observeStopButton();
}

async function checkAllMessagesForReplacement() {
  document
    .querySelectorAll('[data-message-author-role="assistant"]')
    .forEach((el) => {
      window.helper.checkMessageRenderedAndReplace(el);
    });
  document
    .querySelectorAll('[data-message-author-role="user"]')
    .forEach((el) => {
      window.helper.checkMessageRenderedAndReplace(el);
    });
}

// Call the initialize function when the content script loads and the DOM is ready
window.addEventListener("load", async () => {
  await window.helper.getEnabledStatus();
  await window.helper.loadDetectionMode();
  enabled = window.helper.enabled;
  initialize();
  checkAllMessagesForReplacement();
  await window.helper.initializeMappings();
});
