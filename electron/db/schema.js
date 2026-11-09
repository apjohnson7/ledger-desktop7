"use strict";

/* Database schema for the local encrypted ledger. All money columns are REAL
   (UGX has no subunits in practice, so this is safe well past 1M entries). */

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  full_name     TEXT,
  role          TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT
);

CREATE TABLE IF NOT EXISTS borrowers (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  phone           TEXT,
  alt_phone       TEXT,
  national_id     TEXT,
  address         TEXT,
  occupation      TEXT,
  next_of_kin     TEXT,
  next_of_kin_phone TEXT,
  notes           TEXT,
  date_registered TEXT
);

CREATE TABLE IF NOT EXISTS loans (
  id                    TEXT PRIMARY KEY,
  loan_number           TEXT NOT NULL,
  borrower_id           TEXT NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  amount                REAL NOT NULL DEFAULT 0,
  interest_type         TEXT,
  interest_value        REAL NOT NULL DEFAULT 0,
  paperwork_fee         REAL NOT NULL DEFAULT 0,
  total_payable         REAL NOT NULL DEFAULT 0,
  issue_date            TEXT NOT NULL,
  due_date              TEXT,
  repayment_method      TEXT,
  instalment_count      INTEGER,
  instalment_frequency  TEXT,
  instalment_amount     REAL,
  instalment_first_date TEXT,
  voided                INTEGER NOT NULL DEFAULT 0,
  void_reason           TEXT,
  voided_at             TEXT,
  renewed               INTEGER NOT NULL DEFAULT 0,
  renewed_from_id       TEXT,
  renewed_into_id       TEXT,
  renewed_at            TEXT,
  auto_renewed          INTEGER NOT NULL DEFAULT 0,
  issued_at             TEXT,
  is_historical         INTEGER NOT NULL DEFAULT 0,
  paid_amount           REAL NOT NULL DEFAULT 0,
  principal_paid        REAL NOT NULL DEFAULT 0,
  interest_paid         REAL NOT NULL DEFAULT 0,
  payment_count         INTEGER NOT NULL DEFAULT 0,
  next_due_date         TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  loan_id       TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  borrower_id   TEXT,
  amount        REAL NOT NULL DEFAULT 0,
  principal_paid REAL NOT NULL DEFAULT 0,
  interest_paid REAL NOT NULL DEFAULT 0,
  date          TEXT NOT NULL,
  method        TEXT,
  reference     TEXT,
  notes         TEXT,
  voided        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT
);

