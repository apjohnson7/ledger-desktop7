const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { openDatabase, getContext, close } = require("./db");
const { userRow } = require("./db/rows");
const { ROLE_NAMES } = require("./db/util");

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
const MAX_LOG_BYTES = 1024 * 1024;

let dbCtx = null;
let mainWindow = null;
let isQuitting = false;
let rendererCrashCount = 0;
let lastRendererCrashAt = 0;

/* ------------------------------ crash logging ------------------------------ */

function logLine(kind, message) {
  try {
    const dir = userDataDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "crash.log");
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) {
        const previous = `${file}.1`;
        try {
          fs.unlinkSync(previous);
        } catch (e) {
          /* ignore */
        }
        fs.renameSync(file, previous);
      }
    } catch (e) {
      /* file does not exist yet */
    }
    fs.appendFileSync(
      file,
      `${new Date().toISOString()} [${kind}] ${String(message).slice(0, 20000)}\n`,
      "utf8"
    );
  } catch (e) {
    console.error(`[${kind}]`, message);
  }
}

process.on("uncaughtException", (error) => {
  logLine("uncaughtException", (error && error.stack) || String(error));
});
process.on("unhandledRejection", (reason) => {
  logLine(
    "unhandledRejection",
    (reason && reason.stack) || String(reason)
  );
});

/* ------------------------------ main sessions ------------------------------ */

/** Sessions live in the main process, keyed by the renderer that signed in.
 *  The renderer can ask who it is, but it can never claim a role or an
 *  identity: `actor` and `userId` on every call are replaced with the
 *  authenticated user below. */
const sessions = new Map();
const loginAttempts = new Map();

const ADMIN_ONLY = ["Administrator"];
const MANAGER_ROLES = ["Administrator", "Manager"];
const WRITER_ROLES = ["Administrator", "Manager", "Loan Officer"];
const FRONT_DESK_ROLES = [
  "Administrator",
  "Manager",
  "Loan Officer",
  "Cashier",
];
const ALL_ROLES = ROLE_NAMES;

const READ_ROLES = {
  usersList: ADMIN_ONLY,
  auditPage: ADMIN_ONLY,
  approvalsPage: ADMIN_ONLY,
};

const MUTATION_ROLES = {
  borrowerCreate: WRITER_ROLES,
  borrowerUpdate: WRITER_ROLES,
  borrowerDelete: ADMIN_ONLY,

  loanCreate: WRITER_ROLES,
  loanUpdate: WRITER_ROLES,
  loanVoid: WRITER_ROLES,
  loanMarkPaid: WRITER_ROLES,
  loanRenew: WRITER_ROLES,
  loanDelete: ADMIN_ONLY,

  paymentCreate: FRONT_DESK_ROLES,
  paymentUpdate: FRONT_DESK_ROLES,
  paymentDelete: ADMIN_ONLY,

  collateralCreate: WRITER_ROLES,
  collateralUpdate: WRITER_ROLES,
  collateralRelease: WRITER_ROLES,
  collateralDelete: ADMIN_ONLY,

  expenseCreate: MANAGER_ROLES,
  expenseUpdate: MANAGER_ROLES,
  expenseDelete: ADMIN_ONLY,

  fundCreate: MANAGER_ROLES,
  fundUpdate: MANAGER_ROLES,
  fundDelete: ADMIN_ONLY,
  fundRepaymentCreate: MANAGER_ROLES,
  fundRepaymentUpdate: MANAGER_ROLES,
  fundRepaymentDelete: ADMIN_ONLY,

  userCreate: ADMIN_ONLY,
  userUpdate: ADMIN_ONLY,
  userSetActive: ADMIN_ONLY,
  userDelete: ADMIN_ONLY,

  // Every signed-in role may change the business-wide display currency; the
  // UI only offers that one setting outside Administrator/Manager.
  settingsUpdate: ALL_ROLES,
  deletionRequest: FRONT_DESK_ROLES,
  deletionApprove: ADMIN_ONLY,
  deletionReject: ADMIN_ONLY,
  auditLog: ADMIN_ONLY,
  // Automatic renewal is a system action triggered when the app opens.
  autoRenew: ALL_ROLES,
};

function getSession(event) {
  const id = event.sender.id;
  const session = sessions.get(id);
  if (!session) return null;
  try {
    const ctx = getContext();
    // The account may have been deactivated, deleted, or changed role while
    // this window stayed open. Re-read it on every call so a revoked account
    // cannot keep working from a stale session object.
    const row = ctx.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(session.user.id);
    if (!row || !row.active) {
      sessions.delete(id);
      return null;
    }
    session.user = userRow(row, false);
    return session;
  } catch (e) {
    return null;
  }
}

