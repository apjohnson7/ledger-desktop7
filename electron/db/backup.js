"use strict";

/* Readable JSON backups for the SQLite ledger.

   Automatic backups are streamed to disk table by table, so a ledger with a
   million payments never has to be turned into one giant in-memory string.
   The exported file keeps the same top-level shape the app has always used
   (borrowers, loans, payments, ...), which means backups made by older
   versions restore here and backups made here can still be read by older
   versions. */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3-multiple-ciphers");
const { replaceAllData, validateRestoreData } = require("./legacy");
const {
  borrowerRow,
  loanRow,
  paymentRow,
  collateralRow,
  expenseRow,
  fundRow,
  fundRepaymentRow,
  auditRow,
  deletionRow,
} = require("./rows");
const { getSettings } = require("./util");

const MAX_BACKUPS = 20;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB for the whole folder
const MAX_RESTORE_BYTES = 512 * 1024 * 1024; // keep JSON.parse inside safe memory
const AUTO_PREFIX = "ledger-store.";
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 quiet minutes after a change
const MIN_INTERVAL_MS = 30 * 60 * 1000; // at most one automatic backup per 30 min

const SECTIONS = [
  ["borrowers", "borrowers", "id", borrowerRow],
  ["loans", "loans", "issue_date DESC, id", loanRow],
  ["payments", "payments", "date DESC, id", paymentRow],
  ["collateral", "collateral", "date_received DESC, id", collateralRow],
  ["expenses", "expenses", "date DESC, id", expenseRow],
  ["externalFunds", "external_funds", "date_received DESC, id", fundRow],
  ["fundRepayments", "fund_repayments", "date DESC, id", fundRepaymentRow],
  ["auditLog", "audit_log", "timestamp DESC, id", auditRow],
  ["deletionRequests", "deletion_requests", "created_at DESC, id", deletionRow],
  ["users", "users", "username COLLATE NOCASE ASC", backupUser],
];

/* Fields that are derived at read time and are not part of the stored data.
   Leaving them out keeps backup files close to what older versions wrote. */
function compactLoan(row) {
  const value = loanRow(row);
  delete value.paidAmount;
  delete value.principalPaid;
  delete value.interestPaid;
  delete value.paymentCount;
  delete value.nextDueDate;
  delete value.outstanding;
  delete value.outstandingNoInterest;
  delete value.status;
  delete value.borrowerName;
  delete value.borrowerPhone;
  return value;
}

function compactPayment(row) {
  const value = paymentRow(row);
  delete value.borrowerName;
  delete value.loanNumber;
  return value;
}

function compactCollateral(row) {
  const value = collateralRow(row);
  delete value.borrowerName;
  delete value.loanNumber;
  return value;
}

function compactFund(row) {
  const value = fundRow(row);
  delete value.outstanding;
  return value;
}

function compactFundRepayment(row) {
  const value = fundRepaymentRow(row);
  delete value.source;
  delete value.type;
  return value;
}

/* Users are the one table where a readable backup still needs the stored
   PBKDF2 hash and salt: without them a restore creates accounts nobody can
   sign in to. Passwords themselves are never exported. */
function backupUser(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash || "",
    passwordSalt: row.password_salt || "",
    fullName: row.full_name || "",
    role: row.role || "Viewer",
    active: !!row.active,
    createdAt: row.created_at || "",
  };
}

const COMPACT = {
  loans: compactLoan,
  payments: compactPayment,
  collateral: compactCollateral,
  externalFunds: compactFund,
  fundRepayments: compactFundRepayment,
  users: backupUser,
};

const timeStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function backupFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /^ledger-store\..+\.json$/.test(name) || /^ledger-backup-.*\.json$/.test(name))
      .map((name) => {
        const file = path.join(dir, name);
        let stat = null;
        try {
          stat = fs.statSync(file);
        } catch (e) {
          /* raced with prune */
        }
        return stat
          ? { name, path: file, size: stat.size, modifiedAt: stat.mtime.toISOString() }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(b.name).localeCompare(String(a.name)));
  } catch (e) {
    return [];
  }
}

