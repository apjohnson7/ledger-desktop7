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

function readOrCreateKey(userData, safeStorage) {
  const file = path.join(userData, "ledger.key");
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file);
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        const value = safeStorage.decryptString(raw);
        if (value) return value;
      } catch (e) {
        // Fall through: the key may have been written before OS encryption
        // became available, or by a build without safeStorage.
      }
    }
    const value = raw.toString("utf8").trim();
    if (value) return value;
  }

  const value = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, safeStorage.encryptString(value));
  } else {
    fs.writeFileSync(file, value, { mode: 0o600 });
  }
  return value;
}

function seedDefaults(db, auth) {
  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  insertSetting.run("businessName", "My Lending Business");
  insertSetting.run("language", "en");
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

  const db = new Database(dbFile);
  db.pragma(`key='${key.replace(/'/g, "''")}'`);
  try {
    db.prepare("SELECT COUNT(*) AS c FROM sqlite_master").get();
  } catch (e) {
    db.close();
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

  // Import the old single-file store once. The old files are deliberately left
  // in place, so even a failed/partial import never destroys the source data.
  // This runs before seedDefaults so a legacy "admin" account isn't blocked by
  // a freshly-seeded one with the same username.
  const marker = db
    .prepare("SELECT value FROM meta WHERE key = 'legacyImportedAt'")
    .get();
  let importedNow = false;
  if (!marker) {
    try {
      const result = importLegacy(ctx, { onProgress });
      importedNow = !!result.imported;
      if (result.imported) {
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacyImportedAt', ?)"
        ).run(new Date().toISOString());
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacySource', ?)"
        ).run(result.source || "");
      } else {
        db.prepare(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacyImportedAt', ?)"
        ).run(new Date().toISOString());
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
