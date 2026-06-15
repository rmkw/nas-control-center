const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");

loadEnv();

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const NAS_NAME = process.env.NAS_NAME || "nas.local";
const USER = process.env.VAULT_USER || "usuario";
const PASS = process.env.VAULT_PASS || "change-this-password";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 8) * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const TEXT_LIMIT_BYTES = Number(process.env.TEXT_LIMIT_BYTES || 1024 * 1024);
const TRASH_DIR = ".haze-trash";
const TRASH_MANIFEST = ".manifest.json";
const STORAGES = parseStorages(process.env.STORAGE_ROOTS || "public:./data/public,private:./data/private");
const sessions = new Map();
const loginAttempts = new Map();

async function main() {
  await Promise.all(STORAGES.map(async (storage) => {
    await fsp.mkdir(storage.root, { recursive: true });
    await ensureTrash(storage);
  }));

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(error);
      sendJson(res, error.statusCode || 500, { error: error.publicMessage || "Error interno" });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Haze Vault listo en http://${HOST}:${PORT}`);
    console.log(`NAS: ${NAS_NAME}`);
    for (const storage of STORAGES) console.log(`${storage.name}: ${storage.root}`);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    return sendFile(res, path.join(__dirname, "public", "index.html"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    return serveAsset(res, url.pathname);
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, { nasName: NAS_NAME, online: true });
  }
  if (req.method === "POST" && url.pathname === "/api/login") return login(req, res);
  if (req.method === "POST" && url.pathname === "/api/logout") {
    sessions.delete(getSessionId(req));
    setCookie(res, "vault_session", "", "Max-Age=0; HttpOnly; SameSite=Lax");
    return sendJson(res, 200, { ok: true });
  }

  if (!isAuthed(req)) return sendJson(res, 401, { error: "No autorizado" });

  if (req.method === "GET" && url.pathname === "/api/me") {
    return sendJson(res, 200, { user: USER, nasName: NAS_NAME, online: true });
  }
  if (req.method === "GET" && url.pathname === "/api/storages") return listStorages(res);
  if (req.method === "GET" && url.pathname === "/api/storage-status") return storageStatus(res);
  if (req.method === "GET" && url.pathname === "/api/files") return listFiles(res, url);
  if (req.method === "PUT" && url.pathname === "/api/upload") return uploadFile(req, res, url);
  if (req.method === "GET" && url.pathname === "/api/download") return downloadFile(req, res, url);
  if (req.method === "GET" && url.pathname === "/api/preview") return previewFile(req, res, url);
  if (req.method === "GET" && url.pathname === "/api/details") return detailsFile(res, url);
  if (req.method === "GET" && url.pathname === "/api/text") return getTextFile(res, url);
  if (req.method === "PUT" && url.pathname === "/api/text") return putTextFile(req, res, url);
  if (req.method === "DELETE" && url.pathname === "/api/file") return trashFileUrl(res, url);
  if (req.method === "POST" && url.pathname === "/api/delete-many") return trashMany(req, res);
  if (req.method === "POST" && url.pathname === "/api/trash") return trashFile(req, res);
  if (req.method === "POST" && url.pathname === "/api/trash-many") return trashMany(req, res);
  if (req.method === "GET" && url.pathname === "/api/trash") return listTrash(res, url);
  if (req.method === "POST" && url.pathname === "/api/restore") return restoreTrash(req, res);
  if (req.method === "DELETE" && url.pathname === "/api/trash") return deleteTrash(req, res);
  if (req.method === "POST" && url.pathname === "/api/folder") return createFolder(req, res);
  if (req.method === "POST" && url.pathname === "/api/text-file") return createTextFile(req, res);
  if (req.method === "POST" && url.pathname === "/api/rename") return renameItem(req, res);
  if (req.method === "POST" && url.pathname === "/api/copy") return copyItem(req, res);
  if (req.method === "POST" && url.pathname === "/api/move") return moveItem(req, res);

  sendJson(res, 404, { error: "No encontrado" });
}

