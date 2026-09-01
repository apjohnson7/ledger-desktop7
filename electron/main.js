const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// All of the app's data lives in one JSON file inside the user's normal
// per-app data folder (e.g. C:\Users\<name>\AppData\Roaming\Ledger on
// Windows), so it survives updates and works fully offline.
const storeFile = () => path.join(app.getPath("userData"), "ledger-store.json");

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), "utf-8"));
  } catch (e) {
    return {};
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2), "utf-8");
}

const scopedKey = (key, shared) => `${shared ? "shared" : "personal"}:${key}`;

ipcMain.handle("storage:get", (_event, key, shared) => {
  const store = loadStore();
  const k = scopedKey(key, shared);
  if (!(k in store)) throw new Error(`Key not found: ${key}`);
  return { key, value: store[k], shared: !!shared };
});

ipcMain.handle("storage:set", (_event, key, value, shared) => {
  const store = loadStore();
  store[scopedKey(key, shared)] = value;
  saveStore(store);
  return { key, value, shared: !!shared };
});

ipcMain.handle("storage:delete", (_event, key, shared) => {
  const store = loadStore();
  const k = scopedKey(key, shared);
  const deleted = k in store;
  delete store[k];
  saveStore(store);
  return { key, deleted, shared: !!shared };
});

ipcMain.handle("storage:list", (_event, prefix, shared) => {
  const store = loadStore();
  const scopePrefix = `${shared ? "shared" : "personal"}:`;
  const keys = Object.keys(store)
    .filter((k) => k.startsWith(scopePrefix))
    .map((k) => k.slice(scopePrefix.length))
    .filter((k) => !prefix || k.startsWith(prefix));
  return { keys, prefix: prefix || undefined, shared: !!shared };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    // Dev mode: load from the Vite dev server (npm run dev).
    win.loadURL("http://localhost:5173");
  } else {
    // Packaged app: load the built static files, fully offline.
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
