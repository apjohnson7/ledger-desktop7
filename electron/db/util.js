"use strict";

const crypto = require("crypto");

const FREQ_DAYS = { Daily: 1, Weekly: 7, Monthly: 30, Custom: 30 };
const FREQ_NAMES = Object.keys(FREQ_DAYS);
const CURRENCY_CODES = [
  "UGX", "KES", "TZS", "RWF", "BIF", "SSP", "CDF", "ETB", "SOS", "USD", "EUR", "GBP",
];
const LANGUAGES = ["en", "lg", "nyn"];
const ROLE_NAMES = [
  "Administrator",
  "Manager",
  "Loan Officer",
  "Cashier",
  "Viewer",
];

// Values outside this range are almost certainly a typo or a malformed
// message, and letting them through risks overflowing totals to Infinity.
const MAX_MONEY = 1e15;
const MAX_INSTALMENTS = 1000;

const nowIso = () => new Date().toISOString();
const todayUtc = () => nowIso().slice(0, 10);
const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Rounds money to two decimals and keeps it inside the safe range. */
const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_MONEY, Math.min(MAX_MONEY, Math.round(n * 100) / 100));
};

const int = (v, min, max, fallback = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

/** Coerces any value to a bounded single-line string. */
const text = (v, max = 200, fallback = "") => {
  if (v == null) return fallback;
  const s = String(v);
  const clipped = s.length > max ? s.slice(0, max) : s;
  return clipped.trim() || fallback;
};

/** Coerces any value to a bounded string without trimming inner layout. */
const note = (v, max = 5000) => {
  if (v == null) return "";
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
};

const idText = (v, max = 120) => {
  if (v == null) return "";
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
};

/** Accepts only a real calendar date in YYYY-MM-DD form. */
function dateOnly(value, fallback = null) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    return fallback;
  }
  return s;
}

/** Optional date: invalid input becomes an empty string, never "Invalid Date". */
const optionalDate = (value) => dateOnly(value, "");

/** Adds whole days to a date, guarding against invalid dates and huge counts. */
function addDays(dateStr, days, fallback = todayUtc()) {
  const base = dateOnly(dateStr, fallback);
  const step = int(days, -366000, 366000, 0);
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + step);
  return d.toISOString().slice(0, 10);
}

const bool = (v) => (v ? 1 : 0);

function logAudit(db, username, action) {
  if (!action) return;
  db.prepare(
    "INSERT INTO audit_log (id, timestamp, username, action) VALUES (?, ?, ?, ?)"
  ).run(uid("log"), nowIso(), text(username, 200, "System"), note(action, 2000));
}

function getSettings(db) {
  const out = {
    businessName: "My Lending Business",
    language: "en",
    currency: "UGX",
    startingCashBalance: 0,
  };
  for (const row of db.prepare("SELECT key, value FROM settings").all()) {
    if (row.key === "startingCashBalance") {
      out[row.key] = money(row.value);
    } else if (row.key === "currency") {
      const code = String(row.value || "").toUpperCase();
      out.currency = CURRENCY_CODES.includes(code) ? code : "UGX";
    } else if (row.key === "language") {
      out.language = LANGUAGES.includes(row.value) ? row.value : "en";
    } else if (row.key === "businessName") {
      out.businessName = text(row.value, 200, "My Lending Business");
    } else {
      out[row.key] = note(row.value, 5000);
    }
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
    dateOnly(loan.instalments.firstPaymentDate)
  ) {
    const step = FREQ_DAYS[loan.instalments.frequency] || 30;
    const count = int(loan.paymentCount, 0, 100000, 0);
    return addDays(
      loan.instalments.firstPaymentDate,
      count * step,
      dateOnly(loan.dueDate, todayUtc())
    );
  }
  return dateOnly(loan.dueDate, todayUtc());
}

function actorName(user) {
  if (!user) return "System";
  return user.fullName || user.username || "System";
}

module.exports = {
  CURRENCY_CODES,
  LANGUAGES,
  ROLE_NAMES,
  FREQ_DAYS,
  FREQ_NAMES,
  MAX_MONEY,
  MAX_INSTALMENTS,
  nowIso,
  todayUtc,
  uid,
  num,
  money,
  int,
  text,
  note,
  idText,
  dateOnly,
  optionalDate,
  addDays,
  bool,
  logAudit,
  getSettings,
  setSetting,
  nextLoanNumber,
  computeNextDueDate,
  actorName,
};