function createBackup(ctx) {
  const { db, backupsDir } = ctx;
  let timer = null;
  let interval = null;
  let writing = null;
  let restoring = false;
  let dirtyAt = 0;
  let lastBackupAt = 0;

  async function exportToFile(dest, { reason } = {}) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const temp = `${dest}.tmp`;
    const out = fs.createWriteStream(temp, { encoding: "utf8" });
    let streamError = null;
    // One permanent listener keeps stream failures from becoming unhandled
    // errors; transient drain waiters are added and removed per chunk.
    out.on("error", (error) => {
      streamError = error;
    });

    const write = (chunk) =>
      new Promise((resolve, reject) => {
        if (streamError) return reject(streamError);
        if (!out.write(chunk)) {
          const onDrain = () => {
            out.off("error", onError);
            if (streamError) reject(streamError);
            else resolve();
          };
          const onError = (error) => {
            out.off("drain", onDrain);
            reject(error);
          };
          out.once("drain", onDrain);
          out.once("error", onError);
        } else {
          resolve();
        }
      });

    // Read every table from a separate read-only connection. A backup made on
    // the same connection as the writes can otherwise catch the ledger halfway
    // through a mutation (for example a loan written before its payment).
    let snapshot = null;
    try {
      snapshot = new Database(ctx.dbFile, {
        readonly: true,
        fileMustExist: true,
      });
      snapshot.pragma(`key='${String(ctx.key).replace(/'/g, "''")}'`);
      snapshot.pragma("busy_timeout = 5000");
      snapshot.pragma("query_only = ON");
      snapshot.exec("BEGIN");

      const settings = getSettings(snapshot);
      let buffer = "";
      const flush = async (force) => {
        if (buffer.length >= 1024 * 1024 || (force && buffer.length)) {
          const chunk = buffer;
          buffer = "";
          await write(chunk);
        }
      };

      const header = {
        format: "ledger-backup",
        formatVersion: 2,
        exportedAt: new Date().toISOString(),
        reason: reason || "manual",
      };
      buffer += "{";
      for (const [key, value] of Object.entries(header)) {
        buffer += `${JSON.stringify(key)}:${JSON.stringify(value)},`;
      }
      buffer += '"settings":' + JSON.stringify(settings);

      for (const [name, table, order, mapper] of SECTIONS) {
        buffer += `,${JSON.stringify(name)}:[`;
        let first = true;
        const rows = snapshot
          .prepare(`SELECT * FROM ${table} ORDER BY ${order}`)
          .iterate();
        for (const row of rows) {
          const value = (COMPACT[name] || mapper)(row);
          buffer += `${first ? "" : ","}${JSON.stringify(value)}`;
          first = false;
          await flush(false);
        }
        buffer += "]";
        await flush(true);
      }

      buffer += "}";
      await flush(true);
      await new Promise((resolve, reject) => {
        if (streamError) return reject(streamError);
        out.once("error", reject);
        out.end(() => (streamError ? reject(streamError) : resolve()));
      });

      // Make sure the bytes are on disk before the file becomes visible.
      const handle = await fs.promises.open(temp, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.promises.rename(temp, dest);
      return { ok: true, path: dest, size: (await fs.promises.stat(dest)).size };
    } catch (error) {
      try {
        out.destroy();
      } catch (e) {
        /* ignore */
      }
      try {
        fs.unlinkSync(temp);
      } catch (e) {
        /* ignore */
      }
      throw error;
    } finally {
      if (snapshot) {
        try {
          snapshot.exec("ROLLBACK");
        } catch (e) {
          /* the read transaction may not have started */
        }
        try {
          snapshot.close();
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  function prune() {
    const files = backupFiles(backupsDir);
    const auto = files.filter((f) => f.name.startsWith(AUTO_PREFIX));
    let total = files.reduce((sum, f) => sum + f.size, 0);
    const excess = auto.length - MAX_BACKUPS;
    const remove = [];
    if (excess > 0) remove.push(...auto.slice(-excess));

    // Automatic backups are the only ones we delete automatically, oldest
    // first, until the folder is back under the size cap. Manual exports live
    // wherever the user saved them, so they are never touched.
    const remaining = auto.filter((f) => !remove.includes(f));
    for (let i = remaining.length - 1; i >= 0 && total > MAX_BACKUP_BYTES; i--) {
      remove.push(remaining[i]);
      total -= remaining[i].size;
    }

    for (const file of remove) {
      try {
        fs.unlinkSync(file.path);
      } catch (e) {
        /* ignore */
      }
    }
  }

  async function createAutoBackup(reason = "automatic", { force = false } = {}) {
    if (restoring && !force) {
      throw new Error("A backup restore is in progress. Try again in a moment.");
    }
    if (writing) return writing;
    writing = (async () => {
      const dest = path.join(backupsDir, `${AUTO_PREFIX}${timeStamp()}.json`);
      const result = await exportToFile(dest, { reason });
      lastBackupAt = Date.now();
      dirtyAt = 0;
      try {
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('lastBackupAt', ?)"
        ).run(new Date().toISOString());
      } catch (e) {
        /* meta is optional */
      }
      prune();
      return result;
    })();
    try {
      return await writing;
    } finally {
      writing = null;
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      if (!dirtyAt) return;
      const wait = MIN_INTERVAL_MS - (Date.now() - lastBackupAt);
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = null;
          schedule();
        }, wait);
        return;
      }
      try {
        await createAutoBackup("automatic");
      } catch (e) {
        console.error("Automatic backup failed:", e);
      }
    }, DEBOUNCE_MS);
    if (timer.unref) timer.unref();
  }

  function noteChange() {
    dirtyAt = Date.now();
    schedule();
  }

  function start() {
    try {
      // Remove half-written files left behind by a previous crash.
      for (const name of fs.readdirSync(backupsDir)) {
        if (!name.endsWith(".tmp")) continue;
        const file = path.join(backupsDir, name);
        try {
          if (Date.now() - fs.statSync(file).mtimeMs > 60 * 60 * 1000) {
            fs.unlinkSync(file);
          }
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      /* ignore */
    }
    try {
      db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('lastBackupAt', ?)"
      ).run(new Date().toISOString());
    } catch (e) {
      /* ignore */
    }
    createAutoBackup("startup").catch((e) =>
      console.error("Startup backup failed:", e)
    );
    if (interval) clearInterval(interval);
    interval = setInterval(() => {
      if (dirtyAt) schedule();
    }, 60 * 60 * 1000);
    if (interval.unref) interval.unref();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    timer = null;
    interval = null;
  }

  function latestAutomatic() {
    return (
      backupFiles(backupsDir).find((file) =>
        file.name.startsWith(AUTO_PREFIX)
      ) || null
    );
  }

  function info() {
    const last = db
      .prepare("SELECT value FROM meta WHERE key = 'lastBackupAt'")
      .get();
    const lastRestore = db
      .prepare("SELECT value FROM meta WHERE key = 'lastRestoreAt'")
      .get();
    return {
      database: ctx.dbFile,
      keyFile: ctx.keyFile,
      backupsDir,
      lastBackupAt: last ? last.value : null,
      lastRestoreAt: lastRestore ? lastRestore.value : null,
      maxBackups: MAX_BACKUPS,
      maxBytes: MAX_BACKUP_BYTES,
      maxRestoreBytes: MAX_RESTORE_BYTES,
      restoring,
      files: backupFiles(backupsDir),
    };
  }

  async function backupNow(reason = "manual") {
    return createAutoBackup(reason);
  }

  /** Restores a JSON backup. The file can be one of this app's snapshots, a
   *  full backup exported by an older version, or the old encrypted store
   *  contents exported to JSON. Existing data is replaced atomically, but
   *  only after a complete safety snapshot has been written successfully. */
  async function restoreFromFile(file) {
    if (restoring) {
      throw new Error("A restore is already in progress.");
    }
    restoring = true;
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) {
        throw new Error("That path is not a backup file.");
      }
      if (stat.size > MAX_RESTORE_BYTES) {
        throw new Error(
          "That backup file is too large to restore safely in this app. Nothing was changed."
        );
      }
      const raw = await fs.promises.readFile(file);
      let parsed;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch (e) {
        throw new Error("That file is not valid JSON, so it can't be restored.");
      }

      let data = parsed;
      if (parsed && typeof parsed["personal:ledger-data-v1"] === "string") {
        try {
          data = JSON.parse(parsed["personal:ledger-data-v1"]);
        } catch (e) {
          throw new Error("That backup contains unreadable ledger data.");
        }
      } else if (
        parsed &&
        parsed["personal:ledger-data-v1"] &&
        typeof parsed["personal:ledger-data-v1"] === "object"
      ) {
        data = parsed["personal:ledger-data-v1"];
      } else if (
        parsed &&
        parsed.data &&
        typeof parsed.data === "object" &&
        (Array.isArray(parsed.data.borrowers) ||
          Array.isArray(parsed.data.loans))
      ) {
        data = parsed.data;
      }

      // A file written by this version declares its format. For those we
      // require every section, so a truncated export can't silently erase
      // tables. Older single-store files only need the core sections.
      const strict = !!(parsed && parsed.format === "ledger-backup");
      validateRestoreData(data, { strict });

      // Never replace live data without a valid recovery point. If the
      // safety backup cannot be written, the restore is cancelled.
      if (writing) await writing;
      await createAutoBackup("pre-restore", { force: true });
      const result = replaceAllData(ctx, data, { strict });
      try {
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('lastRestoreAt', ?)"
        ).run(new Date().toISOString());
      } catch (e) {
        /* meta is optional */
      }
      return { ok: true, ...result };
    } finally {
      restoring = false;
    }
  }

  return {
    exportToFile,
    createAutoBackup,
    backupNow,
    restoreFromFile,
    noteChange,
    start,
    stop,
    info,
    latestAutomatic,
    isRestoring: () => restoring,
    list: () => backupFiles(backupsDir),
    maxRestoreBytes: MAX_RESTORE_BYTES,
  };
}

module.exports = { createBackup };
