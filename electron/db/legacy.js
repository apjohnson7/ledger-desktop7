"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createSchema } = require("./schema");
const { hashPassword } = require("./auth");
const { uid, todayUtc } = require("./util");

const ARRAY_KEYS = [
  "borrowers",
  "loans",
  "payments",
  "collateral",
  "expenses",
  "externalFunds",
  "fundRepayments",
  "auditLog",
  "deletionRequests",
  "users",
];

const arr = (value) => (Array.isArray(value) ? value : []);

/** Reads the old encrypted/plain single-file store. Returns the inner data
 *  object (the same shape the renderer used), or null when nothing exists. */
function readLegacyData(ctx) {
  const candidates = [
    path.join(ctx.userData, "ledger-store.dat"),
    path.join(ctx.userData, "ledger-store.json"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file);
      let outer = null;

      // Normally the file is safeStorage-encrypted. Try that first, then fall
      // back to plain JSON (old installs and copied backup files).
      if (ctx.safeStorage && ctx.safeStorage.isEncryptionAvailable()) {
        try {
          outer = JSON.parse(ctx.safeStorage.decryptString(raw));
        } catch (e) {
          outer = null;
        }
      }
      if (!outer) {
        outer = JSON.parse(raw.toString("utf8"));
      }

      if (outer && typeof outer["personal:ledger-data-v1"] === "string") {
        return { data: JSON.parse(outer["personal:ledger-data-v1"]), source: file };
      }
      if (outer && outer["personal:ledger-data-v1"] && typeof outer["personal:ledger-data-v1"] === "object") {
        return { data: outer["personal:ledger-data-v1"], source: file };
      }
      if (outer && (Array.isArray(outer.borrowers) || Array.isArray(outer.loans))) {
        return { data: outer, source: file };
      }
    } catch (e) {
      console.error(`Could not read legacy store ${file}:`, e.message);
    }
  }
  return null;
}

