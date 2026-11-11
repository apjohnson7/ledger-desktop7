"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3-multiple-ciphers");
const { createSchema } = require("./schema");
const { createQueries } = require("./queries");
const { createMutations } = require("./mutations");
const { createAuth } = require("./auth");
const { createBackup } = require("./backup");
const { importLegacy } = require("./legacy");

let ctx = null;

// Bump this when a change requires the cached loan totals to be rebuilt from
// the payments table (for example after changing how they are computed).
const SCHEMA_VERSION = 2;
const KEY_PATTERN = /^[0-9a-f]{64}$/i;

function readKeyFile(file, safeStorage) {
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    throw new Error(
      "The ledger encryption key file could not be read. Your data has not been changed."
    );
  }
  if (!raw.length) {
    throw new Error(
      "The ledger encryption key file is empty. Your data has not been changed."
    );
  }

  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    try {
      const value = String(safeStorage.decryptString(raw) || "").trim();
      if (KEY_PATTERN.test(value)) return value;
    } catch (e) {
      // The key may have been written before OS encryption became available,
      // so fall through and try the plain form as well.
    }
  }
  const plain = raw.toString("utf8").trim();
  if (KEY_PATTERN.test(plain)) return plain;

  throw new Error(
    "The ledger encryption key file is damaged or belongs to another computer. " +
      "Your data has not been changed. Restore a JSON backup to continue."
  );
}

function writeKeyFile(file, value, safeStorage) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const payload =
    safeStorage && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(value)
      : Buffer.from(value, "utf8");

  // Write to a temporary file and rename it into place so a crash mid-write
  // can never leave a half-written key behind.
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  try {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (e) {
    /* directory fsync is best-effort */
  }
}

function readOrCreateKey(userData, safeStorage) {
  const file = path.join(userData, "ledger.key");
  const dbFile = path.join(userData, "ledger.db");

  const existing = readKeyFile(file, safeStorage);
  if (existing) return existing;

  // Never generate a new key over an existing encrypted database: the old
  // key is the only way to read it, and silently replacing it would make the
  // ledger permanently unreadable.
  let hasDatabase = false;
  try {
    hasDatabase = fs.statSync(dbFile).size > 0;
  } catch (e) {
    hasDatabase = false;
  }
  if (hasDatabase) {
    throw new Error(
      "The ledger database exists but its encryption key file is missing. " +
        "Your data has not been changed. Restore a JSON backup to continue."
    );
  }

  const value = crypto.randomBytes(32).toString("hex");
  writeKeyFile(file, value, safeStorage);
  return value;
}

function seedDefaults(db, auth) {
  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  insertSetting.run("businessName", "My Lending Business");
  insertSetting.run("language", "en");
  insertSetting.run("currency", "UGX");
  insertSetting.run("startingCashBalance", "0");

  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count === 0) {
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare(
      `INSERT INTO users
        (id, username, password_hash, password_salt, full_name, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      `usr_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`,
      "admin",
      auth.hashPassword("admin", salt),
      salt,
      "Administrator",
      "Administrator",
      new Date().toISOString()
    );
  }
}

function openDatabase({ userData, safeStorage, onProgress }) {
  if (ctx) return ctx;

  fs.mkdirSync(userData, { recursive: true });
  const dbFile = path.join(userData, "ledger.db");
  const key = readOrCreateKey(userData, safeStorage);
  const backupsDir = path.join(userData, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  let db = null;
  try {
    db = new Database(dbFile);
    db.pragma(`key='${key.replace(/'/g, "''")}'`);
    try {
      db.prepare("SELECT COUNT(*) AS c FROM sqlite_master").get();
    } catch (e) {
      db.close();
      db = null;
      throw new Error(
        "The ledger database could not be unlocked with this computer's key. " +
          "Restore a JSON backup from the app's backups folder."
      );
    }

    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.pragma("temp_store = MEMORY");
    db.pragma("cache_size = -65536");

    const previousVersion = db.pragma("user_version", { simple: true });

    createSchema(db);

    ctx = {
      db,
      key,
      dbFile,
      userData,
      backupsDir,
      keyFile: path.join(userData, "ledger.key"),
      safeStorage,
    };

    const auth = createAuth(ctx);

    // Import the old single-file store once. The old files are deliberately
    // left in place, so even a failed/partial import never destroys the
    // source data. This runs before seedDefaults so a legacy "admin" account
    // isn't blocked by a freshly-seeded one with the same username.
    const marker = db
      .prepare("SELECT value FROM meta WHERE key = 'legacyImportedAt'")
      .get();
    let importedNow = false;
    if (!marker) {
      try {
        const result = importLegacy(ctx, { onProgress });
        importedNow = !!result.imported;
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacyImportedAt', ?)"
        ).run(new Date().toISOString());
        if (result.imported) {
          db.prepare(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacySource', ?)"
          ).run(result.source || "");
        }
      } catch (e) {
        console.error("Legacy import failed:", e);
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacyImportError', ?)"
        ).run(String(e && e.message ? e.message : e));
      }
    }

    seedDefaults(db, auth);

    // Cached totals are kept current by triggers. Rebuild them once for a
    // database created by an older build (or a brand-new/restored file); doing
    // this scan on every launch would add seconds once there are many payments.
    if (previousVersion < SCHEMA_VERSION) {
      if (!importedNow) {
        db.prepare(
          `UPDATE loans SET
             paid_amount = COALESCE((SELECT SUM(p.amount) FROM payments p
                                     WHERE p.loan_id = loans.id AND p.voided = 0), 0),
             principal_paid = COALESCE((SELECT SUM(COALESCE(p.principal_paid, p.amount)) FROM payments p
                                        WHERE p.loan_id = loans.id AND p.voided = 0), 0),
             interest_paid = COALESCE((SELECT SUM(COALESCE(p.interest_paid, 0)) FROM payments p
                                       WHERE p.loan_id = loans.id AND p.voided = 0), 0),
             payment_count = (SELECT COUNT(*) FROM payments p
                              WHERE p.loan_id = loans.id AND p.voided = 0)`
        ).run();
      }
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }

    const queries = createQueries(ctx);
    const mutations = createMutations(ctx, auth);
    const backup = createBackup(ctx);

    ctx.queries = queries;
    ctx.mutations = mutations;
    ctx.auth = auth;
    ctx.backup = backup;
    ctx.api = {
      ...queries,
      ...mutations,
      auth,
      backup,
      settings: queries.settings,
    };

    return ctx;
  } catch (error) {
    if (ctx) ctx = null;
    if (db) {
      try {
        db.close();
      } catch (e) {
        /* ignore */
      }
    }
    throw error;
  }
}

function getContext() {
  if (!ctx) throw new Error("Database is not open");
  return ctx;
}

function close() {
  if (!ctx) return;
  try {
    ctx.db.close();
  } catch (e) {
    // ignore
  }
  ctx = null;
}

module.exports = { openDatabase, getContext, close };