async function login(req, res) {
  const ip = clientIp(req);
  if (isLoginLimited(ip)) {
    return sendJson(res, 429, { error: "Demasiados intentos. Espera unos minutos." });
  }
  const body = await readJson(req);
  if (body.user !== USER || body.password !== PASS) {
    recordLoginFailure(ip);
    return sendJson(res, 401, { error: "Usuario o contrasena incorrectos" });
  }
  loginAttempts.delete(ip);
  const id = crypto.randomBytes(32).toString("hex");
  sessions.set(id, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
  setCookie(res, "vault_session", id, `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax`);
  sendJson(res, 200, { ok: true });
}

async function listStorages(res) {
  const storages = await Promise.all(STORAGES.map(async (storage) => {
    let count = 0;
    try {
      count = (await fsp.readdir(storage.root)).filter((name) => !name.startsWith(".")).length;
    } catch {
      count = 0;
    }
    return { id: storage.id, name: storage.name, count };
  }));
  sendJson(res, 200, { nasName: NAS_NAME, storages });
}

async function storageStatus(res) {
  const storages = await Promise.all(STORAGES.map(async (storage) => {
    const status = { id: storage.id, name: storage.name, root: storage.root, exists: false, writable: false, readonly: true };
    try {
      await fsp.access(storage.root, fs.constants.F_OK);
      status.exists = true;
      await fsp.access(storage.root, fs.constants.W_OK);
      status.writable = true;
      status.readonly = false;
    } catch {}
    if (typeof fsp.statfs === "function") {
      try {
        const stat = await fsp.statfs(storage.root);
        status.total = Number(stat.blocks) * Number(stat.bsize);
        status.free = Number(stat.bavail) * Number(stat.bsize);
      } catch {}
    }
    return status;
  }));
  sendJson(res, 200, { nasName: NAS_NAME, storages });
}

async function listFiles(res, url) {
  const { storage, rel } = resolveRequestPath(url);
  const entries = await fsp.readdir(rel.fullPath, { withFileTypes: true });
  const items = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== TRASH_DIR)
    .map(async (entry) => fileInfo(storage, rel.relative, entry.name, path.join(rel.fullPath, entry.name), entry)));

  sendJson(res, 200, {
    nasName: NAS_NAME,
    storage: { id: storage.id, name: storage.name },
    path: rel.relative,
    parent: parentRel(rel.relative),
    items: sortItems(items, "name")
  });
}

async function uploadFile(req, res, url) {
  const storage = getStorage(url.searchParams.get("storage"));
  const folder = sanitizeRel(url.searchParams.get("path") || "");
  const rawName = url.searchParams.get("name") || req.headers["x-file-name"] || "archivo";
  const fileName = sanitizeName(String(rawName));
  const targetDir = resolveInside(storage.root, folder);
  const targetPath = await availablePath(resolveInside(targetDir, fileName));
  await fsp.mkdir(targetDir, { recursive: true });
  await pipeline(req, fs.createWriteStream(targetPath, { flags: "w" }));
  sendJson(res, 200, { ok: true, name: path.basename(targetPath) });
}

async function downloadFile(req, res, url) {
  const { rel } = resolveRequestPath(url);
  const stat = await fsp.stat(rel.fullPath);
  if (!stat.isFile()) return sendJson(res, 400, { error: "No es archivo" });
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": stat.size,
    "Content-Disposition": `attachment; filename="${encodeURIComponent(path.basename(rel.fullPath))}"`
  });
  fs.createReadStream(rel.fullPath).pipe(res);
}

