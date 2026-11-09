"use strict";

/* Mapping between SQLite rows (snake_case) and the object shape the React
   components already speak (camelCase). Keeping this in one place means list
   pages, detail pages, exports and backups all agree. */

const bool = (v) => !!v;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function borrowerRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone || "",
    altPhone: r.alt_phone || "",
    nationalId: r.national_id || "",
    address: r.address || "",
    occupation: r.occupation || "",
    nextOfKin: r.next_of_kin || "",
    nextOfKinPhone: r.next_of_kin_phone || "",
    notes: r.notes || "",
    dateRegistered: r.date_registered,
    ...(r.loanCount != null ? { loanCount: r.loanCount } : {}),
    ...(r.outstanding != null ? { outstanding: r.outstanding } : {}),
  };
}

function loanRow(r) {
  if (!r) return null;
  const instalments =
    r.instalment_count != null || r.instalment_first_date
      ? {
          count: r.instalment_count || 0,
          frequency: r.instalment_frequency || "Monthly",
          expectedAmount: num(r.instalment_amount),
          firstPaymentDate: r.instalment_first_date || "",
        }
      : null;
  const totalPayable = num(r.total_payable);
  const amount = num(r.amount);
  const paidAmount = num(r.paid_amount);
  const principalPaid = num(r.principal_paid);
  return {
    id: r.id,
    loanNumber: r.loan_number,
    borrowerId: r.borrower_id,
    amount,
    interestType: r.interest_type || "Percent",
    interestValue: num(r.interest_value),
    paperworkFee: num(r.paperwork_fee),
    totalPayable,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    repaymentMethod: r.repayment_method || "Full Payment",
    instalments,
    voided: bool(r.voided),
    voidReason: r.void_reason || "",
    voidedAt: r.voided_at || "",
    renewed: bool(r.renewed),
    renewedFromId: r.renewed_from_id || null,
    renewedIntoId: r.renewed_into_id || null,
    renewedAt: r.renewed_at || "",
    autoRenewed: bool(r.auto_renewed),
    issuedAt: r.issued_at || "",
    isHistorical: bool(r.is_historical),
    paidAmount,
    principalPaid,
    interestPaid: num(r.interest_paid),
    paymentCount: num(r.payment_count),
    nextDueDate: r.next_due_date || r.due_date,
    outstanding: Math.max(0, totalPayable - paidAmount),
    outstandingNoInterest: Math.max(0, amount - principalPaid),
    ...(r.status ? { status: r.status } : {}),
    ...(r.borrowerName != null ? { borrowerName: r.borrowerName } : {}),
    ...(r.borrowerPhone != null ? { borrowerPhone: r.borrowerPhone } : {}),
  };
}

function paymentRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    loanId: r.loan_id,
    borrowerId: r.borrower_id,
    amount: num(r.amount),
    principalPaid: num(r.principal_paid),
    interestPaid: num(r.interest_paid),
    date: r.date,
    method: r.method || "Cash",
    reference: r.reference || "",
    notes: r.notes || "",
    voided: bool(r.voided),
    createdAt: r.created_at || "",
    ...(r.borrowerName != null ? { borrowerName: r.borrowerName } : {}),
    ...(r.loanNumber != null ? { loanNumber: r.loanNumber } : {}),
  };
}

function collateralRow(r) {
  if (!r) return null;
  let photos = [];
  try {
    photos = r.photos ? JSON.parse(r.photos) : [];
  } catch (e) {
    photos = [];
  }
  return {
    id: r.id,
    loanId: r.loan_id,
    borrowerId: r.borrower_id,
    description: r.description || "",
    category: r.category || "",
    brand: r.brand || "",
    model: r.model || "",
    serial: r.serial || "",
    estimatedValue: num(r.estimated_value),
    condition: r.condition || "",
    dateReceived: r.date_received || "",
    storageLocation: r.storage_location || "",
    status: r.status || "Held",
    notes: r.notes || "",
    photos,
    ...(r.borrowerName != null ? { borrowerName: r.borrowerName } : {}),
    ...(r.loanNumber != null ? { loanNumber: r.loanNumber } : {}),
  };
}

function expenseRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    description: r.description || "",
    category: r.category || "",
    amount: num(r.amount),
    date: r.date,
    method: r.method || "Cash",
    notes: r.notes || "",
    voided: bool(r.voided),
  };
}

function fundRow(r) {
  if (!r) return null;
  const amount = num(r.amount);
  const repaid = num(r.repaid_amount);
  return {
    id: r.id,
    type: r.type || "External Loan",
    source: r.source || "",
    amount,
    dateReceived: r.date_received || "",
    expectedRepaymentDate: r.expected_repayment_date || "",
    notes: r.notes || "",
    voided: bool(r.voided),
    repaidAmount: repaid,
    outstanding: Math.max(0, amount - repaid),
  };
}

function fundRepaymentRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    fundId: r.fund_id,
    amount: num(r.amount),
    date: r.date,
    method: r.method || "Cash",
    notes: r.notes || "",
    voided: bool(r.voided),
    ...(r.source != null ? { source: r.source } : {}),
    ...(r.type != null ? { type: r.type } : {}),
  };
}

function auditRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    timestamp: r.timestamp,
    username: r.username || "",
    action: r.action,
  };
}

function deletionRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
  };
}

function userRow(r, includeSecrets) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    fullName: r.full_name || "",
    role: r.role || "Viewer",
    active: bool(r.active),
    createdAt: r.created_at || "",
    ...(includeSecrets
      ? { passwordHash: r.password_hash || "", passwordSalt: r.password_salt || "" }
      : {}),
  };
}

/* SQL expression for the app's loan status, in the same precedence order as
   the old renderer helper: Voided, Renewed, Fully Paid, Overdue, Active.
   Bind @today to a YYYY-MM-DD string. */
const STATUS_SQL = `CASE
  WHEN l.voided = 1 THEN 'Voided'
  WHEN l.renewed = 1 THEN 'Renewed'
  WHEN l.paid_amount >= l.total_payable - 0.5 THEN 'Fully Paid'
  WHEN l.due_date < @today THEN 'Overdue'
  ELSE 'Active'
END`;

/* WHERE fragments used by list filters. Keep these aligned with STATUS_SQL. */
function statusWhere(filter, today) {
  switch (filter) {
    case "Voided":
      return { sql: "l.voided = 1", params: { today } };
    case "Renewed":
      return { sql: "l.renewed = 1", params: { today } };
    case "Fully Paid":
      return {
        sql: "l.voided = 0 AND l.renewed = 0 AND l.paid_amount >= l.total_payable - 0.5",
        params: { today },
      };
    case "Overdue":
      return {
        sql:
          "l.voided = 0 AND l.renewed = 0 AND l.paid_amount < l.total_payable - 0.5 AND l.due_date < @today",
        params: { today },
      };
    case "Active":
      return {
        sql:
          "l.voided = 0 AND l.renewed = 0 AND l.paid_amount < l.total_payable - 0.5 AND l.due_date >= @today",
        params: { today },
      };
    case "All":
    default:
      return { sql: "1 = 1", params: { today } };
  }
}

function groupExpr(groupBy) {
  switch (groupBy) {
    case "day":
      return "l.issue_date";
    case "week":
      return "date(l.issue_date, 'weekday 0', '-6 days')";
    case "year":
      return "substr(l.issue_date, 1, 4)";
    case "month":
    default:
      return "substr(l.issue_date, 1, 7)";
  }
}

function fundingGroupExpr(groupBy) {
  switch (groupBy) {
    case "day":
      return "date";
    case "week":
      return "date(date, 'weekday 0', '-6 days')";
    case "year":
      return "substr(date, 1, 4)";
    case "month":
    default:
      return "substr(date, 1, 7)";
  }
}

function groupLabel(key, groupBy) {
  if (!key) return "";
  if (groupBy === "year") return String(key);
  if (groupBy === "month") {
    const [y, m] = String(key).split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }
  if (groupBy === "week") {
    const start = new Date(String(key) + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `Week of ${start.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    })} to ${end.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  }
  const d = new Date(String(key) + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

module.exports = {
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
};
