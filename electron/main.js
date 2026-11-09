const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { openDatabase, getContext, close } = require("./db");

// ----------------------------------------------------------------------------
// DATA SAFETY
//
// The live ledger is a SQLCipher-encrypted SQLite database in the user's
// normal per-app data folder (e.g. C:\Users\<name>\AppData\Roaming\Ledger on
// Windows), separate from the installed program files. Updating the app never
// touches that folder. The database key is kept in ledger.key, encrypted with
// Electron's safeStorage (Windows DPAPI, macOS Keychain, or the Linux keyring)
// when the operating system supports it.
//
// BACKUPS: automatic recovery points are readable JSON files in backups/.
// They contain everything (borrowers, loans, payments, users, settings, ...)
// and can be restored on any machine from Settings > Restore from backup file.
// The old single-file store (ledger-store.dat / ledger-store.json) is imported
// once on first launch and then deliberately left in place as extra safety.
// ----------------------------------------------------------------------------

const userDataDir = () => app.getPath("userData");
const backupsDir = () => path.join(userDataDir(), "backups");

/** Converts older encrypted .bak backups into readable .json files. */
function migrateLegacyBackups() {
  try {
    const dir = backupsDir();
    if (!fs.existsSync(dir)) return;
    const legacyFiles = fs
      .readdirSync(dir)
      .filter((f) => /^ledger-store\..+\.bak$/.test(f));

    for (const name of legacyFiles) {
      const src = path.join(dir, name);
      const dest = path.join(dir, name.replace(/\.bak$/, ".json"));
      try {
        if (!fs.existsSync(dest)) {
          const raw = fs.readFileSync(src);
          let store = null;
          if (safeStorage && safeStorage.isEncryptionAvailable()) {
            try {
              store = JSON.parse(safeStorage.decryptString(raw));
            } catch (e) {
              store = null;
            }
          }
          if (!store) store = JSON.parse(raw.toString("utf8"));
          fs.writeFileSync(dest, JSON.stringify(store, null, 2), "utf-8");
        }
        fs.unlinkSync(src);
      } catch (e) {
        console.error(`Could not convert backup ${name} to JSON:`, e);
      }
    }
  } catch (e) {
    console.error("Backup migration failed:", e);
  }
}

let dbCtx = null;

/** Only query and mutation functions (plus auth) may be invoked from the
 *  renderer. Bookkeeping helpers such as backup.stop are never exposed. */
function exposedMethods() {
  const ctx = getContext();
  const map = new Map();
  for (const name of Object.keys(ctx.queries)) {
    map.set(name, (...args) => ctx.queries[name](...args));
  }
  for (const name of Object.keys(ctx.mutations)) {
    map.set(name, (...args) => ctx.mutations[name](...args));
  }
  for (const name of ["login", "logout", "changePassword"]) {
    map.set(`auth.${name}`, (...args) => ctx.auth[name](...args));
  }
  return map;
}

function registerIpc() {
  const ctx = getContext();
  const methods = exposedMethods();
  const readOnly = new Set(Object.keys(ctx.queries));

  ipcMain.handle("ledger:call", async (_event, method, params) => {
    // Rebuild the map lazily from the live context; getContext() throws if the
    // database was closed while the window still existed.
    getContext();
    const fn = methods.get(String(method));
    if (!fn) throw new Error(`Unknown ledger method: ${method}`);
    const result = await fn(params || {});
    if (!readOnly.has(String(method)) && ctx.backup) {
      ctx.backup.noteChange();
    }
    return result;
  });

  ipcMain.handle("ledger:backupInfo", () => ctx.backup.info());

  ipcMain.handle("ledger:backupNow", async () => {
    const result = await ctx.backup.createAutoBackup("manual");
    return { ok: true, ...result };
  });

  ipcMain.handle("ledger:backupExport", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save a full Ledger backup",
      defaultPath: path.join(
        app.getPath("documents"),
        `ledger-backup-${stamp}.json`
      ),
      filters: [{ name: "Ledger backup", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const result = await ctx.backup.exportToFile(filePath, { reason: "manual" });
    return { ok: true, path: filePath, size: result.size };
  });

  ipcMain.handle("ledger:backupRestore", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Restore Ledger from a backup",
      properties: ["openFile"],
      filters: [
        { name: "Ledger backup", extensions: ["json"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (canceled || !filePaths || !filePaths[0]) {
      return { ok: false, canceled: true };
    }
    const result = await ctx.backup.restoreFromFile(filePaths[0]);
    return { ok: true, path: filePaths[0], counts: result.counts || {} };
  });

  ipcMain.handle("ledger:openFolder", async (_event, which) => {
    const target = which === "database" ? userDataDir() : ctx.backupsDir;
    const error = await shell.openPath(target);
    return { ok: !error, error: error || null, path: target };
  });
}

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
  try {
    migrateLegacyBackups();
    dbCtx = openDatabase({
      userData: userDataDir(),
      safeStorage,
      onProgress: (counts) =>
        console.log("Legacy ledger import finished:", counts),
    });
    registerIpc();
    dbCtx.api.backup.start();
  } catch (error) {
    console.error("Could not open the ledger database:", error);
    dialog.showErrorBox(
      "Ledger could not start",
      `${error && error.message ? error.message : error}\n\n` +
        "Your data has not been changed. If the database is damaged, restore a JSON backup from the app's backups folder:\n" +
        backupsDir()
    );
    app.quit();
    return;
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  try {
    if (dbCtx) {
      dbCtx.api.backup.stop();
      close();
    }
  } catch (e) {
    /* ignore */
  }
  dbCtx = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