async function previewFile(req, res, url) {
  const { rel } = resolveRequestPath(url);
  const stat = await fsp.stat(rel.fullPath);
  if (!stat.isFile()) return sendJson(res, 400, { error: "No es archivo" });
  const ext = path.extname(rel.fullPath).toLowerCase();
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime"
  };
  if (!types[ext]) return sendJson(res, 415, { error: "Sin vista previa" });
  res.writeHead(200, {
    "Content-Type": types[ext],
    "Content-Length": stat.size,
    "Cache-Control": "private, max-age=60"
  });
  fs.createReadStream(rel.fullPath).pipe(res);
}

async function detailsFile(res, url) {
  const { storage, rel } = resolveRequestPath(url);
  const info = await detailInfo(storage, rel.relative, rel.fullPath);
  sendJson(res, 200, { item: info });
}

async function getTextFile(res, url) {
  const { rel } = resolveRequestPath(url);
  const stat = await fsp.stat(rel.fullPath);
  if (!stat.isFile()) return sendJson(res, 400, { error: "No es archivo" });
  if (stat.size > TEXT_LIMIT_BYTES) return sendJson(res, 413, { error: "Archivo demasiado grande para editar" });
  const content = await fsp.readFile(rel.fullPath, "utf8");
  sendJson(res, 200, { content });
}

async function putTextFile(req, res, url) {
  const { rel } = resolveRequestPath(url);
  const body = await readJson(req, TEXT_LIMIT_BYTES + 4096);
  const stat = await fsp.stat(rel.fullPath);
  if (!stat.isFile()) return sendJson(res, 400, { error: "No es archivo" });
  await fsp.writeFile(rel.fullPath, String(body.content || ""), "utf8");
  sendJson(res, 200, { ok: true });
}

async function trashFileUrl(res, url) {
  const { storage, rel } = resolveRequestPath(url);
  const trashed = await moveToTrash(storage, rel.relative);
  sendJson(res, 200, { ok: true, trashed });
}

async function trashFile(req, res) {
  const body = await readJson(req);
  const storage = getStorage(body.storage);
  const trashed = await moveToTrash(storage, body.path || "");
  sendJson(res, 200, { ok: true, trashed });
}

async function trashMany(req, res) {
  const body = await readJson(req);
  const storage = getStorage(body.storage);
  const paths = Array.isArray(body.paths) ? body.paths : [];
  const trashed = [];
  for (const itemPath of paths) {
    const moved = await moveToTrash(storage, itemPath).catch(() => null);
    if (moved) trashed.push(moved);
  }
  sendJson(res, 200, { ok: true, count: trashed.length, trashed });
}

async function listTrash(res, url) {
  const storage = getStorage(url.searchParams.get("storage"));
  await ensureTrash(storage);
  const manifest = await readTrashManifest(storage);
  const items = [];
  for (const [trashPath, meta] of Object.entries(manifest.items || {})) {
    const fullPath = trashPathToFull(storage, trashPath);
    const stat = await fsp.stat(fullPath).catch(() => null);
    if (!stat) continue;
    items.push({
      name: path.basename(trashPath),
      path: trashPath,
      originalPath: meta.originalPath || "",
      deletedAt: meta.deletedAt || "",
      type: stat.isDirectory() ? "folder" : "file",
      kind: classifyName(path.basename(trashPath), stat.isDirectory()),
      size: stat.size,
      modified: stat.mtime.toISOString()
    });
  }
  items.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  sendJson(res, 200, { storage: { id: storage.id, name: storage.name }, items });
}

async function restoreTrash(req, res) {
  const body = await readJson(req);
  const storage = getStorage(body.storage);
  const trashPath = sanitizeTrashRel(body.path || "");
  const source = trashPathToFull(storage, trashPath);
  const manifest = await readTrashManifest(storage);
  const meta = manifest.items[trashPath] || {};
  const original = sanitizeRel(meta.originalPath || path.basename(trashPath));
  const target = await availablePath(resolveInside(storage.root, original));
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rename(source, target);
  delete manifest.items[trashPath];
  await writeTrashManifest(storage, manifest);
  sendJson(res, 200, { ok: true, path: path.relative(storage.root, target).split(path.sep).join("/") });
}

