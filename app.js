(() => {
  const STORAGE_KEY = "dialogtree.project.v1";
  const DEFAULT_PROJECT = {
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
        ],
        x: 150,
        y: 110
      },
      {
        id: "node-2",
        speaker: "Mara",
        text: "The light went out three nights ago. No one has been able to relight it.",
        choices: [{ text: "I'll take a look.", nextNodeId: "node-3" }],
        x: 490,
        y: 60
      },
      {
        id: "node-3",
        speaker: "Mara",
        text: "Good. The stairs are just through that door. Watch your step.",
        choices: [],
        x: 490,
        y: 290
      }
    ]
  };

  const canvas = document.getElementById("canvas-viewport");
  const nodeLayer = document.getElementById("node-layer");
  const connections = document.getElementById("connections");
  const inspector = document.getElementById("inspector-content");
  const preview = document.getElementById("json-preview");
  const titleInput = document.getElementById("project-title");
  const deleteButton = document.getElementById("delete-node-button");
  let loadError = null;
  let project = loadProject();
  let selectedNodeId = project.startNodeId;
  let toastTimer;
  let dragState = null;
  let saveTimer;

  function loadProject() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? validateProject(JSON.parse(saved)) : structuredClone(DEFAULT_PROJECT);
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
          if (!choice || typeof choice.text !== "string" || typeof choice.nextNodeId !== "string") {
            throw new Error(`Choice ${choiceIndex + 1} in node ${node.id} is invalid.`);
          }
          return { text: choice.text, nextNodeId: choice.nextNodeId };
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
          nextNodeId: choice.nextNodeId
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
    renderNodes();
    renderInspector();
    renderConnections();
    preview.textContent = JSON.stringify(exportData(), null, 2);
    const count = project.nodes.length;
    document.getElementById("node-count").textContent = `${count} ${count === 1 ? "node" : "nodes"}`;
    document.getElementById("empty-canvas").hidden = count !== 0;
    deleteButton.disabled = !getSelectedNode();
  }

  function renderNodes() {
    nodeLayer.replaceChildren();
    project.nodes.forEach((node, index) => {
      const card = document.createElement("article");
      card.className = `node-card${node.id === selectedNodeId ? " selected" : ""}${node.id === project.startNodeId ? " is-start" : ""}`;
      card.dataset.nodeId = node.id;
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
      const choicesMarkup = node.choices.slice(0, 3).map(choice => {
        const target = project.nodes.find(item => item.id === choice.nextNodeId);
        return `<div class="node-option"><i class="option-dot"></i><span class="option-label">${escapeHtml(choice.text || "Untitled choice")}</span><span class="option-target">${target ? `→ ${escapeHtml(target.id)}` : "End"}</span></div>`;
      }).join("");
      const extraChoices = node.choices.length > 3 ? `<div class="node-option"><span class="option-label">+ ${node.choices.length - 3} more</span></div>` : "";
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
        ${node.choices.length ? `<div class="node-options">${choicesMarkup}${extraChoices}</div>` : ""}
        <i class="node-port"></i>`;
      card.addEventListener("pointerdown", startDrag);
      card.addEventListener("click", () => {
        if (!dragState || !dragState.moved) {
          selectedNodeId = node.id;
          render();
        }
      });
      nodeLayer.append(card);
    });
  }

  function renderConnections() {
    const bounds = canvas.getBoundingClientRect();
    connections.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    connections.replaceChildren();
    for (const node of project.nodes) {
      for (const choice of node.choices) {
        const target = project.nodes.find(item => item.id === choice.nextNodeId);
        if (!target) continue;
        const sourceX = node.x + 210;
        const sourceY = node.y + 67;
        const targetX = target.x;
        const targetY = target.y + 22;
        const bend = Math.max(45, Math.abs(targetX - sourceX) * .48);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`);
        path.setAttribute("class", `connection-path${node.id === selectedNodeId ? " active" : ""}`);
        connections.append(path);
      }
    }
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
        <select class="choice-target" aria-label="Next dialogue node">
          <option value="">End conversation</option>
          ${project.nodes.filter(target => target.id !== node.id).map(target =>
            `<option value="${escapeHtml(target.id)}"${choice.nextNodeId === target.id ? " selected" : ""}>${escapeHtml(target.id)} · ${escapeHtml(target.speaker || "Unknown")} — ${escapeHtml(target.text.slice(0, 34))}</option>`
          ).join("")}
        </select>
      </div>`).join("");
    inspector.innerHTML = `
      <label class="field"><span class="field-label">Speaker <span class="field-meta">DISPLAY NAME</span></span>
        <input id="speaker-input" type="text" maxlength="80" value="${escapeHtml(node.speaker)}" placeholder="e.g. Mara"></label>
      <label class="field"><span class="field-label">Dialogue</span>
        <textarea id="dialogue-input" maxlength="2000" placeholder="Write the dialogue for this moment…">${escapeHtml(node.text)}</textarea></label>
      <label class="field"><span class="field-label">Start node</span>
        <select id="start-node-input"><option value="false">No</option><option value="true"${node.id === project.startNodeId ? " selected" : ""}>Yes — conversation begins here</option></select></label>
      <div class="section-title"><span>Responses</span><small>${node.choices.length} / 8</small></div>
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
      node.choices.push({ text: "", nextNodeId: "" });
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
      card.querySelector(".choice-target").addEventListener("change", event => {
        choice.nextNodeId = event.target.value;
        renderNodes();
        renderConnections();
        preview.textContent = JSON.stringify(exportData(), null, 2);
        scheduleSave();
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
    selectedNodeId = node.id;
    dragState = {
      id: node.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      moved: false
    };
    nodeLayer.querySelectorAll(".node-card.selected").forEach(selected => selected.classList.remove("selected"));
    card.classList.add("selected");
    card.setPointerCapture(event.pointerId);
    card.addEventListener("pointermove", moveNode);
    card.addEventListener("pointerup", endDrag, { once: true });
    card.addEventListener("pointercancel", endDrag, { once: true });
  }

  function moveNode(event) {
    if (!dragState) return;
    const dx = event.clientX - dragState.pointerX;
    const dy = event.clientY - dragState.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
    if (!dragState.moved) return;
    const node = project.nodes.find(item => item.id === dragState.id);
    if (!node) return;
    node.x = Math.max(5, dragState.nodeX + dx);
    node.y = Math.max(5, dragState.nodeY + dy);
    const card = nodeLayer.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
    if (card) {
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
    }
    renderConnections();
  }

  function endDrag(event) {
    const card = event.currentTarget;
    card.removeEventListener("pointermove", moveNode);
    if (dragState?.moved) scheduleSave();
    if (dragState) {
      const changedSelection = selectedNodeId !== dragState.id || dragState.moved;
      dragState = null;
      if (changedSelection) render();
    }
  }

  function addNode() {
    const number = project.nodes.length + 1;
    const id = `node-${crypto.randomUUID()}`;
    const rect = canvas.getBoundingClientRect();
    const offset = project.nodes.length % 6;
    const node = {
      id,
      speaker: "",
      text: "",
      choices: [],
      x: Math.max(20, Math.round(rect.width / 2 - 105 + offset * 24)),
      y: Math.max(20, Math.round(rect.height / 2 - 80 + offset * 24))
    };
    project.nodes.push(node);
    if (!project.startNodeId) project.startNodeId = id;
    selectedNodeId = id;
    render();
    scheduleSave();
    inspector.querySelector("#speaker-input")?.focus();
    showToast(`Node ${number} added`);
  }

  function deleteSelectedNode() {
    const node = getSelectedNode();
    if (!node) return;
    project.nodes = project.nodes.filter(item => item.id !== node.id);
    for (const item of project.nodes) {
      item.choices = item.choices.filter(choice => choice.nextNodeId !== node.id);
    }
    if (project.startNodeId === node.id) project.startNodeId = project.nodes[0]?.id ?? "";
    selectedNodeId = project.nodes[0]?.id ?? null;
    render();
    scheduleSave();
    showToast("Dialogue node deleted");
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
      render();
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
    if (!window.confirm("Reset this project to the starter conversation? This replaces the locally saved project.")) return;
    project = structuredClone(DEFAULT_PROJECT);
    selectedNodeId = project.startNodeId;
    render();
    saveProject();
    showToast("Project reset");
  });
  window.addEventListener("resize", renderConnections);

  render();
  if (loadError) showToast(loadError);
})();
