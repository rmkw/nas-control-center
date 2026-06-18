const state = {
  nasName: "nas.local",
  storages: [],
  storage: null,
  path: "",
  items: [],
  trashItems: [],
  view: "files",
  query: "",
  filter: "all",
  sort: "name",
  viewMode: "list",
  clipboard: null,
  selectMode: false,
  selected: new Set(),
  uploadControllers: new Map(),
  currentDetail: null
};

const els = {
  serverPill: document.querySelector("#serverPill"),
  serverName: document.querySelector("#serverName"),
  floatingLogout: document.querySelector("#floatingLogout"),
  loginView: document.querySelector("#loginView"),
  homeView: document.querySelector("#homeView"),
  explorerView: document.querySelector("#explorerView"),
  loginForm: document.querySelector("#loginForm"),
  userInput: document.querySelector("#userInput"),
  passInput: document.querySelector("#passInput"),
  loginError: document.querySelector("#loginError"),
  storageGrid: document.querySelector("#storageGrid"),
  pathCrumbs: document.querySelector("#pathCrumbs"),
  homeButton: document.querySelector("#homeButton"),
  selectButton: document.querySelector("#selectButton"),
  trashViewButton: document.querySelector("#trashViewButton"),
  addButton: document.querySelector("#addButton"),
  addMenu: document.querySelector("#addMenu"),
  fileInput: document.querySelector("#fileInput"),
  storageStatus: document.querySelector("#storageStatus"),
  fileToolbar: document.querySelector("#fileToolbar"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  filterTabs: document.querySelector("#filterTabs"),
  viewModeButton: document.querySelector("#viewModeButton"),
  selectionBar: document.querySelector("#selectionBar"),
  fileList: document.querySelector("#fileList"),
  trashList: document.querySelector("#trashList"),
  uploadList: document.querySelector("#uploadList"),
  clipboardBar: document.querySelector("#clipboardBar"),
  toast: document.querySelector("#toast"),
  textDialog: document.querySelector("#textDialog"),
  textDialogTitle: document.querySelector("#textDialogTitle"),
  nameInput: document.querySelector("#nameInput"),
  contentLabel: document.querySelector("#contentLabel"),
  contentInput: document.querySelector("#contentInput"),
  editTextDialog: document.querySelector("#editTextDialog"),
  editTextTitle: document.querySelector("#editTextTitle"),
  editTextContent: document.querySelector("#editTextContent"),
  deleteDialog: document.querySelector("#deleteDialog"),
  deleteTitle: document.querySelector("#deleteTitle"),
  deleteMessage: document.querySelector("#deleteMessage"),
  deleteConfirmButton: document.querySelector("#deleteConfirmButton"),
  deleteManyDialog: document.querySelector("#deleteManyDialog"),
  deleteManyTitle: document.querySelector("#deleteManyTitle"),
  deleteManyMessage: document.querySelector("#deleteManyMessage"),
  deleteManyConfirmButton: document.querySelector("#deleteManyConfirmButton"),
  previewDialog: document.querySelector("#previewDialog"),
  previewTitle: document.querySelector("#previewTitle"),
  previewBody: document.querySelector("#previewBody"),
  detailsDialog: document.querySelector("#detailsDialog"),
  detailsBody: document.querySelector("#detailsBody"),
  copyPathButton: document.querySelector("#copyPathButton"),
  editTextButton: document.querySelector("#editTextButton")
};

boot();

async function boot() {
  await loadStatus();
  try {
    await api("/api/me");
    await showHome();
  } catch {
    showOnly("login");
  }
}

async function loadStatus() {
  try {
    const status = await api("/api/status");
    state.nasName = status.nasName || state.nasName;
    els.serverPill.classList.remove("offline");
    els.serverName.textContent = state.nasName;
  } catch {
    els.serverPill.classList.add("offline");
    els.serverName.textContent = "offline";
  }
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ user: els.userInput.value.trim(), password: els.passInput.value })
    });
    await showHome();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
});