function requireSession(event, allowedRoles) {
  const session = getSession(event);
  if (!session) throw new Error("Please sign in again.");
  if (allowedRoles && !allowedRoles.includes(session.user.role)) {
    throw new Error("Your account doesn't have permission to do that.");
  }
  return session;
}

async function handleLogin(event, params) {
  const ctx = getContext();
  const id = event.sender.id;
  const now = Date.now();
  let attempt = loginAttempts.get(id);
  if (!attempt || now - attempt.firstAt > 5 * 60 * 1000) {
    attempt = { count: 0, firstAt: now, blockedUntil: 0 };
    loginAttempts.set(id, attempt);
  }
  if (attempt.blockedUntil > now) {
    return {
      ok: false,
      error: "Too many failed attempts. Please wait a minute and try again.",
    };
  }

  const result = await ctx.auth.login(params);
  if (!result || !result.ok) {
    attempt.count += 1;
    if (attempt.count >= 10) {
      attempt.count = 0;
      attempt.firstAt = now;
      attempt.blockedUntil = now + 60 * 1000;
    }
    return result;
  }

  sessions.set(id, {
    user: result.user,
    signedInAt: now,
    defaultPassword: !!result.defaultPassword,
  });
  loginAttempts.delete(id);
  return result;
}

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

/* ------------------------------- IPC bridge -------------------------------- */

