"use strict";

const {
  todayUtc,
  nowIso,
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
  logAudit,
  getSettings,
  setSetting,
  nextLoanNumber,
  CURRENCY_CODES,
  LANGUAGES,
  FREQ_DAYS,
  FREQ_NAMES,
  MAX_INSTALMENTS,
  computeNextDueDate,
} = require("./util");
const { borrowerRow, loanRow, paymentRow, collateralRow, fundRow } = require("./rows");
const { userRow } = require("./rows");

function createMutations(ctx, auth) {
  const { db } = ctx;

  /** Audit messages are written in whatever currency the ledger is set to. */
  const fmtMoney = (v) =>
    `${getSettings(db).currency || "UGX"} ${Math.round(Number(v) || 0).toLocaleString("en-UG")}`;

  /** Photos are small data URLs today, but cap the stored JSON so a malformed
   *  IPC message can't balloon the encrypted database. */
  function serializePhotos(photos) {
    if (!Array.isArray(photos)) return "[]";
    try {
      const json = JSON.stringify(photos.slice(0, 10));
      return json.length > 2 * 1024 * 1024 ? "[]" : json;
    } catch (e) {
      return "[]";
    }
  }

  const getLoan = (id) =>
    db.prepare("SELECT * FROM loans WHERE id = ?").get(idText(id));
  const getBorrower = (id) =>
    db.prepare("SELECT * FROM borrowers WHERE id = ?").get(idText(id));
  const getFund = (id) =>
    db.prepare("SELECT * FROM external_funds WHERE id = ?").get(idText(id));

  function insertLoan(input, extra = {}) {
    const amount = Math.max(0, money(input.amount));
    const interestType = input.interestType === "Fixed" ? "Fixed" : "Percent";
    const interestValue = money(input.interestValue);
    const paperworkFee = Math.max(0, money(input.paperworkFee));
    const interestAmount =
      interestType === "Percent" ? (amount * interestValue) / 100 : interestValue;
    const totalPayable = money(amount + interestAmount + paperworkFee);
    const issueDate = dateOnly(input.issueDate, todayUtc());
    const dueDate = dateOnly(input.dueDate, issueDate);
    const repaymentMethod =
      input.repaymentMethod === "Instalments" ? "Instalments" : "Full Payment";
    const inst =
      repaymentMethod === "Instalments" && input.instalments
        ? {
            count: int(input.instalments.count, 0, MAX_INSTALMENTS, 0),
            frequency: FREQ_NAMES.includes(input.instalments.frequency)
              ? input.instalments.frequency
              : "Monthly",
            expectedAmount: Math.max(0, money(input.instalments.expectedAmount)),
            firstPaymentDate: dateOnly(input.instalments.firstPaymentDate, issueDate),
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
      borrower_id: idText(input.borrowerId),
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
      issued_at: text(input.issuedAt, 40, nowIso()),
      is_historical: input.isHistorical ? 1 : 0,
      next_due_date: dateOnly(nextDue, issueDate),
      renewed_from_id: idText(extra.renewedFromId) || null,
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
      loan_id: idText(input.loanId),
      borrower_id: idText(input.borrowerId),
      description: text(input.description, 300),
      category: text(input.category, 80, "Other"),
      brand: text(input.brand, 120),
      model: text(input.model, 120),
      serial: text(input.serial, 120),
      estimated_value: Math.max(0, money(input.estimatedValue)),
      condition: text(input.condition, 120),
      date_received: dateOnly(input.dateReceived, todayUtc()),
      storage_location: text(input.storageLocation, 200),
      status: text(input.status, 40, "Held"),
      notes: note(input.notes),
      photos: serializePhotos(input.photos),
    });
    return id;
  }

  function insertPaymentRecord(input) {
    const id = uid("pay");
    const amount = Math.max(0, money(input.amount));
    const principal =
      input.principalPaid != null ? Math.max(0, money(input.principalPaid)) : amount;
    const interest = Math.max(0, money(input.interestPaid));
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
      loan_id: idText(input.loanId),
      borrower_id: idText(input.borrowerId) || null,
      amount,
      principal_paid: principal,
      interest_paid: interest,
      date: dateOnly(input.date, todayUtc()),
      method: text(input.method, 60, "Cash"),
      reference: text(input.reference, 200),
      notes: note(input.notes),
      created_at: nowIso(),
    });
    return id;
  }

  /* --------------------------------- borrowers -------------------------------- */

  function borrowerCreate({ actor, data = {} }) {
    const fullName = text(data.fullName, 200);
    if (!fullName) {
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
      full_name: fullName,
      phone: text(data.phone, 60),
      alt_phone: text(data.altPhone, 60),
      national_id: text(data.nationalId, 60),
      address: text(data.address, 300),
      occupation: text(data.occupation, 120),
      next_of_kin: text(data.nextOfKin, 200),
      next_of_kin_phone: text(data.nextOfKinPhone, 60),
      notes: note(data.notes),
      date_registered: dateOnly(data.dateRegistered, todayUtc()),
    });
    logAudit(db, actor, `Registered new borrower "${fullName}"`);
    return { ok: true, borrower: borrowerRow(getBorrower(id)) };
  }

  function borrowerUpdate({ actor, id, data = {} }) {
    const existing = getBorrower(id);
    if (!existing) return { ok: false, error: "Borrower not found." };
    const fullName = text(data.fullName, 200, existing.full_name);
    db.prepare(
      `UPDATE borrowers SET
         full_name = @full_name, phone = @phone, alt_phone = @alt_phone,
         national_id = @national_id, address = @address, occupation = @occupation,
         next_of_kin = @next_of_kin, next_of_kin_phone = @next_of_kin_phone,
         notes = @notes
       WHERE id = @id`
    ).run({
      id: existing.id,
      full_name: fullName,
      phone: text(data.phone != null ? data.phone : existing.phone, 60),
      alt_phone: text(
        data.altPhone != null ? data.altPhone : existing.alt_phone,
        60
      ),
      national_id: text(
        data.nationalId != null ? data.nationalId : existing.national_id,
        60
      ),
      address: text(data.address != null ? data.address : existing.address, 300),
      occupation: text(
        data.occupation != null ? data.occupation : existing.occupation,
        120
      ),
      next_of_kin: text(
        data.nextOfKin != null ? data.nextOfKin : existing.next_of_kin,
        200
      ),
      next_of_kin_phone: text(
        data.nextOfKinPhone != null ? data.nextOfKinPhone : existing.next_of_kin_phone,
        60
      ),
      notes: note(data.notes != null ? data.notes : existing.notes),
    });
    logAudit(db, actor, `Edited borrower profile "${fullName}"`);
    return { ok: true, borrower: borrowerRow(getBorrower(id)) };
  }

  function borrowerDelete({ actor, id, entityLabel }) {
    const row = getBorrower(id);
    if (!row) return { ok: false, error: "Borrower not found." };
    db.prepare("DELETE FROM borrowers WHERE id = ?").run(row.id);
    logAudit(db, actor, `Deleted ${text(entityLabel, 300, `borrower "${row.full_name}"`)}`);
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
    const amount = Math.max(
      0,
      money(data.amount != null ? data.amount : old.amount)
    );
    if (amount <= 0) return { ok: false, error: "Enter a loan amount." };
    const interestType =
      data.interestType === "Fixed" || data.interestType === "Percent"
        ? data.interestType
        : old.interest_type === "Fixed"
        ? "Fixed"
        : "Percent";
    const interestValue = money(
      data.interestValue != null ? data.interestValue : old.interest_value
    );
    const paperworkFee = Math.max(
      0,
      money(data.paperworkFee != null ? data.paperworkFee : old.paperwork_fee)
    );
    const interestAmount =
      interestType === "Percent" ? (amount * interestValue) / 100 : interestValue;
    const totalPayable = money(amount + interestAmount + paperworkFee);
    if (totalPayable < num(old.paid_amount)) {
      return {
        ok: false,
        error: `The new total (${fmtMoney(totalPayable)}) can't be less than what's already been paid (${fmtMoney(old.paid_amount)}).`,
      };
    }
    const issueDate = dateOnly(data.issueDate, old.issue_date);
    const dueDate = dateOnly(data.dueDate, old.due_date || issueDate);
    const repaymentMethod =
      data.repaymentMethod === "Instalments" ||
      (data.repaymentMethod == null && old.repayment_method === "Instalments")
        ? "Instalments"
        : "Full Payment";
    const source = data.instalments
      ? data.instalments
      : old.instalment_first_date
      ? {
          count: old.instalment_count,
          frequency: old.instalment_frequency,
          expectedAmount: old.instalment_amount,
          firstPaymentDate: old.instalment_first_date,
        }
      : null;
    const inst =
      repaymentMethod === "Instalments" && source
        ? {
            count: int(source.count, 0, MAX_INSTALMENTS, 0),
            frequency: FREQ_NAMES.includes(source.frequency)
              ? source.frequency
              : "Monthly",
            expectedAmount: Math.max(0, money(source.expectedAmount)),
            firstPaymentDate: dateOnly(source.firstPaymentDate, issueDate),
          }
        : null;

    const loanObj = {
      repaymentMethod,
      dueDate,
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
      id: old.id,
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
      next_due_date: nextDue,
    });
    logAudit(db, actor, `Edited loan ${old.loan_number}`);
    return { ok: true, loan: loanRow(getLoan(old.id)) };
  }

  function loanVoid({ actor, id, reason }) {
    const old = getLoan(id);
    if (!old) return { ok: false, error: "Loan not found." };
    const cleanReason = text(reason, 1000);
    if (!cleanReason) {
      return { ok: false, error: "Reason for voiding this loan is required." };
    }
    db.prepare(
      "UPDATE loans SET voided = 1, void_reason = ?, voided_at = ? WHERE id = ?"
    ).run(cleanReason, todayUtc(), old.id);
    logAudit(db, actor, `Voided loan ${old.loan_number} (reason: ${cleanReason})`);
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
    const principal = Math.max(
      0,
      money(opts.newPrincipal) > 0 ? money(opts.newPrincipal) : outstanding
    );
    if (principal <= 0) {
      return { ok: false, error: "This loan has nothing left to renew." };
    }
    const issueDate = dateOnly(old.issue_date, todayUtc());
    const dueDate = dateOnly(old.due_date, issueDate);
    const term = Math.max(
      int(
        Math.round(
          (new Date(`${dueDate}T00:00:00Z`) -
            new Date(`${issueDate}T00:00:00Z`)) /
            86400000
        ),
        1,
        3650,
        30
      ),
      7
    );
    const nextDueDate = dateOnly(opts.newDueDate, addDays(todayUtc(), term));
    const created = insertLoan(
      {
        borrowerId: old.borrower_id,
        amount: principal,
        interestType: opts.interestType === "Fixed" ? "Fixed" : "Percent",
        interestValue:
          opts.interestValue != null ? opts.interestValue : 20,
        paperworkFee: opts.paperworkFee || 0,
        dueDate: nextDueDate,
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
    db.prepare("DELETE FROM loans WHERE id = ?").run(row.id);
    logAudit(db, actor, `Deleted ${text(entityLabel, 300, `loan ${row.loan_number}`)}`);
    return { ok: true };
  }

  /* ---------------------------------- payments -------------------------------- */

  const paymentCreateTx = db.transaction(({ actor, data = {} }) => {
    const loan = getLoan(data.loanId);
    if (!loan) return { ok: false, error: "Select a loan to record a payment against." };
    if (loan.voided) return { ok: false, error: "This loan is voided." };
    const principal = Math.max(0, money(data.principalPaid));
    const interest = Math.max(0, money(data.interestPaid));
    const amount = Math.max(
      0,
      money(data.amount != null ? data.amount : principal + interest)
    );
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
    const old = db
      .prepare("SELECT * FROM payments WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Payment not found." };
    const loan = getLoan(old.loan_id);
    const principal = Math.max(
      0,
      money(
        data.principalPaid != null ? data.principalPaid : old.principal_paid
      )
    );
    const interest = Math.max(
      0,
      money(data.interestPaid != null ? data.interestPaid : old.interest_paid)
    );
    const amount = Math.max(
      0,
      money(data.amount != null ? data.amount : principal + interest)
    );
    if (amount <= 0) return { ok: false, error: "Enter a payment amount." };
    db.prepare(
      `UPDATE payments SET amount = @amount, principal_paid = @principal_paid,
         interest_paid = @interest_paid, date = @date, method = @method,
         reference = @reference, notes = @notes WHERE id = @id`
    ).run({
      id: old.id,
      amount,
      principal_paid: principal,
      interest_paid: interest,
      date: dateOnly(data.date, old.date),
      method: text(data.method, 60, old.method || "Cash"),
      reference: text(
        data.reference != null ? data.reference : old.reference,
        200
      ),
      notes: note(data.notes != null ? data.notes : old.notes),
    });
    logAudit(
      db,
      actor,
      `Edited payment of ${fmtMoney(amount)} on loan ${loan ? loan.loan_number : "unknown"}`
    );
    return {
      ok: true,
      payment: paymentRow(
        db.prepare("SELECT * FROM payments WHERE id = ?").get(old.id)
      ),
    };
  }

  function paymentDelete({ actor, id, entityLabel }) {
    const old = db
      .prepare("SELECT * FROM payments WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Payment not found." };
    db.prepare("DELETE FROM payments WHERE id = ?").run(old.id);
    logAudit(
      db,
      actor,
      `Deleted ${text(entityLabel, 300, `payment of ${fmtMoney(old.amount)}`)}`
    );
    return { ok: true };
  }

  /* --------------------------------- collateral ------------------------------- */

  function collateralCreate({ actor, data = {} }) {
    const loan = getLoan(data.loanId);
    if (!loan) return { ok: false, error: "Select the loan this collateral belongs to." };
    const description = text(data.description, 300);
    if (!description) {
      return { ok: false, error: "Describe the item." };
    }
    const id = insertCollateralRecord({
      ...data,
      description,
      loanId: loan.id,
      borrowerId: loan.borrower_id,
      status: "Held",
    });
    logAudit(
      db,
      actor,
      `Added collateral "${description}" on loan ${loan.loan_number}`
    );
    return {
      ok: true,
      collateral: collateralRow(
        db.prepare("SELECT * FROM collateral WHERE id = ?").get(id)
      ),
    };
  }

  function collateralUpdate({ actor, id, data = {} }) {
    const old = db
      .prepare("SELECT * FROM collateral WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Collateral record not found." };
    const loan = data.loanId ? getLoan(data.loanId) : getLoan(old.loan_id);
    if (!loan) return { ok: false, error: "Select the loan this collateral belongs to." };
    const description = text(
      data.description != null ? data.description : old.description,
      300
    );
    db.prepare(
      `UPDATE collateral SET
         loan_id = @loan_id, borrower_id = @borrower_id, description = @description,
         category = @category, brand = @brand, model = @model, serial = @serial,
         estimated_value = @estimated_value, condition = @condition,
         date_received = @date_received, storage_location = @storage_location,
         notes = @notes, status = @status
       WHERE id = @id`
    ).run({
      id: old.id,
      loan_id: loan.id,
      borrower_id: loan.borrower_id,
      description,
      category: text(
        data.category != null ? data.category : old.category,
        80,
        "Other"
      ),
      brand: text(data.brand != null ? data.brand : old.brand, 120),
      model: text(data.model != null ? data.model : old.model, 120),
      serial: text(data.serial != null ? data.serial : old.serial, 120),
      estimated_value: Math.max(
        0,
        money(
          data.estimatedValue != null
            ? data.estimatedValue
            : old.estimated_value
        )
      ),
      condition: text(
        data.condition != null ? data.condition : old.condition,
        120
      ),
      date_received: dateOnly(data.dateReceived, old.date_received || todayUtc()),
      storage_location: text(
        data.storageLocation != null
          ? data.storageLocation
          : old.storage_location,
        200
      ),
      notes: note(data.notes != null ? data.notes : old.notes),
      status: text(data.status, 40, old.status || "Held"),
    });
    logAudit(db, actor, `Edited collateral "${description || old.description}"`);
    return {
      ok: true,
      collateral: collateralRow(
        db.prepare("SELECT * FROM collateral WHERE id = ?").get(old.id)
      ),
    };
  }

  function collateralRelease({ actor, id }) {
    const old = db
      .prepare("SELECT * FROM collateral WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Collateral record not found." };
    const loan = getLoan(old.loan_id);
    db.prepare("UPDATE collateral SET status = 'Released' WHERE id = ?").run(
      old.id
    );
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
    const old = db
      .prepare("SELECT * FROM collateral WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Collateral record not found." };
    db.prepare("DELETE FROM collateral WHERE id = ?").run(old.id);
    logAudit(
      db,
      actor,
      `Deleted ${text(entityLabel, 300, `collateral "${old.description}"`)}`
    );
    return { ok: true };
  }

  /* ---------------------------------- expenses -------------------------------- */

  function expenseCreate({ actor, data = {} }) {
    const description = text(data.description, 300);
    if (!description) {
      return { ok: false, error: "Describe the expense." };
    }
    const amount = money(data.amount);
    if (amount <= 0) return { ok: false, error: "Enter an amount." };
    const id = uid("exp");
    db.prepare(
      `INSERT INTO expenses (id, description, category, amount, date, method, notes, voided)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      description,
      text(data.category, 80, "Other"),
      amount,
      dateOnly(data.date, todayUtc()),
      text(data.method, 60, "Cash"),
      note(data.notes)
    );
    logAudit(
      db,
      actor,
      `Recorded expense "${description}" (${fmtMoney(amount)})`
    );
    return { ok: true, id };
  }

  function expenseUpdate({ actor, id, data = {} }) {
    const old = db
      .prepare("SELECT * FROM expenses WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Expense not found." };
    const amount = money(data.amount != null ? data.amount : old.amount);
    if (amount <= 0) return { ok: false, error: "Enter an amount." };
    const description = text(
      data.description != null ? data.description : old.description,
      300
    );
    db.prepare(
      `UPDATE expenses SET description = @description, category = @category,
         amount = @amount, date = @date, method = @method, notes = @notes
       WHERE id = @id`
    ).run({
      id: old.id,
      description,
      category: text(
        data.category != null ? data.category : old.category,
        80,
        "Other"
      ),
      amount,
      date: dateOnly(data.date, old.date || todayUtc()),
      method: text(data.method, 60, old.method || "Cash"),
      notes: note(data.notes != null ? data.notes : old.notes),
    });
    logAudit(db, actor, `Edited expense "${description || old.description}"`);
    return { ok: true };
  }

  function expenseDelete({ actor, id, entityLabel }) {
    const old = db
      .prepare("SELECT * FROM expenses WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Expense not found." };
    db.prepare("DELETE FROM expenses WHERE id = ?").run(old.id);
    logAudit(
      db,
      actor,
      `Deleted ${text(entityLabel, 300, `expense "${old.description}"`)}`
    );
    return { ok: true };
  }

  /* ------------------------------- external funding ---------------------------- */

  function fundCreate({ actor, data = {} }) {
    const source = text(data.source, 200);
    if (!source) {
      return { ok: false, error: "Enter the lender or bank name." };
    }
    const amount = money(data.amount);
    if (amount <= 0) return { ok: false, error: "Enter the amount received." };
    const type = text(data.type, 80, "External Loan");
    const id = uid("fund");
    db.prepare(
      `INSERT INTO external_funds
        (id, type, source, amount, date_received, expected_repayment_date, notes, voided, repaid_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`
    ).run(
      id,
      type,
      source,
      amount,
      dateOnly(data.dateReceived, todayUtc()),
      optionalDate(data.expectedRepaymentDate),
      note(data.notes)
    );
    logAudit(
      db,
      actor,
      `Recorded ${fmtMoney(amount)} received from ${source} (${type})`
    );
    return { ok: true, id };
  }

  function fundUpdate({ actor, id, data = {} }) {
    const old = getFund(id);
    if (!old) return { ok: false, error: "Funding record not found." };
    const amount = money(data.amount != null ? data.amount : old.amount);
    if (amount <= 0) return { ok: false, error: "Enter the amount received." };
    db.prepare(
      `UPDATE external_funds SET type = @type, source = @source, amount = @amount,
         date_received = @date_received, expected_repayment_date = @expected,
         notes = @notes WHERE id = @id`
    ).run({
      id: old.id,
      type: text(data.type, 80, old.type || "External Loan"),
      source: text(data.source != null ? data.source : old.source, 200),
      amount,
      date_received: dateOnly(
        data.dateReceived,
        old.date_received || todayUtc()
      ),
      expected:
        data.expectedRepaymentDate != null
          ? optionalDate(data.expectedRepaymentDate)
          : optionalDate(old.expected_repayment_date),
      notes: note(data.notes != null ? data.notes : old.notes),
    });
    logAudit(db, actor, `Edited funding record from ${old.source} (${old.type})`);
    return { ok: true };
  }

  function fundDelete({ actor, id, entityLabel }) {
    const old = getFund(id);
    if (!old) return { ok: false, error: "Funding record not found." };
    db.prepare("DELETE FROM external_funds WHERE id = ?").run(old.id);
    logAudit(
      db,
      actor,
      `Deleted ${text(entityLabel, 300, `funding record from "${old.source}"`)}`
    );
    return { ok: true };
  }

  function fundRepaymentCreate({ actor, data = {} }) {
    const fund = getFund(data.fundId);
    if (!fund) return { ok: false, error: "Select which loan or bank fund this repayment is for." };
    const amount = money(data.amount);
    if (amount <= 0) return { ok: false, error: "Enter the repayment amount." };
    const id = uid("fundpay");
    db.prepare(
      `INSERT INTO fund_repayments (id, fund_id, amount, date, method, notes, voided)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      fund.id,
      amount,
      dateOnly(data.date, todayUtc()),
      text(data.method, 60, "Cash"),
      note(data.notes)
    );
    logAudit(
      db,
      actor,
      `Recorded repayment of ${fmtMoney(amount)} to ${fund.source} (${fund.type})`
    );
    return { ok: true, id };
  }

  function fundRepaymentUpdate({ actor, id, data = {} }) {
    const old = db
      .prepare("SELECT * FROM fund_repayments WHERE id = ?")
      .get(idText(id));
    if (!old) return { ok: false, error: "Repayment not found." };
    const fund = getFund(data.fundId || old.fund_id);
    const amount = money(data.amount != null ? data.amount : old.amount);
    if (amount <= 0) return { ok: false, error: "Enter the repayment amount." };
    db.prepare(
      `UPDATE fund_repayments SET fund_id = @fund_id, amount = @amount, date = @date,
         method = @method, notes = @notes WHERE id = @id`
    ).run({
      id: old.id,
      fund_id: fund ? fund.id : old.fund_id,
      amount,
      date: dateOnly(data.date, old.date || todayUtc()),
      method: text(data.method, 60, old.method || "Cash"),
      notes: note(data.notes != null ? data.notes : old.notes),
    });
    logAudit(
      db,
      actor,
      `Edited repayment to ${fund ? fund.source : "external fund"} (${fund ? fund.type : ""})`
    );
    return { ok: true };
  }

  function fundRepaymentDelete({ actor, id, entityLabel }) {
    const old = db
      .prepare(
        `SELECT r.*, f.source, f.type FROM fund_repayments r
         LEFT JOIN external_funds f ON f.id = r.fund_id WHERE r.id = ?`
      )
      .get(idText(id));
    if (!old) return { ok: false, error: "Repayment not found." };
    db.prepare("DELETE FROM fund_repayments WHERE id = ?").run(old.id);
    logAudit(
      db,
      actor,
      `Deleted ${text(entityLabel, 300, `repayment of ${fmtMoney(old.amount)}`)}`
    );
    return { ok: true };
  }

  /* ----------------------------------- users ---------------------------------- */

  function userDelete({ actor, id, entityLabel }) {
    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(idText(id));
    if (!row) return { ok: false, error: "User not found." };
    if (String(row.username).toLowerCase() === "admin") {
      return { ok: false, error: "The default administrator account can't be deleted." };
    }
    if (row.active && row.role === "Administrator") {
      const otherAdmins = db
        .prepare(
          `SELECT COUNT(*) AS c FROM users
            WHERE active = 1 AND role = 'Administrator' AND id <> ?`
        )
        .get(row.id).c;
      if (otherAdmins === 0) {
        return {
          ok: false,
          error: "At least one active administrator account must remain.",
        };
      }
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(row.id);
    logAudit(
      db,
      actor,
      `Deleted ${text(entityLabel, 300, `user account "${row.username}"`)}`
    );
    return { ok: true };
  }

  /* --------------------------------- settings --------------------------------- */

  function settingsUpdate({ actor, settings = {} }) {
    let currencyChanged = null;
    if (settings.currency != null) {
      const code = String(settings.currency).toUpperCase();
      if (!CURRENCY_CODES.includes(code)) {
        return { ok: false, error: "That currency isn't supported." };
      }
      currencyChanged = code;
    }
    let language = null;
    if (settings.language != null) {
      language = String(settings.language);
      if (!LANGUAGES.includes(language)) {
        return { ok: false, error: "That language isn't supported." };
      }
    }
    if (settings.businessName != null) {
      setSetting(
        db,
        "businessName",
        text(settings.businessName, 200, "My Lending Business")
      );
    }
    if (settings.startingCashBalance != null) {
      setSetting(db, "startingCashBalance", String(money(settings.startingCashBalance)));
    }
    if (language) setSetting(db, "language", language);
    if (currencyChanged) setSetting(db, "currency", currencyChanged);
    logAudit(
      db,
      actor,
      currencyChanged ? `Changed display currency to ${currencyChanged}` : "Updated business settings"
    );
    return { ok: true };
  }

  /* -------------------------------- approvals --------------------------------- */

  const DELETABLE_TYPES = {
    borrower: "borrowers",
    loan: "loans",
    payment: "payments",
    collateral: "collateral",
    expense: "expenses",
    fund: "external_funds",
    fundRepayment: "fund_repayments",
    user: "users",
  };

  function deletionRequest({ actor, requestedBy, requestedByName, entityType, entityId, entityLabel }) {
    const table = DELETABLE_TYPES[entityType];
    if (!table) return { ok: false, error: "Unknown record type." };
    const cleanId = idText(entityId);
    if (!cleanId) return { ok: false, error: "Missing record to delete." };
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(cleanId);
    if (!row) return { ok: false, error: "That record no longer exists." };
    if (entityType === "user" && String(row.username).toLowerCase() === "admin") {
      return { ok: false, error: "The default administrator account can't be deleted." };
    }
    const id = uid("delreq");
    const label = text(entityLabel, 300, "record");
    db.prepare(
      `INSERT INTO deletion_requests
        (id, entity_type, entity_id, entity_label, requested_by, requested_by_name,
         status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      id,
      entityType,
      cleanId,
      label,
      text(requestedBy || actor, 120),
      text(requestedByName || actor, 200),
      nowIso()
    );
    logAudit(db, actor, `Requested deletion approval for ${label}`);
    return { ok: true, id };
  }

  function executeDeletion(entityType, entityId) {
    const table = DELETABLE_TYPES[entityType];
    if (!table) return false;
    if (entityType === "user") {
      const row = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(idText(entityId));
      if (!row || String(row.username).toLowerCase() === "admin") return false;
    }
    const result = db
      .prepare(`DELETE FROM ${table} WHERE id = ?`)
      .run(idText(entityId));
    return result.changes > 0;
  }

  const approveTx = db.transaction(({ actor, id }) => {
    const req = db
      .prepare("SELECT * FROM deletion_requests WHERE id = ?")
      .get(idText(id));
    if (!req) return { ok: false, error: "Request not found." };
    if (req.status !== "pending") return { ok: false, error: "This request is already resolved." };
    if (!executeDeletion(req.entity_type, req.entity_id)) {
      return { ok: false, error: "That record no longer exists or can't be deleted." };
    }
    db.prepare(
      "UPDATE deletion_requests SET status = 'approved', resolved_at = ?, resolved_by = ? WHERE id = ?"
    ).run(nowIso(), actor, req.id);
    logAudit(db, actor, `Approved deletion request: ${req.entity_label}`);
    return { ok: true };
  });

  function deletionApprove(payload) {
    return approveTx(payload);
  }

  function deletionReject({ actor, id }) {
    const req = db
      .prepare("SELECT * FROM deletion_requests WHERE id = ?")
      .get(idText(id));
    if (!req) return { ok: false, error: "Request not found." };
    if (req.status !== "pending") return { ok: false, error: "This request is already resolved." };
    db.prepare(
      "UPDATE deletion_requests SET status = 'rejected', resolved_at = ?, resolved_by = ? WHERE id = ?"
    ).run(nowIso(), actor, req.id);
    logAudit(db, actor, `Rejected deletion request: ${req.entity_label}`);
    return { ok: true };
  }

  /* ------------------------------- audit helper -------------------------------- */

  function auditLog({ actor, action }) {
    const clean = note(action, 2000);
    if (!clean) return { ok: false, error: "Nothing to record." };
    logAudit(db, actor, clean);
    return { ok: true };
  }

  /* ------------------------------- auto renewal -------------------------------- */

  const autoRenewTx = db.transaction(({ limit }) => {
    const today = todayUtc();
    const batch = int(limit, 1, 5000, 500);
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