els.floatingLogout.addEventListener("click", logout);
els.homeButton.addEventListener("click", goBack);
els.selectButton.addEventListener("click", async () => {
  state.selectMode = !state.selectMode;
  state.selected.clear();
  renderCurrent();
});
els.trashViewButton.addEventListener("click", async () => {
  state.view = state.view === "trash" ? "files" : "trash";
  state.selectMode = false;
  state.selected.clear();
  state.clipboard = null;
  await refreshCurrent();
});
els.addButton.addEventListener("click", () => {
  els.addMenu.classList.toggle("hidden");
});
els.addMenu.addEventListener("click", async (event) => {
  const action = event.target.closest("button")?.dataset.create;
  if (!action) return;
  els.addMenu.classList.add("hidden");
  if (action === "folder") return createByDialog("folder");
  if (action === "text") return createByDialog("text");
  if (action === "upload") return els.fileInput.click();
});
els.fileInput.addEventListener("change", async () => {
  await uploadFiles([...els.fileInput.files]);
  els.fileInput.value = "";
});
els.searchInput.addEventListener("input", () => {
  state.query = els.searchInput.value.trim().toLowerCase();
  renderCurrent();
});
els.sortSelect.addEventListener("change", () => {
  state.sort = els.sortSelect.value;
  renderCurrent();
});
els.viewModeButton.addEventListener("click", () => {
  state.viewMode = state.viewMode === "list" ? "grid" : "list";
  renderCurrent();
});
els.filterTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  renderFilterTabs();
  renderCurrent();
});
els.copyPathButton.addEventListener("click", async (event) => {
  event.preventDefault();
  if (!state.currentDetail) return;
  await navigator.clipboard?.writeText(state.currentDetail.path || state.currentDetail.name).catch(() => {});
  toast("Ruta copiada");
});
els.editTextButton.addEventListener("click", async (event) => {
  event.preventDefault();
  if (!state.currentDetail) return;
  els.detailsDialog.close();
  await editText(state.currentDetail);
});

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  state.storage = null;
  state.path = "";
  state.clipboard = null;
  showOnly("login");
}

async function showHome() {
  const data = await api("/api/storages");
  state.nasName = data.nasName || state.nasName;
  els.serverName.textContent = state.nasName;
  state.storages = data.storages || [];
  state.storage = null;
  state.path = "";
  state.view = "files";
  renderStorages();
  showOnly("home");
}

async function goBack() {
  if (!state.storage) return showHome();
  if (state.view === "trash") {
    state.view = "files";
    await refreshFiles();
    return;
  }
  if (state.path) {
    state.path = parentPath(state.path);
    await refreshFiles();
    return;
  }
  await showHome();
}

function renderStorages() {
  els.storageGrid.innerHTML = "";
  if (state.storages.length === 0) {
    els.storageGrid.innerHTML = `<div class="empty-state">No hay almacenamientos configurados.</div>`;
    return;
  }
  for (const storage of state.storages) {
    const card = document.createElement("button");
    card.className = "storage-card";
    card.innerHTML = `
      <strong></strong>
      <span class="storage-meta">${storage.count} elemento${storage.count === 1 ? "" : "s"}</span>
    `;
    card.querySelector("strong").textContent = storage.name;
    card.addEventListener("click", async () => openStorage(storage));
    els.storageGrid.append(card);
  }
}

async function openStorage(storage, nextPath = "") {
  state.storage = storage;
  state.path = nextPath;
  state.view = "files";
  state.selectMode = false;
  state.selected.clear();
  state.query = "";
  els.searchInput.value = "";
  showOnly("explorer");
  await refreshCurrent();
}

async function refreshCurrent() {
  if (state.view === "trash") return refreshTrash();
  return refreshFiles();
}

async function refreshFiles() {
  const data = await api(`/api/files?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(state.path)}`);
  state.path = data.path || "";
  state.items = data.items || [];
  await renderStorageStatus();
  renderCurrent();
}

async function refreshTrash() {
  const data = await api(`/api/trash?storage=${encodeURIComponent(state.storage.id)}`);
  state.trashItems = data.items || [];
  await renderStorageStatus();
  renderCurrent();
}

