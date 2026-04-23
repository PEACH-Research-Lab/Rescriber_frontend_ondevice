window.helper = {
  enabled: undefined,
  detectedEntities: [],
  currentEntities: [],
  currentUserMessage: "",
  previousStatesByConversation: {},
  useOnDeviceModel: false,
  detectionMode: "privacy_filter", // "privacy_filter", "ondevice", "cloud", or "presidio"
  showInfoForNew: undefined,

  placeholderToPii: {},
  piiToPlaceholder: {},
  entityCounts: {},
  tempMappings: {
    tempPlaceholderToPii: {},
    tempPiiToPlaceholder: {},
  },
  tempEntityCounts: {},
  prolificId: "",
  replaceCount: 0,
  abstractCount: 0,

  setProlificid(id) {
    this.prolificId = id;
    this.replaceCount = 0;
    this.abstractCount = 0;
  },
  addReplaceCount() {
    this.replaceCount = this.replaceCount + 1;
  },
  addAbstractCount() {
    this.abstractCount = this.abstractCount + 1;
  },

  // Dashboard data methods

  async getDashboardData() {
    try {
      const data = await this.getFromStorage(null);
      const piiToPlaceholder = data.piiToPlaceholder || {};
      const entityCounts = data.entityCounts || {};
      const actionHistory = data.actionHistory || [];

      // === Detected PIIs: aggregate from piiToPlaceholder across ALL conversations ===
      const totalByType = {};
      let totalPIIs = 0;
      const conversationIds = new Set();

      for (const convId of Object.keys(piiToPlaceholder)) {
        if (convId === "no-url") continue;
        const mappings = piiToPlaceholder[convId];
        if (!mappings || typeof mappings !== "object") continue;
        conversationIds.add(convId);

        for (const placeholder of Object.values(mappings)) {
          // Parse type from placeholder like "NAME1" -> "NAME", "PHONE_NUMBER2" -> "PHONE_NUMBER"
          const type = placeholder.replace(/[0-9]+$/, "");
          if (type) {
            totalByType[type] = (totalByType[type] || 0) + 1;
            totalPIIs++;
          }
        }
      }

      // Also count from entityCounts for conversations that may not have piiToPlaceholder entries
      for (const convId of Object.keys(entityCounts)) {
        if (convId === "no-url" || conversationIds.has(convId)) continue;
        conversationIds.add(convId);
        for (const [type, count] of Object.entries(entityCounts[convId])) {
          totalByType[type] = (totalByType[type] || 0) + count;
          totalPIIs += count;
        }
      }

      const conversationCount = conversationIds.size;

      // === Protected PIIs: aggregate from actionHistory ===
      let totalReplaced = 0;
      let totalAbstracted = 0;
      const actionsByDay = {};
      const typeActions = { replace: {}, abstract: {} };
      const protectedPIISet = new Set(); // track unique protected PIIs

      for (const entry of actionHistory) {
        const count = entry.count || 1;
        if (entry.action === "replace") {
          totalReplaced += count;
        } else if (entry.action === "abstract") {
          totalAbstracted += count;
        }

        // Track unique protected PIIs
        if (entry.piiTexts) {
          entry.piiTexts.forEach((t) => protectedPIISet.add(t));
        }

        // Group by day for timeline
        const day = new Date(entry.timestamp).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        if (!actionsByDay[day]) {
          actionsByDay[day] = { replace: 0, abstract: 0 };
        }
        actionsByDay[day][entry.action] += count;

        // Group by type per action
        if (entry.entityTypes) {
          for (const t of entry.entityTypes) {
            typeActions[entry.action][t] =
              (typeActions[entry.action][t] || 0) + 1;
          }
        }
      }

      return {
        totalPIIs,
        totalReplaced,
        totalAbstracted,
        totalByType,
        conversationCount,
        actionsByDay,
        typeActions,
        actionHistory,
        uniqueProtected: protectedPIISet.size,
      };
    } catch (error) {
      console.error("Error getting dashboard data:", error);
      return null;
    }
  },

  async showDashboard() {
    const { createDashboardPanel } = await import(
      chrome.runtime.getURL("dashboardPanel.js")
    );
    const dashboardData = await this.getDashboardData();
    createDashboardPanel(dashboardData);
  },
  async initializeMappings() {
    try {
      const data = await this.getFromStorage(null);

      // Load data from cloud storage，initialize mappings and counts
      this.piiToPlaceholder = data.piiToPlaceholder || {};
      this.placeholderToPii = data.placeholderToPii || {};
      this.entityCounts = data.entityCounts || {};
      this.tempMappings = {
        tempPiiToPlaceholder: {},
        tempPlaceholderToPii: {},
      };
      this.tempEntityCounts = {};

      console.log("Mappings and counts loaded from storage.");
    } catch (error) {
      console.error("Error initializing mappings from storage:", error);
    }
  },

  getEnabledStatus: async function () {
    this.enabled = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(["enabled"], function (result) {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result.enabled !== undefined ? result.enabled : true);
      });
    });
  },

  loadDetectionMode: async function () {
    const result = await new Promise((resolve) => {
      chrome.storage.sync.get(["detectionMode"], (r) => resolve(r));
    });
    if (result.detectionMode) {
      this.detectionMode = result.detectionMode;
    }
    this.useOnDeviceModel = this.detectionMode === "ondevice";
    console.log("Detection mode loaded:", this.detectionMode);
  },

  getDetectionModelName: async function () {
    switch (this.detectionMode) {
      case "privacy_filter":
        return "Privacy Filter";
      case "presidio":
        return "Presidio";
      case "ondevice": {
        const { ollamaModel } = await new Promise((resolve) =>
          chrome.storage.sync.get(["ollamaModel"], (r) => resolve(r))
        );
        return `Ollama (${ollamaModel || "llama3"})`;
      }
      case "cloud":
      default:
        return "GPT-4o";
    }
  },

  getUserInputElement: function () {
    // ChatGPT's composer is a contenteditable="true" ProseMirror div. Canvas/
    // writing-block responses and in-place message edits are ALSO contenteditable
    // ProseMirror editors and appear earlier in the DOM, so a bare
    // [contenteditable] selector can return them and cause detection to run on
    // the assistant response while ignoring typing in the real composer.
    //
    // The composer is always inside the same <form> as the send button, so
    // anchor on that first.
    const sendButton = document.querySelector('[data-testid="send-button"]');
    const composerForm = sendButton
      ? sendButton.closest("form")
      : document.querySelector("form");
    if (composerForm) {
      const inForm = composerForm.querySelector('[contenteditable="true"]');
      if (inForm) return inForm;
    }

    const primary = document.querySelector(
      '#prompt-textarea[contenteditable="true"]'
    );
    if (primary) return primary;

    const candidates = document.querySelectorAll('[contenteditable="true"]');
    for (const el of candidates) {
      if (el.closest('[data-message-author-role]')) continue;
      if (el.closest('[data-writing-block="true"]')) continue;
      if (el.closest(".writing-block-editor")) continue;
      return el;
    }
    return null;
  },

  getUserInputText: function () {
    const input = this.getUserInputElement();
    return input ? input.innerText : "";
  },

  generateUserMessageCluster: function (userMessage, entities) {
    let clusterMessage = `<message>${userMessage}</message>`;
    if (entities.length) {
      entities.forEach(function (value, i) {
        clusterMessage += `<pii${i + 1}>${value.text}</pii${i + 1}>`;
      });
    } else {
      return undefined;
    }
    return clusterMessage;
  },

  simplifyClustersWithTypes: function (clusters, entities) {
    const groupedClusters = {};
    const associatedGroups = [];

    function mergeClusters(key, visited = new Set()) {
      if (visited.has(key)) return groupedClusters[key];
      visited.add(key);

      if (!groupedClusters[key]) {
        groupedClusters[key] = new Set(clusters[key] || []);
      }

      clusters[key]?.forEach((value) => {
        if (value !== key) {
          groupedClusters[key].add(value);
          const nestedCluster = mergeClusters(value, visited);
          nestedCluster.forEach((nestedValue) => {
            groupedClusters[key].add(nestedValue);
          });
        }
      });

      return groupedClusters[key];
    }

    Object.keys(clusters).forEach((key) => {
      mergeClusters(key);
    });

    // Merge sets with overlapping values and respect entity types
    const mergedClusters = [];
    const seen = new Set();

    Object.keys(groupedClusters).forEach((key) => {
      if (!seen.has(key)) {
        const cluster = groupedClusters[key];
        cluster.forEach((value) => seen.add(value));
        mergedClusters.push(Array.from(cluster));
      }
    });

    const finalClusters = [];
    mergedClusters.forEach((cluster) => {
      const typeMap = {};
      const associatedGroup = new Set();

      cluster.forEach((item) => {
        const entityType = entities
          .find((entity) => entity.text === item)
          ?.entity_type.replace(/[0-9]/g, "");
        if (entityType) {
          if (!typeMap[entityType]) {
            typeMap[entityType] = [];
          }
          typeMap[entityType].push(item);
        }
        associatedGroup.add(item);
      });

      Object.keys(typeMap).forEach((type) => {
        finalClusters.push(typeMap[type]);
      });

      if (Object.keys(typeMap).length > 1) {
        associatedGroups.push(Array.from(associatedGroup));
      }
    });

    return { finalClusters, associatedGroups };
  },

  findKeyByValue: function (mapping, value) {
    for (let [k, v] of Object.entries(mapping)) {
      if (v === value) {
        return { exists: true, key: k }; // Returns true and the key if the value is found
      }
    }
    return { exists: false, key: null }; // Returns false and null if the value is not found
  },

  isExtensionContextValid: function () {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  },

  setToStorage: function (data) {
    return new Promise((resolve, reject) => {
      if (!this.isExtensionContextValid()) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.set(data, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (e) {
        resolve();
      }
    });
  },

  async saveMappingsToStorage() {
    try {
      //contains non- "no-url" entityCounts
      const filteredEntityCounts = Object.fromEntries(
        Object.entries(this.entityCounts).filter(([key]) => key !== "no-url")
      );

      await this.setToStorage({
        piiToPlaceholder: this.piiToPlaceholder,
        placeholderToPii: this.placeholderToPii,
        entityCounts: filteredEntityCounts,
      });

      console.log(
        "Mappings and counts have been saved to storage, excluding 'no-url'."
      );
    } catch (error) {
      console.error("Error saving mappings to storage:", error);
    }
  },

  async setCurrentEntitiesFromCloud() {
    this.currentEntities = await this.getCurrentEntitiesFromCloud();
  },

  createCurrentEntities(mapping) {
    const currentEntities = Object.entries(mapping).map(([key, value]) => {
      // 提取 entity_type，不包含最后的数字
      const entity_type = value.replace(/[0-9]+$/, "");

      return {
        text: key,
        entity_placeholder: value,
        entity_type: entity_type,
      };
    });

    return currentEntities;
  },

  async getCurrentEntitiesFromCloud() {
    const data = await this.getFromStorage(null);
    const activeConversationId = this.getActiveConversationId() || "no-url";
    const pii2placeholderMapping = data.piiToPlaceholder?.[activeConversationId];
    if (pii2placeholderMapping) {
      return this.createCurrentEntities(pii2placeholderMapping);
    } else {
      return [];
    }
  },

  async processEntities(entities, finalClusters) {
    const activeConversationId = this.getActiveConversationId() || "no-url";

    // Get data from storage always
    const data = await this.getFromStorage(null);
    this.piiToPlaceholder = data.piiToPlaceholder || {};
    this.placeholderToPii = data.placeholderToPii || {};
    if (activeConversationId !== "no-url") {
      this.entityCounts = data.entityCounts || {};
    }

    if (!this.entityCounts[activeConversationId]) {
      this.entityCounts[activeConversationId] = {};
    }
    const localEntityCounts = this.entityCounts[activeConversationId];

    for (const cluster of finalClusters) {
      for (const entity of entities) {
        if (cluster.includes(entity.text)) {
          const entityType = entity.entity_type.replace(/[0-9]/g, "");
          let placeholder;

          const existingPlaceholder =
            activeConversationId === "no-url"
              ? this.tempMappings.tempPiiToPlaceholder[entity.text]
              : this.piiToPlaceholder[activeConversationId]?.[entity.text];

          if (existingPlaceholder) {
            placeholder = existingPlaceholder;
          } else {
            localEntityCounts[entityType] =
              (localEntityCounts[entityType] || 0) + 1;
            placeholder = `${entityType}${localEntityCounts[entityType]}`;

            if (activeConversationId === "no-url") {
              this.tempMappings.tempPiiToPlaceholder[entity.text] = placeholder;
              this.tempMappings.tempPlaceholderToPii[placeholder] = entity.text;
              this.tempEntityCounts[entityType] =
                (this.tempEntityCounts[entityType] || 0) + 1;
            } else {
              if (!this.piiToPlaceholder[activeConversationId]) {
                this.piiToPlaceholder[activeConversationId] = {};
                this.placeholderToPii[activeConversationId] = {};
              }
              this.piiToPlaceholder[activeConversationId][entity.text] =
                placeholder;
              this.placeholderToPii[activeConversationId][placeholder] =
                entity.text;
            }
          }
          entity.entity_placeholder = placeholder;

          cluster.forEach((item) => {
            if (activeConversationId === "no-url") {
              this.tempMappings.tempPiiToPlaceholder[item] = placeholder;
              this.tempMappings.tempPlaceholderToPii[placeholder] = item;
            } else {
              this.piiToPlaceholder[activeConversationId][item] = placeholder;
              this.placeholderToPii[activeConversationId][placeholder] = item;
            }
          });
        }
      }
    }

    this.entityCounts[activeConversationId] = localEntityCounts;
    await this.saveMappingsToStorage(activeConversationId);

    return entities;
  },

  async updateCurrentConversationPIIToCloud() {
    const activeConversationId = this.getActiveConversationId();
    if (activeConversationId !== "no-url") {
      try {
        this.piiToPlaceholder[activeConversationId] = {
          ...this.piiToPlaceholder[activeConversationId],
          ...this.tempMappings.tempPiiToPlaceholder,
        };
        this.placeholderToPii[activeConversationId] = {
          ...this.placeholderToPii[activeConversationId],
          ...this.tempMappings.tempPlaceholderToPii,
        };
        this.entityCounts[activeConversationId] = {
          ...this.entityCounts[activeConversationId],
          ...this.tempEntityCounts,
        };
        this.entityCounts["no-url"] = {};

        await this.saveMappingsToStorage(activeConversationId);

        console.log(
          "Mappings and counts saved for conversation:",
          activeConversationId
        );

        this.tempMappings.tempPiiToPlaceholder = {};
        this.tempMappings.tempPlaceholderToPii = {};
        this.tempEntityCounts = {};
      } catch (error) {
        console.error("Error updating conversation PII to cloud:", error);
      }
    }
  },

  getResponseDetect: async function (userMessage) {
    let entities;
    console.log("Detection mode:", this.detectionMode);
    if (this.detectionMode === "privacy_filter") {
      const { getPrivacyFilterResponseDetect } = await import(
        chrome.runtime.getURL("privacy_filter.js")
      );
      entities = await getPrivacyFilterResponseDetect(userMessage);
    } else if (this.detectionMode === "presidio") {
      const { getPresidioResponseDetect } = await import(
        chrome.runtime.getURL("presidio.js")
      );
      entities = await getPresidioResponseDetect(userMessage);
    } else if (!this.useOnDeviceModel) {
      const { getCloudResponseDetect } = await import(
        chrome.runtime.getURL("openai.js")
      );
      entities = await getCloudResponseDetect(userMessage);
    } else {
      const { getOnDeviceResponseDetect } = await import(
        chrome.runtime.getURL("ondevice.js")
      );
      entities = await getOnDeviceResponseDetect(userMessage);
    }
    return entities;
  },

  getResponseCluster: async function (clusterMessage) {
    // Non-LLM detection modes: skip semantic clustering.
    if (
      this.detectionMode === "presidio" ||
      this.detectionMode === "privacy_filter"
    ) {
      return "{}";
    }
    let clustersResponse;
    if (!this.useOnDeviceModel) {
      const { getCloudResponseCluster } = await import(
        chrome.runtime.getURL("openai.js")
      );
      clustersResponse = await getCloudResponseCluster(clusterMessage);
    } else {
      const { getOnDeviceResponseCluster } = await import(
        chrome.runtime.getURL("ondevice.js")
      );
      clustersResponse = await getOnDeviceResponseCluster(clusterMessage);
    }
    return clustersResponse;
  },

  filterEntities: function (entities) {
    const entityPlaceholders = [
      "ADDRESS",
      "IP_ADDRESS",
      "URL",
      "SSN",
      "PHONE_NUMBER",
      "EMAIL",
      "DRIVERS_LICENSE",
      "PASSPORT_NUMBER",
      "TAXPAYER_IDENTIFICATION_NUMBER",
      "ID_NUMBER",
      "NAME",
      "USERNAME",
      "GEOLOCATION",
      "AFFILIATION",
      "DEMOGRAPHIC_ATTRIBUTE",
      "TIME",
      "HEALTH_INFORMATION",
      "FINANCIAL_INFORMATION",
      "EDUCATIONAL_RECORD",
    ];

    const placeholderPattern = new RegExp(
      `\\b(?:${entityPlaceholders.join(
        "|"
      )})\\d+\\b|\\[(?:${entityPlaceholders.join("|")})\\d+\\]`,
      "gi"
    );

    // Use a Set to keep track of unique entities
    const seen = new Set();
    const filteredEntities = entities.filter((entity) => {
      const identifier = `${entity.entity_type}:${entity.text}`;
      if (seen.has(identifier)) {
        return false; // Skip duplicate entities
      }
      seen.add(identifier);

      const match = placeholderPattern.test(entity.text);

      // Additional check for placeholders
      const additionalCheck = entityPlaceholders.some((placeholder) =>
        new RegExp(
          `\\b${placeholder}\\d+\\b|\\[${placeholder}\\d+\\]`,
          "gi"
        ).test(entity.text)
      );

      return !(match || additionalCheck);
    });

    return filteredEntities;
  },

  setShowInfoForNew: function (state) {
    this.showInfoForNew = state;
  },

  handleDetect: async function () {
    if (!this.enabled) {
      return;
    }
    const userMessage = this.getUserInputText();
    this.currentUserMessage = userMessage;

    this.currentEntities = [];

    const onResultCallback = async (newEntities) => {
      console.log("New entities received:", newEntities);
      const filteredEntities = this.filterEntities(newEntities);
      if (filteredEntities.length === 0) return;
      let finalClusters = filteredEntities.map((entity) => [entity.text]);
      const detectedEntities = await this.processEntities(
        filteredEntities,
        finalClusters
      );
      this.currentEntities = detectedEntities;

      await this.highlightWords(this.currentUserMessage, this.currentEntities);
      await this.updatePIIReplacementPanel(this.currentEntities);
    };

    if (this.detectionMode === "privacy_filter") {
      const { getPrivacyFilterResponseDetect } = await import(
        chrome.runtime.getURL("privacy_filter.js")
      );
      await getPrivacyFilterResponseDetect(userMessage, onResultCallback);
    } else if (this.detectionMode === "presidio") {
      const { getPresidioResponseDetect } = await import(
        chrome.runtime.getURL("presidio.js")
      );
      await getPresidioResponseDetect(userMessage, onResultCallback);
    } else {
      const { getOnDeviceResponseDetect } = await import(
        chrome.runtime.getURL("ondevice.js")
      );
      await getOnDeviceResponseDetect(userMessage, onResultCallback);
    }

    if (this.currentEntities.length === 0) {
      return false;
    }

    return true;
  },

  handleDetectAndUpdatePanel: async function () {
    if (await this.handleDetect()) {
      console.log("Detection and panel update complete!");
    } else {
      await this.updatePIIReplacementPanel(this.currentEntities);
    }
  },

  highlightDetectedWords: async function () {
    if (!this.enabled) {
      return;
    }
    await this.highlightWords(this.currentUserMessage, this.currentEntities);
  },

  showReplacementPanel: async function (detectedEntities) {
    if (!this.enabled) {
      return;
    }
    const { createPIIReplacementPanel } = await import(
      chrome.runtime.getURL("replacePanel.js")
    );
    const modelName = await this.getDetectionModelName();
    if (!this.showInfoForNew) {
      await createPIIReplacementPanel(
        detectedEntities,
        modelName,
        (hideCheckboxes = true)
      );
    } else {
      await createPIIReplacementPanel(detectedEntities, modelName);
    }
  },

  highlightDetectedAndShowReplacementPanel: async function () {
    if (!this.enabled) {
      return;
    }
    this.getCurrentEntitiesFromCloud();
    await this.highlightWords(this.currentUserMessage, this.currentEntities);
    this.showReplacementPanel(this.currentEntities);
  },

  getPreviousStateForActiveConversation: function () {
    const id = this.getActiveConversationId() || "no-url";
    return this.previousStatesByConversation[id] || null;
  },

  saveCurrentState: function () {
    const id = this.getActiveConversationId() || "no-url";
    this.previousStatesByConversation[id] = {
      userMessage: this.currentUserMessage,
      entities: [...this.currentEntities],
    };
  },

  revertToPreviousState: async function () {
    const input = this.getUserInputElement();
    const prev = this.getPreviousStateForActiveConversation();
    if (input && prev) {
      input.innerText = prev.userMessage;
      this.currentUserMessage = prev.userMessage;
      this.currentEntities = [...prev.entities];
      await this.updatePIIReplacementPanel(this.currentEntities);
    }
  },

  highlightWords: async function (userMessage, entities) {
    if (!this.enabled || !userMessage || !entities) return;
    if (!document.querySelector("#detect-next-to-input-button")) {
      const { addDetectButton } = await import(
        chrome.runtime.getURL("buttonWidget.js")
      );
      addDetectButton();
    }
    let highlightedValue = this.getUserInputText();

    // Create a copy of the entities array and sort the copy by the length of their text property in descending order
    const sortedEntities = [...entities].sort(
      (a, b) => b.text.length - a.text.length
    );

    sortedEntities.forEach((entity) => {
      const regex = new RegExp(
        `(${entity.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi"
      );
      highlightedValue = highlightedValue.replace(
        regex,
        '<span class="highlight">$1</span>'
      );
    });

    // Ensure the highlightedValue retains proper HTML structure
    const escapedHighlightedValue = highlightedValue
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/&lt;span class="highlight"&gt;/g, '<span class="highlight">')
      .replace(/&lt;\/span&gt;/g, "</span>");

    if (escapedHighlightedValue.length > 0) {
      this.displayHighlight(
        this.getUserInputElement(),
        escapedHighlightedValue
      );
    }
  },

  displayHighlight: function (target, highlightedValue) {
    const existingTooltips = document.querySelectorAll(
      ".pii-highlight-tooltip"
    );
    existingTooltips.forEach((existingTooltip) => existingTooltip.remove());

    const tooltip = document.createElement("div");
    tooltip.classList.add("pii-highlight-tooltip");
    tooltip.innerHTML = highlightedValue;

    document.body.appendChild(tooltip);

    // Calculate the position of the tooltip
    const rect = target.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX}px`;

    // Set max-width to the width of the input box
    tooltip.style.maxWidth = `${rect.width}px`;

    // Add the tooltip to measure its height
    document.body.appendChild(tooltip);

    // Measure the tooltip's height
    const tooltipHeight = tooltip.offsetHeight;

    // Threshold to determine if the tooltip is more than one line
    const singleLineHeight = parseFloat(
      window.getComputedStyle(target).lineHeight
    );

    // Position the tooltip above or below the input box based on its height
    if (tooltipHeight > singleLineHeight) {
      tooltip.style.top = `${rect.top + window.scrollY - tooltipHeight}px`;
    } else {
      tooltip.style.top = `${
        rect.top + window.scrollY + target.offsetHeight
      }px`;
    }

    target.addEventListener("input", () => {
      tooltip.remove();
    });
  },

  getEntitiesForSelectedText: function (selectedTexts) {
    return this.currentEntities.filter((entity) =>
      selectedTexts.includes(entity.text)
    );
  },

  replaceWords: function (entities) {
    const inputField = this.getUserInputElement();
    const activeConversationId = this.getActiveConversationId() || "no-url";

    console.log("Current active conversation ID:", activeConversationId);

    if (!this.entityCounts[activeConversationId]) {
      this.entityCounts[activeConversationId] = {};
    }

    let localMappings;

    // if no-url, then temp
    if (activeConversationId === "no-url") {
      localMappings = {
        piiToPlaceholder: this.tempMappings.tempPiiToPlaceholder || {},
        placeholderToPii: this.tempMappings.tempPlaceholderToPii || {},
      };
    } else {
      localMappings = {
        piiToPlaceholder: this.piiToPlaceholder[activeConversationId] || {},
        placeholderToPii: this.placeholderToPii[activeConversationId] || {},
      };
    }

    entities.forEach((entity) => {
      const entityType = entity.entity_type.replace(/[0-9]/g, "");
      let placeholder;

      if (localMappings.piiToPlaceholder[entity.text]) {
        placeholder = localMappings.piiToPlaceholder[entity.text];
      } else {
        this.entityCounts[activeConversationId][entityType] =
          (this.entityCounts[activeConversationId][entityType] || 0) + 1;
        placeholder = `${entityType}${this.entityCounts[activeConversationId][entityType]}`;

        localMappings.piiToPlaceholder[entity.text] = placeholder;
        localMappings.placeholderToPii[placeholder] = entity.text;

        // if "no-url", then update mappings
        if (activeConversationId === "no-url") {
          this.tempMappings.tempPiiToPlaceholder[entity.text] = placeholder;
          this.tempMappings.tempPlaceholderToPii[placeholder] = entity.text;
        } else {
          // Update existing mappings
          this.piiToPlaceholder[activeConversationId][entity.text] =
            placeholder;
          this.placeholderToPii[activeConversationId][placeholder] =
            entity.text;
        }
      }
    });

    console.log("Updated mappings:", localMappings);

    entities.sort((a, b) => b.text.length - a.text.length);

    const performReplacement = (element, value) => {
      value = this.markNonSelectedRegions(value, entities);

      entities.forEach((entity) => {
        const placeholder =
          localMappings.piiToPlaceholder[entity.text] || entity.entity_type;
        const regex = new RegExp(
          `(?<!\\w)${this.replacementEscapeRegExp(entity.text)}(?!\\w)`,
          "gi"
        );
        value = value.replace(regex, `[${placeholder}]`);
      });
      value = this.unmarkRegions(value);

      element.innerText = value;
    };

    performReplacement(inputField, inputField.innerText);

    const existingTooltips = document.querySelectorAll(
      ".pii-highlight-tooltip"
    );
    existingTooltips.forEach((existingTooltip) => existingTooltip.remove());
  },

  markNonSelectedRegions: function (value, selectedEntities) {
    const parts = [];
    let lastIndex = 0;
    const alreadyMarked = [];

    this.currentEntities.forEach((currentEntity) => {
      if (
        !selectedEntities.some(
          (entity) => entity.text === currentEntity.text
        ) &&
        selectedEntities.every(
          (entity) => currentEntity.text.length > entity.text.length
        )
      ) {
        const regex = new RegExp(
          `(${currentEntity.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
          "gi"
        );
        let match;
        while ((match = regex.exec(value)) !== null) {
          const matchIndex = match.index;
          const matchEnd = regex.lastIndex;

          // Skip if match is within already marked region: example if Dubai, United Arab Emirates and United Arab Emirates are both marked as PII
          if (
            alreadyMarked.some(
              ([start, end]) => matchIndex >= start && matchEnd <= end
            )
          ) {
            continue;
          }

          if (matchIndex >= lastIndex) {
            // Append the text between the last match and this match
            parts.push(value.substring(lastIndex, matchIndex));
            parts.push(`[[MARKED:${match[0]}]]`);
            // Update the last index to the end of this match
            lastIndex = matchEnd;
            // Track this marked region
            alreadyMarked.push([matchIndex, matchEnd]);
          }
        }
      }
    });

    // Append any remaining text after the last match
    parts.push(value.substring(lastIndex));

    return parts.join("");
  },

  unmarkRegions: function (value) {
    return value.replace(/\[\[MARKED:(.*?)\]\]/g, "$1");
  },

  replacementEscapeRegExp: function (string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  getEntitiesByConversationId: async function () {
    const activeConversationId = this.getActiveConversationId();
    const isNoUrl = activeConversationId === "no-url";

    let placeholderToPii = {};
    let piiToPlaceholder = {};

    try {
      // Get existing mapping from cloud storage
      const data = await this.getFromStorage(null);

      if (isNoUrl) {
        // Use temp mapping if no-url
        placeholderToPii = this.tempMappings.tempPlaceholderToPii || {};
        piiToPlaceholder = this.tempMappings.tempPiiToPlaceholder || {};
      } else {
        // Combine and form permanent mapping
        placeholderToPii = {
          ...data.placeholderToPii?.[activeConversationId],
          ...this.tempMappings.tempPlaceholderToPii,
        };
        piiToPlaceholder = {
          ...data.piiToPlaceholder?.[activeConversationId],
          ...this.tempMappings.tempPiiToPlaceholder,
        };
      }

      // Convert PII mappings to entities
      const entities = Object.keys(piiToPlaceholder).map((pii) => ({
        entity_type: piiToPlaceholder[pii],
        text: pii,
      }));

      console.log("Entities for current conversation:", entities);
      return entities;
    } catch (error) {
      console.error("Error retrieving entities by conversation ID:", error);
      return [];
    }
  },

  handleAbstractResponse: async function (
    originalMessage,
    currentMessage,
    abstractList
  ) {
    let lastPairs = [];
    const onResultCallback = (partialAbstractResponse) => {
      const input = this.getUserInputElement();
      if (input) {
        // Update the input field with the partial response
        input.innerText = this.applyAbstractResponse(
          partialAbstractResponse,
          input.innerText,
          abstractList
        );
        this.currentUserMessage = input.innerText;
      }
      // Keep the latest complete set of pairs for storage
      if (Array.isArray(partialAbstractResponse)) {
        lastPairs = partialAbstractResponse.filter((item) =>
          abstractList.includes(item.protected)
        );
      }
    };

    await this.getAbstractResponse(
      originalMessage,
      currentMessage,
      abstractList,
      onResultCallback
    );

    // Persist abstract mappings so rendered messages can be matched later
    if (lastPairs.length > 0) {
      await this.saveAbstractMappings(lastPairs);
      await this.logAbstractAction(lastPairs);
    }
  },

  // Log the abstract action to actionHistory immediately when the user
  // performs it, rather than waiting until the message is sent and rendered.
  async logAbstractAction(pairs) {
    try {
      const conversationId = this.getActiveConversationId() || "no-url";
      const data = await this.getFromStorage(["actionHistory"]);
      const history = data.actionHistory || [];

      const entries = pairs
        .map(({ protected: original }) => {
          const type =
            this.currentEntities
              .find((e) => e.text === original)
              ?.entity_type.replace(/[0-9]+$/, "") || "UNKNOWN";
          return { piiValue: original, type };
        })
        .filter(Boolean);

      if (entries.length > 0) {
        history.push({
          action: "abstract",
          timestamp: Date.now(),
          conversationId,
          entityTypes: entries.map((e) => e.type),
          count: entries.length,
          piiTexts: entries.map((e) => e.piiValue),
        });
        await this.setToStorage({ actionHistory: history });
        console.log(
          `Dashboard: logged ${entries.length} abstract action(s) immediately`
        );
      }
    } catch (error) {
      console.error("Error logging abstract action:", error);
    }
  },

  // Store abstractedText → { original, type } in local storage so that
  // rendered user messages containing the abstracted text can be detected
  // and counted as confirmed abstract actions.
  async saveAbstractMappings(pairs) {
    try {
      const conversationId = this.getActiveConversationId() || "no-url";
      const data = await this.getFromStorage(["abstractMappings"]);
      const allMappings = data.abstractMappings || {};
      const convMappings = allMappings[conversationId] || {};

      for (const { protected: original, abstracted } of pairs) {
        if (abstracted && original) {
          const type =
            this.currentEntities
              .find((e) => e.text === original)
              ?.entity_type.replace(/[0-9]+$/, "") || "UNKNOWN";
          convMappings[abstracted] = { original, type };
        }
      }

      allMappings[conversationId] = convMappings;
      await this.setToStorage({ abstractMappings: allMappings });
    } catch (error) {
      console.error("Error saving abstract mappings:", error);
    }
  },

  getAbstractResponse: async function (
    originalMessage,
    currentMessage,
    abstractList,
    onResultCallback
  ) {
    let abstractResponse = "";
    // Non-LLM modes: no LLM available, fall back to placeholder abstraction.
    // privacy_filter mode hides the Abstract button entirely, so this branch
    // should rarely execute; it stays as a safety net.
    if (
      this.detectionMode === "presidio" ||
      this.detectionMode === "privacy_filter"
    ) {
      const convId = this.getActiveConversationId() || "no-url";
      const convMappings = this.piiToPlaceholder[convId] || {};
      const results = abstractList.map((pii) => {
        const placeholder = convMappings[pii] || "REDACTED";
        return { protected: pii, abstracted: `[${placeholder}]` };
      });
      abstractResponse = results;
      onResultCallback(results);
      return abstractResponse;
    }
    if (!this.useOnDeviceModel) {
      const { getCloudAbstractResponse } = await import(
        chrome.runtime.getURL("openai.js")
      );
      const abstractResponseResult = await getCloudAbstractResponse(
        originalMessage,
        currentMessage,
        abstractList
      );
      const abstractResponseObject = JSON.parse(abstractResponseResult);
      if (abstractResponseObject) {
        abstractResponse = abstractResponseObject.text;
        // Since cloud models are not streamed, call callback with the final result
        onResultCallback(abstractResponse);
      } else {
        abstractResponse = undefined;
      }
    } else {
      const { getOnDeviceAbstractResponse } = await import(
        chrome.runtime.getURL("ondevice.js")
      );
      // Stream the results and update in real-time via the callback
      await getOnDeviceAbstractResponse(
        originalMessage,
        currentMessage,
        abstractList,
        (partialResult) => {
          // Update the cumulative abstract response
          abstractResponse = partialResult;
          // Call the provided callback for UI updates
          onResultCallback(partialResult);
        }
      );
    }
    return abstractResponse;
  },

  applyAbstractResponse: function (
    partialAbstractResponse,
    current_message,
    abstractList
  ) {
    if (!partialAbstractResponse || partialAbstractResponse.length === 0) {
      return current_message;
    }

    const sortedResponses = partialAbstractResponse
      .filter((item) => abstractList.includes(item.protected)) // Only include terms in the abstractList
      .sort((a, b) => b.protected.length - a.protected.length);

    let modifiedMessage = current_message;

    sortedResponses.forEach(({ protected: protectedValue, abstracted }) => {
      const regex = new RegExp(protectedValue, "g");
      modifiedMessage = modifiedMessage.replace(regex, abstracted);
    });

    return modifiedMessage;
  },

  updateDetectedEntities: function () {
    const newDetectedEntities = [];
    const inputText = this.currentUserMessage;

    this.currentEntities.forEach((entity) => {
      if (inputText.includes(entity.text)) {
        newDetectedEntities.push(entity);
      }
    });

    this.currentEntities = newDetectedEntities;
  },

  updatePanelWithCurrentDetection: async function () {
    await this.updatePIIReplacementPanel(this.currentEntities);
  },

  getCurrentEntities: function () {
    return this.currentEntities;
  },

  updatePIIReplacementPanel: async function (detectedEntities) {
    const panel = document.getElementById("pii-replacement-panel");
    if (panel) {
      panel.remove();
      await this.showReplacementPanel(detectedEntities);
    }
  },

  getActiveConversationId: function () {
    const url = window.location.href;
    const conversationIdMatch = url.match(/\/c\/([a-z0-9-]+)/);
    return conversationIdMatch ? conversationIdMatch[1] : "no-url";
  },

  getFromStorage: function (keys) {
    return new Promise((resolve, reject) => {
      if (!this.isExtensionContextValid()) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      } catch (e) {
        resolve({});
      }
    });
  },

  checkMessageRenderedAndReplace: async function (element) {
    if (!this.enabled) {
      return;
    }

    const activeConversationId = this.getActiveConversationId();
    if (activeConversationId === "no-url") {
      console.log("No active conversation URL detected.");
      return;
    }

    try {
      // Get mapping from cloud storage
      const data = await this.getFromStorage(null);
      const piiToPlaceholder =
        data.piiToPlaceholder?.[activeConversationId] || {};
      const placeholderToPii =
        data.placeholderToPii?.[activeConversationId] || {};

      // For user messages, detect confirmed replace actions
      // from the actual sent prompt before the display-replacement runs
      const isUserMessage =
        element.getAttribute("data-message-author-role") === "user";
      if (isUserMessage) {
        await this.inferActionsFromRenderedMessage(
          element,
          placeholderToPii,
          activeConversationId
        );
      }

      // Update current entities by using the mappings from cloud
      this.updateCurrentEntitiesByPIIMappings(piiToPlaceholder);
      this.replaceTextInElement(element, placeholderToPii);
    } catch (error) {
      console.error("Error fetching PII mappings:", error);
    }
  },

  // Scan a rendered user message to confirm replace actions.
  // Called before replaceTextInElement swaps placeholders for display,
  // so the raw text still contains [NAME1] as actually sent.
  //
  // Replace: placeholders like [NAME1] found in the text prove the user
  //   sent the redacted version.
  // Abstract actions are logged immediately when the user clicks Abstract,
  // so they are not detected here.
  inferActionsFromRenderedMessage: async function (
    element,
    placeholderToPii,
    conversationId
  ) {
    // Skip if we already processed this element
    if (element.hasAttribute("data-actions-inferred")) return;
    element.setAttribute("data-actions-inferred", "true");

    const text = element.textContent || "";

    try {
      const data = await this.getFromStorage(["actionHistory"]);
      const history = data.actionHistory || [];
      let changed = false;

      // Build set of already-logged replace PII texts for this conversation
      const loggedReplacePIIs = new Set();
      for (const entry of history) {
        if (
          entry.conversationId !== conversationId ||
          entry.action !== "replace" ||
          !entry.piiTexts
        )
          continue;
        entry.piiTexts.forEach((t) => loggedReplacePIIs.add(t));
      }

      // --- Replace detection ---
      const foundPlaceholders = [];
      for (const [placeholder, piiValue] of Object.entries(placeholderToPii)) {
        if (loggedReplacePIIs.has(piiValue)) continue;
        const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(
          `\\[${escaped}\\]|\\b${escaped}\\b`,
          "g"
        );
        if (regex.test(text)) {
          foundPlaceholders.push({
            piiValue,
            type: placeholder.replace(/[0-9]+$/, ""),
          });
        }
      }

      if (foundPlaceholders.length > 0) {
        history.push({
          action: "replace",
          timestamp: Date.now(),
          conversationId,
          entityTypes: foundPlaceholders.map((e) => e.type),
          count: foundPlaceholders.length,
          piiTexts: foundPlaceholders.map((e) => e.piiValue),
        });
        changed = true;
        console.log(
          `Dashboard: confirmed ${foundPlaceholders.length} replace action(s) from sent message`
        );
      }

      if (changed) {
        await this.setToStorage({ actionHistory: history });
      }
    } catch (error) {
      console.error("Error inferring actions from rendered message:", error);
    }
  },

  updateCurrentEntitiesByPIIMappings(piiMappings) {
    this.currentEntities = Object.keys(piiMappings).map((key) => ({
      entity_type: piiMappings[key],
      entity_placeholder: piiMappings[key],
      text: key,
    }));
  },

  replaceTextInElement: function (element, piiMappings) {
    const sortedPiiMappings = Object.entries(piiMappings).sort(
      (a, b) => b[1].length - a[1].length
    );

    const bgColor = document.childNodes[1].classList.contains("dark")
      ? "#23a066"
      : "#ade7cc";
    const placeholderBgColor = document.childNodes[1].classList.contains("dark")
      ? "rgb(213 44 126)"
      : "rgb(231 185 207)";

    function escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Pad the shorter string with non-breaking spaces ( ) split evenly on
    // both sides, so the placeholder and the original PII render at the same
    // visual width and hover-toggling does not reflow surrounding text.
    // A non-breaking space is visually narrower than an average glyph, so
    // multiply the character deficit to better compensate for the width gap.
    const SPACE_WIDTH_MULTIPLIER = 2;
    function padToEqualLength(a, b) {
      const max = Math.max(a.length, b.length);
      const pad = (s) => {
        const diff = max - s.length;
        if (diff <= 0) return s;
        const total = diff * SPACE_WIDTH_MULTIPLIER;
        const left = Math.floor(total / 2);
        const right = total - left;
        return " ".repeat(left) + s + " ".repeat(right);
      };
      return { a: pad(a), b: pad(b) };
    }

    function replaceTextRecursively(node) {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent;

          // Build a regex that matches placeholder patterns: [NAME1] or bare NAME1
          const placeholderPatterns = sortedPiiMappings.map(
            ([placeholder]) =>
              `\\[${escapeRegExp(placeholder)}\\]|\\b${escapeRegExp(placeholder)}\\b`
          );
          if (placeholderPatterns.length === 0) return;

          const combinedRegex = new RegExp(
            placeholderPatterns.join("|"),
            "g"
          );

          if (!combinedRegex.test(text)) return;
          combinedRegex.lastIndex = 0;

          // Build a lookup from placeholder (with or without brackets) to its entry
          const placeholderLookup = {};
          for (const [placeholder, pii] of sortedPiiMappings) {
            placeholderLookup[`[${placeholder}]`] = { placeholder, pii };
            placeholderLookup[placeholder] = { placeholder, pii };
          }

          const fragment = document.createDocumentFragment();
          let lastIndex = 0;
          let match;

          while ((match = combinedRegex.exec(text)) !== null) {
            const matched = match[0];
            const offset = match.index;

            // Add preceding text
            if (offset > lastIndex) {
              fragment.appendChild(
                document.createTextNode(text.slice(lastIndex, offset))
              );
            }

            const entry = placeholderLookup[matched];
            const { a: paddedPii, b: paddedPlaceholder } = padToEqualLength(
              entry.pii,
              entry.placeholder
            );
            const span = document.createElement("span");
            span.className = "highlight-pii-in-displayed-message";
            span.style.backgroundColor = bgColor;
            span.textContent = paddedPii;
            span.setAttribute("data-placeholder", entry.placeholder);
            span.setAttribute("data-padded-placeholder", paddedPlaceholder);
            span.setAttribute("data-padded-pii", paddedPii);

            fragment.appendChild(span);
            lastIndex = offset + matched.length;
          }

          if (lastIndex > 0) {
            if (lastIndex < text.length) {
              fragment.appendChild(
                document.createTextNode(text.slice(lastIndex))
              );
            }
            child.replaceWith(fragment);
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          replaceTextRecursively(child);
        }
      });
    }

    if (element.matches('[data-message-author-role="assistant"]')) {
      // Process regular (non-writing-block) content
      element
        .querySelectorAll("p, li, div, span, strong, em, u, b, i")
        .forEach((el) => {
          // Skip elements inside writing blocks — handled separately below
          if (el.closest('[data-writing-block="true"]')) return;
          replaceTextRecursively(el);
        });

      // Handle writing blocks (editable views like email drafts)
      element
        .querySelectorAll('[data-writing-block="true"]')
        .forEach((block) => {
          // Replace placeholders in textarea elements (e.g., subject line)
          block.querySelectorAll("textarea").forEach((textarea) => {
            let val = textarea.value;
            let changed = false;
            for (const [placeholder, pii] of sortedPiiMappings) {
              const bracketedRegex = new RegExp(
                `\\[${escapeRegExp(placeholder)}\\]`,
                "g"
              );
              const bareRegex = new RegExp(
                `\\b${escapeRegExp(placeholder)}\\b`,
                "g"
              );
              const newVal = val
                .replace(bracketedRegex, pii)
                .replace(bareRegex, pii);
              if (newVal !== val) {
                val = newVal;
                changed = true;
              }
            }
            if (changed) {
              textarea.value = val;
              textarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
          });

          // ProseMirror strips inline DOM modifications, so we use a positioned
          // overlay approach: place highlight divs on top of PII text without
          // touching ProseMirror's DOM.
          const proseMirror = block.querySelector(".ProseMirror");
          if (!proseMirror) return;

          // First, ensure placeholders in text are replaced with PII values.
          // ProseMirror preserves text changes even though it strips span wrappers.
          const placeholderTokenSpans = block.querySelectorAll(
            "span[data-placeholder-token]"
          );
          placeholderTokenSpans.forEach((span) => {
            const text = span.textContent;
            for (const [placeholder, pii] of sortedPiiMappings) {
              if (text === `[${placeholder}]` || text === placeholder) {
                span.textContent = pii;
                break;
              }
            }
          });

          // Build PII entries for overlay matching (reverse lookup: PII value → placeholder)
          const piiEntries = sortedPiiMappings
            .filter(([, pii]) => pii.length > 0)
            .map(([placeholder, pii]) => {
              const { a: paddedPii, b: paddedPlaceholder } = padToEqualLength(
                pii,
                placeholder
              );
              return {
                placeholder,
                pii,
                paddedPlaceholder,
                paddedPii,
                regex: new RegExp(escapeRegExp(pii), "g"),
              };
            });

          function buildOverlay() {
            const editorWrapper =
              proseMirror.closest(".writing-block-editor") ||
              proseMirror.parentElement;
            if (!editorWrapper) return;

            // Remove existing overlay
            const old = editorWrapper.querySelector(".pii-wb-overlay");
            if (old) old.remove();

            // Ensure parent is positioned for absolute children
            if (
              window.getComputedStyle(editorWrapper).position === "static"
            ) {
              editorWrapper.style.position = "relative";
            }

            const overlay = document.createElement("div");
            overlay.className = "pii-wb-overlay";
            overlay.style.cssText =
              "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;";

            const wrapperRect = editorWrapper.getBoundingClientRect();

            // Walk text nodes in ProseMirror to find PII values
            const walker = document.createTreeWalker(
              proseMirror,
              NodeFilter.SHOW_TEXT
            );
            while (walker.nextNode()) {
              const textNode = walker.currentNode;
              const text = textNode.textContent;

              for (const entry of piiEntries) {
                entry.regex.lastIndex = 0;
                let match;
                while ((match = entry.regex.exec(text)) !== null) {
                  const range = document.createRange();
                  range.setStart(textNode, match.index);
                  range.setEnd(textNode, match.index + entry.pii.length);

                  const clientRects = range.getClientRects();
                  for (const rect of clientRects) {
                    const cs = window.getComputedStyle(
                      textNode.parentElement
                    );
                    const hl = document.createElement("div");
                    hl.className = "highlight-pii-in-displayed-message";
                    hl.setAttribute("data-placeholder", entry.placeholder);
                    hl.style.cssText = [
                      "position:absolute",
                      `top:${rect.top - wrapperRect.top}px`,
                      `left:${rect.left - wrapperRect.left}px`,
                      `height:${rect.height}px`,
                      `background-color:${bgColor}`,
                      "pointer-events:auto",
                      "cursor:pointer",
                      "border-radius:3px",
                      `font-size:${cs.fontSize}`,
                      `font-family:${cs.fontFamily}`,
                      `font-weight:${cs.fontWeight}`,
                      `line-height:${rect.height}px`,
                      `letter-spacing:${cs.letterSpacing}`,
                      `color:${cs.color}`,
                      "white-space:pre",
                      "padding:0 1px",
                    ].join(";");
                    hl.textContent = entry.paddedPii;

                    hl.addEventListener("mouseenter", () => {
                      hl.textContent = entry.paddedPlaceholder;
                      hl.style.backgroundColor = placeholderBgColor;
                    });
                    hl.addEventListener("mouseleave", () => {
                      hl.textContent = entry.paddedPii;
                      hl.style.backgroundColor = bgColor;
                    });

                    overlay.appendChild(hl);
                  }
                  range.detach();
                }
              }
            }

            if (overlay.children.length > 0) {
              editorWrapper.appendChild(overlay);
            }
          }

          // Build overlay after a short delay to let ProseMirror settle
          setTimeout(buildOverlay, 150);

          // Rebuild overlay when ProseMirror content changes
          if (!proseMirror.hasAttribute("data-pii-observed")) {
            proseMirror.setAttribute("data-pii-observed", "true");
            let rebuildTimeout;
            const pmObserver = new MutationObserver(() => {
              clearTimeout(rebuildTimeout);
              rebuildTimeout = setTimeout(buildOverlay, 200);
            });
            pmObserver.observe(proseMirror, {
              childList: true,
              subtree: true,
              characterData: true,
            });
          }
        });
    } else if (element.matches('[data-message-author-role="user"]')) {
      element.querySelectorAll("div").forEach((el) => {
        replaceTextRecursively(el);
      });
    }

    // Bind hover events for regular (non-writing-block) highlight spans
    element
      .querySelectorAll(
        "span.highlight-pii-in-displayed-message:not([data-pii-hover-bound])"
      )
      .forEach((span) => {
        span.setAttribute("data-pii-hover-bound", "true");
        const placeholder = span.getAttribute("data-placeholder");
        const paddedPlaceholder =
          span.getAttribute("data-padded-placeholder") || placeholder;
        const paddedPii =
          span.getAttribute("data-padded-pii") || piiMappings[placeholder];
        span.addEventListener("mouseenter", () => {
          span.textContent = paddedPlaceholder;
          span.style.backgroundColor = placeholderBgColor;
        });
        span.addEventListener("mouseleave", () => {
          span.textContent = paddedPii;
          span.style.backgroundColor = bgColor;
        });
      });
  },
};