async function deleteTrash(req, res) {
  const body = await readJson(req);
  const storage = getStorage(body.storage);
  const manifest = await readTrashManifest(storage);
  const paths = Array.isArray(body.paths) ? body.paths : [body.path].filter(Boolean);
  let count = 0;
  for (const itemPath of paths) {
    const trashPath = sanitizeTrashRel(itemPath);
    const target = trashPathToFull(storage, trashPath);
    const stat = await fsp.stat(target).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) await fsp.rm(target, { recursive: true, force: true });
    else await fsp.unlink(target);
    delete manifest.items[trashPath];
    count++;
  }
  await writeTrashManifest(storage, manifest);
  sendJson(res, 200, { ok: true, count });
}

async function createFolder(req, res) {
  const body = await readJson(req);
  const storage = getStorage(body.storage);
  const name = sanitizeName(body.name || "");
  if (!name) return sendJson(res, 400, { error: "Nombre invalido" });
  const target = await availablePath(resolveInside(resolveInside(storage.root, sanitizeRel(body.path || "")), name));
  await fsp.mkdir(target, { recursive: false });
  sendJson(res, 200, { ok: true, name: path.basename(target) });
}

async function createTextFile(req, res) {
  const body = await readJson(req);
  const storage = getStorage(body.storage);
  const name = ensureTxt(sanitizeName(body.name || ""));
  if (!name) return sendJson(res, 400, { error: "Nombre invalido" });
  const target = await availablePath(resolveInside(resolveInside(storage.root, sanitizeRel(body.path || "")), name));
  await fsp.writeFile(target, body.content || "", { flag: "wx" });
  sendJson(res, 200, { ok: true, name: path.basename(target) });
}

async function renameItem(req, res) {
  const body = await readJson(req);
  const storage = getStorage(body.storage);
  const source = resolveInside(storage.root, sanitizeRel(body.path || ""));
  const name = sanitizeName(body.name || "");
  if (!name) return sendJson(res, 400, { error: "Nombre invalido" });
  let target = resolveInside(path.dirname(source), name);
  if (target !== source) target = await availablePath(target);
  await fsp.rename(source, target);
  sendJson(res, 200, { ok: true, name: path.basename(target) });
}

async function copyItem(req, res) {
  const body = await readJson(req);
  const sourceStorage = getStorage(body.sourceStorage);
  const targetStorage = getStorage(body.targetStorage);
  if (Array.isArray(body.sourcePaths)) {
    const targetDir = resolveInside(targetStorage.root, sanitizeRel(body.targetPath || ""));
    for (const sourcePath of body.sourcePaths) {
      const source = resolveInside(sourceStorage.root, sanitizeRel(sourcePath || ""));
      const target = await availablePath(resolveInside(targetDir, path.basename(source)));
      ensureNotInsideSelf(source, target);
      await copyRecursive(source, target);
    }
    return sendJson(res, 200, { ok: true, count: body.sourcePaths.length });
  }
  const source = resolveInside(sourceStorage.root, sanitizeRel(body.sourcePath || ""));
  const target = await availablePath(resolveInside(resolveInside(targetStorage.root, sanitizeRel(body.targetPath || "")), path.basename(source)));
  ensureNotInsideSelf(source, target);
  await copyRecursive(source, target);
  sendJson(res, 200, { ok: true });
}

async function moveItem(req, res) {
  const body = await readJson(req);
  const sourceStorage = getStorage(body.sourceStorage);
  const targetStorage = getStorage(body.targetStorage);
  const source = resolveInside(sourceStorage.root, sanitizeRel(body.sourcePath || ""));
  const target = await availablePath(resolveInside(resolveInside(targetStorage.root, sanitizeRel(body.targetPath || "")), path.basename(source)));
  ensureNotInsideSelf(source, target);
  await fsp.rename(source, target).catch(async (error) => {
    if (error.code !== "EXDEV") throw error;
    await copyRecursive(source, target);
    await fsp.rm(source, { recursive: true, force: true });
  });
  sendJson(res, 200, { ok: true });
}

