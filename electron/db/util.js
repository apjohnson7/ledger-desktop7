"use strict";

const crypto = require("crypto");

const FREQ_DAYS = { Daily: 1, Weekly: 7, Monthly: 30, Custom: 30 };

const nowIso = () => new Date().toISOString();
const todayUtc = () => nowIso().slice(0, 10);
const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const bool = (v) => (v ? 1 : 0);

function logAudit(db, username, action) {
  if (!action) return;
  db.prepare(
    "INSERT INTO audit_log (id, timestamp, username, action) VALUES (?, ?, ?, ?)"
  ).run(uid("log"), nowIso(), username || "System", action);
}

function getSettings(db) {
  const out = {
    businessName: "My Lending Business",
    language: "en",
    startingCashBalance: 0,
  };
  for (const row of db.prepare("SELECT key, value FROM settings").all()) {
    if (row.key === "startingCashBalance") out[row.key] = num(row.value);
    else out[row.key] = row.value;
  }
  return out;
}

function setSetting(db, key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

/** Concurrency-safe per-year loan number. Call inside a write transaction. */
function nextLoanNumber(db, year = new Date().getFullYear()) {
  const name = `loanNumber:${year}`;
  const prefix = `LN-${year}-`;
  let row = db.prepare("SELECT value FROM counters WHERE name = ?").get(name);
  if (!row) {
    const max =
      db
        .prepare(
          `SELECT COALESCE(MAX(CAST(substr(loan_number, 9) AS INTEGER)), 0) AS m
             FROM loans WHERE loan_number LIKE ?`
        )
        .get(`${prefix}%`).m || 0;
    db.prepare("INSERT INTO counters (name, value) VALUES (?, ?)").run(name, max);
    row = { value: max };
  }
  const value = row.value + 1;
  db.prepare("UPDATE counters SET value = ? WHERE name = ?").run(value, name);
  return `${prefix}${String(value).padStart(4, "0")}`;
}

function computeNextDueDate(loan) {
  if (
    loan.repaymentMethod === "Instalments" &&
    loan.instalments &&
    loan.instalments.firstPaymentDate
  ) {
    const step = FREQ_DAYS[loan.instalments.frequency] || 30;
    const d = new Date(loan.instalments.firstPaymentDate + "T00:00:00");
    d.setDate(d.getDate() + (loan.paymentCount || 0) * step);
    return d.toISOString().slice(0, 10);
  }
  return loan.dueDate;
}

function actorName(user) {
  if (!user) return "System";
  return user.fullName || user.username || "System";
}

module.exports = {
  FREQ_DAYS,
  nowIso,
  todayUtc,
  uid,
  num,
  bool,
  logAudit,
  getSettings,
  setSetting,
  nextLoanNumber,
  computeNextDueDate,
  actorName,
};