function registerIpc() {
  const ctx = getContext();
  const methods = exposedMethods();
  const mutationMethods = new Set(Object.keys(ctx.mutations));

  ipcMain.handle("ledger:call", async (event, method, rawParams) => {
    // Rebuild the context lazily; getContext() throws if the database was
    // closed while the window still existed.
    getContext();

    if (
      typeof method !== "string" ||
      method.length === 0 ||
      method.length > 80
    ) {
      throw new Error("Unknown ledger method.");
    }
    const params =
      rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)
        ? rawParams
        : {};

    if (method === "auth.login") {
      return handleLogin(event, params);
    }
    if (method === "auth.session") {
      const session = getSession(event);
      return {
        ok: true,
        user: session ? session.user : null,
        defaultPassword: !!(session && session.defaultPassword),
      };
    }
    // The sign-in screen is allowed to read business name and currency before
    // anyone has authenticated. It contains no borrower or user data.
    if (method === "settings") {
      return ctx.queries.settings();
    }

    const session = requireSession(event);
    const sessionName = session.user.fullName || session.user.username;

    const readRoles = READ_ROLES[method];
    if (readRoles && !readRoles.includes(session.user.role)) {
      throw new Error("Your account doesn't have permission to do that.");
    }

    if (MUTATION_ROLES[method]) {
      if (!MUTATION_ROLES[method].includes(session.user.role)) {
        throw new Error("Your account doesn't have permission to do that.");
      }
      if (ctx.backup && ctx.backup.isRestoring()) {
        throw new Error(
          "A backup restore is in progress. Try again in a moment."
        );
      }
    }

    const fn = methods.get(method);
    if (!fn) throw new Error(`Unknown ledger method: ${method}`);

    // Never trust renderer-supplied identity fields.
    const safeParams = { ...params, actor: sessionName };
    if (method === "auth.changePassword") {
      safeParams.userId = session.user.id;
    }
    if (method === "deletionRequest") {
      safeParams.requestedBy = session.user.id;
      safeParams.requestedByName = sessionName;
    }
    // Everyone may switch the display currency, but only managers may change
    // the business name, opening balance, or language.
    if (
      method === "settingsUpdate" &&
      !MANAGER_ROLES.includes(session.user.role)
    ) {
      const requested = params.settings;
      if (!requested || requested.currency == null) {
        throw new Error("Your account doesn't have permission to do that.");
      }
      safeParams.settings = { currency: requested.currency };
    }

    if (method === "auth.logout") {
      try {
        const result = await fn(safeParams);
        return result;
      } finally {
        sessions.delete(event.sender.id);
      }
    }

    const result = await fn(safeParams);
    if (
      method === "auth.changePassword" &&
      result &&
      result.ok &&
      sessions.has(event.sender.id)
    ) {
      sessions.get(event.sender.id).defaultPassword = false;
    }
    if (
      method === "userUpdate" &&
      result &&
      result.ok &&
      safeParams.id === session.user.id &&
      safeParams.password &&
      sessions.has(event.sender.id)
    ) {
      sessions.get(event.sender.id).defaultPassword = false;
    }
    if (
      mutationMethods.has(method) &&
      result &&
      result.ok !== false &&
      ctx.backup
    ) {
      ctx.backup.noteChange();
    }
    return result;
  });

  ipcMain.handle("ledger:backupInfo", (event) => {
    requireSession(event);
    return ctx.backup.info();
  });

  ipcMain.handle("ledger:backupNow", async (event) => {
    requireSession(event, MANAGER_ROLES);
    if (ctx.backup.isRestoring()) {
      throw new Error("A backup restore is in progress. Try again in a moment.");
    }
    const result = await ctx.backup.createAutoBackup("manual");
    return { ok: true, ...result };
  });

  ipcMain.handle("ledger:backupExport", async (event) => {
    requireSession(event, MANAGER_ROLES);
    if (ctx.backup.isRestoring()) {
      throw new Error("A backup restore is in progress. Try again in a moment.");
    }
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

    // Never let a save dialog overwrite the live encrypted database or its
    // key; a mistyped filename there would destroy the ledger.
    const chosen = path.resolve(filePath);
    if (
      chosen === path.resolve(userDataDir(), "ledger.db") ||
      chosen === path.resolve(userDataDir(), "ledger.key")
    ) {
      throw new Error(
        "That location is the live ledger itself. Choose a different file name."
      );
    }

    const result = await ctx.backup.exportToFile(filePath, { reason: "manual" });
    return { ok: true, path: filePath, size: result.size };
  });

  ipcMain.handle("ledger:backupRestore", async (event) => {
    requireSession(event, ADMIN_ONLY);
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

  ipcMain.handle("ledger:openFolder", async (event, which) => {
    // The backups folder must be reachable before sign-in so a damaged
    // database can still be recovered on a machine where no account works.
    const session = getSession(event);
    const target =
      which === "database" && session ? userDataDir() : backupsDir();
    const error = await shell.openPath(target);
    return { ok: !error, error: error || null, path: target };
  });

  ipcMain.handle("ledger:logError", (_event, payload) => {
    try {
      const value =
        payload && typeof payload === "object"
          ? `${String(payload.kind || "renderer")}: ${String(
              payload.message || ""
            ).slice(0, 4000)}\n${String(payload.stack || "").slice(0, 16000)}${
              payload.componentStack
                ? `\nComponent stack:\n${String(payload.componentStack).slice(
                    0,
                    8000
                  )}`
                : ""
            }`
          : String(payload || "").slice(0, 4000);
      logLine("renderer-error", value);
    } catch (e) {
      /* logging must never break the app */
    }
    return { ok: true };
  });
}

/* ---------------------------- startup / recovery ---------------------------- */

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

function openLedger() {
  dbCtx = openDatabase({
    userData: userDataDir(),
    safeStorage,
    onProgress: (counts) =>
      console.log("Legacy ledger import finished:", counts),
  });
  return dbCtx;
}

/** Moves the unreadable database, its WAL files, and its key aside before a
 *  fresh database is created. Nothing is deleted, so a later recovery attempt
 *  can still use the originals. */
function quarantineDatabaseFiles() {
  try {
    if (dbCtx) {
      dbCtx.api.backup.stop();
      close();
      dbCtx = null;
    }
  } catch (e) {
    /* keep going: the files are what matter */
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = userDataDir();
  const moved = [];
  for (const name of [
    "ledger.db",
    "ledger.db-wal",
    "ledger.db-shm",
    "ledger.key",
  ]) {
    const src = path.join(dir, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, `${name}.recovery-${stamp}`);
    fs.renameSync(src, dest);
    moved.push(dest);
  }
  return moved;
}

async function pickBackupFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose a Ledger backup to restore",
    defaultPath: backupsDir(),
    properties: ["openFile"],
    filters: [
      { name: "Ledger backup", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (canceled || !filePaths || !filePaths[0]) return null;
  return filePaths[0];
}

async function openDatabaseWithRecovery() {
  let firstError;
  try {
    openLedger();
    return true;
  } catch (error) {
    firstError = error;
    logLine("database-open-failed", (error && error.stack) || String(error));
  }

  // The database could not be opened. Offer the only safe ways forward:
  // restore a portable JSON backup, inspect the backups folder, or quit.
  while (true) {
    const choice = await dialog.showMessageBox({
      type: "error",
      title: "Ledger could not open its database",
      message: "Ledger could not open its encrypted database.",
      detail:
        `${firstError && firstError.message ? firstError.message : firstError}\n\n` +
        "Your existing files have not been changed or deleted. To continue, restore a JSON backup " +
        "into a fresh database. The unreadable files will be kept beside them with a timestamp.\n\n" +
        `Backups folder:\n${backupsDir()}`,
      buttons: ["Restore from backup…", "Open backups folder", "Quit"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    if (choice.response === 2) return false;
    if (choice.response === 1) {
      await shell.openPath(backupsDir());
      continue;
    }

    let backupFile = await pickBackupFile();
    if (!backupFile) continue;
    if (!fs.existsSync(backupFile)) {
      firstError = new Error("That backup file no longer exists.");
      continue;
    }

    try {
      quarantineDatabaseFiles();
      openLedger();
    } catch (error) {
      firstError = error;
      logLine(
        "database-recovery-open-failed",
        (error && error.stack) || String(error)
      );
      dialog.showErrorBox(
        "Ledger could not create a fresh database",
        `${error && error.message ? error.message : error}\n\nYour files have been left in place.`
      );
      continue;
    }

    // Restore into the fresh database, allowing another file to be chosen if
    // this one turns out to be damaged or incomplete.
    while (true) {
      try {
        await dbCtx.api.backup.restoreFromFile(backupFile);
        logLine("database-restored", backupFile);
        return true;
      } catch (error) {
        logLine(
          "database-recovery-restore-failed",
          (error && error.stack) || String(error)
        );
        const retry = await dialog.showMessageBox({
          type: "error",
          title: "That backup could not be restored",
          message: "The backup could not be restored.",
          detail: `${error && error.message ? error.message : error}\n\nNothing else was changed. You can choose another backup file or quit.`,
          buttons: ["Choose another backup…", "Open backups folder", "Quit"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (retry.response === 2) return false;
        if (retry.response === 1) {
          await shell.openPath(backupsDir());
          continue;
        }
        const next = await pickBackupFile();
        if (next) backupFile = next;
      }
    }
  }
}

/* --------------------------------- windows --------------------------------- */

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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow = win;
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    logLine("renderer-load-failed", `${code} ${description} ${url}`);
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // The app is fully offline: nothing in the window may open another page or
  // a popup. A compromised renderer therefore cannot navigate to remote code.
  win.webContents.setWindowOpenHandler(({ url }) => {
    logLine("blocked-window-open", url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      logLine("blocked-navigation", url);
      event.preventDefault();
    }
  });
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  win.webContents.on("render-process-gone", async (_event, details) => {
    if (isQuitting) return;
    logLine("render-process-gone", JSON.stringify(details));
    const now = Date.now();
    if (now - lastRendererCrashAt < 10 * 1000) rendererCrashCount += 1;
    else rendererCrashCount = 1;
    lastRendererCrashAt = now;

    if (rendererCrashCount > 3) {
      dialog.showErrorBox(
        "Ledger keeps closing",
        "The display process has crashed several times in a row. Details were written to crash.log in the app's data folder."
      );
      app.quit();
      return;
    }

    const { response } = await dialog.showMessageBox(win, {
      type: "error",
      title: "Ledger needs to reload",
      message: "The Ledger window stopped unexpectedly.",
      detail:
        "Your saved data is safe. Reload the window to continue; details were written to crash.log.",
      buttons: ["Reload", "Quit"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) win.reload();
    else app.quit();
  });

  if (!app.isPackaged) {
    // Dev mode: load from the Vite dev server (npm run dev).
    win.loadURL("http://localhost:5173");
  } else {
    // Packaged app: load the built static files, fully offline.
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

/* --------------------------------- lifecycle -------------------------------- */

if (!app.requestSingleInstanceLock()) {
  // A second copy opening the same encrypted database could race with the
  // first one. Send the existing window to the front instead.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.once("destroyed", () => {
      sessions.delete(contents.id);
      loginAttempts.delete(contents.id);
    });
  });

  app.on("child-process-gone", (_event, details) => {
    if (isQuitting) return;
    logLine("child-process-gone", JSON.stringify(details));
  });

  app.whenReady().then(async () => {
    try {
      migrateLegacyBackups();
    } catch (e) {
      logLine("backup-migration-failed", (e && e.stack) || String(e));
    }

    const ready = await openDatabaseWithRecovery();
    if (!ready) {
      app.quit();
      return;
    }

    try {
      registerIpc();
      dbCtx.api.backup.start();
    } catch (error) {
      logLine("startup-failed", (error && error.stack) || String(error));
      dialog.showErrorBox(
        "Ledger could not start",
        `${error && error.message ? error.message : error}\n\n` +
          "Your data has not been changed. Details were written to crash.log."
      );
      app.quit();
      return;
    }

    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    logLine("startup-failed", (error && error.stack) || String(error));
    dialog.showErrorBox(
      "Ledger could not start",
      `${error && error.message ? error.message : error}\n\n` +
        "Your data has not been changed. Details were written to crash.log."
    );
    app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    try {
      if (dbCtx) dbCtx.api.backup.stop();
    } catch (e) {
      /* ignore */
    }
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
}