function resolveRequestPath(url) {
  const storage = getStorage(url.searchParams.get("storage"));
  const relative = sanitizeRel(url.searchParams.get("path") || "");
  return { storage, rel: { relative, fullPath: resolveInside(storage.root, relative) } };
}

function parseStorages(value) {
  return value.split(",").map((entry, index) => {
    const separator = entry.indexOf(":");
    const name = separator === -1 ? `Almacenamiento ${index + 1}` : entry.slice(0, separator).trim();
    const root = separator === -1 ? entry.trim() : entry.slice(separator + 1).trim();
    const id = slugify(name || `storage-${index + 1}`);
    return { id, name: name || id, root: path.resolve(root || "./data") };
  }).filter((storage) => storage.root);
}

function getStorage(id) {
  const storage = STORAGES.find((item) => item.id === id) || STORAGES[0];
  if (!storage) throw publicError(400, "No hay almacenamientos configurados");
  return storage;
}

async function fileInfo(storage, base, name, fullPath, dirent) {
  const stat = await fsp.stat(fullPath);
  const relPath = joinRel(base, name);
  return {
    name,
    path: relPath,
    type: dirent.isDirectory() ? "folder" : "file",
    kind: classifyName(name, dirent.isDirectory()),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    storage: storage.id
  };
}

async function detailInfo(storage, relative, fullPath) {
  const stat = await fsp.stat(fullPath);
  const name = path.basename(fullPath);
  return {
    name,
    path: relative,
    storage: { id: storage.id, name: storage.name },
    type: stat.isDirectory() ? "folder" : "file",
    kind: classifyName(name, stat.isDirectory()),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    created: stat.birthtime.toISOString(),
    readonly: !await canWrite(fullPath)
  };
}

function sortItems(items, key) {
  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (key === "date") return new Date(b.modified) - new Date(a.modified);
    if (key === "size") return b.size - a.size;
    if (key === "type") return a.kind.localeCompare(b.kind, "es", { sensitivity: "base" });
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });
}

function classifyName(name, folder) {
  if (folder) return "folder";
  if (isImage(name)) return "image";
  if (isVideo(name)) return "video";
  if (isDocument(name)) return "document";
  if (isText(name)) return "text";
  return "file";
}

async function moveToTrash(storage, rawPath) {
  await ensureTrash(storage);
  const relative = sanitizeRel(rawPath);
  if (!relative) throw publicError(400, "Ruta invalida");
  const source = resolveInside(storage.root, relative);
  const stat = await fsp.stat(source);
  const today = new Date().toISOString().slice(0, 10);
  const trashDayDir = path.join(trashRoot(storage), today);
  await fsp.mkdir(trashDayDir, { recursive: true });
  const target = await availablePath(path.join(trashDayDir, path.basename(source)));
  await fsp.rename(source, target).catch(async (error) => {
    if (error.code !== "EXDEV") throw error;
    if (stat.isDirectory()) await copyRecursive(source, target);
    else await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    await fsp.rm(source, { recursive: true, force: true });
  });
  const trashPath = path.relative(trashRoot(storage), target).split(path.sep).join("/");
  const manifest = await readTrashManifest(storage);
  manifest.items[trashPath] = {
    originalPath: relative,
    deletedAt: new Date().toISOString(),
    name: path.basename(source),
    type: stat.isDirectory() ? "folder" : "file"
  };
  await writeTrashManifest(storage, manifest);
  return { path: trashPath, originalPath: relative };
}

async function ensureTrash(storage) {
  await fsp.mkdir(trashRoot(storage), { recursive: true });
  const manifestPath = path.join(trashRoot(storage), TRASH_MANIFEST);
  if (!await exists(manifestPath)) await writeTrashManifest(storage, { version: 1, items: {} });
}