async function renderStorageStatus() {
  try {
    const data = await api("/api/storage-status");
    const current = (data.storages || []).find((item) => item.id === state.storage.id);
    if (!current) {
      els.storageStatus.innerHTML = "";
      return;
    }
    const free = typeof current.free === "number" ? `${formatBytes(current.free)} libres` : "no disponible";
    els.storageStatus.innerHTML = `<span>Almacenamiento ${escapeHtml(free)}</span>`;
    els.storageStatus.classList.toggle("readonly", !current.writable);
  } catch {
    els.storageStatus.innerHTML = "";
  }
}

function renderCurrent() {
  renderCrumbs();
  renderBackButton();
  renderFilterTabs();
  renderViewMode();
  renderSelection();
  renderClipboard();
  els.trashViewButton.classList.toggle("active", state.view === "trash");
  els.addButton.classList.toggle("hidden", state.view === "trash");
  els.selectButton.classList.toggle("hidden", state.view === "trash");
  els.fileToolbar.classList.toggle("trash-mode", state.view === "trash");
  els.fileList.classList.toggle("hidden", state.view === "trash");
  els.trashList.classList.toggle("hidden", state.view !== "trash");
  if (state.view === "trash") renderTrash();
  else renderFiles(filteredItems(state.items));
}

function renderBackButton() {
  els.homeButton.title = state.path || state.view === "trash" ? "Atras" : "Almacenamientos";
  els.homeButton.setAttribute("aria-label", els.homeButton.title);
}

function renderCrumbs() {
  const parts = state.path ? state.path.split("/") : [];
  els.pathCrumbs.innerHTML = "";
  const root = crumbButton(state.storage.name, "");
  els.pathCrumbs.append(root);
  parts.forEach((part, index) => {
    const separator = document.createElement("span");
    separator.textContent = "/";
    els.pathCrumbs.append(separator);
    els.pathCrumbs.append(crumbButton(part, parts.slice(0, index + 1).join("/")));
  });
  if (state.view === "trash") {
    const separator = document.createElement("span");
    separator.textContent = "/";
    els.pathCrumbs.append(separator);
    const trash = document.createElement("strong");
    trash.textContent = "Papelera";
    els.pathCrumbs.append(trash);
  }
}

function crumbButton(label, targetPath) {
  const button = document.createElement("button");
  button.textContent = label;
  button.addEventListener("click", async () => {
    state.view = "files";
    state.path = targetPath;
    await refreshFiles();
  });
  return button;
}

function filteredItems(items) {
  const query = state.query;
  const filtered = items.filter((item) => {
    const matchesQuery = !query || item.name.toLowerCase().includes(query);
    const matchesDocument = state.filter === "document" && (item.kind === "document" || item.kind === "text");
    const matchesFilter = state.filter === "all" || item.kind === state.filter || item.type === state.filter || matchesDocument;
    return matchesQuery && matchesFilter;
  });
  return sortItems(filtered, state.sort);
}

function renderFilterTabs() {
  for (const button of els.filterTabs.querySelectorAll("button")) {
    if (!button.dataset.filter) continue;
    button.classList.toggle("active", button.dataset.filter === state.filter);
  }
}

function renderViewMode() {
  els.viewModeButton.classList.toggle("active", state.viewMode === "grid");
  els.viewModeButton.title = state.viewMode === "grid" ? "Vista de lista" : "Vista de cuadricula";
  els.viewModeButton.setAttribute("aria-label", els.viewModeButton.title);
  els.viewModeButton.innerHTML = state.viewMode === "grid" ? icons.listView : icons.gridView;
  els.fileList.classList.toggle("grid-view", state.viewMode === "grid");
}

function renderFiles(items) {
  els.fileList.innerHTML = "";
  if (!state.path && !items.length) {
    els.fileList.append(emptyState("Este almacenamiento esta vacio."));
    return;
  }
  if (!state.path && state.items.length && !items.length) {
    els.fileList.append(emptyState("No hay resultados con ese filtro."));
    return;
  }
  for (const item of items) els.fileList.append(makeRow(item));
}

