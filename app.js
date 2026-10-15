(() => {
  const STORAGE_KEY = "dialogtree.project.v1";
  const DEFAULT_PROJECT = {
    title: "Untitled conversation",
    startNodeId: "",
    nodes: []
  };
  const LEGACY_SAMPLE = {
    title: "The old lighthouse",
    startNodeId: "node-1",
    nodes: [
      {
        id: "node-1",
        speaker: "Mara",
        text: "You made it. The storm's getting worse — we need to get inside.",
        choices: [
          { text: "What happened here?", nextNodeId: "node-2" },
          { text: "I'm right behind you.", nextNodeId: "node-3" }
        ]
      },
      {
        id: "node-2",
        speaker: "Mara",
        text: "The light went out three nights ago. No one has been able to relight it.",
        choices: [{ text: "I'll take a look.", nextNodeId: "node-3" }]
      },
      {
        id: "node-3",
        speaker: "Mara",
        text: "Good. The stairs are just through that door. Watch your step.",
        choices: []
      }
    ]
  };

  const canvas = document.getElementById("canvas-viewport");
  const canvasWorld = document.getElementById("canvas-world");
  const canvasContent = document.getElementById("canvas-content");
  const nodeLayer = document.getElementById("node-layer");
  const selectionBox = document.getElementById("selection-box");
  const connections = document.getElementById("connections");
  const inspector = document.getElementById("inspector-content");
  const preview = document.getElementById("json-preview");
  const titleInput = document.getElementById("project-title");
  const deleteButton = document.getElementById("delete-node-button");
  let loadError = null;
  let project = loadProject();
  let selectedNodeId = project.startNodeId;
  let selectedNodeIds = new Set(selectedNodeId ? [selectedNodeId] : []);
  let toastTimer;
  let dragState = null;
  let marqueeState = null;
  let connectionState = null;
  let nodeClipboard = [];
  let saveTimer;
  let zoom = 1;
  let worldWidth = 0;
  let worldHeight = 0;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2;

  function loadProject() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return structuredClone(DEFAULT_PROJECT);
      const loaded = validateProject(JSON.parse(saved));
      const legacyContent = {
        title: loaded.title,
        startNodeId: loaded.startNodeId,
        nodes: loaded.nodes.map(({ id, speaker, text, choices }) => ({
          id,
          speaker,
          text,
          choices: choices.map(({ text: choiceText, nextNodeId }) => ({
            text: choiceText,
            nextNodeId
          }))
        }))
      };
      return JSON.stringify(legacyContent) === JSON.stringify(LEGACY_SAMPLE)
        ? structuredClone(DEFAULT_PROJECT)
        : loaded;
    } catch (error) {
      console.error("Could not load the saved dialog tree.", error);
      loadError = `Saved project could not be loaded: ${error.message}`;
      return structuredClone(DEFAULT_PROJECT);
    }
  }

  function validateProject(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.nodes)) {
      throw new Error("The saved project does not contain a nodes array.");
    }
    const nodes = value.nodes.map((node, index) => {
      if (!node || typeof node.id !== "string" || !node.id.trim() || typeof node.text !== "string" || !Array.isArray(node.choices)) {
        throw new Error(`Node ${index + 1} is invalid.`);
      }
      return {
        id: node.id,
        speaker: typeof node.speaker === "string" ? node.speaker : "",
        text: node.text,
        choices: node.choices.map((choice, choiceIndex) => {
          if (!choice || typeof choice.text !== "string" || typeof choice.nextNodeId !== "string"
            || (choice.actionKey != null && typeof choice.actionKey !== "string")) {
            throw new Error(`Choice ${choiceIndex + 1} in node ${node.id} is invalid.`);
          }
          return {
            text: choice.text,
            nextNodeId: choice.nextNodeId,
            actionKey: typeof choice.actionKey === "string" ? choice.actionKey : ""
          };
        }),
        x: Number.isFinite(node.x) ? node.x : 100 + (index % 3) * 270,
        y: Number.isFinite(node.y) ? node.y : 100 + Math.floor(index / 3) * 220
      };
    });
    const ids = new Set(nodes.map(node => node.id));
    if (ids.size !== nodes.length) {
      throw new Error("Node IDs must be unique.");
    }
    for (const node of nodes) {
      for (const choice of node.choices) {
        if (choice.nextNodeId && !ids.has(choice.nextNodeId)) {
          throw new Error(`Choice in node ${node.id} points to missing node ${choice.nextNodeId}.`);
        }
      }
    }
    return {
      title: typeof value.title === "string" && value.title.trim() ? value.title : "Untitled conversation",
      startNodeId: ids.has(value.startNodeId) ? value.startNodeId : (nodes[0]?.id ?? ""),
      nodes
    };
  }

  function exportData() {
    return {
      title: project.title,
      startNodeId: project.startNodeId,
      nodes: project.nodes.map(({ id, speaker, text, choices }) => ({
        id,
        speaker,
        text,
        choices: choices.map(choice => ({
          text: choice.text,
          nextNodeId: choice.nextNodeId,
          ...(choice.actionKey ? { actionKey: choice.actionKey } : {})
        }))
      }))
    };
  }

  function saveProject() {
    try {
      const saved = project.nodes.map(node => ({ ...node, choices: node.choices.map(choice => ({ ...choice })) }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, nodes: saved }));
      document.getElementById("save-status").textContent = "Saved locally";
    } catch (error) {
      document.getElementById("save-status").textContent = "Save failed";
      console.error("Could not save the dialog tree.", error);
      showToast("Could not save this project in your browser.");
    }
  }

  function scheduleSave() {
    document.getElementById("save-status").textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProject, 180);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function render() {
    titleInput.textContent = project.title;
    updateWorldSize();
    renderNodes();
    renderInspector();
    renderConnections();
    preview.textContent = JSON.stringify(exportData(), null, 2);
    const count = project.nodes.length;
    document.getElementById("node-count").textContent = `${count} ${count === 1 ? "node" : "nodes"}`;
    document.getElementById("empty-canvas").hidden = count !== 0;
    deleteButton.disabled = !getSelectedNode();
    document.getElementById("duplicate-selection-button").disabled = selectedNodeIds.size === 0;
    document.getElementById("delete-selection-button").disabled = selectedNodeIds.size === 0;
    document.getElementById("delete-selection-button").textContent = selectedNodeIds.size > 1
      ? `Delete ${selectedNodeIds.size}`
      : "Delete";
    updateZoomLabel();
  }

  function updateWorldSize() {
    const minimumWidth = (canvas.clientWidth + 1200) / zoom;
    const minimumHeight = (canvas.clientHeight + 1200) / zoom;
    const nodeRight = project.nodes.reduce((right, node) => Math.max(right, node.x + 550), 0);
    const nodeBottom = project.nodes.reduce((bottom, node) => Math.max(bottom, node.y + 420), 0);
    const visibleRight = (canvas.scrollLeft + canvas.clientWidth + 800) / zoom;
    const visibleBottom = (canvas.scrollTop + canvas.clientHeight + 800) / zoom;
    worldWidth = Math.max(worldWidth, minimumWidth, nodeRight, visibleRight);
    worldHeight = Math.max(worldHeight, minimumHeight, nodeBottom, visibleBottom);
    canvasContent.style.width = `${worldWidth}px`;
    canvasContent.style.height = `${worldHeight}px`;
    canvasContent.style.transform = `scale(${zoom})`;
    canvasWorld.style.width = `${worldWidth * zoom}px`;
    canvasWorld.style.height = `${worldHeight * zoom}px`;
  }

  function updateZoomLabel() {
    document.getElementById("zoom-level").textContent = `${Math.round(zoom * 100)}%`;
  }

  function canvasPoint(clientX, clientY) {
    const bounds = canvasContent.getBoundingClientRect();
    return {
      x: (clientX - bounds.left) / zoom,
      y: (clientY - bounds.top) / zoom
    };
  }

  function setZoom(nextZoom, clientX = canvas.getBoundingClientRect().left + canvas.clientWidth / 2,
    clientY = canvas.getBoundingClientRect().top + canvas.clientHeight / 2) {
    const oldZoom = zoom;
    const viewportBounds = canvas.getBoundingClientRect();
    const anchorX = (canvas.scrollLeft + clientX - viewportBounds.left) / oldZoom;
    const anchorY = (canvas.scrollTop + clientY - viewportBounds.top) / oldZoom;
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    updateWorldSize();
    canvas.scrollLeft = anchorX * zoom - (clientX - viewportBounds.left);
    canvas.scrollTop = anchorY * zoom - (clientY - viewportBounds.top);
    updateZoomLabel();
    renderConnections();
  }

  function fitNodesToView() {
    if (!project.nodes.length) {
      setZoom(1);
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
      return;
    }
    const left = Math.min(...project.nodes.map(node => node.x));
    const top = Math.min(...project.nodes.map(node => node.y));
    const right = Math.max(...project.nodes.map(node => node.x + 220));
    const bottom = Math.max(...project.nodes.map(node => node.y + 180));
    const fitZoom = Math.min(
      (canvas.clientWidth - 120) / (right - left),
      (canvas.clientHeight - 120) / (bottom - top),
      1
    );
    setZoom(fitZoom);
    canvas.scrollLeft = Math.max(0, ((left + right) * zoom - canvas.clientWidth) / 2);
    canvas.scrollTop = Math.max(0, ((top + bottom) * zoom - canvas.clientHeight) / 2);
  }

  function renderNodes() {
    nodeLayer.replaceChildren(selectionBox);
    project.nodes.forEach((node, index) => {
      const card = document.createElement("article");
      card.className = `node-card${node.id === selectedNodeId ? " selected" : ""}${selectedNodeIds.has(node.id) && node.id !== selectedNodeId ? " multi-selected" : ""}${node.id === project.startNodeId ? " is-start" : ""}`;
      card.dataset.nodeId = node.id;
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
      const choicesMarkup = node.choices.map((choice, choiceIndex) => {
        const target = project.nodes.find(item => item.id === choice.nextNodeId);
        const destination = target
          ? `→ ${escapeHtml(target.id)}`
          : choice.actionKey ? `⚡ ${escapeHtml(choice.actionKey)}` : "End";
        return `<div class="node-option"><i class="option-dot"></i><span class="option-label">${escapeHtml(choice.text || "Untitled choice")}</span><span class="option-target">${destination}</span><button class="connection-handle" type="button" data-choice-index="${choiceIndex}" aria-label="Connect response ${choiceIndex + 1}" title="Drag to a node to connect"></button></div>`;
      }).join("");
      card.innerHTML = `
        <div class="node-topline">
          <span class="node-grip">⠿</span>
          <span class="node-number">NODE ${String(index + 1).padStart(2, "0")}</span>
          ${node.id === project.startNodeId ? '<span class="start-badge">START</span>' : ""}
        </div>
        <div class="node-body">
          <div class="node-speaker">${escapeHtml(node.speaker || "Unknown speaker")}</div>
          <div class="node-copy">${escapeHtml(node.text || "Write your dialogue…")}</div>
        </div>
        ${node.choices.length ? `<div class="node-options">${choicesMarkup}</div>` : ""}
        `;
      card.addEventListener("pointerdown", startDrag);
      card.querySelectorAll(".connection-handle").forEach(handle => {
        handle.addEventListener("pointerdown", startConnection);
      });
      nodeLayer.append(card);
    });
  }

  function renderConnections() {
    connections.setAttribute("viewBox", `0 0 ${worldWidth} ${worldHeight}`);
    connections.replaceChildren();
    for (const node of project.nodes) {
      for (const choice of node.choices) {
        const target = project.nodes.find(item => item.id === choice.nextNodeId);
        if (!target) continue;
        const choiceIndex = node.choices.indexOf(choice);
        const sourceHandle = nodeLayer.querySelector(
          `[data-node-id="${CSS.escape(node.id)}"] .connection-handle[data-choice-index="${choiceIndex}"]`
        );
        const sourceBounds = sourceHandle?.getBoundingClientRect();
        const sourcePoint = sourceBounds
          ? canvasPoint(sourceBounds.right, sourceBounds.top + sourceBounds.height / 2)
          : { x: node.x + 200, y: node.y + 67 };
        const sourceX = sourcePoint.x;
        const sourceY = sourcePoint.y;
        const targetX = target.x;
        const targetY = target.y + 22;
        const bend = Math.max(45, Math.abs(targetX - sourceX) * .48);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`);
        path.setAttribute("class", `connection-path${selectedNodeIds.has(node.id) ? " active" : ""}`);
        connections.append(path);
      }
    }
    if (connectionState) {
      const sourceHandle = nodeLayer.querySelector(
        `[data-node-id="${CSS.escape(connectionState.sourceNodeId)}"] .connection-handle[data-choice-index="${connectionState.choiceIndex}"]`
      );
      const sourceBounds = sourceHandle?.getBoundingClientRect();
      if (sourceBounds) {
        const sourcePoint = canvasPoint(sourceBounds.right, sourceBounds.top + sourceBounds.height / 2);
        const pointerPoint = canvasPoint(connectionState.pointerX, connectionState.pointerY);
        const sourceX = sourcePoint.x;
        const sourceY = sourcePoint.y;
        const targetX = pointerPoint.x;
        const targetY = pointerPoint.y;
        const bend = Math.max(35, Math.abs(targetX - sourceX) * .45);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`);
        path.setAttribute("class", "connection-path connection-preview");
        connections.append(path);
      }
    }
  }

  function startConnection(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const card = handle.closest(".node-card");
    if (!card) return;
    connectionState = {
      sourceNodeId: card.dataset.nodeId,
      choiceIndex: Number(handle.dataset.choiceIndex),
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      hoveredNodeId: null
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", moveConnection);
    handle.addEventListener("pointerup", endConnection, { once: true });
    handle.addEventListener("pointercancel", cancelConnection, { once: true });
    renderConnections();
  }

  function moveConnection(event) {
    if (!connectionState || event.pointerId !== connectionState.pointerId) return;
    connectionState.pointerX = event.clientX;
    connectionState.pointerY = event.clientY;
    if (Math.abs(event.clientX - connectionState.startX) + Math.abs(event.clientY - connectionState.startY) > 5) {
      connectionState.moved = true;
    }
    nodeLayer.querySelectorAll(".connection-target").forEach(node => node.classList.remove("connection-target"));
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".node-card");
    connectionState.hoveredNodeId = target?.dataset.nodeId ?? null;
    target?.classList.add("connection-target");
    renderConnections();
  }

  function finishConnection(event, shouldConnect) {
    if (!connectionState || event.pointerId !== connectionState.pointerId) return;
    const handle = event.currentTarget;
    const state = connectionState;
    if (shouldConnect && Math.abs(event.clientX - state.startX) + Math.abs(event.clientY - state.startY) > 5) {
      state.moved = true;
    }
    const canvasBounds = canvas.getBoundingClientRect();
    const inCanvas = event.clientX >= canvasBounds.left && event.clientX <= canvasBounds.right
      && event.clientY >= canvasBounds.top && event.clientY <= canvasBounds.bottom;
    let changed = false;
    if (shouldConnect && state.moved && inCanvas) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".node-card");
      const node = project.nodes.find(item => item.id === state.sourceNodeId);
      const choice = node?.choices[state.choiceIndex];
      const nextNodeId = target?.dataset.nodeId ?? "";
      if (choice && choice.nextNodeId !== nextNodeId) {
        choice.nextNodeId = nextNodeId;
        changed = true;
      }
    }
    handle.removeEventListener("pointermove", moveConnection);
    handle.removeEventListener("pointercancel", cancelConnection);
    nodeLayer.querySelectorAll(".connection-target").forEach(node => node.classList.remove("connection-target"));
    connectionState = null;
    render();
    if (changed) {
      scheduleSave();
      showToast(inCanvas && document.elementFromPoint(event.clientX, event.clientY)?.closest(".node-card")
        ? "Response connected"
        : "Response disconnected");
    }
  }

  function endConnection(event) {
    finishConnection(event, true);
  }

  function cancelConnection(event) {
    finishConnection(event, false);
  }

  function getSelectedNode() {
    return project.nodes.find(node => node.id === selectedNodeId);
  }

  function renderInspector() {
    const node = getSelectedNode();
    document.getElementById("inspector-title").textContent = node ? "Edit dialogue" : "Node details";
    if (!node) {
      inspector.innerHTML = `<div class="inspector-empty"><div class="empty-selection-icon">↖</div><strong>Select a node</strong><span>Choose a node on the canvas to edit its dialogue and response paths.</span></div>`;
      return;
    }
    const choices = node.choices.map((choice, index) => `
      <div class="choice-card" data-choice-index="${index}">
        <div class="choice-card-top"><span>RESPONSE ${String(index + 1).padStart(2, "0")}</span><button class="choice-remove" type="button" aria-label="Remove response">×</button></div>
        <input class="choice-text" type="text" maxlength="180" value="${escapeHtml(choice.text)}" placeholder="What can the player say?">
        <div class="choice-link-status">${choice.nextNodeId
          ? `Connected to <strong>${escapeHtml(choice.nextNodeId)}</strong> · drag dot to change`
          : "Not connected · drag dot to a node"}</div>
        ${choice.nextNodeId ? "" : `<label class="action-key-field">C# action key
          <input class="choice-action-key" type="text" maxlength="100" value="${escapeHtml(choice.actionKey || "")}" placeholder="e.g. OpenLighthouseDoor">
          <small>Runs your matching C# handler when this response is chosen.</small>
        </label>`}
      </div>`).join("");
    inspector.innerHTML = `
      <label class="field"><span class="field-label">Speaker <span class="field-meta">DISPLAY NAME</span></span>
        <input id="speaker-input" type="text" maxlength="80" value="${escapeHtml(node.speaker)}" placeholder="e.g. Mara"></label>
      <label class="field"><span class="field-label">Dialogue</span>
        <textarea id="dialogue-input" maxlength="2000" placeholder="Write the dialogue for this moment…">${escapeHtml(node.text)}</textarea></label>
      <label class="field"><span class="field-label">Start node</span>
        <select id="start-node-input"><option value="false">No</option><option value="true"${node.id === project.startNodeId ? " selected" : ""}>Yes — conversation begins here</option></select></label>
      <div class="section-title"><span>Responses</span><small>${node.choices.length} / 8</small></div>
      ${node.choices.length ? '<p class="choice-empty">Drag a response dot on the canvas to connect it, or add an action key to run a C# handler.</p>' : ""}
      ${node.choices.length ? choices : '<p class="choice-empty">No responses yet. This node ends the conversation unless another system continues it.</p>'}
      <button class="button-outline" id="add-choice-button" type="button"${node.choices.length >= 8 ? " disabled" : ""}>＋ &nbsp; Add response</button>
      <div class="section-title"><span>Node ID</span><small>JSON REFERENCE</small></div>
      <div class="node-id">${escapeHtml(node.id)}</div>`;

    inspector.querySelector("#speaker-input").addEventListener("input", event => updateNode(node.id, { speaker: event.target.value }));
    inspector.querySelector("#dialogue-input").addEventListener("input", event => updateNode(node.id, { text: event.target.value }));
    inspector.querySelector("#start-node-input").addEventListener("change", event => {
      if (event.target.value === "true") {
        project.startNodeId = node.id;
        render();
        scheduleSave();
      }
    });
    inspector.querySelector("#add-choice-button").addEventListener("click", () => {
      if (node.choices.length >= 8) return;
      node.choices.push({ text: "", nextNodeId: "", actionKey: "" });
      render();
      scheduleSave();
      inspector.querySelector(".choice-card:last-of-type .choice-text")?.focus();
    });
    inspector.querySelectorAll(".choice-card").forEach(card => {
      const choice = node.choices[Number(card.dataset.choiceIndex)];
      card.querySelector(".choice-text").addEventListener("input", event => {
        choice.text = event.target.value;
        scheduleSave();
        renderNodes();
        renderConnections();
        preview.textContent = JSON.stringify(exportData(), null, 2);
      });
      card.querySelector(".choice-action-key")?.addEventListener("input", event => {
        choice.actionKey = event.target.value;
        scheduleSave();
        renderNodes();
        preview.textContent = JSON.stringify(exportData(), null, 2);
      });
      card.querySelector(".choice-remove").addEventListener("click", () => {
        node.choices.splice(Number(card.dataset.choiceIndex), 1);
        render();
        scheduleSave();
      });
    });
  }

  function updateNode(nodeId, values) {
    const node = project.nodes.find(item => item.id === nodeId);
    if (!node) return;
    Object.assign(node, values);
    renderNodes();
    renderConnections();
    preview.textContent = JSON.stringify(exportData(), null, 2);
    scheduleSave();
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    const card = event.currentTarget;
    const node = project.nodes.find(item => item.id === card.dataset.nodeId);
    if (!node) return;
    const extendSelection = event.shiftKey || event.ctrlKey || event.metaKey;
    let selectionChanged = false;
    if (extendSelection) {
      if (selectedNodeIds.has(node.id)) {
        selectedNodeIds.delete(node.id);
        if (selectedNodeId === node.id) selectedNodeId = [...selectedNodeIds].at(-1) ?? null;
        render();
        return;
      } else {
        selectedNodeIds.add(node.id);
        selectedNodeId = node.id;
        selectionChanged = true;
      }
    } else if (!selectedNodeIds.has(node.id)) {
      selectedNodeIds = new Set([node.id]);
      selectedNodeId = node.id;
      selectionChanged = true;
    } else if (selectedNodeId !== node.id) {
      selectedNodeId = node.id;
      selectionChanged = true;
    }
    dragState = {
      id: node.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      positions: project.nodes
        .filter(item => selectedNodeIds.has(item.id))
        .map(item => ({ id: item.id, x: item.x, y: item.y })),
      moved: false,
      selectionChanged
    };
    nodeLayer.querySelectorAll(".node-card").forEach(item => {
      item.classList.toggle("selected", item.dataset.nodeId === selectedNodeId);
      item.classList.toggle("multi-selected", selectedNodeIds.has(item.dataset.nodeId) && item.dataset.nodeId !== selectedNodeId);
    });
    card.setPointerCapture(event.pointerId);
    card.addEventListener("pointermove", moveNode);
    card.addEventListener("pointerup", endDrag, { once: true });
    card.addEventListener("pointercancel", endDrag, { once: true });
  }

  function moveNode(event) {
    if (!dragState) return;
    const dx = (event.clientX - dragState.pointerX) / zoom;
    const dy = (event.clientY - dragState.pointerY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
    if (!dragState.moved) return;
    for (const position of dragState.positions) {
      const node = project.nodes.find(item => item.id === position.id);
      if (!node) continue;
      node.x = Math.max(5, position.x + dx);
      node.y = Math.max(5, position.y + dy);
      const card = nodeLayer.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
      if (card) {
        card.style.left = `${node.x}px`;
        card.style.top = `${node.y}px`;
      }
    }
    updateWorldSize();
    renderConnections();
  }

  function endDrag(event) {
    const card = event.currentTarget;
    card.removeEventListener("pointermove", moveNode);
    if (dragState?.moved) scheduleSave();
    if (dragState) {
      const changedSelection = dragState.selectionChanged || dragState.moved;
      dragState = null;
      if (changedSelection) render();
    }
  }

  function startMarquee(event) {
    if (event.button !== 0 || event.target.closest(".node-card, button, .canvas-legend")) return;
    const point = canvasPoint(event.clientX, event.clientY);
    marqueeState = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      initialSelection: new Set(selectedNodeIds),
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    selectionBox.hidden = false;
    updateMarquee(point.x, point.y);
  }

  function updateMarquee(x, y) {
    if (!marqueeState) return;
    const left = Math.min(marqueeState.startX, x);
    const top = Math.min(marqueeState.startY, y);
    const width = Math.abs(x - marqueeState.startX);
    const height = Math.abs(y - marqueeState.startY);
    if (width + height > 4) marqueeState.moved = true;
    Object.assign(selectionBox.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    });
  }

  function moveMarquee(event) {
    if (!marqueeState || event.pointerId !== marqueeState.pointerId) return;
    const point = canvasPoint(event.clientX, event.clientY);
    updateMarquee(point.x, point.y);
  }

  function endMarquee(event) {
    if (!marqueeState || event.pointerId !== marqueeState.pointerId) return;
    const state = marqueeState;
    const point = canvasPoint(event.clientX, event.clientY);
    const endX = point.x;
    const endY = point.y;
    updateMarquee(endX, endY);
    selectionBox.hidden = true;
    if (state.moved) {
      const left = Math.min(state.startX, endX);
      const right = Math.max(state.startX, endX);
      const top = Math.min(state.startY, endY);
      const bottom = Math.max(state.startY, endY);
      const hits = project.nodes.filter(node => {
        const card = nodeLayer.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
        if (!card) return false;
        const cardBounds = card.getBoundingClientRect();
        const contentBounds = canvasContent.getBoundingClientRect();
        const cardLeft = (cardBounds.left - contentBounds.left) / zoom;
        const cardTop = (cardBounds.top - contentBounds.top) / zoom;
        const cardRight = (cardBounds.right - contentBounds.left) / zoom;
        const cardBottom = (cardBounds.bottom - contentBounds.top) / zoom;
        return cardRight >= left && cardLeft <= right && cardBottom >= top && cardTop <= bottom;
      });
      selectedNodeIds = state.additive ? state.initialSelection : new Set();
      for (const node of hits) selectedNodeIds.add(node.id);
      if (!selectedNodeIds.has(selectedNodeId)) selectedNodeId = hits.at(-1)?.id ?? [...selectedNodeIds].at(-1) ?? null;
    } else if (!state.additive) {
      selectedNodeIds.clear();
      selectedNodeId = null;
    }
    marqueeState = null;
    render();
  }

  function addNode() {
    const number = project.nodes.length + 1;
    const id = `node-${crypto.randomUUID()}`;
    const center = canvasPoint(
      canvas.getBoundingClientRect().left + canvas.clientWidth / 2,
      canvas.getBoundingClientRect().top + canvas.clientHeight / 2
    );
    const offset = project.nodes.length % 6;
    const node = {
      id,
      speaker: "",
      text: "",
      choices: [],
      x: Math.max(20, Math.round(center.x - 105 + offset * 24)),
      y: Math.max(20, Math.round(center.y - 80 + offset * 24))
    };
    project.nodes.push(node);
    if (!project.startNodeId) project.startNodeId = id;
    selectedNodeId = id;
    selectedNodeIds = new Set([id]);
    render();
    scheduleSave();
    inspector.querySelector("#speaker-input")?.focus();
    showToast(`Node ${number} added`);
  }

  function deleteSelectedNode() {
    deleteSelectedNodes();
  }

  function deleteSelectedNodes() {
    if (!selectedNodeIds.size) return;
    const deletedIds = new Set(selectedNodeIds);
    project.nodes = project.nodes.filter(item => !deletedIds.has(item.id));
    for (const item of project.nodes) {
      item.choices = item.choices.filter(choice => !deletedIds.has(choice.nextNodeId));
    }
    if (deletedIds.has(project.startNodeId)) project.startNodeId = project.nodes[0]?.id ?? "";
    selectedNodeId = project.nodes[0]?.id ?? null;
    selectedNodeIds = new Set(selectedNodeId ? [selectedNodeId] : []);
    render();
    scheduleSave();
    showToast(`${deletedIds.size} ${deletedIds.size === 1 ? "node" : "nodes"} deleted`);
  }

  function copySelectedNodes() {
    nodeClipboard = project.nodes
      .filter(node => selectedNodeIds.has(node.id))
      .map(node => structuredClone(node));
    if (nodeClipboard.length) showToast(`${nodeClipboard.length} ${nodeClipboard.length === 1 ? "node" : "nodes"} copied`);
  }

  function pasteNodes() {
    if (!nodeClipboard.length) return;
    const idMap = new Map(nodeClipboard.map(node => [node.id, `node-${crypto.randomUUID()}`]));
    const pasted = nodeClipboard.map(source => ({
      ...structuredClone(source),
      id: idMap.get(source.id),
      x: source.x + 32,
      y: source.y + 32,
      choices: source.choices.map(choice => ({
        ...choice,
        nextNodeId: idMap.get(choice.nextNodeId) ?? choice.nextNodeId
      }))
    }));
    const existingIds = new Set(project.nodes.map(node => node.id));
    for (const node of pasted) {
      node.choices = node.choices.filter(choice => !choice.nextNodeId || idMap.has(choice.nextNodeId) || existingIds.has(choice.nextNodeId));
    }
    if (!project.startNodeId && pasted.length) project.startNodeId = pasted[0].id;
    project.nodes.push(...pasted);
    selectedNodeIds = new Set(pasted.map(node => node.id));
    selectedNodeId = pasted.at(-1)?.id ?? null;
    render();
    scheduleSave();
    showToast(`${pasted.length} ${pasted.length === 1 ? "node" : "nodes"} pasted`);
  }

  function duplicateSelection() {
    nodeClipboard = project.nodes
      .filter(node => selectedNodeIds.has(node.id))
      .map(node => structuredClone(node));
    pasteNodes();
  }

  function handleKeyboard(event) {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']"))) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "a") {
      event.preventDefault();
      selectedNodeIds = new Set(project.nodes.map(node => node.id));
      selectedNodeId = project.nodes.at(-1)?.id ?? null;
      render();
    } else if (modifier && key === "c") {
      event.preventDefault();
      copySelectedNodes();
    } else if (modifier && key === "x") {
      event.preventDefault();
      copySelectedNodes();
      deleteSelectedNodes();
    } else if (modifier && key === "v") {
      event.preventDefault();
      pasteNodes();
    } else if (modifier && key === "d") {
      event.preventDefault();
      duplicateSelection();
    } else if (key === "delete" || key === "backspace") {
      if (selectedNodeIds.size) {
        event.preventDefault();
        deleteSelectedNodes();
      }
    } else if (key === "escape" && selectedNodeIds.size) {
      selectedNodeIds.clear();
      selectedNodeId = null;
      render();
    }
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2300);
  }

  document.getElementById("add-node-button").addEventListener("click", addNode);
  document.getElementById("empty-add-button").addEventListener("click", addNode);
  deleteButton.addEventListener("click", deleteSelectedNode);
  document.getElementById("delete-selection-button").addEventListener("click", deleteSelectedNodes);
  document.getElementById("duplicate-selection-button").addEventListener("click", duplicateSelection);
  document.getElementById("zoom-out-button").addEventListener("click", () => setZoom(zoom / 1.2));
  document.getElementById("zoom-in-button").addEventListener("click", () => setZoom(zoom * 1.2));
  document.getElementById("zoom-level").addEventListener("click", fitNodesToView);
  canvas.addEventListener("wheel", event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
  }, { passive: false });
  canvas.addEventListener("scroll", () => {
    updateWorldSize();
    renderConnections();
  });
  canvas.addEventListener("pointerdown", startMarquee);
  canvas.addEventListener("pointermove", moveMarquee);
  canvas.addEventListener("pointerup", endMarquee);
  canvas.addEventListener("pointercancel", endMarquee);
  window.addEventListener("keydown", handleKeyboard);
  titleInput.addEventListener("input", () => {
    project.title = titleInput.textContent.trim() || "Untitled conversation";
    preview.textContent = JSON.stringify(exportData(), null, 2);
    scheduleSave();
  });
  titleInput.addEventListener("blur", () => {
    titleInput.textContent = project.title;
  });
  document.getElementById("export-button").addEventListener("click", () => {
    const blob = new Blob([`${JSON.stringify(exportData(), null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dialogue"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("JSON exported");
  });
  document.getElementById("copy-button").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportData(), null, 2));
      showToast("JSON copied to clipboard");
    } catch (error) {
      console.error("Could not copy JSON to the clipboard.", error);
      showToast("Clipboard access is unavailable in this browser.");
    }
  });
  document.getElementById("import-button").addEventListener("click", () => document.getElementById("import-input").click());
  document.getElementById("import-input").addEventListener("change", async event => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const imported = validateProject(JSON.parse(await file.text()));
      project = imported;
      selectedNodeId = project.startNodeId || project.nodes[0]?.id || null;
      selectedNodeIds = new Set(selectedNodeId ? [selectedNodeId] : []);
      render();
      fitNodesToView();
      saveProject();
      showToast("Dialog tree imported");
    } catch (error) {
      console.error("Could not import the dialog tree.", error);
      showToast(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
  document.getElementById("reset-button").addEventListener("click", () => {
    if (!window.confirm("Clear this project and start over? This replaces the locally saved project.")) return;
    project = structuredClone(DEFAULT_PROJECT);
    selectedNodeId = project.startNodeId;
    selectedNodeIds = new Set();
    zoom = 1;
    worldWidth = 0;
    worldHeight = 0;
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
    render();
    saveProject();
    showToast("Project reset");
  });
  window.addEventListener("resize", () => {
    updateWorldSize();
    renderConnections();
  });

  render();
  if (loadError) showToast(loadError);
})();
