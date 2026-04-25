import { dlog } from "./debug.js";

// Queue for processing targets
const processingQueue = [];
let isProcessing = false;
let sendButtonObserver;
let sendButton;
let stopButton;
let globalObserver;
let debounceTimeout;

// Initializes the button observation
export function initializeButton() {
  observePage();
}

// Observes the entire page for button-related changes
function observePage() {
  if (globalObserver) {
    globalObserver.disconnect();
  }

  // Creates a new MutationObserver to watch for changes in the entire page
  globalObserver = new MutationObserver((mutations) => {
    // Filter to detect only changes related to send-button or stop-button
    const buttonMutation = mutations.some((mutation) => {
      return (
        mutation.target.closest("[data-testid='send-button']") ||
        mutation.target.closest("[data-testid='stop-button']")
      );
    });

    // If a relevant button mutation is detected, debounce the function call
    if (buttonMutation) {
      debounceDetectButtonChanges();
    }
  });

  // Observes the entire body for changes in child elements and attributes
  globalObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial check of button state
  detectButtonChanges();
}

// Debounce function to reduce the frequency of calls to detectButtonChanges
function debounceDetectButtonChanges() {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    detectButtonChanges();
  }, 100); // Adjust this delay as needed
}

// Detects changes in send-button or stop-button state
function detectButtonChanges() {
  // Locate the send-button and stop-button
  sendButton = document.querySelector("[data-testid='send-button']");
  stopButton = document.querySelector("[data-testid='stop-button']");

  if (sendButton) {
    dlog("Send button detected");
    observeSendButton();

    // Check if the send button is enabled
    if (!sendButton.hasAttribute("disabled") && window.helper.enabled) {
      addDetectButton();
    } else if (!window.helper.enabled) {
      removeDetectButton();
    } else if (sendButton.hasAttribute("disabled")) {
      // Show original green dot
      showInitialDetectIcon();
      window.helper.setShowInfoForNew(false);
    }
  }

  if (stopButton) {
    dlog("Stop button detected");
    handleStopButtonDetected();
  }
}

// Sets up an observer for the send-button to watch for attribute changes
function observeSendButton() {
  if (!sendButton) return;

  // Disconnect the existing observer to avoid duplicate listeners
  if (sendButtonObserver) {
    sendButtonObserver.disconnect();
  }

  // Create a MutationObserver to monitor changes in the send-button
  sendButtonObserver = new MutationObserver((mutations) => {
    mutations.forEach(async (mutation) => {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "disabled"
      ) {
        // Check if the send button is enabled or disabled
        if (!sendButton.hasAttribute("disabled") && window.helper.enabled) {
          dlog("Send button enabled");
          addDetectButton();
          await window.helper.updateCurrentConversationPIIToCloud();
        } else {
          dlog("Send button disabled");
          removeDetectButton();
        }
      }
    });
  });

  // Observe attribute changes on the send-button
  sendButtonObserver.observe(sendButton, {
    attributes: true,
  });
}

// Handler for when the stop button is detected
function handleStopButtonDetected() {
  dlog("Stop button shows up. Removing detect button...");
  showInitialDetectIcon();
  window.helper.setShowInfoForNew(false);
}

// Cleans up observers when no longer needed
export function cleanup() {
  if (sendButtonObserver) {
    sendButtonObserver.disconnect();
  }
  if (globalObserver) {
    globalObserver.disconnect();
  }
}

export function addDetectButton() {
  sendButton = document.querySelector("[data-testid='send-button']");
  if (sendButton && !document.getElementById("detect-next-to-input-button")) {
    const detectButton = document.createElement("button");
    detectButton.id = "detect-next-to-input-button";
    detectButton.className = "detect-next-to-input-button";
    detectButton.innerHTML = `<span class="detect-circle"></span>`;

    // Append the detect button next to the send button
    document.body.appendChild(detectButton);

    // Add event listener to handle click action
    detectButton.addEventListener("click", async (event) => {
      event.stopPropagation(); // Prevents the event from bubbling up to parent elements
      await window.helper.highlightDetectedAndShowReplacementPanel();
    });
  } else if (
    sendButton &&
    document.getElementById("detect-next-to-input-button")
  ) {
    const detectButton = document.querySelector("#detect-next-to-input-button");
    if (detectButton.innerHTML != `<span class="detect-circle"></span>`) {
      detectButton.innerHTML = `<span class="detect-circle"></span>`;
    }
  }
}

export function removeDetectButton() {
  const detectButton = document.getElementById("detect-next-to-input-button");
  if (detectButton) {
    detectButton.remove();
  }
}

export function showInitialDetectIcon() {
  const detectButton = document.querySelector("#detect-next-to-input-button");
  if (detectButton) {
    detectButton.innerHTML = `<span class="detect-circle"></span>`;
  }
}