function makeRow(item) {
  const row = document.createElement("article");
  row.className = "file-row";
  row.classList.toggle("grid-item", state.viewMode === "grid");
  row.classList.toggle("selected", state.selected.has(item.path));
  row.classList.toggle("folder-row", item.type === "folder");
  row.innerHTML = `
    <div class="file-icon">${previewMarkup(item)}</div>
    <div>
      <div class="file-name"></div>
      <div class="file-meta">${item.type === "folder" ? "Carpeta" : formatBytes(item.size)} · ${formatDate(item.modified)}</div>
    </div>
    <div class="file-actions"></div>
  `;
  row.querySelector(".file-name").textContent = item.name;
  const actions = row.querySelector(".file-actions");

  if (state.selectMode) {
    row.addEventListener("click", () => toggleSelection(item.path));
    actions.append(actionButton(state.selected.has(item.path) ? icons.checked : icons.unchecked, "Seleccionar", () => toggleSelection(item.path)));
    return row;
  }

  if (item.type === "folder") {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Abrir ${item.name}`);
    row.addEventListener("click", () => openFolder(item));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openFolder(item);
    });
  } else {
    actions.append(actionButton(icons.download, "Descargar", () => {
      location.href = `/api/download?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`;
    }));
    if (item.kind === "image" || item.kind === "video" || isTextPreviewable(item)) {
      actions.append(actionButton(icons.eye, "Vista previa", () => previewItem(item)));
    }
  }

  actions.append(actionButton(icons.info, "Detalles", () => showDetails(item)));
  actions.append(actionButton(icons.rename, "Renombrar", () => renameItem(item)));
  actions.append(actionButton(icons.copy, "Copiar", () => setClipboard(item)));
  actions.append(actionButton(icons.trash, "Enviar a papelera", () => confirmTrash(item), "delete-action"));

  return row;
}

async function openFolder(item) {
  state.path = item.path;
  await refreshFiles();
}

function previewMarkup(item) {
  if (item.type === "folder") return icons.folder;
  if (item.kind === "image") {
    const src = `/api/preview?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`;
    return `<img class="thumb" src="${src}" alt="">`;
  }
  if (item.kind === "video") {
    const src = `/api/preview?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`;
    return `<video class="thumb video-thumb" src="${src}#t=0.1" muted preload="metadata" playsinline></video>`;
  }
  if (item.kind === "document" || item.kind === "text") return icons.document;
  return icons.file;
}

function renderTrash() {
  els.trashList.innerHTML = "";
  const items = filteredItems(state.trashItems);
  if (!items.length) {
    els.trashList.append(emptyState(state.trashItems.length ? "No hay resultados en la papelera." : "La papelera esta vacia."));
    return;
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "file-row trash-row";
    row.innerHTML = `
      <div class="file-icon">${item.type === "folder" ? icons.folder : icons.file}</div>
      <div>
        <div class="file-name"></div>
        <div class="file-meta">Antes: ${escapeHtml(item.originalPath || item.name)} · ${formatDate(item.deletedAt || item.modified)}</div>
      </div>
      <div class="file-actions"></div>
    `;
    row.querySelector(".file-name").textContent = item.name;
    const actions = row.querySelector(".file-actions");
    actions.append(actionButton(icons.restore, "Restaurar", () => restoreTrash(item)));
    actions.append(actionButton(icons.trash, "Borrar definitivamente", () => confirmDeleteTrash(item), "delete-action"));
    els.trashList.append(row);
  }
}

function renderSelection() {
  els.selectButton.classList.toggle("active", state.selectMode);
  if (!state.selectMode || state.view === "trash") {
    els.selectionBar.classList.add("hidden");
    els.selectionBar.innerHTML = "";
    return;
  }
  const visible = filteredItems(state.items);
  const count = state.selected.size;
  els.selectionBar.classList.remove("hidden");
  els.selectionBar.innerHTML = `
    <span>${count} seleccionado${count === 1 ? "" : "s"}</span>
    <div class="file-actions wide-actions">
      <button id="selectAllButton">Seleccionar todo</button>
      <button id="clearSelectionButton" ${count ? "" : "disabled"}>Limpiar</button>
      <button id="copySelectedButton" ${count ? "" : "disabled"}>Copiar</button>
      <button id="trashSelectedButton" ${count ? "" : "disabled"}>Enviar a papelera</button>
      <button id="cancelSelectionButton">Cancelar</button>
    </div>
  `;
  document.querySelector("#selectAllButton").addEventListener("click", () => {
    for (const item of visible) state.selected.add(item.path);
    renderCurrent();
  });
  document.querySelector("#clearSelectionButton").addEventListener("click", () => {
    state.selected.clear();
    renderCurrent();
  });
  document.querySelector("#cancelSelectionButton").addEventListener("click", () => {
    state.selectMode = false;
    state.selected.clear();
    renderCurrent();
  });
  document.querySelector("#copySelectedButton").addEventListener("click", () => {
    if (!state.selected.size) return;
    state.clipboard = {
      storage: state.storage,
      paths: [...state.selected],
      name: `${state.selected.size} elementos`
    };
    state.selectMode = false;
    state.selected.clear();
    renderCurrent();
  });
  document.querySelector("#trashSelectedButton").addEventListener("click", trashSelected);
}

function toggleSelection(itemPath) {
  if (state.selected.has(itemPath)) state.selected.delete(itemPath);
  else state.selected.add(itemPath);
  renderCurrent();
}

async function trashSelected() {
  if (!state.selected.size) return;
  els.deleteManyTitle.textContent = "Enviar seleccionados a papelera";
  els.deleteManyMessage.textContent = `Se moveran ${state.selected.size} elemento(s) a la papelera. Podras restaurarlos despues.`;
  els.deleteManyConfirmButton.textContent = "Enviar a papelera";
  const result = await waitDialog(els.deleteManyDialog);
  if (result !== "ok") return;
  try {
    await api("/api/trash-many", {
      method: "POST",
      body: JSON.stringify({ storage: state.storage.id, paths: [...state.selected] })
    });
    toast("Seleccion enviada a papelera");
    state.selectMode = false;
    state.selected.clear();
    await refreshFiles();
  } catch (error) {
    toast(error.message);
  }
}

function actionButton(icon, title, handler, className = "") {
  const button = document.createElement("button");
  button.innerHTML = icon;
  button.title = title;
  button.className = className;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler(event);
  });
  return button;
}

async function createByDialog(type) {
  const result = await askName({
    title: type === "folder" ? "Crear carpeta" : "Crear archivo TXT",
    name: type === "folder" ? "Nueva carpeta" : "nuevo.txt",
    content: type === "text"
  });
  if (!result) return;
  if (!result.name) return toast("Escribe un nombre");
  try {
    const endpoint = type === "folder" ? "/api/folder" : "/api/text-file";
    const created = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ storage: state.storage.id, path: state.path, name: result.name, content: result.content || "" })
    });
    toast(`${type === "folder" ? "Carpeta" : "Archivo"} creado: ${created.name || result.name}`);
    await refreshFiles();
  } catch (error) {
    toast(error.message);
  }
}

async function renameItem(item) {
  const result = await askName({ title: "Renombrar", name: item.name, content: false });
  if (!result) return;
  if (!result.name) return toast("Escribe un nombre");
  try {
    const renamed = await api("/api/rename", {
      method: "POST",
      body: JSON.stringify({ storage: state.storage.id, path: item.path, name: result.name })
    });
    toast(`Nombre actualizado: ${renamed.name || result.name}`);
    await refreshFiles();
  } catch (error) {
    toast(error.message);
  }
}

async function confirmTrash(item) {
  els.deleteTitle.textContent = "Enviar a papelera";
  els.deleteMessage.textContent = item.type === "folder"
    ? `Se movera "${item.name}" a la papelera con todo su contenido.`
    : `Se movera "${item.name}" a la papelera.`;
  els.deleteConfirmButton.textContent = "Enviar a papelera";
  const result = await waitDialog(els.deleteDialog);
  if (result !== "ok") return;
  try {
    await api("/api/trash", {
      method: "POST",
      body: JSON.stringify({ storage: state.storage.id, path: item.path })
    });
    toast("Elemento enviado a papelera");
    await refreshFiles();
  } catch (error) {
    toast(error.message);
  }
}

async function restoreTrash(item) {
  try {
    const restored = await api("/api/restore", {
      method: "POST",
      body: JSON.stringify({ storage: state.storage.id, path: item.path })
    });
    toast(`Restaurado: ${restored.path}`);
    await refreshTrash();
  } catch (error) {
    toast(error.message);
  }
}

async function confirmDeleteTrash(item) {
  els.deleteTitle.textContent = "Borrar definitivamente";
  els.deleteMessage.textContent = `Se borrara definitivamente "${item.name}". Esta accion no se puede deshacer.`;
  els.deleteConfirmButton.textContent = "Borrar definitivo";
  const result = await waitDialog(els.deleteDialog);
  if (result !== "ok") return;
  try {
    await api("/api/trash", {
      method: "DELETE",
      body: JSON.stringify({ storage: state.storage.id, path: item.path })
    });
    toast("Elemento borrado definitivamente");
    await refreshTrash();
  } catch (error) {
    toast(error.message);
  }
}

function setClipboard(item) {
  state.clipboard = {
    storage: state.storage,
    path: item.path,
    name: item.name,
    type: item.type
  };
  renderClipboard();
}

function renderClipboard() {
  if (!state.clipboard || state.view === "trash") {
    els.clipboardBar.classList.add("hidden");
    els.clipboardBar.innerHTML = "";
    return;
  }
  els.clipboardBar.classList.remove("hidden");
  els.clipboardBar.innerHTML = `
    <span>Copiar: <strong>${escapeHtml(state.clipboard.name)}</strong></span>
    <div class="file-actions">
      <button id="pasteButton">Pegar aqui</button>
      <button id="cancelClipboardButton">Cancelar</button>
    </div>
  `;
  document.querySelector("#pasteButton").addEventListener("click", pasteClipboard);
  document.querySelector("#cancelClipboardButton").addEventListener("click", () => {
    state.clipboard = null;
    renderClipboard();
  });
}

async function pasteClipboard() {
  const clip = state.clipboard;
  if (!clip) return;
  try {
    await api("/api/copy", {
      method: "POST",
      body: JSON.stringify({
        sourceStorage: clip.storage.id,
        sourcePath: clip.path,
        sourcePaths: clip.paths,
        targetStorage: state.storage.id,
        targetPath: state.path
      })
    });
    state.clipboard = null;
    toast("Copiado aqui");
    await refreshFiles();
  } catch (error) {
    toast(error.message);
  }
}

async function previewItem(item) {
  const src = `/api/preview?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`;
  els.previewTitle.textContent = item.name;
  try {
    if (isTextPreviewable(item)) {
      const data = await api(`/api/text?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`);
      els.previewBody.innerHTML = `<pre class="text-preview"></pre>`;
      els.previewBody.querySelector(".text-preview").textContent = data.content || "";
    } else if (item.kind === "video") {
      els.previewBody.innerHTML = `<video src="${src}" controls playsinline></video>`;
    } else {
      els.previewBody.innerHTML = `<img src="${src}" alt="">`;
    }
    await waitDialog(els.previewDialog);
  } catch (error) {
    toast(error.message);
  } finally {
    els.previewBody.innerHTML = "";
  }
}

function isTextPreviewable(item) {
  return item.kind === "text" || /\.(txt|md|json|log|csv)$/i.test(item.name || "");
}

async function showDetails(item) {
  try {
    const data = await api(`/api/details?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`);
    state.currentDetail = data.item;
    const detail = data.item;
    els.editTextButton.classList.toggle("hidden", detail.kind !== "text");
    els.detailsBody.innerHTML = `
      <dl>
        <dt>Nombre</dt><dd>${escapeHtml(detail.name)}</dd>
        <dt>Tipo</dt><dd>${escapeHtml(detail.kind)}</dd>
        <dt>Tamano</dt><dd>${formatBytes(detail.size)}</dd>
        <dt>Ruta</dt><dd>${escapeHtml(detail.path || "/")}</dd>
        <dt>Almacenamiento</dt><dd>${escapeHtml(detail.storage.name)}</dd>
        <dt>Modificado</dt><dd>${formatDate(detail.modified)}</dd>
        <dt>Permiso</dt><dd>${detail.readonly ? "Solo lectura" : "Escribible"}</dd>
      </dl>
    `;
    await waitDialog(els.detailsDialog);
  } catch (error) {
    toast(error.message);
  }
}

async function editText(item) {
  try {
    const data = await api(`/api/text?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`);
    els.editTextTitle.textContent = `Editar ${item.name}`;
    els.editTextContent.value = data.content || "";
    const result = await waitDialog(els.editTextDialog);
    if (result !== "ok") return;
    await api(`/api/text?storage=${encodeURIComponent(state.storage.id)}&path=${encodeURIComponent(item.path)}`, {
      method: "PUT",
      body: JSON.stringify({ content: els.editTextContent.value })
    });
    toast("Archivo actualizado");
    await refreshFiles();
  } catch (error) {
    toast(error.message);
  }
}

async function uploadFiles(files) {
  if (!files.length) return;
  const totalCard = document.createElement("div");
  totalCard.className = "upload-card total-upload";
  totalCard.innerHTML = `<strong>Subiendo ${files.length} archivo${files.length === 1 ? "" : "s"}</strong><div class="file-meta">0 completados</div><div class="progress-bar"><span></span></div>`;
  els.uploadList.prepend(totalCard);
  let done = 0;
  for (const file of files) {
    try {
      await uploadOne(file);
      done++;
      totalCard.querySelector(".file-meta").textContent = `${done} completado${done === 1 ? "" : "s"}`;
      totalCard.querySelector(".progress-bar span").style.width = `${Math.round((done / files.length) * 100)}%`;
    } catch (error) {
      toast(error.message);
    }
  }
  await refreshFiles();
  setTimeout(() => totalCard.remove(), 1200);
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const card = document.createElement("div");
    const id = cryptoId();
    card.className = "upload-card";
    card.innerHTML = `
      <div class="upload-row">
        <strong></strong>
        <button class="ghost-button" type="button">Cancelar</button>
      </div>
      <div class="file-meta">${formatBytes(file.size)}</div>
      <div class="progress-bar"><span></span></div>
    `;
    card.querySelector("strong").textContent = file.name;
    els.uploadList.prepend(card);
    const bar = card.querySelector(".progress-bar span");
    const xhr = new XMLHttpRequest();
    state.uploadControllers.set(id, xhr);
    card.querySelector("button").addEventListener("click", () => xhr.abort());
    const params = new URLSearchParams({ storage: state.storage.id, path: state.path, name: file.name });
    xhr.open("PUT", `/api/upload?${params.toString()}`);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) bar.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
    });
    xhr.addEventListener("load", () => {
      state.uploadControllers.delete(id);
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText || "{}");
        bar.style.width = "100%";
        card.querySelector(".file-meta").textContent = `Guardado como ${data.name || file.name}`;
        setTimeout(() => card.remove(), 1400);
        resolve();
      } else {
        card.querySelector(".file-meta").textContent = "Error al subir";
        reject(new Error("Error al subir"));
      }
    });
    xhr.addEventListener("abort", () => {
      state.uploadControllers.delete(id);
      card.querySelector(".file-meta").textContent = "Cancelado";
      setTimeout(() => card.remove(), 800);
      reject(new Error("Subida cancelada"));
    });
    xhr.addEventListener("error", () => {
      state.uploadControllers.delete(id);
      reject(new Error("Error de red"));
    });
    xhr.send(file);
  });
}

function askName({ title, name, content }) {
  els.textDialogTitle.textContent = title;
  els.nameInput.value = name;
  els.contentInput.value = "";
  els.contentLabel.classList.toggle("hidden", !content);
  return waitDialog(els.textDialog).then((result) => {
    if (result !== "ok") return null;
    return { name: els.nameInput.value.trim(), content: els.contentInput.value };
  });
}

function waitDialog(dialog) {
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
  });
}

function showOnly(view) {
  els.loginView.classList.toggle("hidden", view !== "login");
  els.homeView.classList.toggle("hidden", view !== "home");
  els.explorerView.classList.toggle("hidden", view !== "explorer");
  els.floatingLogout.classList.toggle("hidden", view === "login");
  els.storageStatus.classList.toggle("hidden", view !== "explorer");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Error");
  return data;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

function emptyState(text) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

function sortItems(items, key) {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (key === "date") return new Date(b.modified || b.deletedAt) - new Date(a.modified || a.deletedAt);
    if (key === "size") return b.size - a.size;
    if (key === "type") return String(a.kind || a.type).localeCompare(String(b.kind || b.type), "es", { sensitivity: "base" });
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes || 0);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function parentPath(value) {
  return value.split("/").slice(0, -1).join("/");
}

function cryptoId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

const icons = {
  storage: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-database" viewBox="0 0 16 16">
  <path d="M4.318 2.687C5.234 2.271 6.536 2 8 2s2.766.27 3.682.687C12.644 3.125 13 3.627 13 4c0 .374-.356.875-1.318 1.313C10.766 5.729 9.464 6 8 6s-2.766-.27-3.682-.687C3.356 4.875 3 4.373 3 4c0-.374.356-.875 1.318-1.313M13 5.698V7c0 .374-.356.875-1.318 1.313C10.766 8.729 9.464 9 8 9s-2.766-.27-3.682-.687C3.356 7.875 3 7.373 3 7V5.698c.271.202.58.378.904.525C4.978 6.711 6.427 7 8 7s3.022-.289 4.096-.777A5 5 0 0 0 13 5.698M14 4c0-1.007-.875-1.755-1.904-2.223C11.022 1.289 9.573 1 8 1s-3.022.289-4.096.777C2.875 2.245 2 2.993 2 4v9c0 1.007.875 1.755 1.904 2.223C4.978 15.71 6.427 16 8 16s3.022-.289 4.096-.777C13.125 14.755 14 14.007 14 13zm-1 4.698V10c0 .374-.356.875-1.318 1.313C10.766 11.729 9.464 12 8 12s-2.766-.27-3.682-.687C3.356 10.875 3 10.373 3 10V8.698c.271.202.58.378.904.525C4.978 9.71 6.427 10 8 10s3.022-.289 4.096-.777A5 5 0 0 0 13 8.698m0 3V13c0 .374-.356.875-1.318 1.313C10.766 14.729 9.464 15 8 15s-2.766-.27-3.682-.687C3.356 13.875 3 13.373 3 13v-1.302c.271.202.58.378.904.525C4.978 12.71 6.427 13 8 13s3.022-.289 4.096-.777c.324-.147.633-.323.904-.525"/>
</svg>`,
  folder: `<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" /></svg>`,
  file: `<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7V3Z" /><path d="M14 3v5h5" /></svg>`,
  document: `<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7V3Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>`,
  video: `<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z" /><path d="m10 9 5 3-5 3z" /></svg>`,
  open: `<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 21h14" /></svg>`,
  rename: `<svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>`,
  copy: `<svg viewBox="0 0 24 24"><path d="M8 8h11v13H8z" /><path d="M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" /></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 15h10l1-15" /></svg>`,
  checked: `<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>`,
  unchecked: `<svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z" /></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></svg>`,
  info: `<svg viewBox="0 0 24 24"><path d="M12 17v-5" /><path d="M12 8h.01" /><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" /></svg>`,
  restore: `<svg viewBox="0 0 24 24"><path d="M3 7v6h6" /><path d="M4 13a8 8 0 1 0 2.3-5.7L3 10" /></svg>`
  ,
  gridView: `<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4z" /><path d="M13 4h7v7h-7z" /><path d="M4 13h7v7H4z" /><path d="M13 13h7v7h-7z" /></svg>`,
  listView: `<svg viewBox="0 0 24 24"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></svg>`
};
