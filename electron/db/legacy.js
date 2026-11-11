"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createSchema } = require("./schema");
const { hashPassword } = require("./auth");
const {
  uid,
  todayUtc,
  money,
  int,
  text,
  note,
  idText,
  dateOnly,
  optionalDate,
  CURRENCY_CODES,
  LANGUAGES,
  ROLE_NAMES,
  MAX_INSTALMENTS,
} = require("./util");

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
const MAX_IMPORT_ROWS = 2_000_000;

function safePhotos(photos) {
  if (!Array.isArray(photos)) return "[]";
  try {
    const json = JSON.stringify(photos.slice(0, 10));
    return json.length > 2 * 1024 * 1024 ? "[]" : json;
  } catch (e) {
    return "[]";
  }
}

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

  let totalRows = 0;
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(data[key])) totalRows += data[key].length;
  }
  if (totalRows > MAX_IMPORT_ROWS) {
    throw new Error(
      `That backup contains ${totalRows.toLocaleString()} records, which is more than this app can safely restore at once.`
    );
  }

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
    if (settings.businessName != null) {
      insertSetting.run(
        "businessName",
        text(settings.businessName, 200, "My Lending Business")
      );
    }
    if (settings.language != null && LANGUAGES.includes(settings.language)) {
      insertSetting.run("language", settings.language);
    }
    if (settings.currency != null) {
      const code = String(settings.currency).toUpperCase();
      if (CURRENCY_CODES.includes(code)) insertSetting.run("currency", code);
    }
    if (settings.startingCashBalance != null) {
      insertSetting.run(
        "startingCashBalance",
        String(money(settings.startingCashBalance))
      );
    }

    const borrowers = arr(data.borrowers);
    borrowers.forEach((b, i) => {
      insertBorrower.run({
        id: idText(b.id) || uid("bor"),
        full_name: text(b.fullName || b.name, 200, `Borrower ${i + 1}`),
        phone: text(b.phone, 60),
        alt_phone: text(b.altPhone, 60),
        national_id: text(b.nationalId, 60),
        address: text(b.address, 300),
        occupation: text(b.occupation, 120),
        next_of_kin: text(b.nextOfKin, 200),
        next_of_kin_phone: text(b.nextOfKinPhone, 60),
        notes: note(b.notes),
        date_registered: dateOnly(b.dateRegistered, todayUtc()),
      });
    });
    counts.borrowers = borrowers.length;

    const loans = arr(data.loans);
    loans.forEach((l, i) => {
      const inst = l.instalments || null;
      const issueDate = dateOnly(l.issueDate, todayUtc());
      const year = issueDate.slice(0, 4);
      const interestType = l.interestType === "Fixed" ? "Fixed" : "Percent";
      insertLoan.run({
        id: idText(l.id) || uid("loan"),
        loan_number: text(
          l.loanNumber,
          60,
          `LN-${year}-IMP${String(i + 1).padStart(4, "0")}`
        ),
        borrower_id: idText(l.borrowerId),
        amount: money(l.amount),
        interest_type: interestType,
        interest_value: money(l.interestValue),
        paperwork_fee: money(l.paperworkFee),
        total_payable: money(l.totalPayable),
        issue_date: issueDate,
        due_date: dateOnly(l.dueDate, issueDate),
        repayment_method:
          l.repaymentMethod === "Instalments" ? "Instalments" : "Full Payment",
        instalment_count: inst
          ? int(inst.count, 0, MAX_INSTALMENTS, 0)
          : null,
        instalment_frequency: inst
          ? text(inst.frequency, 40, "Monthly")
          : null,
        instalment_amount: inst ? money(inst.expectedAmount) : null,
        instalment_first_date: inst
          ? dateOnly(inst.firstPaymentDate, issueDate)
          : null,
        voided: l.voided ? 1 : 0,
        void_reason: text(l.voidReason, 1000),
        voided_at: text(l.voidedAt, 40),
        renewed: l.renewed ? 1 : 0,
        renewed_from_id: idText(l.renewedFromId) || null,
        renewed_into_id: idText(l.renewedIntoId) || null,
        renewed_at: text(l.renewedAt, 40),
        auto_renewed: l.autoRenewed ? 1 : 0,
        issued_at: text(l.issuedAt, 40),
        is_historical: l.isHistorical ? 1 : 0,
      });
    });
    counts.loans = loans.length;

    const payments = arr(data.payments);
    payments.forEach((p) => {
      const date = dateOnly(p.date, todayUtc());
      insertPayment.run({
        id: idText(p.id) || uid("pay"),
        loan_id: idText(p.loanId),
        borrower_id: idText(p.borrowerId) || null,
        amount: money(p.amount),
        principal_paid:
          p.principalPaid != null ? money(p.principalPaid) : money(p.amount),
        interest_paid: money(p.interestPaid),
        date,
        method: text(p.method, 60, "Cash"),
        reference: text(p.reference, 200),
        notes: note(p.notes),
        voided: p.voided ? 1 : 0,
        created_at: text(p.createdAt, 40, `${date}T00:00:00.000Z`),
      });
    });
    counts.payments = payments.length;

    const collateral = arr(data.collateral);
    collateral.forEach((c) => {
      insertCollateral.run({
        id: idText(c.id) || uid("col"),
        loan_id: idText(c.loanId) || null,
        borrower_id: idText(c.borrowerId) || null,
        description: text(c.description, 300),
        category: text(c.category, 80),
        brand: text(c.brand, 120),
        model: text(c.model, 120),
        serial: text(c.serial, 120),
        estimated_value: money(c.estimatedValue),
        condition: text(c.condition, 120),
        date_received: dateOnly(c.dateReceived, todayUtc()),
        storage_location: text(c.storageLocation, 200),
        status: text(c.status, 40, "Held"),
        notes: note(c.notes),
        photos: safePhotos(c.photos),
      });
    });
    counts.collateral = collateral.length;

    const expenses = arr(data.expenses);
    expenses.forEach((e) => {
      insertExpense.run({
        id: idText(e.id) || uid("exp"),
        description: text(e.description, 300),
        category: text(e.category, 80, "Other"),
        amount: money(e.amount),
        date: dateOnly(e.date, todayUtc()),
        method: text(e.method, 60, "Cash"),
        notes: note(e.notes),
        voided: e.voided ? 1 : 0,
      });
    });
    counts.expenses = expenses.length;

    const funds = arr(data.externalFunds);
    funds.forEach((f) => {
      insertFund.run({
        id: idText(f.id) || uid("fund"),
        type: text(f.type, 80, "External Loan"),
        source: text(f.source, 200),
        amount: money(f.amount),
        date_received: dateOnly(f.dateReceived, todayUtc()),
        expected_repayment_date: optionalDate(f.expectedRepaymentDate),
        notes: note(f.notes),
        voided: f.voided ? 1 : 0,
      });
    });
    counts.externalFunds = funds.length;

    const fundRepayments = arr(data.fundRepayments);
    fundRepayments.forEach((r) => {
      insertFundRepayment.run({
        id: idText(r.id) || uid("fundpay"),
        fund_id: idText(r.fundId) || null,
        amount: money(r.amount),
        date: dateOnly(r.date, todayUtc()),
        method: text(r.method, 60, "Cash"),
        notes: note(r.notes),
        voided: r.voided ? 1 : 0,
      });
    });
    counts.fundRepayments = fundRepayments.length;

    const auditLog = arr(data.auditLog);
    auditLog.forEach((e) => {
      insertAudit.run({
        id: idText(e.id) || uid("log"),
        timestamp: text(e.timestamp, 40, nowStamp()),
        username: text(e.username, 200),
        action: note(e.action, 2000),
      });
    });
    counts.auditLog = auditLog.length;

    const deletionRequests = arr(data.deletionRequests);
    deletionRequests.forEach((r) => {
      insertDeletion.run({
        id: idText(r.id) || uid("delreq"),
        entity_type: text(r.entityType, 40),
        entity_id: idText(r.entityId),
        entity_label: text(r.entityLabel, 300),
        requested_by: idText(r.requestedBy),
        requested_by_name: text(r.requestedByName, 200),
        status: text(r.status, 40, "pending"),
        created_at: text(r.createdAt, 40, nowStamp()),
        resolved_at: text(r.resolvedAt, 40) || null,
        resolved_by: idText(r.resolvedBy) || null,
      });
    });
    counts.deletionRequests = deletionRequests.length;

    const users = arr(data.users);
    users.forEach((u) => {
      let passwordHash = text(u.passwordHash, 200) || null;
      let passwordSalt = text(u.passwordSalt, 200) || null;
      if (!passwordHash && u.password) {
        passwordSalt = crypto.randomBytes(16).toString("hex");
        passwordHash = hashPassword(text(u.password, 200), passwordSalt);
      }
      const username = text(u.username, 64);
      insertUser.run({
        id: idText(u.id) || uid("usr"),
        username: username || `user${Math.random().toString(36).slice(2, 8)}`,
        password_hash: passwordHash,
        password_salt: passwordSalt,
        full_name: text(u.fullName, 200, username),
        role: ROLE_NAMES.includes(u.role) ? u.role : "Loan Officer",
        active:
          u.active === false || u.active === 0 || u.active === "0" ? 0 : 1,
        created_at: text(u.createdAt, 40, todayUtc()),
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

/** Rejects backups that would leave the ledger unusable or silently drop
 *  whole tables. Called before any existing data is deleted. */
function validateRestoreData(data, { strict = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("That file doesn't look like a Ledger backup.");
  }

  const required = strict
    ? ARRAY_KEYS
    : ["borrowers", "loans", "payments", "users"];
  for (const key of required) {
    if (!Array.isArray(data[key])) {
      throw new Error(
        `That backup is incomplete: the "${key}" section is missing. Nothing was changed.`
      );
    }
  }
  for (const key of ARRAY_KEYS) {
    if (data[key] != null && !Array.isArray(data[key])) {
      throw new Error(
        `That backup is damaged: the "${key}" section isn't a list. Nothing was changed.`
      );
    }
  }

  let totalRows = 0;
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(data[key])) totalRows += data[key].length;
  }
  if (totalRows > MAX_IMPORT_ROWS) {
    throw new Error(
      `That backup contains ${totalRows.toLocaleString()} records, which is more than this app can safely restore at once. Nothing was changed.`
    );
  }

  const users = data.users || [];
  if (users.length === 0) {
    throw new Error(
      "That backup has no user accounts. Restoring it would lock you out, so nothing was changed."
    );
  }
  const isActiveUser = (u) =>
    !!u &&
    u.active !== false &&
    u.active !== 0 &&
    u.active !== "0";
  const admins = users.filter(
    (u) => isActiveUser(u) && u.role === "Administrator"
  );
  if (admins.length === 0) {
    throw new Error(
      "That backup has no active Administrator account. Restoring it would lock you out, so nothing was changed."
    );
  }
  const usable = admins.some(
    (u) => (u.passwordHash && u.passwordSalt) || u.password
  );
  if (!usable) {
    throw new Error(
      "That backup's administrator account has no password. Restoring it would lock you out, so nothing was changed."
    );
  }
  const seen = new Set();
  for (const user of users) {
    const name = String((user && user.username) || "").toLowerCase();
    if (!name) continue;
    if (seen.has(name)) {
      throw new Error(
        `That backup contains two users named "${name}". Nothing was changed.`
      );
    }
    seen.add(name);
  }
  return true;
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
function replaceAllData(ctx, data, options = {}) {
  validateRestoreData(data, options);
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

module.exports = {
  importLegacy,
  importData,
  replaceAllData,
  readLegacyData,
  validateRestoreData,
  ARRAY_KEYS,
};
