const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const PORT = 19000 + Math.floor(Math.random() * 1000);
const HOST = "127.0.0.1";
const USER = "tester";
const PASS = "secret";

let child;

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haze-vault-"));
  const storageRoot = path.join(root, "main");
  await fs.mkdir(storageRoot, { recursive: true });

  child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST,
      NAS_NAME: "test.local",
      VAULT_USER: USER,
      VAULT_PASS: PASS,
      VAULT_PASS_SHA256: "",
      STORAGE_ROOTS: `main:${storageRoot}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  await waitForServer(stderr);
  const base = `http://${HOST}:${PORT}`;
  const cookie = await login(base);

  await assertOk(await api(base, "/api/storages", { cookie }), "list storages");
  await expectReject(() => api(base, "/api/files?storage=main&path=../", { cookie }), "path traversal");

  const firstFolder = await api(base, "/api/folder", {
    cookie,
    method: "POST",
    body: { storage: "main", path: "", name: "Nueva carpeta" }
  });
  const secondFolder = await api(base, "/api/folder", {
    cookie,
    method: "POST",
    body: { storage: "main", path: "", name: "Nueva carpeta" }
  });
  assert(firstFolder.name === "Nueva carpeta", "first duplicate folder name");
  assert(secondFolder.name === "Nueva carpeta (1)", "second duplicate folder name");

  const firstUpload = await upload(base, cookie, "dup.txt", "uno");
  const secondUpload = await upload(base, cookie, "dup.txt", "dos");
  assert(firstUpload.name === "dup.txt", "first duplicate upload name");
  assert(secondUpload.name === "dup (1).txt", "second duplicate upload name");

  const trashed = await api(base, "/api/trash", {
    cookie,
    method: "POST",
    body: { storage: "main", path: "dup.txt" }
  });
  assert(trashed.trashed?.path, "trash returns path");

  const trash = await api(base, "/api/trash?storage=main", { cookie });
  assert(trash.items.some((item) => item.originalPath === "dup.txt"), "trashed file listed");

  const restored = await api(base, "/api/restore", {
    cookie,
    method: "POST",
    body: { storage: "main", path: trashed.trashed.path }
  });
  assert(restored.path, "restore returns path");

  await upload(base, cookie, "range-test.mp4", Buffer.alloc(4096, 1));
  const range = await fetch(`${base}/api/preview?storage=main&path=range-test.mp4`, {
    headers: { Cookie: cookie, Range: "bytes=0-99" }
  });
  assert(range.status === 206, "range preview status");
  assert(range.headers.get("content-range") === "bytes 0-99/4096", "range preview header");
  assert((await range.arrayBuffer()).byteLength === 100, "range preview size");

  await cleanup();
  await fs.rm(root, { recursive: true, force: true });
  console.log("Smoke tests passed");
}

async function waitForServer(stderr) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`http://${HOST}:${PORT}/api/status`);
      if (response.ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`Server exited early: ${stderr}`);
    await delay(80);
  }
  throw new Error("Server did not start");
}

async function login(base) {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: USER, password: PASS })
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not return a session cookie");
  return cookie;
}

async function api(base, endpoint, options = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${endpoint} failed: ${response.status} ${data.error || ""}`.trim());
  return data;
}

async function upload(base, cookie, name, content) {
  const response = await fetch(`${base}/api/upload?storage=main&path=&name=${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { Cookie: cookie },
    body: content
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  return data;
}

async function expectReject(fn, label) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${label} should fail`);
}

async function assertOk(value, label) {
  assert(Boolean(value), label);
}

function assert(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