function importData(ctx, sourceData, { onProgress } = {}) {
  const data = sourceData || {};
  const { db } = ctx;

  for (const key of ARRAY_KEYS) {
    if (data[key] != null && !Array.isArray(data[key])) {
      console.warn(`Legacy field ${key} is not an array; ignoring it.`);
    }
  }

  // Drop the per-payment recalculation triggers while bulk inserting: one
  // final aggregate pass is much faster than a million individual recalcs.
  // createSchema() recreates them afterwards (all statements are IF NOT EXISTS).
  db.exec(`
    DROP TRIGGER IF EXISTS trg_payments_ai;
    DROP TRIGGER IF EXISTS trg_payments_au;
    DROP TRIGGER IF EXISTS trg_payments_ad;
    DROP TRIGGER IF EXISTS trg_fundrep_ai;
    DROP TRIGGER IF EXISTS trg_fundrep_au;
    DROP TRIGGER IF EXISTS trg_fundrep_ad;
  `);
  db.pragma("foreign_keys = OFF");

  const insertBorrower = db.prepare(`
    INSERT OR REPLACE INTO borrowers
      (id, full_name, phone, alt_phone, national_id, address, occupation,
       next_of_kin, next_of_kin_phone, notes, date_registered)
    VALUES (@id, @full_name, @phone, @alt_phone, @national_id, @address, @occupation,
            @next_of_kin, @next_of_kin_phone, @notes, @date_registered)`);

  const insertLoan = db.prepare(`
    INSERT OR REPLACE INTO loans
      (id, loan_number, borrower_id, amount, interest_type, interest_value,
       paperwork_fee, total_payable, issue_date, due_date, repayment_method,
       instalment_count, instalment_frequency, instalment_amount,
       instalment_first_date, voided, void_reason, voided_at, renewed,
       renewed_from_id, renewed_into_id, renewed_at, auto_renewed, issued_at,
       is_historical, paid_amount, principal_paid, interest_paid, payment_count,
       next_due_date)
    VALUES (@id, @loan_number, @borrower_id, @amount, @interest_type, @interest_value,
            @paperwork_fee, @total_payable, @issue_date, @due_date, @repayment_method,
            @instalment_count, @instalment_frequency, @instalment_amount,
            @instalment_first_date, @voided, @void_reason, @voided_at, @renewed,
            @renewed_from_id, @renewed_into_id, @renewed_at, @auto_renewed, @issued_at,
            @is_historical, 0, 0, 0, 0, NULL)`);

  const insertPayment = db.prepare(`
    INSERT OR REPLACE INTO payments
      (id, loan_id, borrower_id, amount, principal_paid, interest_paid, date,
       method, reference, notes, voided, created_at)
    VALUES (@id, @loan_id, @borrower_id, @amount, @principal_paid, @interest_paid, @date,
            @method, @reference, @notes, @voided, @created_at)`);

  const insertCollateral = db.prepare(`
    INSERT OR REPLACE INTO collateral
      (id, loan_id, borrower_id, description, category, brand, model, serial,
       estimated_value, condition, date_received, storage_location, status,
       notes, photos)
    VALUES (@id, @loan_id, @borrower_id, @description, @category, @brand, @model,
            @serial, @estimated_value, @condition, @date_received, @storage_location,
            @status, @notes, @photos)`);

  const insertExpense = db.prepare(`
    INSERT OR REPLACE INTO expenses
      (id, description, category, amount, date, method, notes, voided)
    VALUES (@id, @description, @category, @amount, @date, @method, @notes, @voided)`);

  const insertFund = db.prepare(`
    INSERT OR REPLACE INTO external_funds
      (id, type, source, amount, date_received, expected_repayment_date, notes,
       voided, repaid_amount)
    VALUES (@id, @type, @source, @amount, @date_received, @expected_repayment_date,
            @notes, @voided, 0)`);

  const insertFundRepayment = db.prepare(`
    INSERT OR REPLACE INTO fund_repayments
      (id, fund_id, amount, date, method, notes, voided)
    VALUES (@id, @fund_id, @amount, @date, @method, @notes, @voided)`);

  const insertAudit = db.prepare(`
    INSERT OR REPLACE INTO audit_log (id, timestamp, username, action)
    VALUES (@id, @timestamp, @username, @action)`);

  const insertDeletion = db.prepare(`
    INSERT OR REPLACE INTO deletion_requests
      (id, entity_type, entity_id, entity_label, requested_by, requested_by_name,
       status, created_at, resolved_at, resolved_by)
    VALUES (@id, @entity_type, @entity_id, @entity_label, @requested_by,
            @requested_by_name, @status, @created_at, @resolved_at, @resolved_by)`);

  const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users
      (id, username, password_hash, password_salt, full_name, role, active, created_at)
    VALUES (@id, @username, @password_hash, @password_salt, @full_name, @role,
            @active, @created_at)`);

  const insertSetting = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  const counts = {};
  const run = db.transaction(() => {
    const settings = data.settings || {};
    if (settings.businessName != null) insertSetting.run("businessName", String(settings.businessName));
    if (settings.language != null) insertSetting.run("language", String(settings.language));
    if (settings.startingCashBalance != null) {
      insertSetting.run("startingCashBalance", String(Number(settings.startingCashBalance) || 0));
    }

    const borrowers = arr(data.borrowers);
    borrowers.forEach((b, i) => {
      insertBorrower.run({
        id: b.id || uid("bor"),
        full_name: b.fullName || b.name || `Borrower ${i + 1}`,
        phone: b.phone || "",
        alt_phone: b.altPhone || "",
        national_id: b.nationalId || "",
        address: b.address || "",
        occupation: b.occupation || "",
        next_of_kin: b.nextOfKin || "",
        next_of_kin_phone: b.nextOfKinPhone || "",
        notes: b.notes || "",
        date_registered: b.dateRegistered || todayUtc(),
      });
    });
    counts.borrowers = borrowers.length;

    const loans = arr(data.loans);
    loans.forEach((l, i) => {
      const inst = l.instalments || null;
      const year = String(l.issueDate || todayUtc()).slice(0, 4);
      insertLoan.run({
        id: l.id || uid("loan"),
        loan_number: l.loanNumber || `LN-${year}-IMP${String(i + 1).padStart(4, "0")}`,
        borrower_id: l.borrowerId || "",
        amount: Number(l.amount) || 0,
        interest_type: l.interestType || "Percent",
        interest_value: Number(l.interestValue) || 0,
        paperwork_fee: Number(l.paperworkFee) || 0,
        total_payable: Number(l.totalPayable) || 0,
        issue_date: l.issueDate || todayUtc(),
        due_date: l.dueDate || l.issueDate || todayUtc(),
        repayment_method: l.repaymentMethod || "Full Payment",
        instalment_count: inst ? Number(inst.count) || 0 : null,
        instalment_frequency: inst ? inst.frequency || "Monthly" : null,
        instalment_amount: inst ? Number(inst.expectedAmount) || 0 : null,
        instalment_first_date: inst ? inst.firstPaymentDate || null : null,
        voided: l.voided ? 1 : 0,
        void_reason: l.voidReason || "",
        voided_at: l.voidedAt || "",
        renewed: l.renewed ? 1 : 0,
        renewed_from_id: l.renewedFromId || null,
        renewed_into_id: l.renewedIntoId || null,
        renewed_at: l.renewedAt || "",
        auto_renewed: l.autoRenewed ? 1 : 0,
        issued_at: l.issuedAt || "",
        is_historical: l.isHistorical ? 1 : 0,
      });
    });
    counts.loans = loans.length;

    const payments = arr(data.payments);
    payments.forEach((p) => {
      insertPayment.run({
        id: p.id || uid("pay"),
        loan_id: p.loanId || "",
        borrower_id: p.borrowerId || null,
        amount: Number(p.amount) || 0,
        principal_paid: p.principalPaid != null ? Number(p.principalPaid) || 0 : Number(p.amount) || 0,
        interest_paid: p.interestPaid != null ? Number(p.interestPaid) || 0 : 0,
        date: p.date || todayUtc(),
        method: p.method || "Cash",
        reference: p.reference || "",
        notes: p.notes || "",
        voided: p.voided ? 1 : 0,
        created_at: p.createdAt || `${p.date || todayUtc()}T00:00:00.000Z`,
      });
    });
    counts.payments = payments.length;

    const collateral = arr(data.collateral);
    collateral.forEach((c) => {
      insertCollateral.run({
        id: c.id || uid("col"),
        loan_id: c.loanId || null,
        borrower_id: c.borrowerId || null,
        description: c.description || "",
        category: c.category || "",
        brand: c.brand || "",
        model: c.model || "",
        serial: c.serial || "",
        estimated_value: Number(c.estimatedValue) || 0,
        condition: c.condition || "",
        date_received: c.dateReceived || todayUtc(),
        storage_location: c.storageLocation || "",
        status: c.status || "Held",
        notes: c.notes || "",
        photos: JSON.stringify(Array.isArray(c.photos) ? c.photos : []),
      });
    });
    counts.collateral = collateral.length;

    const expenses = arr(data.expenses);
    expenses.forEach((e) => {
      insertExpense.run({
        id: e.id || uid("exp"),
        description: e.description || "",
        category: e.category || "Other",
        amount: Number(e.amount) || 0,
        date: e.date || todayUtc(),
        method: e.method || "Cash",
        notes: e.notes || "",
        voided: e.voided ? 1 : 0,
      });
    });
    counts.expenses = expenses.length;

    const funds = arr(data.externalFunds);
    funds.forEach((f) => {
      insertFund.run({
        id: f.id || uid("fund"),
        type: f.type || "External Loan",
        source: f.source || "",
        amount: Number(f.amount) || 0,
        date_received: f.dateReceived || todayUtc(),
        expected_repayment_date: f.expectedRepaymentDate || "",
        notes: f.notes || "",
        voided: f.voided ? 1 : 0,
      });
    });
    counts.externalFunds = funds.length;

    const fundRepayments = arr(data.fundRepayments);
    fundRepayments.forEach((r) => {
      insertFundRepayment.run({
        id: r.id || uid("fundpay"),
        fund_id: r.fundId || null,
        amount: Number(r.amount) || 0,
        date: r.date || todayUtc(),
        method: r.method || "Cash",
        notes: r.notes || "",
        voided: r.voided ? 1 : 0,
      });
    });
    counts.fundRepayments = fundRepayments.length;

    const auditLog = arr(data.auditLog);
    auditLog.forEach((e) => {
      insertAudit.run({
        id: e.id || uid("log"),
        timestamp: e.timestamp || nowStamp(),
        username: e.username || "",
        action: e.action || "",
      });
    });
    counts.auditLog = auditLog.length;

    const deletionRequests = arr(data.deletionRequests);
    deletionRequests.forEach((r) => {
      insertDeletion.run({
        id: r.id || uid("delreq"),
        entity_type: r.entityType || "",
        entity_id: r.entityId || "",
        entity_label: r.entityLabel || "",
        requested_by: r.requestedBy || "",
        requested_by_name: r.requestedByName || "",
        status: r.status || "pending",
        created_at: r.createdAt || nowStamp(),
        resolved_at: r.resolvedAt || null,
        resolved_by: r.resolvedBy || null,
      });
    });
    counts.deletionRequests = deletionRequests.length;

    const users = arr(data.users);
    users.forEach((u) => {
      let passwordHash = u.passwordHash || null;
      let passwordSalt = u.passwordSalt || null;
      if (!passwordHash && u.password) {
        passwordSalt = crypto.randomBytes(16).toString("hex");
        passwordHash = hashPassword(u.password, passwordSalt);
      }
      insertUser.run({
        id: u.id || uid("usr"),
        username: u.username || `user${Math.random().toString(36).slice(2, 8)}`,
        password_hash: passwordHash,
        password_salt: passwordSalt,
        full_name: u.fullName || u.username || "",
        role: u.role || "Loan Officer",
        active: u.active === false ? 0 : 1,
        created_at: u.createdAt || todayUtc(),
      });
    });
    counts.users = users.length;
  });

  try {
    run();
  } finally {
    db.pragma("foreign_keys = ON");
    createSchema(db);
  }

  // One aggregate pass instead of per-payment trigger work during import.
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

  db.prepare(
    `UPDATE loans SET next_due_date = CASE
       WHEN repayment_method = 'Instalments' AND instalment_first_date IS NOT NULL
       THEN date(instalment_first_date, '+' ||
         (payment_count * CASE instalment_frequency
           WHEN 'Daily' THEN 1 WHEN 'Weekly' THEN 7 ELSE 30 END) || ' days')
       ELSE due_date END`
  ).run();

  db.prepare(
    `UPDATE external_funds SET repaid_amount = COALESCE(
       (SELECT SUM(r.amount) FROM fund_repayments r
         WHERE r.fund_id = external_funds.id AND r.voided = 0), 0)`
  ).run();

  if (onProgress) {
    onProgress(counts);
  }
  return { imported: true, counts };
}

function importLegacy(ctx, options = {}) {
  const found = readLegacyData(ctx);
  if (!found) return { imported: false };
  const result = importData(ctx, found.data, options);
  console.log("Imported legacy ledger data:", result.counts, "from", found.source);
  return { ...result, source: found.source };
}

/** Replaces every table with the contents of a parsed backup. Used by the
 *  Settings page's "Restore from backup file" action. The whole replacement
 *  runs in one transaction, so a bad file leaves the current data untouched. */
function replaceAllData(ctx, data) {
  const { db } = ctx;
  db.pragma("foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM fund_repayments;
      DELETE FROM collateral;
      DELETE FROM payments;
      DELETE FROM loans;
      DELETE FROM external_funds;
      DELETE FROM expenses;
      DELETE FROM deletion_requests;
      DELETE FROM audit_log;
      DELETE FROM users;
      DELETE FROM borrowers;
      DELETE FROM settings;
      DELETE FROM counters;
      DELETE FROM meta;
    `);
    const result = importData(ctx, data);
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacyImportedAt', ?)"
    ).run(nowStamp());
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacySource', 'restored-backup')"
    ).run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (e) {
      /* ignore */
    }
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function nowStamp() {
  return new Date().toISOString();
}

module.exports = { importLegacy, importData, replaceAllData, readLegacyData };
