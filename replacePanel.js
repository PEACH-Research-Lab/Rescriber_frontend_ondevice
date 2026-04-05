export function createPIIReplacementPanel(
  detectedEntities,
  modelNumber,
  hideCheckboxes = false
) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = chrome.runtime.getURL("ui.css");
  document.head.appendChild(link);

  let panel = document.getElementById("pii-replacement-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "pii-replacement-panel";
    panel.classList.add("pii-replacement-panel");
    document.body.appendChild(panel);
  } else if (panel.style.display === "none") {
    panel.style.display = "initial";
  }

  const piiList = detectedEntities
    .map(
      (entity) => `
      <li class="pii-item">
        <span>${entity.text} - ${entity.entity_placeholder}</span>
        ${
          hideCheckboxes
            ? ""
            : `<input type="checkbox" class="pii-checkbox" data-entity-text="${entity.text}">`
        }
      </li>`
    )
    .join("");
  panel.innerHTML = `
    <div class="pii-replacement-header">
      <div class="name-model-info">
        <div class="tool-name">
          <p>Rescriber</p>
        </div>
        <div class="tool-model-number">
          <p>Model ${modelNumber}</p>
        </div>
      </div> 
      <div class="right-corner-buttons">
        <div class="top-row">
          <button id="highlight-btn">Highlight</button>
          ${
            hideCheckboxes
              ? ""
              : `<div class="select-all-and-checkbox">
            <span id="select-all">Select All</span>
            <input type="checkbox" id="select-all-checkbox">
          </div>`
          }
          <button id="dashboard-btn" title="Privacy Dashboard">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="1" y="8" width="3" height="6" rx="0.5"/>
              <rect x="6.5" y="4" width="3" height="10" rx="0.5"/>
              <rect x="12" y="1" width="3" height="13" rx="0.5"/>
            </svg>
            Stats
          </button>
          <button id="close-panel-btn">X</button>
        </div>
      </div>
    </div>
    <ul id="pii-list">${piiList}</ul>
    <div class="pii-replacement-footer">
    <div class="replace-abstract"></div>
      <button id="replace-btn" class="replacePanelActionButton" disabled>Replace</button>
      <button id="abstract-btn" class="replacePanelActionButton" disabled>Abstract<span class="loader-circle" style="display: none;"></span></button>
      <button id="revert-btn" class="replacePanelActionButton" disabled>
        <img src="${chrome.runtime.getURL("images/revert.jpg")}" alt="Revert">
      </button>
    </div>
  `;

  if (!hideCheckboxes) {
    document
      .getElementById("select-all-checkbox")
      .addEventListener("change", () => {
        const allChecked = document.getElementById(
          "select-all-checkbox"
        ).checked;
        document.querySelectorAll(".pii-checkbox").forEach((checkbox) => {
          checkbox.checked = allChecked;
        });
        toggleButtonsState();
      });

    document.querySelectorAll(".pii-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", toggleButtonsState);
    });
  }

  document.getElementById("replace-btn").addEventListener("click", () => {
    const checkedItems = Array.from(
      document.querySelectorAll(".pii-checkbox:checked")
    ).map((checkbox) => checkbox.getAttribute("data-entity-text"));

    if (checkedItems.length > 0) {
      window.helper.saveCurrentState();
      const entitiesToReplace =
        window.helper.getEntitiesForSelectedText(checkedItems);
      window.helper.replaceWords(entitiesToReplace);
    }
    document.getElementById("abstract-btn").disabled = true;
    document.getElementById("replace-btn").disabled = true;
    document.getElementById("revert-btn").disabled = false;
    disableCheckedCheckboxes();
    window.helper.addReplaceCount();
  });

  document
    .getElementById("abstract-btn")
    .addEventListener("click", async () => {
      const checkedItems = Array.from(
        document.querySelectorAll(".pii-checkbox:checked")
      ).map((checkbox) => checkbox.getAttribute("data-entity-text"));

      if (checkedItems.length > 0) {
        const originalMessage = window.helper.currentUserMessage;
        const currentMessage = window.helper.getUserInputText();

        // Save the current state before abstraction
        window.helper.saveCurrentState();

        showAbstractLoading();
        await window.helper
          .handleAbstractResponse(originalMessage, currentMessage, checkedItems)
          .finally(() => {
            hideAbstractLoading();
            document.getElementById("abstract-btn").disabled = true;
            document.getElementById("replace-btn").disabled = true;
            document.getElementById("revert-btn").disabled = false;
            disableCheckedCheckboxes();
          });
      }
      window.helper.addAbstractCount();
    });

  document.getElementById("revert-btn").addEventListener("click", () => {
    window.helper.revertToPreviousState();
    if (document.getElementById("revert-btn")) {
      document.getElementById("revert-btn").disabled = true;
    }
  });

  document.getElementById("close-panel-btn").addEventListener("click", () => {
    panel.style.display = "none";
  });

  document.getElementById("dashboard-btn").addEventListener("click", async () => {
    await window.helper.showDashboard();
  });

  const highlightButton = document.getElementById("highlight-btn");
  if (hideCheckboxes) {
    highlightButton.classList.add("disabled");
  } else {
    highlightButton.classList.remove("disabled");
    highlightButton.addEventListener("click", async () => {
      await window.helper.highlightDetectedWords();
    });
  }
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Add click event to bring panel to front
  panel.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.style.zIndex = 1001; // Set a high z-index to bring it to front
    const tooltip = document.querySelector(".pii-highlight-tooltip");
    if (tooltip) {
      tooltip.style.zIndex = 1000; // Ensure tooltip has a lower z-index
    }
  });

  // Ensure tooltip has a lower z-index initially
  document.addEventListener("click", (event) => {
    const tooltip = document.querySelector(".pii-highlight-tooltip");
    const panel = document.getElementById("pii-replacement-panel");
    if (tooltip && panel) {
      if (panel.contains(event.target)) {
        tooltip.style.zIndex = 999; // Set a lower z-index
      } else if (tooltip.contains(event.target)) {
        tooltip.style.zIndex = 1001; // Bring tooltip to front
        panel.style.zIndex = 1000; // Ensure panel has a lower z-index
      } else {
        tooltip.remove();
        panel.remove();
      }
    }
  });

  function toggleButtonsState() {
    const anyChecked = Array.from(
      document.querySelectorAll(".pii-checkbox")
    ).some((cb) => cb.checked);
    document.getElementById("replace-btn").disabled = !anyChecked;
    document.getElementById("abstract-btn").disabled = !anyChecked;
    updateRevertButtonState();
  }

  function updateRevertButtonState() {
    const revertButton = document.getElementById("revert-btn");
    if (!revertButton) return;
    if (checkMessageStateChanged()) {
      revertButton.disabled = false;
    } else {
      revertButton.disabled = true;
    }
  }

  function checkMessageStateChanged() {
    const input = window.helper.getUserInputElement();
    return input.innerText !== window.helper.previousUserMessage;
  }

  function showAbstractLoading() {
    document.querySelector(".loader-circle").style.display = "inline-block";
  }

  function hideAbstractLoading() {
    document.querySelector(".loader-circle").style.display = "none";
  }

  function disableCheckedCheckboxes() {
    const checkboxes = document.querySelectorAll(".pii-checkbox");
    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        checkbox.disabled = true;
        checkbox.checked = false;
      }
    });
  }

  const inputField = window.helper.getUserInputElement();
  if (inputField) {
    inputField.addEventListener("input", updateRevertButtonState);
  }
  updateRevertButtonState();
}
