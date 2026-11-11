"use strict";

const { getSettings, todayUtc, num, text, idText } = require("./util");
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
  statusWhere,
  groupExpr,
  fundingGroupExpr,
  groupLabel,
  STATUS_SQL,
} = require("./rows");

function pageArgs(params = {}, defaultLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(Math.trunc(num(params.limit)) || defaultLimit, 1), maxLimit);
  const page = Math.max(Math.trunc(num(params.page)) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

function createQueries(ctx) {
  const { db } = ctx;

  function settings() {
    return getSettings(db);
  }

  function bootstrap() {
    const today = todayUtc();
    const alertSelect = `
      SELECT l.id, l.loan_number AS "loanNumber", l.borrower_id AS "borrowerId",
             b.full_name AS "borrowerName", l.due_date AS "dueDate",
             l.issued_at AS "issuedAt", l.auto_renewed AS "autoRenewed"
        FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id`;
    const openLoan = "l.voided = 0 AND l.renewed = 0 AND l.paid_amount < l.total_payable - 0.5";

    const overdue = db
      .prepare(
        `${alertSelect} WHERE ${openLoan} AND l.due_date < @today
         ORDER BY l.due_date ASC LIMIT 8`
      )
      .all({ today });
    const soon = db
      .prepare(
        `${alertSelect} WHERE ${openLoan} AND l.due_date >= @today
           AND l.due_date <= date(@today, '+3 days')
         ORDER BY l.due_date ASC LIMIT 8`
      )
      .all({ today });
    const autoRenewedToday = db
      .prepare(
        `${alertSelect} WHERE l.auto_renewed = 1 AND substr(l.issued_at, 1, 10) = @today
         ORDER BY l.issued_at DESC LIMIT 8`
      )
      .all({ today });

    const counts = {
      overdue: db
        .prepare(`SELECT COUNT(*) AS c FROM loans l WHERE ${openLoan} AND l.due_date < @today`)
        .get({ today }).c,
      soon: db
        .prepare(
          `SELECT COUNT(*) AS c FROM loans l WHERE ${openLoan} AND l.due_date >= @today
             AND l.due_date <= date(@today, '+3 days')`
        )
        .get({ today }).c,
      autoRenewedToday: db
        .prepare(
          `SELECT COUNT(*) AS c FROM loans l WHERE l.auto_renewed = 1
             AND substr(l.issued_at, 1, 10) = @today`
        )
        .get({ today }).c,
      borrowers: db.prepare("SELECT COUNT(*) AS c FROM borrowers").get().c,
      loans: db.prepare("SELECT COUNT(*) AS c FROM loans WHERE voided = 0").get().c,
      payments: db.prepare("SELECT COUNT(*) AS c FROM payments WHERE voided = 0").get().c,
    };

    const migrationError = db
      .prepare("SELECT value FROM meta WHERE key = 'legacyImportError'")
      .get();

    return {
      settings: settings(),
      today,
      alerts: { overdue, soon, autoRenewedToday },
      alertCount: counts.overdue + counts.soon + counts.autoRenewedToday,
      counts,
      migrationError: migrationError ? migrationError.value : null,
      paths: {
        database: ctx.dbFile,
        backups: ctx.backupsDir,
        keyFile: ctx.keyFile,
      },
    };
  }

  function dashboard() {
    const today = todayUtc();
    const loanTotals = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN voided = 0 THEN amount ELSE 0 END), 0) AS "totalLent",
           COALESCE(SUM(CASE WHEN voided = 0 AND renewed = 0
                              AND paid_amount < total_payable - 0.5
                             THEN MAX(0, total_payable - paid_amount) ELSE 0 END), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN voided = 0 AND renewed = 0
                              AND paid_amount < total_payable - 0.5
                             THEN 1 ELSE 0 END), 0) AS "activeCount",
           COALESCE(SUM(CASE WHEN voided = 0 AND renewed = 0
                              AND paid_amount < total_payable - 0.5
                              AND due_date < @today
                             THEN 1 ELSE 0 END), 0) AS "overdueCount"
         FROM loans`
      )
      .get({ today });
    const totalCollected = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE voided = 0")
      .get().s;
    const totalCosts = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE voided = 0")
      .get().s;

    const dueToday = db
      .prepare(
        `SELECT l.id, l.loan_number AS "loanNumber", l.borrower_id AS "borrowerId",
                b.full_name AS "borrowerName", l.total_payable AS "totalPayable",
                l.paid_amount AS "paidAmount", l.due_date AS "dueDate",
                l.next_due_date AS "nextDueDate"
           FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id
          WHERE l.voided = 0 AND l.renewed = 0
            AND l.paid_amount < l.total_payable - 0.5
            AND l.next_due_date = @today
          ORDER BY b.full_name COLLATE NOCASE ASC LIMIT 20`
      )
      .all({ today })
      .map((r) => ({ ...r, remaining: Math.max(0, num(r.totalPayable) - num(r.paidAmount)) }));
    const dueTodayCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM loans l
          WHERE l.voided = 0 AND l.renewed = 0
            AND l.paid_amount < l.total_payable - 0.5
            AND l.next_due_date = @today`
      )
      .get({ today }).c;

    const overdue = db
      .prepare(
        `SELECT l.id, l.loan_number AS "loanNumber", l.borrower_id AS "borrowerId",
                b.full_name AS "borrowerName", l.due_date AS "dueDate"
           FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id
          WHERE l.voided = 0 AND l.renewed = 0
            AND l.paid_amount < l.total_payable - 0.5 AND l.due_date < @today
          ORDER BY l.due_date ASC LIMIT 6`
      )
      .all({ today });

    const recentPayments = db
      .prepare(
        `SELECT p.id, p.loan_id AS "loanId", p.borrower_id AS "borrowerId",
                p.amount, p.date, b.full_name AS "borrowerName"
           FROM payments p INDEXED BY idx_payments_order
           LEFT JOIN borrowers b ON b.id = p.borrower_id
          WHERE p.voided = 0
          ORDER BY p.date DESC, p.created_at DESC, p.id DESC LIMIT 5`
      )
      .all();

    const recentLoans = db
      .prepare(
        `SELECT l.id, l.loan_number AS "loanNumber", l.borrower_id AS "borrowerId",
                l.amount, l.issue_date AS "issueDate", b.full_name AS "borrowerName"
           FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id
          WHERE l.voided = 0
          ORDER BY l.issue_date DESC, l.issued_at DESC, l.id DESC LIMIT 5`
      )
      .all();

    return {
      totals: {
        totalLent: num(loanTotals.totalLent),
        totalCollected: num(totalCollected),
        outstanding: num(loanTotals.outstanding),
        activeCount: num(loanTotals.activeCount),
        overdueCount: num(loanTotals.overdueCount),
      },
      totalCosts: num(totalCosts),
      dueToday,
      dueTodayCount,
      overdue,
      recentPayments,
      recentLoans,
    };
  }

  function borrowersPage(params = {}) {
    const { limit, page, offset } = pageArgs(params, 50);
    const q = text(params.q, 200);
    let where = "1 = 1";
    const bind = { limit, offset };
    if (q) {
      where +=
        " AND (b.full_name LIKE @like OR b.phone LIKE @like OR b.alt_phone LIKE @like OR b.national_id LIKE @like)";
      bind.like = `%${q}%`;
    }
    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM borrowers b WHERE ${where}`)
      .get(bind).c;
    // Read the requested page first, then aggregate loan stats for those
    // borrowers only. Correlated subqueries in the page query would run for
    // every borrower in the table before LIMIT could discard them.
    const items = db
      .prepare(
        `SELECT b.* FROM borrowers b
          WHERE ${where}
          ORDER BY b.full_name COLLATE NOCASE ASC
          LIMIT @limit OFFSET @offset`
      )
      .all(bind)
      .map(borrowerRow);

    if (items.length) {
      const statBind = {};
      const placeholders = items
        .map((row, i) => {
          statBind[`id${i}`] = row.id;
          return `@id${i}`;
        })
        .join(", ");
      const stats = db
        .prepare(
          `SELECT borrower_id AS id,
                  SUM(CASE WHEN voided = 0 THEN 1 ELSE 0 END) AS "loanCount",
                  COALESCE(SUM(CASE WHEN voided = 0 AND renewed = 0
                                    THEN MAX(0, total_payable - paid_amount) ELSE 0 END), 0) AS outstanding
             FROM loans
            WHERE borrower_id IN (${placeholders})
            GROUP BY borrower_id`
        )
        .all(statBind);
      const byBorrower = new Map(stats.map((s) => [s.id, s]));
      for (const item of items) {
        const stat = byBorrower.get(item.id);
        item.loanCount = num(stat?.loanCount);
        item.outstanding = num(stat?.outstanding);
      }
    }
    return {
      items,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  function borrowerGet(params = {}) {
    const id = idText(params.id);
    const today = todayUtc();
    const row = db
      .prepare(
        `SELECT b.*,
           (SELECT COUNT(*) FROM loans l WHERE l.borrower_id = b.id) AS "loanCount",
           (SELECT COUNT(*) FROM loans l WHERE l.borrower_id = b.id AND l.voided = 0) AS "activeLoanCount",
           (SELECT COUNT(*) FROM payments p WHERE p.borrower_id = b.id AND p.voided = 0) AS "paymentCount",
           (SELECT COUNT(*) FROM collateral c WHERE c.borrower_id = b.id) AS "collateralCount",
           COALESCE((SELECT SUM(MAX(0, l.total_payable - l.paid_amount))
                       FROM loans l WHERE l.borrower_id = b.id
                         AND l.voided = 0 AND l.renewed = 0), 0) AS outstanding,
           COALESCE((SELECT SUM(MAX(0, l.amount - l.principal_paid))
                       FROM loans l WHERE l.borrower_id = b.id
                         AND l.voided = 0 AND l.renewed = 0), 0) AS "outstandingNoInterest"
         FROM borrowers b WHERE b.id = @id`
      )
      .get({ id });
    if (!row) return null;

    const { limit, page, offset } = pageArgs(
      { page: params.loanPage, limit: params.loanLimit || 50 },
      50
    );
    const loanTotal = db
      .prepare("SELECT COUNT(*) AS c FROM loans l WHERE l.borrower_id = @id")
      .get({ id }).c;
    const loans = db
      .prepare(
        `SELECT l.*, ${STATUS_SQL} AS status
           FROM loans l WHERE l.borrower_id = @id
          ORDER BY l.issue_date DESC, l.issued_at DESC, l.id DESC
          LIMIT @limit OFFSET @offset`
      )
      .all({ id, today, limit, offset })
      .map(loanRow);

    const collateral = db
      .prepare(
        `SELECT c.* FROM collateral c WHERE c.borrower_id = @id
          ORDER BY c.date_received DESC, c.id DESC LIMIT 100`
      )
      .all({ id })
      .map(collateralRow);
    const collateralTotal = db
      .prepare("SELECT COUNT(*) AS c FROM collateral WHERE borrower_id = @id")
      .get({ id }).c;

    return {
      borrower: borrowerRow(row),
      summary: {
        loanCount: num(row.loanCount),
        activeLoanCount: num(row.activeLoanCount),
        paymentCount: num(row.paymentCount),
        collateralCount: num(row.collateralCount),
        outstanding: num(row.outstanding),
        outstandingNoInterest: num(row.outstandingNoInterest),
      },
      loans,
      loanPage: page,
      loanLimit: limit,
      loanPageCount: Math.max(1, Math.ceil(loanTotal / limit)),
      loanTotal,
      collateral,
      collateralTotal,
    };
  }

  /** Everything needed to print or export one borrower's full statement.
   *  Unlike borrowerGet (which pages the loan history for the screen) this
   *  returns the complete history, bounded only as a safety valve. */
  function borrowerStatement(params = {}) {
    const id = idText(params.id);
    const today = todayUtc();
    const row = db
      .prepare(
        `SELECT b.*,
           (SELECT COUNT(*) FROM loans l WHERE l.borrower_id = b.id) AS "loanCount",
           (SELECT COUNT(*) FROM payments p WHERE p.borrower_id = b.id AND p.voided = 0) AS "paymentCount",
           (SELECT COUNT(*) FROM collateral c WHERE c.borrower_id = b.id) AS "collateralCount",
           COALESCE((SELECT SUM(MAX(0, l.total_payable - l.paid_amount))
                       FROM loans l WHERE l.borrower_id = b.id
                         AND l.voided = 0 AND l.renewed = 0), 0) AS outstanding,
           COALESCE((SELECT SUM(MAX(0, l.amount - l.principal_paid))
                       FROM loans l WHERE l.borrower_id = b.id
                         AND l.voided = 0 AND l.renewed = 0), 0) AS "outstandingNoInterest"
         FROM borrowers b WHERE b.id = @id`
      )
      .get({ id });
    if (!row) return null;

    const loanLimit = 10000;
    const paymentLimit = 50000;
    const loans = db
      .prepare(
        `SELECT l.*, ${STATUS_SQL} AS status FROM loans l
          WHERE l.borrower_id = @id
          ORDER BY l.issue_date ASC, l.issued_at ASC, l.id ASC LIMIT @limit`
      )
      .all({ id, today, limit: loanLimit })
      .map(loanRow);
    const payments = db
      .prepare(
        `SELECT p.*, l.loan_number AS "loanNumber" FROM payments p
           LEFT JOIN loans l ON l.id = p.loan_id
          WHERE p.borrower_id = @id
          ORDER BY p.date ASC, p.created_at ASC, p.id ASC LIMIT @limit`
      )
      .all({ id, limit: paymentLimit })
      .map(paymentRow);
    const collateral = db
      .prepare(
        `SELECT c.*, l.loan_number AS "loanNumber" FROM collateral c
           LEFT JOIN loans l ON l.id = c.loan_id
          WHERE c.borrower_id = @id
          ORDER BY c.date_received ASC, c.id ASC LIMIT 10000`
      )
      .all({ id })
      .map(collateralRow);

    return {
      borrower: borrowerRow(row),
      summary: {
        loanCount: num(row.loanCount),
        paymentCount: num(row.paymentCount),
        collateralCount: num(row.collateralCount),
        outstanding: num(row.outstanding),
        outstandingNoInterest: num(row.outstandingNoInterest),
      },
      loans,
      payments,
      collateral,
      loansTruncated: num(row.loanCount) > loans.length,
      paymentsTruncated: num(row.paymentCount) > payments.length,
    };
  }

  function borrowerPick(params = {}) {
    const q = text(params.q, 200);
    const limit = Math.min(Math.max(num(params.limit) || 20, 1), 50);
    const bind = { limit };
    let where = "1 = 1";
    if (q) {
      where = "b.full_name LIKE @like OR b.phone LIKE @like OR b.national_id LIKE @like";
      bind.like = `%${q}%`;
    }
    return db
      .prepare(
        `SELECT b.id, b.full_name AS "fullName", b.phone, b.national_id AS "nationalId"
           FROM borrowers b WHERE ${where}
          ORDER BY b.full_name COLLATE NOCASE ASC LIMIT @limit`
      )
      .all(bind);
  }

  function borrowerDuplicate(params = {}) {
    const name = text(params.name, 200).toLowerCase();
    const phone = text(params.phone, 60);
    if (!name || !phone) return null;
    const row = db
      .prepare(
        `SELECT id, full_name AS "fullName", phone, date_registered AS "dateRegistered"
           FROM borrowers
          WHERE lower(trim(full_name)) = @name AND trim(phone) = @phone
            AND (@excludeId IS NULL OR id <> @excludeId)
          LIMIT 1`
      )
      .get({ name, phone, excludeId: params.excludeId || null });
    return row || null;
  }

  function loansPage(params = {}) {
    const today = todayUtc();
    const filter = params.filter || "All";
    const groupBy = params.groupBy || "month";
    const expr = groupExpr(groupBy);
    const where = statusWhere(filter, today);
    const { limit, page, offset } = pageArgs(params, 50);

    const groups = db
      .prepare(
        `SELECT ${expr} AS key, COUNT(*) AS "count",
                COALESCE(SUM(l.amount), 0) AS "totalPrincipal",
                COALESCE(SUM(MAX(0, l.total_payable - l.paid_amount)), 0) AS "totalOutstanding"
           FROM loans l WHERE ${where.sql}
          GROUP BY key ORDER BY key DESC`
      )
      .all(where.params)
      .map((g) => ({ ...g, label: groupLabel(g.key, groupBy) }));

    if (groups.length === 0) {
      return { groups: [], groupKey: null, items: [], total: 0, page: 1, pageCount: 1, limit };
    }
    let groupKey = params.groupKey;
    if (!groupKey || !groups.some((g) => g.key === groupKey)) {
      groupKey = groups[0].key;
    }
    const total = db
      .prepare(
        `SELECT COUNT(*) AS c FROM loans l WHERE ${where.sql} AND ${expr} = @key`
      )
      .get({ ...where.params, key: groupKey }).c;
    const pageCount = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pageCount);
    const items = db
      .prepare(
        `SELECT l.*, b.full_name AS "borrowerName", ${STATUS_SQL} AS status
           FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id
          WHERE ${where.sql} AND ${expr} = @key
          ORDER BY l.issue_date DESC, l.issued_at DESC, l.id DESC
          LIMIT @limit OFFSET @offset`
      )
      .all({
        ...where.params,
        key: groupKey,
        limit,
        offset: (safePage - 1) * limit,
      })
      .map(loanRow);

    return { groups, groupKey, items, total, page: safePage, pageCount, limit };
  }

  function loanGet(params = {}) {
    const id = idText(params.id);
    const today = todayUtc();
    const row = db
      .prepare(
        `SELECT l.*, b.full_name AS "borrowerName", ${STATUS_SQL} AS status
           FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id
          WHERE l.id = @id`
      )
      .get({ id, today });
    if (!row) return null;
    const paymentLimit = Math.min(Math.max(num(params.paymentLimit) || 1000, 0), 5000);
    const payments = db
      .prepare(
        `SELECT * FROM payments WHERE loan_id = @id
          ORDER BY date DESC, created_at DESC, id DESC LIMIT @limit`
      )
      .all({ id, limit: paymentLimit })
      .map(paymentRow);
    const paymentCount = db
      .prepare("SELECT COUNT(*) AS c FROM payments WHERE loan_id = @id")
      .get({ id }).c;
    const collateral = db
      .prepare(
        `SELECT c.*, b.full_name AS "borrowerName" FROM collateral c
           LEFT JOIN borrowers b ON b.id = c.borrower_id
          WHERE c.loan_id = @id ORDER BY c.date_received DESC LIMIT 200`
      )
      .all({ id })
      .map(collateralRow);
    const collateralCount = db
      .prepare("SELECT COUNT(*) AS c FROM collateral WHERE loan_id = @id")
      .get({ id }).c;
    const borrower = db
      .prepare("SELECT * FROM borrowers WHERE id = ?")
      .get(row.borrower_id);

    return {
      loan: loanRow(row),
      borrower: borrowerRow(borrower),
      payments,
      paymentCount,
      paymentsTruncated: paymentCount > paymentLimit,
      collateral,
      collateralCount,
    };
  }

  function loansPicker(params = {}) {
    const q = text(params.q, 200);
    const mode = params.mode === "active" ? "active" : "open";
    const limit = Math.min(Math.max(num(params.limit) || 30, 1), 100);
    const bind = { limit, today: todayUtc() };
    let where = "l.voided = 0 AND l.renewed = 0";
    if (mode === "open") where += " AND l.paid_amount < l.total_payable - 0.5";
    if (q) {
      where += ' AND (l.loan_number LIKE @like OR b.full_name LIKE @like OR b.phone LIKE @like)';
      bind.like = `%${q}%`;
    }
    return db
      .prepare(
        `SELECT l.id, l.loan_number AS "loanNumber", l.borrower_id AS "borrowerId",
                b.full_name AS "borrowerName", b.phone AS "borrowerPhone",
                l.amount, l.total_payable AS "totalPayable",
                l.paid_amount AS "paidAmount", l.principal_paid AS "principalPaid",
                l.interest_paid AS "interestPaid", l.interest_type AS "interestType",
                l.interest_value AS "interestValue", l.due_date AS "dueDate",
                MAX(0, l.total_payable - l.paid_amount) AS outstanding
           FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id
          WHERE ${where}
          ORDER BY l.due_date ASC, l.issue_date DESC LIMIT @limit`
      )
      .all(bind);
  }

  function loanPaymentContext(params = {}) {
    const id = idText(params.id);
    const excludePaymentId = params.excludePaymentId || null;
    const loan = db.prepare("SELECT * FROM loans WHERE id = ?").get(id);
    if (!loan) return null;
    const agg = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS paid,
                COALESCE(SUM(COALESCE(principal_paid, amount)), 0) AS principalPaid,
                COALESCE(SUM(COALESCE(interest_paid, 0)), 0) AS interestPaid
           FROM payments
          WHERE loan_id = @id AND voided = 0
            AND (@excludeId IS NULL OR id <> @excludeId)`
      )
      .get({ id, excludeId: excludePaymentId });
    const borrower = db
      .prepare("SELECT * FROM borrowers WHERE id = ?")
      .get(loan.borrower_id);
    const totalPayable = num(loan.total_payable);
    const amount = num(loan.amount);
    const paid = num(agg.paid);
    const principalPaid = num(agg.principalPaid);
    const interestPaid = num(agg.interestPaid);
    const interestAmount =
      loan.interest_type === "Percent"
        ? (amount * num(loan.interest_value)) / 100
        : num(loan.interest_value);
    return {
      loan: loanRow(loan),
      borrower: borrowerRow(borrower),
      paid,
      principalPaid,
      interestPaid,
      outstanding: Math.max(0, totalPayable - paid),
      remainingPrincipal: Math.max(0, amount - principalPaid),
      remainingInterest: Math.max(0, interestAmount - interestPaid),
    };
  }

  function paymentsPage(params = {}) {
    const { limit, page, offset } = pageArgs(params, 50);
    const q = text(params.q, 200);
    const select = `SELECT p.*, b.full_name AS "borrowerName", l.loan_number AS "loanNumber"
                      FROM payments p
                      LEFT JOIN borrowers b ON b.id = p.borrower_id
                      LEFT JOIN loans l ON l.id = p.loan_id`;
    let total;
    let rows;
    if (q) {
      // Prefilter through borrowers/loans first: searching a borrower's name
      // then touches only that borrower's payments instead of every payment
      // row in the ledger.
      const like = `%${q}%`;
      const matched = `SELECT p.id FROM payments p
                        WHERE p.reference <> '' AND p.reference LIKE @like
                       UNION
                       SELECT p.id FROM payments p
                        WHERE p.loan_id IN (SELECT l.id FROM loans l WHERE l.loan_number LIKE @like)
                       UNION
                       SELECT p.id FROM payments p
                        WHERE p.borrower_id IN (SELECT b.id FROM borrowers b WHERE b.full_name LIKE @like)`;
      total = db
        .prepare(`SELECT COUNT(*) AS c FROM (${matched})`)
        .get({ like }).c;
      rows = db
        .prepare(
          `SELECT p.*, b.full_name AS "borrowerName", l.loan_number AS "loanNumber"
             FROM (${matched}) m
             CROSS JOIN payments p ON p.id = m.id
             LEFT JOIN borrowers b ON b.id = p.borrower_id
             LEFT JOIN loans l ON l.id = p.loan_id
            ORDER BY p.date DESC, p.created_at DESC, p.id DESC
            LIMIT @limit OFFSET @offset`
        )
        .all({ like, limit, offset });
    } else {
      total = db.prepare("SELECT COUNT(*) AS c FROM payments").get().c;
      rows = db
        .prepare(
          `${select}
            ORDER BY p.date DESC, p.created_at DESC, p.id DESC
            LIMIT @limit OFFSET @offset`
        )
        .all({ limit, offset });
    }
    const items = rows.map(paymentRow);
    return {
      items,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  function collateralPage(params = {}) {
    const { limit, page, offset } = pageArgs(params, 40);
    const q = text(params.q, 200);
    let where = "1 = 1";
    const bind = { limit, offset };
    if (q) {
      where +=
        ' AND (c.description LIKE @like OR c.category LIKE @like OR c.brand LIKE @like OR c.serial LIKE @like OR b.full_name LIKE @like OR l.loan_number LIKE @like)';
      bind.like = `%${q}%`;
    }
    const total = db
      .prepare(
        `SELECT COUNT(*) AS c FROM collateral c
           LEFT JOIN borrowers b ON b.id = c.borrower_id
           LEFT JOIN loans l ON l.id = c.loan_id
          WHERE ${where}`
      )
      .get(bind).c;
    const items = db
      .prepare(
        `SELECT c.*, b.full_name AS "borrowerName", l.loan_number AS "loanNumber"
           FROM collateral c
           LEFT JOIN borrowers b ON b.id = c.borrower_id
           LEFT JOIN loans l ON l.id = c.loan_id
          WHERE ${where}
          ORDER BY c.date_received DESC, c.id DESC
          LIMIT @limit OFFSET @offset`
      )
      .all(bind)
      .map(collateralRow);
    return {
      items,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  function expensesPage(params = {}) {
    const { limit, page, offset } = pageArgs(params, 50);
    const q = text(params.q, 200);
    let where = "1 = 1";
    const bind = { limit, offset };
    if (q) {
      where += " AND (description LIKE @like OR category LIKE @like OR method LIKE @like)";
      bind.like = `%${q}%`;
    }
    const total = db.prepare(`SELECT COUNT(*) AS c FROM expenses WHERE ${where}`).get(bind).c;
    const totalAmount = db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE voided = 0`)
      .get().s;
    const items = db
      .prepare(
        `SELECT * FROM expenses WHERE ${where}
          ORDER BY date DESC, id DESC LIMIT @limit OFFSET @offset`
      )
      .all(bind)
      .map(expenseRow);
    return {
      items,
      total,
      totalAmount: num(totalAmount),
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  function expenseBalances(params = {}) {
    const limit = Math.min(Math.max(num(params.limit) || 14, 1), 4000);
    // Group once and derive the total day count and the opening balance from
    // the same result. Three separate passes over the cash_events view cost
    // seconds each once the payments table is large.
    const allDays = db
      .prepare(
        `SELECT date, SUM(cash_in) AS "cashIn", SUM(cash_out) AS "cashOut"
           FROM cash_events GROUP BY date ORDER BY date DESC`
      )
      .all()
      .map((r) => ({ date: r.date, cashIn: num(r.cashIn), cashOut: num(r.cashOut) }));
    const totalDays = allDays.length;
    if (totalDays === 0) return { days: [], totalDays: 0 };
    const rows = allDays.slice(0, limit);
    let priorNet = 0;
    for (let i = rows.length; i < allDays.length; i++) {
      priorNet += allDays[i].cashIn - allDays[i].cashOut;
    }
    let running = (getSettings(db).startingCashBalance || 0) + num(priorNet);
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      row.opening = running;
      row.closing = running + row.cashIn - row.cashOut;
      running = row.closing;
    }
    return { days: rows, totalDays };
  }

  function fundingOverview(params = {}) {
    const groupBy = params.groupBy || "month";
    const expr = fundingGroupExpr(groupBy);
    const totals = db
      .prepare(
        `SELECT type, COALESCE(SUM(amount), 0) AS total,
                COALESCE(SUM(repaid_amount), 0) AS repaid
           FROM external_funds WHERE voided = 0 GROUP BY type`
      )
      .all();
    let externalOutstanding = 0;
    let bankOutstanding = 0;
    for (const t of totals) {
      const out = Math.max(0, num(t.total) - num(t.repaid));
      if (t.type === "Bank") bankOutstanding += out;
      else externalOutstanding += out;
    }

    const groups = db
      .prepare(
        `WITH events AS (
           SELECT date_received AS date, 'received' AS kind, type, amount
             FROM external_funds WHERE voided = 0
           UNION ALL
           SELECT r.date, 'paid', f.type, r.amount
             FROM fund_repayments r JOIN external_funds f ON f.id = r.fund_id
            WHERE r.voided = 0 AND f.voided = 0
         )
         SELECT ${expr} AS key, COUNT(*) AS "count",
                COALESCE(SUM(CASE WHEN kind = 'received' THEN amount ELSE 0 END), 0) AS received,
                COALESCE(SUM(CASE WHEN kind = 'paid' THEN amount ELSE 0 END), 0) AS paid
           FROM events GROUP BY key ORDER BY key DESC`
      )
      .all()
      .map((g) => ({ ...g, label: groupLabel(g.key, groupBy) }));

    return {
      groups,
      externalOutstanding,
      bankOutstanding,
      groupBy,
    };
  }

  function fundingEvents(params = {}) {
    const groupBy = params.groupBy || "month";
    const expr = fundingGroupExpr(groupBy);
    const key = params.groupKey;
    if (!key) return { events: [], truncated: false };
    const limit = Math.min(Math.max(num(params.limit) || 2000, 1), 5000);
    const rows = db
      .prepare(
        `WITH events AS (
           SELECT f.id AS fund_id, NULL AS repayment_id, f.source, f.type,
                  f.amount AS fund_amount, f.date_received AS fund_date,
                  f.expected_repayment_date, f.notes AS fund_notes, f.voided AS fund_voided,
                  f.repaid_amount, f.date_received AS date, 'received' AS kind,
                  0.0 AS repayment_amount, NULL AS repayment_method,
                  NULL AS repayment_notes, 0 AS repayment_voided
             FROM external_funds f WHERE f.voided = 0
           UNION ALL
           SELECT f.id, r.id, f.source, f.type,
                  f.amount, f.date_received, f.expected_repayment_date,
                  f.notes, f.voided, f.repaid_amount,
                  r.date, 'paid', r.amount, r.method, r.notes, r.voided
             FROM fund_repayments r JOIN external_funds f ON f.id = r.fund_id
            WHERE r.voided = 0 AND f.voided = 0
         )
         SELECT * FROM events WHERE ${expr} = @key
          ORDER BY date DESC, kind ASC LIMIT @limit`
      )
      .all({ key, limit });

    const total = db
      .prepare(
        `WITH events AS (
           SELECT date_received AS date FROM external_funds WHERE voided = 0
           UNION ALL
           SELECT r.date FROM fund_repayments r JOIN external_funds f ON f.id = r.fund_id
            WHERE r.voided = 0 AND f.voided = 0
         )
         SELECT COUNT(*) AS c FROM events WHERE ${expr} = @key`
      )
      .get({ key }).c;

    const events = rows.map((r) => {
      const fund = fundRow({
        id: r.fund_id,
        type: r.type,
        source: r.source,
        amount: r.fund_amount,
        date_received: r.fund_date,
        expected_repayment_date: r.expected_repayment_date,
        notes: r.fund_notes,
        voided: r.fund_voided,
        repaid_amount: r.repaid_amount,
      });
      return {
        date: r.date,
        kind: r.kind,
        type: r.type,
        amount: num(r.kind === "paid" ? r.repayment_amount : r.fund_amount),
        fund,
        ...(r.kind === "paid"
          ? {
              repayment: {
                id: r.repayment_id,
                fundId: r.fund_id,
                amount: num(r.repayment_amount),
                date: r.date,
                method: r.repayment_method || "Cash",
                notes: r.repayment_notes || "",
                voided: !!r.repayment_voided,
              },
            }
          : {}),
      };
    });

    return { events, truncated: total > rows.length, total };
  }

  function fundingOpen(params = {}) {
    const q = text(params.q, 200);
    const excludeRepaymentId = params.excludeRepaymentId || null;
    const limit = Math.min(Math.max(num(params.limit) || 40, 1), 100);
    const bind = { limit, excludeId: excludeRepaymentId };
    let where = "f.voided = 0";
    if (q) {
      where += " AND (f.source LIKE @like OR f.type LIKE @like)";
      bind.like = `%${q}%`;
    }
    const rows = db
      .prepare(
        `SELECT f.*,
                COALESCE((SELECT SUM(r.amount) FROM fund_repayments r
                           WHERE r.fund_id = f.id AND r.voided = 0
                             AND (@excludeId IS NULL OR r.id <> @excludeId)), 0) AS repaid_amount
           FROM external_funds f WHERE ${where}
          ORDER BY f.date_received DESC, f.id DESC LIMIT @limit`
      )
      .all(bind)
      .map(fundRow);
    return rows.filter(
      (f) => f.outstanding > 0.5 || f.id === params.selectedFundId
    );
  }

  function fundRepaymentContext(params = {}) {
    const id = params.fundId;
    const excludeRepaymentId = params.excludeRepaymentId || null;
    const row = db
      .prepare(
        `SELECT f.*,
                COALESCE((SELECT SUM(r.amount) FROM fund_repayments r
                           WHERE r.fund_id = f.id AND r.voided = 0
                             AND (@excludeId IS NULL OR r.id <> @excludeId)), 0) AS repaid_amount
           FROM external_funds f WHERE f.id = @id`
      )
      .get({ id, excludeId: excludeRepaymentId });
    return row ? fundRow(row) : null;
  }

  function reportsSummary() {
    const today = todayUtc();
    const totals = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN voided = 0 THEN amount ELSE 0 END), 0) AS "totalLent",
           COALESCE(SUM(CASE WHEN voided = 0 AND renewed = 0
                              AND paid_amount < total_payable - 0.5
                             THEN MAX(0, total_payable - paid_amount) ELSE 0 END), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN voided = 0 AND renewed = 0
                              AND paid_amount < total_payable - 0.5
                             THEN 1 ELSE 0 END), 0) AS "activeCount",
           COALESCE(SUM(CASE WHEN voided = 0 AND renewed = 0
                              AND paid_amount < total_payable - 0.5
                              AND due_date < @today
                             THEN 1 ELSE 0 END), 0) AS "overdueCount"
         FROM loans`
      )
      .get({ today });
    const totalCollected = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE voided = 0")
      .get().s;
    const totalCosts = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE voided = 0")
      .get().s;
    const borrowerCount = db.prepare("SELECT COUNT(*) AS c FROM borrowers").get().c;
    const loanCount = db
      .prepare("SELECT COUNT(*) AS c FROM loans WHERE voided = 0")
      .get().c;
    const fullyPaid = db
      .prepare(
        `SELECT COUNT(*) AS c FROM loans
          WHERE voided = 0 AND renewed = 0 AND paid_amount >= total_payable - 0.5`
      )
      .get().c;
    const categoryRows = db
      .prepare(
        `SELECT category, COALESCE(SUM(amount), 0) AS amount
           FROM expenses WHERE voided = 0
          GROUP BY category ORDER BY amount DESC`
      )
      .all()
      .map((r) => [r.category || "Other", num(r.amount)]);

    return {
      borrowerCount,
      loanCount,
      fullyPaid,
      totalLent: num(totals.totalLent),
      totalCollected: num(totalCollected),
      outstanding: num(totals.outstanding),
      activeCount: num(totals.activeCount),
      overdueCount: num(totals.overdueCount),
      totalCosts: num(totalCosts),
      categoryRows,
      netPosition: num(totalCollected) - num(totals.totalLent) - num(totalCosts),
    };
  }

  function auditPage(params = {}) {
    const { limit, page, offset } = pageArgs(params, 60);
    const q = text(params.q, 200);
    const user = text(params.user, 200, "All");
    let where = "1 = 1";
    const bind = { limit, offset };
    if (q) {
      where += " AND action LIKE @like";
      bind.like = `%${q}%`;
    }
    if (user && user !== "All") {
      where += " AND username = @user";
      bind.user = user;
    }
    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE ${where}`)
      .get(bind).c;
    const items = db
      .prepare(
        `SELECT * FROM audit_log WHERE ${where}
          ORDER BY timestamp DESC, id DESC LIMIT @limit OFFSET @offset`
      )
      .all(bind)
      .map(auditRow);
    const usernames = db
      .prepare(
        "SELECT DISTINCT username FROM audit_log WHERE username <> '' ORDER BY username COLLATE NOCASE ASC LIMIT 200"
      )
      .all()
      .map((r) => r.username);
    return {
      items,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      usernames,
    };
  }

  function approvalsPage() {
    const pending = db
      .prepare(
        "SELECT * FROM deletion_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 200"
      )
      .all()
      .map(deletionRow);
    const resolved = db
      .prepare(
        "SELECT * FROM deletion_requests WHERE status <> 'pending' ORDER BY created_at DESC LIMIT 100"
      )
      .all()
      .map(deletionRow);
    const pendingCount = db
      .prepare("SELECT COUNT(*) AS c FROM deletion_requests WHERE status = 'pending'")
      .get().c;
    const resolvedCount = db
      .prepare("SELECT COUNT(*) AS c FROM deletion_requests WHERE status <> 'pending'")
      .get().c;
    return { pending, resolved, pendingCount, resolvedCount };
  }

  function usersList() {
    return db
      .prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE ASC")
      .all()
      .map((u) => userRow(u, false));
  }

  function searchAll(params = {}) {
    const q = text(params.q, 200);
    if (!q) return { borrowers: [], loans: [], payments: [], collateral: [] };
    const like = `%${q}%`;
    const today = todayUtc();

    const borrowers = db
      .prepare(
        `SELECT * FROM borrowers
          WHERE full_name LIKE @like OR phone LIKE @like OR alt_phone LIKE @like
             OR national_id LIKE @like
          ORDER BY full_name COLLATE NOCASE ASC LIMIT 20`
      )
      .all({ like })
      .map(borrowerRow);

    const loans = db
      .prepare(
        `SELECT l.*, b.full_name AS "borrowerName", ${STATUS_SQL} AS status
           FROM loans l LEFT JOIN borrowers b ON b.id = l.borrower_id
          WHERE l.loan_number LIKE @like OR b.full_name LIKE @like OR b.phone LIKE @like
          ORDER BY l.issue_date DESC LIMIT 20`
      )
      .all({ like, today })
      .map(loanRow);

    const payments = db
      .prepare(
        `SELECT p.*, b.full_name AS "borrowerName", l.loan_number AS "loanNumber"
           FROM (SELECT p.id FROM payments p
                  WHERE p.reference <> '' AND p.reference LIKE @like
                 UNION
                 SELECT p.id FROM payments p
                  WHERE p.loan_id IN (SELECT l.id FROM loans l WHERE l.loan_number LIKE @like)
                 UNION
                 SELECT p.id FROM payments p
                  WHERE p.borrower_id IN (SELECT b.id FROM borrowers b WHERE b.full_name LIKE @like)) m
           CROSS JOIN payments p ON p.id = m.id
           LEFT JOIN borrowers b ON b.id = p.borrower_id
           LEFT JOIN loans l ON l.id = p.loan_id
          ORDER BY p.date DESC LIMIT 20`
      )
      .all({ like })
      .map(paymentRow);

    const collateral = db
      .prepare(
        `SELECT c.*, b.full_name AS "borrowerName", l.loan_number AS "loanNumber"
           FROM collateral c
           LEFT JOIN borrowers b ON b.id = c.borrower_id
           LEFT JOIN loans l ON l.id = c.loan_id
          WHERE c.description LIKE @like OR c.category LIKE @like OR c.brand LIKE @like
             OR c.serial LIKE @like OR b.full_name LIKE @like
          ORDER BY c.date_received DESC LIMIT 20`
      )
      .all({ like })
      .map(collateralRow);

    return { borrowers, loans, payments, collateral };
  }

  return {
    bootstrap,
    dashboard,
    settings,
    borrowersPage,
    borrowerGet,
    borrowerStatement,
    borrowerPick,
    borrowerDuplicate,
    loansPage,
    loanGet,
    loansPicker,
    loanPaymentContext,
    paymentsPage,
    collateralPage,
    expensesPage,
    expenseBalances,
    fundingOverview,
    fundingEvents,
    fundingOpen,
    fundRepaymentContext,
    reportsSummary,
    auditPage,
    approvalsPage,
    usersList,
    searchAll,
  };
}

module.exports = { createQueries };
