"use strict";

const {
  todayUtc,
  nowIso,
  uid,
  num,
  logAudit,
  setSetting,
  nextLoanNumber,
  computeNextDueDate,
  FREQ_DAYS,
} = require("./util");
const { borrowerRow, loanRow, paymentRow, collateralRow, fundRow } = require("./rows");
const { userRow } = require("./rows");

const fmtMoney = (v) =>
  `UGX ${Math.round(Number(v) || 0).toLocaleString("en-UG")}`;

function createMutations(ctx, auth) {
  const { db } = ctx;

  const getLoan = (id) => db.prepare("SELECT * FROM loans WHERE id = ?").get(id);
  const getBorrower = (id) =>
    db.prepare("SELECT * FROM borrowers WHERE id = ?").get(id);
  const getFund = (id) =>
    db.prepare("SELECT * FROM external_funds WHERE id = ?").get(id);

  function insertLoan(input, extra = {}) {
    const amount = num(input.amount);
    const interestType = input.interestType || "Percent";
    const interestValue = num(input.interestValue);
    const paperworkFee = num(input.paperworkFee);
    const interestAmount =
      interestType === "Percent" ? (amount * interestValue) / 100 : interestValue;
    const totalPayable = amount + interestAmount + paperworkFee;
    const issueDate = input.issueDate || todayUtc();
    const dueDate = input.dueDate || issueDate;
    const repaymentMethod = input.repaymentMethod || "Full Payment";
    const inst =
      repaymentMethod === "Instalments" && input.instalments
        ? {
            count: num(input.instalments.count),
            frequency: input.instalments.frequency || "Monthly",
            expectedAmount: num(input.instalments.expectedAmount),
            firstPaymentDate: input.instalments.firstPaymentDate || issueDate,
          }
        : null;
    const id = uid("loan");
    const loanNumber = nextLoanNumber(db);
    const nextDue = inst ? inst.firstPaymentDate : dueDate;

    db.prepare(
      `INSERT INTO loans (
         id, loan_number, borrower_id, amount, interest_type, interest_value,
         paperwork_fee, total_payable, issue_date, due_date, repayment_method,
         instalment_count, instalment_frequency, instalment_amount,
         instalment_first_date, voided, renewed, auto_renewed, issued_at,
         is_historical, paid_amount, principal_paid, interest_paid, payment_count,
         next_due_date, renewed_from_id
       ) VALUES (
         @id, @loan_number, @borrower_id, @amount, @interest_type, @interest_value,
         @paperwork_fee, @total_payable, @issue_date, @due_date, @repayment_method,
         @instalment_count, @instalment_frequency, @instalment_amount,
         @instalment_first_date, 0, 0, @auto_renewed, @issued_at,
         @is_historical, 0, 0, 0, 0, @next_due_date, @renewed_from_id
       )`
    ).run({
      id,
      loan_number: loanNumber,
      borrower_id: input.borrowerId,
      amount,
      interest_type: interestType,
      interest_value: interestValue,
      paperwork_fee: paperworkFee,
      total_payable: totalPayable,
      issue_date: issueDate,
      due_date: dueDate,
      repayment_method: repaymentMethod,
      instalment_count: inst ? inst.count : null,
      instalment_frequency: inst ? inst.frequency : null,
      instalment_amount: inst ? inst.expectedAmount : null,
      instalment_first_date: inst ? inst.firstPaymentDate : null,
      auto_renewed: extra.auto ? 1 : 0,
      issued_at: input.issuedAt || nowIso(),
      is_historical: input.isHistorical ? 1 : 0,
      next_due_date: nextDue,
      renewed_from_id: extra.renewedFromId || null,
    });

    return {
      id,
      loanNumber,
      totalPayable,
      borrowerId: input.borrowerId,
      issueDate,
      dueDate,
      repaymentMethod,
      amount,
      interestType,
      interestValue,
      paperworkFee,
    };
  }

  function insertCollateralRecord(input) {
    const id = uid("col");
    db.prepare(
      `INSERT INTO collateral (
         id, loan_id, borrower_id, description, category, brand, model, serial,
         estimated_value, condition, date_received, storage_location, status,
         notes, photos
       ) VALUES (
         @id, @loan_id, @borrower_id, @description, @category, @brand, @model,
         @serial, @estimated_value, @condition, @date_received, @storage_location,
         @status, @notes, @photos
       )`
    ).run({
      id,
      loan_id: input.loanId,
      borrower_id: input.borrowerId,
      description: input.description || "",
      category: input.category || "Other",
      brand: input.brand || "",
      model: input.model || "",
      serial: input.serial || "",
      estimated_value: num(input.estimatedValue),
      condition: input.condition || "",
      date_received: input.dateReceived || todayUtc(),
      storage_location: input.storageLocation || "",
      status: input.status || "Held",
      notes: input.notes || "",
      photos: JSON.stringify(Array.isArray(input.photos) ? input.photos : []),
    });
    return id;
  }

  function insertPaymentRecord(input) {
    const id = uid("pay");
    const amount = num(input.amount);
    const principal =
      input.principalPaid != null ? num(input.principalPaid) : amount;
    const interest = num(input.interestPaid);
    db.prepare(
      `INSERT INTO payments (
         id, loan_id, borrower_id, amount, principal_paid, interest_paid, date,
         method, reference, notes, voided, created_at
       ) VALUES (
         @id, @loan_id, @borrower_id, @amount, @principal_paid, @interest_paid,
         @date, @method, @reference, @notes, 0, @created_at
       )`
    ).run({
      id,
      loan_id: input.loanId,
      borrower_id: input.borrowerId || null,
      amount,
      principal_paid: principal,
      interest_paid: interest,
      date: input.date || todayUtc(),
      method: input.method || "Cash",
      reference: input.reference || "",
      notes: input.notes || "",
      created_at: nowIso(),
    });
    return id;
  }

  /* --------------------------------- borrowers -------------------------------- */

  function borrowerCreate({ actor, data = {} }) {
    if (!String(data.fullName || "").trim()) {
      return { ok: false, error: "Full name is required." };
    }
    const id = uid("bor");
    db.prepare(
      `INSERT INTO borrowers
        (id, full_name, phone, alt_phone, national_id, address, occupation,
         next_of_kin, next_of_kin_phone, notes, date_registered)
       VALUES (@id, @full_name, @phone, @alt_phone, @national_id, @address,
               @occupation, @next_of_kin, @next_of_kin_phone, @notes, @date_registered)`
    ).run({
      id,
      full_name: String(data.fullName).trim(),
      phone: data.phone || "",
      alt_phone: data.altPhone || "",
      national_id: data.nationalId || "",
      address: data.address || "",
      occupation: data.occupation || "",
      next_of_kin: data.nextOfKin || "",
      next_of_kin_phone: data.nextOfKinPhone || "",
      notes: data.notes || "",
      date_registered: data.dateRegistered || todayUtc(),
    });
    logAudit(db, actor, `Registered new borrower "${String(data.fullName).trim()}"`);
    return { ok: true, borrower: borrowerRow(getBorrower(id)) };
  }

  function borrowerUpdate({ actor, id, data = {} }) {
    const existing = getBorrower(id);
    if (!existing) return { ok: false, error: "Borrower not found." };
    const fullName = String(data.fullName || existing.full_name).trim();
    db.prepare(
      `UPDATE borrowers SET
         full_name = @full_name, phone = @phone, alt_phone = @alt_phone,
         national_id = @national_id, address = @address, occupation = @occupation,
         next_of_kin = @next_of_kin, next_of_kin_phone = @next_of_kin_phone,
         notes = @notes
       WHERE id = @id`
    ).run({
      id,
      full_name: fullName,
      phone: data.phone != null ? data.phone : existing.phone,
      alt_phone: data.altPhone != null ? data.altPhone : existing.alt_phone,
      national_id: data.nationalId != null ? data.nationalId : existing.national_id,
      address: data.address != null ? data.address : existing.address,
      occupation: data.occupation != null ? data.occupation : existing.occupation,
      next_of_kin: data.nextOfKin != null ? data.nextOfKin : existing.next_of_kin,
      next_of_kin_phone:
        data.nextOfKinPhone != null ? data.nextOfKinPhone : existing.next_of_kin_phone,
      notes: data.notes != null ? data.notes : existing.notes,
    });
    logAudit(db, actor, `Edited borrower profile "${fullName}"`);
    return { ok: true, borrower: borrowerRow(getBorrower(id)) };
  }

  function borrowerDelete({ actor, id, entityLabel }) {
    const row = getBorrower(id);
    if (!row) return { ok: false, error: "Borrower not found." };
    db.prepare("DELETE FROM borrowers WHERE id = ?").run(id);
    logAudit(db, actor, `Deleted ${entityLabel || `borrower "${row.full_name}"`}`);
    return { ok: true };
  }

  /* ----------------------------------- loans ---------------------------------- */

  const loanCreateTx = db.transaction((payload) => {
    const { actor, data = {} } = payload;
    const borrower = getBorrower(data.borrowerId);
    if (!borrower) return { ok: false, error: "Select a borrower first." };
    if (num(data.amount) <= 0) return { ok: false, error: "Enter a loan amount." };

    const created = insertLoan(data);
    if (data.collateral && data.collateral.description) {
      insertCollateralRecord({
        ...data.collateral,
        loanId: created.id,
        borrowerId: borrower.id,
        dateReceived: data.issueDate,
        status: "Held",
      });
    }
    let priorPayment = null;
    if (num(data.priorPaid) > 0) {
      const payId = insertPaymentRecord({
        loanId: created.id,
        borrowerId: borrower.id,
        amount: num(data.priorPaid),
        principalPaid: num(data.priorPaid),
        interestPaid: 0,
        date: data.priorPaidDate || data.issueDate || todayUtc(),
        method: data.priorPaidMethod || "Cash",
        notes: "Entered while recording previous loan history.",
      });
      priorPayment = paymentRow(db.prepare("SELECT * FROM payments WHERE id = ?").get(payId));
    }
    logAudit(
      db,
      actor,
      `Issued loan ${created.loanNumber} for ${fmtMoney(created.amount)}${
        data.isHistorical ? " (migrated record)" : ""
      }`
    );
    return {
      ok: true,
      id: created.id,
      loan: loanRow(getLoan(created.id)),
      priorPayment,
    };
  });

  function loanCreate(payload) {
    return loanCreateTx(payload);
  }

  function loanUpdate({ actor, id, data = {} }) {
    const old = getLoan(id);
    if (!old) return { ok: false, error: "Loan not found." };
    const amount = num(data.amount != null ? data.amount : old.amount);
    if (amount <= 0) return { ok: false, error: "Enter a loan amount." };
    const interestType = data.interestType || old.interest_type || "Percent";
    const interestValue = num(
      data.interestValue != null ? data.interestValue : old.interest_value
    );
    const paperworkFee = num(
      data.paperworkFee != null ? data.paperworkFee : old.paperwork_fee
    );
    const interestAmount =
      interestType === "Percent" ? (amount * interestValue) / 100 : interestValue;
    const totalPayable = amount + interestAmount + paperworkFee;
    if (totalPayable < num(old.paid_amount)) {
      return {
        ok: false,
        error: `The new total (${fmtMoney(totalPayable)}) can't be less than what's already been paid (${fmtMoney(old.paid_amount)}).`,
      };
    }
    const repaymentMethod = data.repaymentMethod || old.repayment_method;
    const inst =
      repaymentMethod === "Instalments" && data.instalments
        ? data.instalments
        : repaymentMethod === "Instalments" && old.instalment_first_date
        ? {
            count: old.instalment_count,
            frequency: old.instalment_frequency,
            expectedAmount: old.instalment_amount,
            firstPaymentDate: old.instalment_first_date,
          }
        : null;

    const loanObj = {
      repaymentMethod,
      dueDate: data.dueDate || old.due_date,
      instalments: inst,
      paymentCount: old.payment_count,
    };
    const nextDue = computeNextDueDate(loanObj);

    db.prepare(
      `UPDATE loans SET
         amount = @amount, interest_type = @interest_type,
         interest_value = @interest_value, paperwork_fee = @paperwork_fee,
         total_payable = @total_payable, issue_date = @issue_date,
         due_date = @due_date, repayment_method = @repayment_method,
         instalment_count = @instalment_count,
         instalment_frequency = @instalment_frequency,
         instalment_amount = @instalment_amount,
         instalment_first_date = @instalment_first_date,
         next_due_date = @next_due_date
       WHERE id = @id`
    ).run({
      id,
      amount,
      interest_type: interestType,
      interest_value: interestValue,
      paperwork_fee: paperworkFee,
      total_payable: totalPayable,
      issue_date: data.issueDate || old.issue_date,
      due_date: data.dueDate || old.due_date,
      repayment_method: repaymentMethod,
      instalment_count: inst ? num(inst.count) : null,
      instalment_frequency: inst ? inst.frequency || "Monthly" : null,
      instalment_amount: inst ? num(inst.expectedAmount) : null,
      instalment_first_date: inst ? inst.firstPaymentDate || null : null,
      next_due_date: nextDue,
    });
    logAudit(db, actor, `Edited loan ${old.loan_number}`);
    return { ok: true, loan: loanRow(getLoan(id)) };
  }

  function loanVoid({ actor, id, reason }) {
    const old = getLoan(id);
    if (!old) return { ok: false, error: "Loan not found." };
    if (!String(reason || "").trim()) {
      return { ok: false, error: "Reason for voiding this loan is required." };
    }
    db.prepare(
      "UPDATE loans SET voided = 1, void_reason = ?, voided_at = ? WHERE id = ?"
    ).run(String(reason).trim(), todayUtc(), id);
    logAudit(db, actor, `Voided loan ${old.loan_number} (reason: ${String(reason).trim()})`);
    return { ok: true };
  }

  const markPaidTx = db.transaction(({ actor, id }) => {
    const loan = getLoan(id);
    if (!loan) return { ok: false, error: "Loan not found." };
    const outstanding = Math.max(0, num(loan.total_payable) - num(loan.paid_amount));
    if (outstanding <= 0) return { ok: false, error: "This loan is already fully paid." };
    const remainingPrincipal = Math.max(0, num(loan.amount) - num(loan.principal_paid));
    const principalPaid = Math.min(remainingPrincipal, outstanding);
    const interestPaid = outstanding - principalPaid;
    const payId = insertPaymentRecord({
      loanId: loan.id,
      borrowerId: loan.borrower_id,
      amount: outstanding,
      principalPaid,
      interestPaid,
      date: todayUtc(),
      method: "Cash",
      notes: "Marked as fully paid by admin.",
    });
    logAudit(db, actor, `Marked loan ${loan.loan_number} as fully paid`);
    return {
      ok: true,
      payment: paymentRow(db.prepare("SELECT * FROM payments WHERE id = ?").get(payId)),
      loan: loanRow(getLoan(id)),
    };
  });

  function loanMarkPaid(payload) {
    return markPaidTx(payload);
  }

  const renewTx = db.transaction(({ actor, id, opts = {} }) => {
    const old = getLoan(id);
    if (!old || old.voided || old.renewed) {
      return { ok: false, error: "This loan can't be renewed." };
    }
    const outstanding = Math.max(0, num(old.total_payable) - num(old.paid_amount));
    const principal =
      num(opts.newPrincipal) > 0 ? num(opts.newPrincipal) : outstanding;
    const term = Math.max(
      Math.round(
        (new Date(old.due_date || todayUtc()) - new Date(old.issue_date || todayUtc())) /
          86400000
      ),
      7
    );
    const due = new Date();
    due.setDate(due.getDate() + term);
    let dueDate = opts.newDueDate || due.toISOString().slice(0, 10);
    const created = insertLoan(
      {
        borrowerId: old.borrower_id,
        amount: principal,
        interestType: opts.interestType || "Percent",
        interestValue:
          opts.interestValue != null ? opts.interestValue : 20,
        paperworkFee: opts.paperworkFee || 0,
        dueDate,
        issueDate: todayUtc(),
        repaymentMethod: "Full Payment",
      },
      { auto: !!opts.auto, renewedFromId: old.id }
    );
    db.prepare(
      "UPDATE loans SET renewed = 1, renewed_into_id = ?, renewed_at = ? WHERE id = ?"
    ).run(created.id, todayUtc(), old.id);
    logAudit(
      db,
      actor,
      opts.auto
        ? `Automatically renewed overdue loan ${old.loan_number} into ${created.loanNumber}`
        : `Renewed loan ${old.loan_number}`
    );
    return {
      ok: true,
      id: created.id,
      loan: loanRow(getLoan(created.id)),
      oldLoanNumber: old.loan_number,
      newLoanNumber: created.loanNumber,
    };
  });

  function loanRenew(payload) {
    return renewTx(payload);
  }

  function loanDelete({ actor, id, entityLabel }) {
    const row = getLoan(id);
    if (!row) return { ok: false, error: "Loan not found." };
    db.prepare("DELETE FROM loans WHERE id = ?").run(id);
    logAudit(db, actor, `Deleted ${entityLabel || `loan ${row.loan_number}`}`);
    return { ok: true };
  }

  /* ---------------------------------- payments -------------------------------- */

  const paymentCreateTx = db.transaction(({ actor, data = {} }) => {
    const loan = getLoan(data.loanId);
    if (!loan) return { ok: false, error: "Select a loan to record a payment against." };
    if (loan.voided) return { ok: false, error: "This loan is voided." };
    const principal = num(data.principalPaid);
    const interest = num(data.interestPaid);
    const amount = data.amount != null ? num(data.amount) : principal + interest;
    if (amount <= 0) {
      return { ok: false, error: "Enter an amount towards principal, interest, or both." };
    }
    const payId = insertPaymentRecord({
      loanId: loan.id,
      borrowerId: loan.borrower_id,
      amount,
      principalPaid: principal,
      interestPaid: interest,
      date: data.date,
      method: data.method,
      reference: data.reference,
      notes: data.notes,
    });
    const updated = getLoan(loan.id);
    logAudit(
      db,
      actor,
      `Recorded payment of ${fmtMoney(amount)} on loan ${loan.loan_number}`
    );
    return {
      ok: true,
      payment: paymentRow(db.prepare("SELECT * FROM payments WHERE id = ?").get(payId)),
      fullyPaid: num(updated.paid_amount) >= num(updated.total_payable) - 0.5,
    };
  });

  function paymentCreate(payload) {
    return paymentCreateTx(payload);
  }

  function paymentUpdate({ actor, id, data = {} }) {
    const old = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Payment not found." };
    const loan = getLoan(old.loan_id);
    const principal = num(
      data.principalPaid != null ? data.principalPaid : old.principal_paid
    );
    const interest = num(
      data.interestPaid != null ? data.interestPaid : old.interest_paid
    );
    const amount =
      data.amount != null ? num(data.amount) : principal + interest;
    if (amount <= 0) return { ok: false, error: "Enter a payment amount." };
    db.prepare(
      `UPDATE payments SET amount = @amount, principal_paid = @principal_paid,
         interest_paid = @interest_paid, date = @date, method = @method,
         reference = @reference, notes = @notes WHERE id = @id`
    ).run({
      id,
      amount,
      principal_paid: principal,
      interest_paid: interest,
      date: data.date || old.date,
      method: data.method || old.method,
      reference: data.reference != null ? data.reference : old.reference,
      notes: data.notes != null ? data.notes : old.notes,
    });
    logAudit(
      db,
      actor,
      `Edited payment of ${fmtMoney(amount)} on loan ${loan ? loan.loan_number : "unknown"}`
    );
    return { ok: true, payment: paymentRow(db.prepare("SELECT * FROM payments WHERE id = ?").get(id)) };
  }

  function paymentDelete({ actor, id, entityLabel }) {
    const old = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Payment not found." };
    db.prepare("DELETE FROM payments WHERE id = ?").run(id);
    logAudit(db, actor, `Deleted ${entityLabel || `payment of ${fmtMoney(old.amount)}`}`);
    return { ok: true };
  }

  /* --------------------------------- collateral ------------------------------- */

  function collateralCreate({ actor, data = {} }) {
    const loan = getLoan(data.loanId);
    if (!loan) return { ok: false, error: "Select the loan this collateral belongs to." };
    if (!String(data.description || "").trim()) {
      return { ok: false, error: "Describe the item." };
    }
    const id = insertCollateralRecord({
      ...data,
      loanId: loan.id,
      borrowerId: loan.borrower_id,
      status: "Held",
    });
    logAudit(db, actor, `Added collateral "${String(data.description).trim()}" on loan ${loan.loan_number}`);
    return { ok: true, collateral: collateralRow(db.prepare("SELECT * FROM collateral WHERE id = ?").get(id)) };
  }

  function collateralUpdate({ actor, id, data = {} }) {
    const old = db.prepare("SELECT * FROM collateral WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Collateral record not found." };
    const loan = data.loanId ? getLoan(data.loanId) : getLoan(old.loan_id);
    if (!loan) return { ok: false, error: "Select the loan this collateral belongs to." };
    db.prepare(
      `UPDATE collateral SET
         loan_id = @loan_id, borrower_id = @borrower_id, description = @description,
         category = @category, brand = @brand, model = @model, serial = @serial,
         estimated_value = @estimated_value, condition = @condition,
         date_received = @date_received, storage_location = @storage_location,
         notes = @notes, status = @status
       WHERE id = @id`
    ).run({
      id,
      loan_id: loan.id,
      borrower_id: loan.borrower_id,
      description: data.description != null ? data.description : old.description,
      category: data.category != null ? data.category : old.category,
      brand: data.brand != null ? data.brand : old.brand,
      model: data.model != null ? data.model : old.model,
      serial: data.serial != null ? data.serial : old.serial,
      estimated_value:
        data.estimatedValue != null ? num(data.estimatedValue) : old.estimated_value,
      condition: data.condition != null ? data.condition : old.condition,
      date_received: data.dateReceived || old.date_received,
      storage_location:
        data.storageLocation != null ? data.storageLocation : old.storage_location,
      notes: data.notes != null ? data.notes : old.notes,
      status: data.status || old.status,
    });
    logAudit(
      db,
      actor,
      `Edited collateral "${data.description || old.description}"`
    );
    return {
      ok: true,
      collateral: collateralRow(db.prepare("SELECT * FROM collateral WHERE id = ?").get(id)),
    };
  }

  function collateralRelease({ actor, id }) {
    const old = db.prepare("SELECT * FROM collateral WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Collateral record not found." };
    const loan = getLoan(old.loan_id);
    db.prepare("UPDATE collateral SET status = 'Released' WHERE id = ?").run(id);
    logAudit(
      db,
      actor,
      `Marked collateral "${old.description}" as collected${
        loan ? ` (loan ${loan.loan_number})` : ""
      }`
    );
    return { ok: true };
  }

  function collateralDelete({ actor, id, entityLabel }) {
    const old = db.prepare("SELECT * FROM collateral WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Collateral record not found." };
    db.prepare("DELETE FROM collateral WHERE id = ?").run(id);
    logAudit(db, actor, `Deleted ${entityLabel || `collateral "${old.description}"`}`);
    return { ok: true };
  }

  /* ---------------------------------- expenses -------------------------------- */

  function expenseCreate({ actor, data = {} }) {
    if (!String(data.description || "").trim()) {
      return { ok: false, error: "Describe the expense." };
    }
    if (num(data.amount) <= 0) return { ok: false, error: "Enter an amount." };
    const id = uid("exp");
    db.prepare(
      `INSERT INTO expenses (id, description, category, amount, date, method, notes, voided)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      String(data.description).trim(),
      data.category || "Other",
      num(data.amount),
      data.date || todayUtc(),
      data.method || "Cash",
      data.notes || ""
    );
    logAudit(
      db,
      actor,
      `Recorded expense "${String(data.description).trim()}" (${fmtMoney(data.amount)})`
    );
    return { ok: true, id };
  }

  function expenseUpdate({ actor, id, data = {} }) {
    const old = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Expense not found." };
    db.prepare(
      `UPDATE expenses SET description = @description, category = @category,
         amount = @amount, date = @date, method = @method, notes = @notes
       WHERE id = @id`
    ).run({
      id,
      description: data.description != null ? data.description : old.description,
      category: data.category != null ? data.category : old.category,
      amount: data.amount != null ? num(data.amount) : old.amount,
      date: data.date || old.date,
      method: data.method || old.method,
      notes: data.notes != null ? data.notes : old.notes,
    });
    logAudit(db, actor, `Edited expense "${data.description || old.description}"`);
    return { ok: true };
  }

  function expenseDelete({ actor, id, entityLabel }) {
    const old = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Expense not found." };
    db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
    logAudit(db, actor, `Deleted ${entityLabel || `expense "${old.description}"`}`);
    return { ok: true };
  }

  /* ------------------------------- external funding ---------------------------- */

  function fundCreate({ actor, data = {} }) {
    if (!String(data.source || "").trim()) {
      return { ok: false, error: "Enter the lender or bank name." };
    }
    if (num(data.amount) <= 0) return { ok: false, error: "Enter the amount received." };
    const id = uid("fund");
    db.prepare(
      `INSERT INTO external_funds
        (id, type, source, amount, date_received, expected_repayment_date, notes, voided, repaid_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`
    ).run(
      id,
      data.type || "External Loan",
      String(data.source).trim(),
      num(data.amount),
      data.dateReceived || todayUtc(),
      data.expectedRepaymentDate || "",
      data.notes || ""
    );
    logAudit(
      db,
      actor,
      `Recorded ${fmtMoney(data.amount)} received from ${String(data.source).trim()} (${data.type || "External Loan"})`
    );
    return { ok: true, id };
  }

  function fundUpdate({ actor, id, data = {} }) {
    const old = getFund(id);
    if (!old) return { ok: false, error: "Funding record not found." };
    db.prepare(
      `UPDATE external_funds SET type = @type, source = @source, amount = @amount,
         date_received = @date_received, expected_repayment_date = @expected,
         notes = @notes WHERE id = @id`
    ).run({
      id,
      type: data.type || old.type,
      source: data.source != null ? String(data.source).trim() : old.source,
      amount: data.amount != null ? num(data.amount) : old.amount,
      date_received: data.dateReceived || old.date_received,
      expected: data.expectedRepaymentDate != null
        ? data.expectedRepaymentDate
        : old.expected_repayment_date,
      notes: data.notes != null ? data.notes : old.notes,
    });
    logAudit(db, actor, `Edited funding record from ${old.source} (${old.type})`);
    return { ok: true };
  }

  function fundDelete({ actor, id, entityLabel }) {
    const old = getFund(id);
    if (!old) return { ok: false, error: "Funding record not found." };
    db.prepare("DELETE FROM external_funds WHERE id = ?").run(id);
    logAudit(db, actor, `Deleted ${entityLabel || `funding record from "${old.source}"`}`);
    return { ok: true };
  }

  function fundRepaymentCreate({ actor, data = {} }) {
    const fund = getFund(data.fundId);
    if (!fund) return { ok: false, error: "Select which loan or bank fund this repayment is for." };
    if (num(data.amount) <= 0) return { ok: false, error: "Enter the repayment amount." };
    const id = uid("fundpay");
    db.prepare(
      `INSERT INTO fund_repayments (id, fund_id, amount, date, method, notes, voided)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      fund.id,
      num(data.amount),
      data.date || todayUtc(),
      data.method || "Cash",
      data.notes || ""
    );
    logAudit(
      db,
      actor,
      `Recorded repayment of ${fmtMoney(data.amount)} to ${fund.source} (${fund.type})`
    );
    return { ok: true, id };
  }

  function fundRepaymentUpdate({ actor, id, data = {} }) {
    const old = db.prepare("SELECT * FROM fund_repayments WHERE id = ?").get(id);
    if (!old) return { ok: false, error: "Repayment not found." };
    const fund = getFund(data.fundId || old.fund_id);
    db.prepare(
      `UPDATE fund_repayments SET fund_id = @fund_id, amount = @amount, date = @date,
         method = @method, notes = @notes WHERE id = @id`
    ).run({
      id,
      fund_id: fund ? fund.id : old.fund_id,
      amount: data.amount != null ? num(data.amount) : old.amount,
      date: data.date || old.date,
      method: data.method || old.method,
      notes: data.notes != null ? data.notes : old.notes,
    });
    logAudit(
      db,
      actor,
      `Edited repayment to ${fund ? fund.source : "external fund"} (${fund ? fund.type : ""})`
    );
    return { ok: true };
  }

  function fundRepaymentDelete({ actor, id, entityLabel }) {
    const old = db.prepare(
      `SELECT r.*, f.source, f.type FROM fund_repayments r
         LEFT JOIN external_funds f ON f.id = r.fund_id WHERE r.id = ?`
    ).get(id);
    if (!old) return { ok: false, error: "Repayment not found." };
    db.prepare("DELETE FROM fund_repayments WHERE id = ?").run(id);
    logAudit(
      db,
      actor,
      `Deleted ${entityLabel || `repayment of ${fmtMoney(old.amount)}`}`
    );
    return { ok: true };
  }

  /* ----------------------------------- users ---------------------------------- */

  function userDelete({ actor, id, entityLabel }) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!row) return { ok: false, error: "User not found." };
    if (row.username === "admin") {
      return { ok: false, error: "The default administrator account can't be deleted." };
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    logAudit(db, actor, `Deleted ${entityLabel || `user account "${row.username}"`}`);
    return { ok: true };
  }

  /* --------------------------------- settings --------------------------------- */

  function settingsUpdate({ actor, settings = {} }) {
    if (settings.businessName != null) {
      setSetting(db, "businessName", String(settings.businessName).trim() || "My Lending Business");
    }
    if (settings.startingCashBalance != null) {
      setSetting(db, "startingCashBalance", String(num(settings.startingCashBalance)));
    }
    if (settings.language != null) setSetting(db, "language", String(settings.language));
    logAudit(db, actor, "Updated business settings");
    return { ok: true };
  }

  /* -------------------------------- approvals --------------------------------- */

  function deletionRequest({ actor, requestedBy, requestedByName, entityType, entityId, entityLabel }) {
    const id = uid("delreq");
    db.prepare(
      `INSERT INTO deletion_requests
        (id, entity_type, entity_id, entity_label, requested_by, requested_by_name,
         status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      id,
      entityType,
      entityId,
      entityLabel,
      requestedBy || actor,
      requestedByName || actor,
      nowIso()
    );
    logAudit(db, actor, `Requested deletion approval for ${entityLabel}`);
    return { ok: true, id };
  }

  function executeDeletion(entityType, entityId) {
    switch (entityType) {
      case "borrower":
        db.prepare("DELETE FROM borrowers WHERE id = ?").run(entityId);
        break;
      case "loan":
        db.prepare("DELETE FROM loans WHERE id = ?").run(entityId);
        break;
      case "payment":
        db.prepare("DELETE FROM payments WHERE id = ?").run(entityId);
        break;
      case "collateral":
        db.prepare("DELETE FROM collateral WHERE id = ?").run(entityId);
        break;
      case "expense":
        db.prepare("DELETE FROM expenses WHERE id = ?").run(entityId);
        break;
      case "fund":
        db.prepare("DELETE FROM external_funds WHERE id = ?").run(entityId);
        break;
      case "fundRepayment":
        db.prepare("DELETE FROM fund_repayments WHERE id = ?").run(entityId);
        break;
      case "user": {
        const row = db.prepare("SELECT * FROM users WHERE id = ?").get(entityId);
        if (row && row.username !== "admin") {
          db.prepare("DELETE FROM users WHERE id = ?").run(entityId);
        }
        break;
      }
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  const approveTx = db.transaction(({ actor, id }) => {
    const req = db.prepare("SELECT * FROM deletion_requests WHERE id = ?").get(id);
    if (!req) return { ok: false, error: "Request not found." };
    if (req.status !== "pending") return { ok: false, error: "This request is already resolved." };
    executeDeletion(req.entity_type, req.entity_id);
    db.prepare(
      "UPDATE deletion_requests SET status = 'approved', resolved_at = ?, resolved_by = ? WHERE id = ?"
    ).run(nowIso(), actor, id);
    logAudit(db, actor, `Approved deletion request: ${req.entity_label}`);
    return { ok: true };
  });

  function deletionApprove(payload) {
    return approveTx(payload);
  }

  function deletionReject({ actor, id }) {
    const req = db.prepare("SELECT * FROM deletion_requests WHERE id = ?").get(id);
    if (!req) return { ok: false, error: "Request not found." };
    if (req.status !== "pending") return { ok: false, error: "This request is already resolved." };
    db.prepare(
      "UPDATE deletion_requests SET status = 'rejected', resolved_at = ?, resolved_by = ? WHERE id = ?"
    ).run(nowIso(), actor, id);
    logAudit(db, actor, `Rejected deletion request: ${req.entity_label}`);
    return { ok: true };
  }

  /* ------------------------------- audit helper -------------------------------- */

  function auditLog({ actor, action }) {
    logAudit(db, actor, action);
    return { ok: true };
  }

  /* ------------------------------- auto renewal -------------------------------- */

  const autoRenewTx = db.transaction(({ limit }) => {
    const today = todayUtc();
    const batch = Math.min(Math.max(num(limit) || 500, 1), 5000);
    const due = db
      .prepare(
        `SELECT id FROM loans
          WHERE voided = 0 AND renewed = 0
            AND paid_amount < total_payable - 0.5
            AND due_date < ?
          ORDER BY due_date ASC LIMIT ?`
      )
      .all(today, batch);
    let renewed = 0;
    for (const row of due) {
      const result = renewTx({
        actor: "System (auto-renewal)",
        id: row.id,
        opts: { auto: true },
      });
      if (result.ok) renewed++;
    }
    const remaining = db
      .prepare(
        `SELECT COUNT(*) AS c FROM loans
          WHERE voided = 0 AND renewed = 0
            AND paid_amount < total_payable - 0.5
            AND due_date < ?`
      )
      .get(today).c;
    return { ok: true, renewed, remaining };
  });

  function autoRenew({ limit }) {
    return autoRenewTx({ limit });
  }

  return {
    borrowerCreate,
    borrowerUpdate,
    borrowerDelete,
    loanCreate,
    loanUpdate,
    loanVoid,
    loanMarkPaid,
    loanRenew,
    loanDelete,
    paymentCreate,
    paymentUpdate,
    paymentDelete,
    collateralCreate,
    collateralUpdate,
    collateralRelease,
    collateralDelete,
    expenseCreate,
    expenseUpdate,
    expenseDelete,
    fundCreate,
    fundUpdate,
    fundDelete,
    fundRepaymentCreate,
    fundRepaymentUpdate,
    fundRepaymentDelete,
    userDelete,
    settingsUpdate,
    deletionRequest,
    deletionApprove,
    deletionReject,
    auditLog,
    autoRenew,
    // auth-backed user operations
    userCreate: auth.createUser,
    userUpdate: auth.updateUser,
    userSetActive: auth.setUserActive,
  };
}

module.exports = { createMutations };