function trashRoot(storage) {
  return path.join(storage.root, TRASH_DIR);
}

function trashPathToFull(storage, relative) {
  return resolveInside(trashRoot(storage), sanitizeTrashRel(relative));
}

function sanitizeTrashRel(input) {
  return String(input).split("/").map((part) => sanitizeName(part)).filter(Boolean).join("/");
}

async function readTrashManifest(storage) {
  await ensureTrash(storage);
  const manifestPath = path.join(trashRoot(storage), TRASH_MANIFEST);
  try {
    const parsed = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    if (!parsed.items) parsed.items = {};
    return parsed;
  } catch {
    return { version: 1, items: {} };
  }
}

async function writeTrashManifest(storage, manifest) {
  await fsp.mkdir(trashRoot(storage), { recursive: true });
  const manifestPath = path.join(trashRoot(storage), TRASH_MANIFEST);
  await fsp.writeFile(manifestPath, JSON.stringify({ version: 1, items: manifest.items || {} }, null, 2));
}

async function copyRecursive(source, target) {
  const stat = await fsp.stat(source);
  if (stat.isDirectory()) {
    await fsp.mkdir(target, { recursive: false });
    const entries = await fsp.readdir(source);
    for (const entry of entries) await copyRecursive(path.join(source, entry), path.join(target, entry));
  } else {
    await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  }
}

async function availablePath(target) {
  if (!await exists(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let index = 1; index < 10000; index++) {
    const candidate = path.join(dir, `${base} (${index})${ext}`);
    if (!await exists(candidate)) return candidate;
  }
  throw publicError(409, "No se pudo crear un nombre disponible");
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function canWrite(target) {
  try {
    await fsp.access(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizeRel(input) {
  return String(input).split("/").map((part) => sanitizeName(part)).filter(Boolean).join("/");
}

function sanitizeName(input) {
  return String(input).normalize("NFC").replace(/[\\/:*?"<>|]/g, "-").replace(/\0/g, "").trim().slice(0, 180);
}

function ensureTxt(name) {
  if (!name) return "";
  return name.toLowerCase().endsWith(".txt") ? name : `${name}.txt`;
}

function resolveInside(root, relative) {
  const resolved = path.resolve(root, relative || ".");
  const allowed = resolved === root || resolved.startsWith(root + path.sep);
  if (!allowed) throw publicError(400, "Ruta invalida");
  return resolved;
}

function publicError(statusCode, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

function ensureNotInsideSelf(source, target) {
  if (target === source || target.startsWith(source + path.sep)) {
    throw publicError(400, "No puedes pegar una carpeta dentro de si misma");
  }
}

function slugify(value) {
  return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function joinRel(base, name) {
  return [base, name].filter(Boolean).join("/");
}

function parentRel(relative) {
  if (!relative) return "";
  return relative.split("/").slice(0, -1).join("/");
}

function isAuthed(req) {
  const id = getSessionId(req);
  if (!id) return false;
  const session = sessions.get(id);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return false;
  }
  return true;
}

function getSessionId(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|; )vault_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
}

function isLoginLimited(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count++;
}

function setCookie(res, name, value, extra) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; ${extra}`);
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw publicError(413, "Solicitud demasiado grande");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function serveAsset(res, pathname) {
  const name = path.basename(pathname);
  const filePath = path.join(__dirname, "public", name);
  const ext = path.extname(name);
  const types = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: "No encontrado" });
  sendFile(res, filePath, types[ext] || "application/octet-stream");
}

function isImage(name) {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function isVideo(name) {
  return /\.(mp4|m4v|webm|mov)$/i.test(name);
}

function isText(name) {
  return /\.(txt|md|json|log|csv)$/i.test(name);
}

function isDocument(name) {
  return /\.(pdf|docx?|xlsx?|pptx?)$/i.test(name) || isText(name);
}

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

main();
