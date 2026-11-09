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
const { replaceAllData } = require("./legacy");
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
  userRow,
} = require("./rows");
const { getSettings } = require("./util");

const MAX_BACKUPS = 20;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB for the whole folder
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
  ["users", "users", "username COLLATE NOCASE ASC", userRow],
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

const COMPACT = {
  loans: compactLoan,
  payments: compactPayment,
  collateral: compactCollateral,
  externalFunds: compactFund,
  fundRepayments: compactFundRepayment,
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

    const settings = getSettings(db);
    let buffer = "";
    const flush = async (force) => {
      if (buffer.length >= 1024 * 1024 || (force && buffer.length)) {
        const chunk = buffer;
        buffer = "";
        await write(chunk);
      }
    };

    try {
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
        const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).iterate();
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

  async function createAutoBackup(reason = "automatic") {
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

  function info() {
    const last = db
      .prepare("SELECT value FROM meta WHERE key = 'lastBackupAt'")
      .get();
    return {
      database: ctx.dbFile,
      keyFile: ctx.keyFile,
      backupsDir,
      lastBackupAt: last ? last.value : null,
      maxBackups: MAX_BACKUPS,
      maxBytes: MAX_BACKUP_BYTES,
      files: backupFiles(backupsDir),
    };
  }

  async function backupNow(reason = "manual") {
    return createAutoBackup(reason);
  }

  /** Restores a JSON backup. The file can be one of this app's snapshots, a
   *  full backup exported by an older version, or the old encrypted store
   *  contents exported to JSON. Existing data is replaced atomically. */
  async function restoreFromFile(file) {
    const raw = fs.readFileSync(file);
    let parsed;
    const text = raw.toString("utf8");
    try {
      parsed = JSON.parse(text);
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
    } else if (parsed && parsed["personal:ledger-data-v1"] && typeof parsed["personal:ledger-data-v1"] === "object") {
      data = parsed["personal:ledger-data-v1"];
    } else if (
      parsed &&
      parsed.data &&
      typeof parsed.data === "object" &&
      (Array.isArray(parsed.data.borrowers) || Array.isArray(parsed.data.loans))
    ) {
      data = parsed.data;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("That file doesn't look like a Ledger backup.");
    }
    if (
      !Array.isArray(data.borrowers) &&
      !Array.isArray(data.loans) &&
      !Array.isArray(data.payments)
    ) {
      throw new Error("That file doesn't look like a Ledger backup.");
    }

    // Keep a recovery point of the current data before replacing it. Failure
    // to write this safety copy should not block an intentional restore.
    try {
      await createAutoBackup("pre-restore");
    } catch (e) {
      console.error("Could not write pre-restore backup:", e);
    }
    return replaceAllData(ctx, data);
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
    list: () => backupFiles(backupsDir),
  };
}

module.exports = { createBackup };
