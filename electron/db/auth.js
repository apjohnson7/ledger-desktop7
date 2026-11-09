"use strict";

const crypto = require("crypto");
const { userRow } = require("./rows");
const { uid, nowIso, logAudit, bool } = require("./util");

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

  function login({ username, password }) {
    const clean = String(username || "").trim();
    if (!clean || !password) {
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
    return { ok: true, user };
  }

  function changePassword({ userId, currentPassword, newPassword }) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!row) return { ok: false, error: "User not found." };
    if (!verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
      return { ok: false, error: "Current password is incorrect." };
    }
    if (!newPassword || String(newPassword).length < 4) {
      return { ok: false, error: "New password must be at least 4 characters." };
    }
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
    ).run(hashPassword(newPassword, salt), salt, userId);
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
    const clean = String(username || "").trim();
    if (!clean) return { ok: false, error: "Choose a username." };
    if (!fullName || !String(fullName).trim()) {
      return { ok: false, error: "Enter the user's full name." };
    }
    if (!password || String(password).length < 4) {
      return { ok: false, error: "Set a password of at least 4 characters." };
    }
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
      String(fullName).trim(),
      role || "Loan Officer",
      nowIso()
    );
    logAudit(db, actor, `Added user account "${clean}" (${role || "Loan Officer"})`);
    return { ok: true, user: userRow(db.prepare("SELECT * FROM users WHERE id = ?").get(id), false) };
  }

  function updateUser({ actor, id, username, fullName, role, password }) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!row) return { ok: false, error: "User not found." };
    const clean = String(username || row.username).trim();
    const clash = db
      .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?")
      .get(clean, id);
    if (clash) return { ok: false, error: "That username is already taken." };
    if (password) {
      if (String(password).length < 4) {
        return { ok: false, error: "Password must be at least 4 characters." };
      }
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare(
        `UPDATE users SET username = ?, full_name = ?, role = ?,
           password_hash = ?, password_salt = ? WHERE id = ?`
      ).run(
        clean,
        String(fullName || row.full_name).trim(),
        role || row.role,
        hashPassword(password, salt),
        salt,
        id
      );
    } else {
      db.prepare(
        "UPDATE users SET username = ?, full_name = ?, role = ? WHERE id = ?"
      ).run(clean, String(fullName || row.full_name).trim(), role || row.role, id);
    }
    logAudit(db, actor, `Edited user account "${clean}"`);
    return { ok: true, user: userRow(db.prepare("SELECT * FROM users WHERE id = ?").get(id), false) };
  }

  function setUserActive({ actor, id, active }) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!row) return { ok: false, error: "User not found." };
    if (row.username === "admin" && !active) {
      return { ok: false, error: "The default administrator account can't be deactivated." };
    }
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(bool(active), id);
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
