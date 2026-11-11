"use strict";

const crypto = require("crypto");
const { userRow } = require("./rows");
const {
  uid,
  nowIso,
  logAudit,
  bool,
  text,
  idText,
  ROLE_NAMES,
} = require("./util");

const MAX_PASSWORD = 1024;
const MIN_PASSWORD = 4;

/** Same PBKDF2 parameters the renderer has always used, so existing password
 *  hashes keep working after the migration. */
function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(String(password), String(salt), 100000, 32, "sha256")
    .toString("hex");
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  let expected;
  try {
    expected = Buffer.from(String(expectedHash), "hex");
  } catch (e) {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function createAuth(ctx) {
  const { db } = ctx;

  const cleanRole = (role) =>
    ROLE_NAMES.includes(role) ? role : "Loan Officer";

  function activeAdminCount(excludeId = "") {
    return db
      .prepare(
        `SELECT COUNT(*) AS c FROM users
          WHERE active = 1 AND role = 'Administrator' AND id <> ?`
      )
      .get(idText(excludeId)).c;
  }

  function isDefaultAdmin(row) {
    return String(row && row.username).toLowerCase() === "admin";
  }

  function login({ username, password }) {
    const clean = text(username, 200);
    if (!clean || !password || String(password).length > MAX_PASSWORD) {
      return { ok: false, error: "Incorrect username or password." };
    }
    const row = db
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(clean);
    if (!row || !row.active) {
      return { ok: false, error: "Incorrect username or password." };
    }
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      return { ok: false, error: "Incorrect username or password." };
    }
    const user = userRow(row, false);
    logAudit(db, user.fullName || user.username, "Signed in");
    return {
      ok: true,
      user,
      defaultPassword:
        isDefaultAdmin(row) && verifyPassword("admin", row.password_salt, row.password_hash),
    };
  }

  function changePassword({ userId, currentPassword, newPassword }) {
    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(idText(userId));
    if (!row) return { ok: false, error: "User not found." };
    if (
      !currentPassword ||
      String(currentPassword).length > MAX_PASSWORD ||
      !verifyPassword(currentPassword, row.password_salt, row.password_hash)
    ) {
      return { ok: false, error: "Current password is incorrect." };
    }
    if (
      !newPassword ||
      String(newPassword).length < MIN_PASSWORD ||
      String(newPassword).length > MAX_PASSWORD
    ) {
      return {
        ok: false,
        error: `New password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`,
      };
    }
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
    ).run(hashPassword(newPassword, salt), salt, row.id);
    logAudit(db, row.full_name || row.username, "Changed own password");
    return { ok: true };
  }

  function logout({ actor }) {
    logAudit(db, actor || "System", "Signed out");
    return { ok: true };
  }

  /** Used by the legacy importer for users that still had a plain password. */
  function upgradeLegacyUser(id, plainPassword) {
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
    ).run(hashPassword(plainPassword, salt), salt, id);
  }

  function createUser({ actor, username, fullName, role, password }) {
    const clean = text(username, 64);
    if (!clean) return { ok: false, error: "Choose a username." };
    const name = text(fullName, 200);
    if (!name) {
      return { ok: false, error: "Enter the user's full name." };
    }
    if (
      !password ||
      String(password).length < MIN_PASSWORD ||
      String(password).length > MAX_PASSWORD
    ) {
      return {
        ok: false,
        error: `Set a password between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`,
      };
    }
    const chosenRole = cleanRole(role);
    const clash = db
      .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
      .get(clean);
    if (clash) return { ok: false, error: "That username is already taken." };
    const salt = crypto.randomBytes(16).toString("hex");
    const id = uid("usr");
    db.prepare(
      `INSERT INTO users
        (id, username, password_hash, password_salt, full_name, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      clean,
      hashPassword(password, salt),
      salt,
      name,
      chosenRole,
      nowIso()
    );
    logAudit(db, actor, `Added user account "${clean}" (${chosenRole})`);
    return {
      ok: true,
      user: userRow(db.prepare("SELECT * FROM users WHERE id = ?").get(id), false),
    };
  }

  function updateUser({ actor, id, username, fullName, role, password }) {
    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(idText(id));
    if (!row) return { ok: false, error: "User not found." };
    const clean = text(username, 64, row.username);
    if (isDefaultAdmin(row) && clean.toLowerCase() !== "admin") {
      return {
        ok: false,
        error: "The default administrator username can't be changed.",
      };
    }
    const clash = db
      .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?")
      .get(clean, row.id);
    if (clash) return { ok: false, error: "That username is already taken." };
    const chosenRole = cleanRole(role || row.role);
    if (
      row.active &&
      row.role === "Administrator" &&
      chosenRole !== "Administrator" &&
      activeAdminCount(row.id) === 0
    ) {
      return {
        ok: false,
        error: "At least one active administrator account must remain.",
      };
    }
    if (password) {
      if (
        String(password).length < MIN_PASSWORD ||
        String(password).length > MAX_PASSWORD
      ) {
        return {
          ok: false,
          error: `Password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`,
        };
      }
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare(
        `UPDATE users SET username = ?, full_name = ?, role = ?,
           password_hash = ?, password_salt = ? WHERE id = ?`
      ).run(
        clean,
        text(fullName, 200, row.full_name || clean),
        chosenRole,
        hashPassword(password, salt),
        salt,
        row.id
      );
    } else {
      db.prepare(
        "UPDATE users SET username = ?, full_name = ?, role = ? WHERE id = ?"
      ).run(
        clean,
        text(fullName, 200, row.full_name || clean),
        chosenRole,
        row.id
      );
    }
    logAudit(db, actor, `Edited user account "${clean}"`);
    return {
      ok: true,
      user: userRow(db.prepare("SELECT * FROM users WHERE id = ?").get(row.id), false),
    };
  }

  function setUserActive({ actor, id, active }) {
    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(idText(id));
    if (!row) return { ok: false, error: "User not found." };
    if (isDefaultAdmin(row) && !active) {
      return { ok: false, error: "The default administrator account can't be deactivated." };
    }
    if (
      row.active &&
      row.role === "Administrator" &&
      !active &&
      activeAdminCount(row.id) === 0
    ) {
      return {
        ok: false,
        error: "At least one active administrator account must remain.",
      };
    }
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(
      bool(active),
      row.id
    );
    logAudit(
      db,
      actor,
      `${active ? "Reactivated" : "Deactivated"} user account "${row.username}"`
    );
    return { ok: true };
  }

  return {
    hashPassword,
    verifyPassword,
    login,
    logout,
    changePassword,
    upgradeLegacyUser,
    createUser,
    updateUser,
    setUserActive,
  };
}

module.exports = { createAuth, hashPassword, verifyPassword };
