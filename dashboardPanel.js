export function createDashboardPanel(data) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = chrome.runtime.getURL("ui.css");
  document.head.appendChild(link);

  let panel = document.getElementById("privacy-dashboard-panel");
  if (panel) {
    panel.remove();
  }

  panel = document.createElement("div");
  panel.id = "privacy-dashboard-panel";
  document.body.appendChild(panel);

  if (!data) {
    panel.innerHTML = `
      <div class="dashboard-header">
        <span class="dashboard-title">Privacy Dashboard</span>
        <button id="close-dashboard-btn">X</button>
      </div>
      <div class="dashboard-empty">No data yet. Start using Rescriber to see your privacy stats.</div>
    `;
    document.getElementById("close-dashboard-btn").addEventListener("click", () => panel.remove());
    return;
  }

  const {
    totalPIIs,
    totalReplaced,
    totalAbstracted,
    totalByType,
    conversationCount,
    actionsByDay,
    typeActions,
  } = data;

  const totalProtected = totalReplaced + totalAbstracted;
  const protectionRate = totalPIIs > 0 ? Math.round((totalProtected / totalPIIs) * 100) : 0;

  // Sort types by count descending
  const sortedTypes = Object.entries(totalByType).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = sortedTypes.length > 0 ? sortedTypes[0][1] : 1;

  // Build type bars HTML
  const typeBarsHTML = sortedTypes.map(([type, count]) => {
    const pct = Math.max(8, (count / maxTypeCount) * 100);
    const replaceCount = typeActions.replace[type] || 0;
    const abstractCount = typeActions.abstract[type] || 0;
    const label = formatTypeName(type);
    return `
      <div class="type-bar-row">
        <span class="type-bar-label">${label}</span>
        <div class="type-bar-track">
          <div class="type-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="type-bar-count">${count}</span>
        <div class="type-bar-actions">
          ${replaceCount > 0 ? `<span class="action-badge badge-replace" title="Replaced">${replaceCount}R</span>` : ""}
          ${abstractCount > 0 ? `<span class="action-badge badge-abstract" title="Abstracted">${abstractCount}A</span>` : ""}
        </div>
      </div>
    `;
  }).join("");

  // Build timeline HTML
  const days = Object.keys(actionsByDay);
  const recentDays = days.slice(-7); // Last 7 days
  const maxDayTotal = recentDays.reduce((max, d) => {
    const total = actionsByDay[d].replace + actionsByDay[d].abstract;
    return Math.max(max, total);
  }, 1);

  const timelineHTML = recentDays.length > 0
    ? recentDays.map((day) => {
        const r = actionsByDay[day].replace;
        const a = actionsByDay[day].abstract;
        const total = r + a;
        const heightPct = Math.max(6, (total / maxDayTotal) * 100);
        const rPct = total > 0 ? (r / total) * heightPct : 0;
        const aPct = total > 0 ? (a / total) * heightPct : 0;
        return `
          <div class="timeline-bar-group" title="${day}: ${r} replaced, ${a} abstracted">
            <div class="timeline-bar-stack" style="height: ${heightPct}%">
              <div class="timeline-bar-replace" style="height: ${rPct > 0 ? (rPct / heightPct) * 100 : 0}%"></div>
              <div class="timeline-bar-abstract" style="height: ${aPct > 0 ? (aPct / heightPct) * 100 : 0}%"></div>
            </div>
            <span class="timeline-label">${day}</span>
          </div>
        `;
      }).join("")
    : '<div class="dashboard-empty-hint">No actions recorded yet</div>';

  // Protection ring SVG
  const ringRadius = 36;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (protectionRate / 100) * ringCircumference;

  panel.innerHTML = `
    <div class="dashboard-header">
      <span class="dashboard-title">Privacy Dashboard</span>
      <button id="close-dashboard-btn">X</button>
    </div>

    <div class="dashboard-stats-row">
      <div class="stat-card">
        <div class="stat-number">${totalPIIs}</div>
        <div class="stat-label">Detected</div>
      </div>
      <div class="stat-card stat-card-replace">
        <div class="stat-number">${totalReplaced}</div>
        <div class="stat-label">Replaced</div>
      </div>
      <div class="stat-card stat-card-abstract">
        <div class="stat-number">${totalAbstracted}</div>
        <div class="stat-label">Abstracted</div>
      </div>
    </div>

    <div class="dashboard-ring-section">
      <svg class="ring-svg" viewBox="0 0 90 90">
        <circle class="ring-bg" cx="45" cy="45" r="${ringRadius}" />
        <circle class="ring-fill" cx="45" cy="45" r="${ringRadius}"
          stroke-dasharray="${ringCircumference}"
          stroke-dashoffset="${ringOffset}" />
        <text x="45" y="42" class="ring-pct">${protectionRate}%</text>
        <text x="45" y="54" class="ring-sub">protected</text>
      </svg>
      <div class="ring-detail">
        <div class="ring-detail-item">
          <span class="ring-dot dot-conversations"></span>
          <span>${conversationCount} conversation${conversationCount !== 1 ? "s" : ""}</span>
        </div>
        <div class="ring-detail-item">
          <span class="ring-dot dot-protected"></span>
          <span>${totalProtected} PII${totalProtected !== 1 ? "s" : ""} protected</span>
        </div>
      </div>
    </div>

    <div class="dashboard-section">
      <div class="section-title">PII Types Detected</div>
      <div class="type-bars-container">
        ${typeBarsHTML || '<div class="dashboard-empty-hint">No PIIs detected yet</div>'}
      </div>
    </div>

    <div class="dashboard-section">
      <div class="section-title">
        Recent Activity
        <div class="timeline-legend">
          <span class="legend-item"><span class="legend-swatch swatch-replace"></span>Replace</span>
          <span class="legend-item"><span class="legend-swatch swatch-abstract"></span>Abstract</span>
        </div>
      </div>
      <div class="timeline-container">
        ${timelineHTML}
      </div>
    </div>
  `;

  // Close button
  document.getElementById("close-dashboard-btn").addEventListener("click", () => {
    panel.remove();
  });

  // Make panel draggable
  makeDraggable(panel, panel.querySelector(".dashboard-header"));
}

function formatTypeName(type) {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function makeDraggable(panel, handle) {
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  handle.style.cursor = "grab";

  handle.addEventListener("mousedown", (e) => {
    if (e.target.id === "close-dashboard-btn") return;
    isDragging = true;
    handle.style.cursor = "grabbing";
    startX = e.clientX;
    startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panel.style.left = `${initialLeft + dx}px`;
    panel.style.top = `${initialTop + dy}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      handle.style.cursor = "grab";
    }
  });
}