CREATE TABLE IF NOT EXISTS collateral (
  id              TEXT PRIMARY KEY,
  loan_id         TEXT REFERENCES loans(id) ON DELETE CASCADE,
  borrower_id     TEXT REFERENCES borrowers(id) ON DELETE CASCADE,
  description     TEXT,
  category        TEXT,
  brand           TEXT,
  model           TEXT,
  serial          TEXT,
  estimated_value REAL NOT NULL DEFAULT 0,
  condition       TEXT,
  date_received   TEXT,
  storage_location TEXT,
  status          TEXT,
  notes           TEXT,
  photos          TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY,
  description TEXT,
  category    TEXT,
  amount      REAL NOT NULL DEFAULT 0,
  date        TEXT NOT NULL,
  method      TEXT,
  notes       TEXT,
  voided      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS external_funds (
  id                   TEXT PRIMARY KEY,
  type                 TEXT,
  source               TEXT,
  amount               REAL NOT NULL DEFAULT 0,
  date_received        TEXT,
  expected_repayment_date TEXT,
  notes                TEXT,
  voided               INTEGER NOT NULL DEFAULT 0,
  repaid_amount        REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fund_repayments (
  id      TEXT PRIMARY KEY,
  fund_id TEXT REFERENCES external_funds(id) ON DELETE SET NULL,
  amount  REAL NOT NULL DEFAULT 0,
  date    TEXT NOT NULL,
  method  TEXT,
  notes   TEXT,
  voided  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  username  TEXT,
  action    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id                TEXT PRIMARY KEY,
  entity_type       TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  entity_label      TEXT,
  requested_by      TEXT,
  requested_by_name TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL,
  resolved_at       TEXT,
  resolved_by       TEXT
);

CREATE INDEX IF NOT EXISTS idx_borrowers_name  ON borrowers(full_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_borrowers_phone ON borrowers(phone);
CREATE INDEX IF NOT EXISTS idx_borrowers_nin   ON borrowers(national_id);

CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_loans_borrower_flags ON loans(borrower_id, voided, renewed);
CREATE INDEX IF NOT EXISTS idx_loans_issue    ON loans(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_loans_due      ON loans(due_date);
CREATE INDEX IF NOT EXISTS idx_loans_status   ON loans(voided, renewed, due_date, paid_amount);
CREATE INDEX IF NOT EXISTS idx_loans_number   ON loans(loan_number);

CREATE INDEX IF NOT EXISTS idx_payments_loan     ON payments(loan_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_borrower ON payments(borrower_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_date     ON payments(date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order    ON payments(date DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payments_voided   ON payments(voided, amount);
CREATE INDEX IF NOT EXISTS idx_payments_loan_sum ON payments(loan_id, voided, amount, principal_paid, interest_paid);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference) WHERE reference <> '';
CREATE INDEX IF NOT EXISTS idx_payments_borrower_voided ON payments(borrower_id, voided);
CREATE INDEX IF NOT EXISTS idx_payments_cash     ON payments(voided, date, amount);

CREATE INDEX IF NOT EXISTS idx_collateral_loan     ON collateral(loan_id);
CREATE INDEX IF NOT EXISTS idx_collateral_borrower ON collateral(borrower_id, date_received DESC);
CREATE INDEX IF NOT EXISTS idx_collateral_date     ON collateral(date_received DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_voided ON expenses(voided, amount);
CREATE INDEX IF NOT EXISTS idx_expenses_cash ON expenses(voided, date, amount);
CREATE INDEX IF NOT EXISTS idx_funds_date    ON external_funds(date_received DESC);
CREATE INDEX IF NOT EXISTS idx_fundrep_fund  ON fund_repayments(fund_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ts      ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(username, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_delreq_status ON deletion_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_name    ON users(username COLLATE NOCASE);

CREATE VIEW IF NOT EXISTS cash_events AS
  SELECT issue_date AS date, 0.0 AS cash_in, amount AS cash_out
    FROM loans WHERE voided = 0 AND renewed_from_id IS NULL
  UNION ALL
  SELECT date, amount, 0.0 FROM payments WHERE voided = 0
  UNION ALL
  SELECT date, 0.0, amount FROM expenses WHERE voided = 0;
`;

/* A payment row changes a loan's cached totals. Recomputing only the affected
   loan keeps every write O(payments on that one loan), and means list pages
   never have to scan the payments table again. */
const RECALC_LOAN = `
  paid_amount = COALESCE((SELECT SUM(p.amount) FROM payments p
                          WHERE p.loan_id = loans.id AND p.voided = 0), 0),
  principal_paid = COALESCE((SELECT SUM(COALESCE(p.principal_paid, p.amount)) FROM payments p
                             WHERE p.loan_id = loans.id AND p.voided = 0), 0),
  interest_paid = COALESCE((SELECT SUM(COALESCE(p.interest_paid, 0)) FROM payments p
                            WHERE p.loan_id = loans.id AND p.voided = 0), 0),
  payment_count = (SELECT COUNT(*) FROM payments p
                   WHERE p.loan_id = loans.id AND p.voided = 0),
  next_due_date = CASE
    WHEN repayment_method = 'Instalments' AND instalment_first_date IS NOT NULL
    THEN date(instalment_first_date, '+' ||
      ((SELECT COUNT(*) FROM payments p WHERE p.loan_id = loans.id AND p.voided = 0) *
       CASE instalment_frequency WHEN 'Daily' THEN 1 WHEN 'Weekly' THEN 7 ELSE 30 END) || ' days')
    ELSE due_date END
`;

const TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS trg_payments_ai AFTER INSERT ON payments BEGIN
  UPDATE loans SET ${RECALC_LOAN} WHERE id = NEW.loan_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_au AFTER UPDATE ON payments BEGIN
  UPDATE loans SET ${RECALC_LOAN} WHERE id = OLD.loan_id;
  UPDATE loans SET ${RECALC_LOAN} WHERE id = NEW.loan_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_ad AFTER DELETE ON payments BEGIN
  UPDATE loans SET ${RECALC_LOAN} WHERE id = OLD.loan_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_fundrep_ai AFTER INSERT ON fund_repayments BEGIN
  UPDATE external_funds SET repaid_amount = COALESCE(
    (SELECT SUM(r.amount) FROM fund_repayments r
      WHERE r.fund_id = external_funds.id AND r.voided = 0), 0)
  WHERE id = NEW.fund_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_fundrep_au AFTER UPDATE ON fund_repayments BEGIN
  UPDATE external_funds SET repaid_amount = COALESCE(
    (SELECT SUM(r.amount) FROM fund_repayments r
      WHERE r.fund_id = external_funds.id AND r.voided = 0), 0)
  WHERE id = OLD.fund_id;
  UPDATE external_funds SET repaid_amount = COALESCE(
    (SELECT SUM(r.amount) FROM fund_repayments r
      WHERE r.fund_id = external_funds.id AND r.voided = 0), 0)
  WHERE id = NEW.fund_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_fundrep_ad AFTER DELETE ON fund_repayments BEGIN
  UPDATE external_funds SET repaid_amount = COALESCE(
    (SELECT SUM(r.amount) FROM fund_repayments r
      WHERE r.fund_id = external_funds.id AND r.voided = 0), 0)
  WHERE id = OLD.fund_id;
END;
`;

function createSchema(db) {
  db.exec(DDL);
  db.exec(TRIGGERS);
}

module.exports = { createSchema };
