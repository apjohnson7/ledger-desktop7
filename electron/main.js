const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");

// ----------------------------------------------------------------------------
// DATA SAFETY
//
// All of the app's data lives in one file inside the user's normal per-app
// data folder (e.g. C:\Users\<name>\AppData\Roaming\Ledger on Windows).
// That folder is completely separate from the installed program files, so a
// fresh installer over an existing install (an "update") does NOT touch it,
// the same way updating any normal Windows app doesn't erase your
// documents. Data only moves if the app's productName/appId in
// package.json changes between builds, since that changes the folder name,
// so keep those the same across versions.
//
// ENCRYPTION AT REST: the file on disk is encrypted using Electron's
// safeStorage, which hands off to the operating system's own secure
// storage (Windows Credential Manager/DPAPI, macOS Keychain, or the
// Linux keyring). This ties the encryption to the current Windows user
// account on this specific computer, so a raw copy of the file will not
// open on a different machine or account, moving to a new computer needs
// the in-app "Download full backup" export instead (Settings page), which
// produces a portable, unencrypted file you can restore anywhere. If
// OS-level encryption isn't available on a given machine (some minimal
// Linux setups without a keyring), the app automatically falls back to
// writing the file in plain JSON rather than failing to start.
//
// On top of that, every time the app starts (and before every save) it
// keeps a small rolling history of backups in a "backups" subfolder, so
// there's always a recent recovery point even if the main file is ever
// corrupted or accidentally cleared.
// ----------------------------------------------------------------------------

const userDataDir = () => app.getPath("userData");
const storeFile = () => path.join(userDataDir(), "ledger-store.dat");
const legacyPlainStoreFile = () => path.join(userDataDir(), "ledger-store.json");
const backupsDir = () => path.join(userDataDir(), "backups");
const MAX_BACKUPS = 20;

function loadStore() {
  const encAvailable = safeStorage.isEncryptionAvailable();

  // Current format: encrypted binary file.
  try {
    if (fs.existsSync(storeFile())) {
      const raw = fs.readFileSync(storeFile());
      const json = encAvailable ? safeStorage.decryptString(raw) : raw.toString("utf-8");
      return JSON.parse(json);
    }
  } catch (e) {
    console.error("Failed to read encrypted store, trying legacy file:", e);
  }

  // Legacy format: plain JSON from before encryption was added. Read it
  // once, then it gets re-saved encrypted on the next write.
  try {
    if (fs.existsSync(legacyPlainStoreFile())) {
      return JSON.parse(fs.readFileSync(legacyPlainStoreFile(), "utf-8"));
    }
  } catch (e) {
    console.error("Failed to read legacy store:", e);
  }

  return {};
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  const json = JSON.stringify(store);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(storeFile(), safeStorage.encryptString(json));
  } else {
    // No OS-level secure storage on this machine - write plain JSON so the
    // app keeps working rather than losing data.
    fs.writeFileSync(storeFile(), json, "utf-8");
  }
  // Once the new encrypted file exists, the old plain-text copy is
  // redundant and would otherwise sit on disk unencrypted forever.
  try {
    if (fs.existsSync(legacyPlainStoreFile())) fs.unlinkSync(legacyPlainStoreFile());
  } catch (e) { /* not critical */ }
}

/** Copies the current store into backups/ with a timestamped filename, then
 *  prunes older backups beyond MAX_BACKUPS. Safe to call often. */
function writeBackup() {
  try {
    if (!fs.existsSync(storeFile())) return;
    fs.mkdirSync(backupsDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(backupsDir(), `ledger-store.${stamp}.bak`);
    fs.copyFileSync(storeFile(), dest);

    const files = fs.readdirSync(backupsDir())
      .filter((f) => f.startsWith("ledger-store."))
      .sort(); // ISO timestamps sort chronologically as strings
    const excess = files.length - MAX_BACKUPS;
    if (excess > 0) {
      files.slice(0, excess).forEach((f) => {
        try { fs.unlinkSync(path.join(backupsDir(), f)); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) {
    // Backups are a safety net, not critical path - never let a backup
    // failure block the app from starting or saving.
    console.error("Backup failed:", e);
  }
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
  writeBackup();
  return { key, value, shared: !!shared };
});

ipcMain.handle("storage:delete", (_event, key, shared) => {
  const store = loadStore();
  const k = scopedKey(key, shared);
  const deleted = k in store;
  delete store[k];
  saveStore(store);
  writeBackup();
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

// Lets the renderer show where backups live and open that folder directly.
ipcMain.handle("storage:backupInfo", () => ({
  storeFile: storeFile(),
  backupsDir: backupsDir(),
}));

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
  // Take a backup on every launch too, so upgrading to a new version (which
  // relaunches the app) always leaves a "before this session" recovery
  // point, on top of the backup taken after every save.
  writeBackup();

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
