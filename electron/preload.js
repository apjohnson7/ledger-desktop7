const { contextBridge, ipcRenderer } = require("electron");

// The renderer never touches the database file or Node APIs directly. Every
// data operation goes through the main process's whitelisted IPC bridge, and
// lists always come back paginated.
const call = (method, params = {}) => ipcRenderer.invoke("ledger:call", method, params);

const group = (methods) => {
  const out = {};
  for (const [name, method] of Object.entries(methods)) {
    out[name] = (params = {}) => call(method, params);
  }
  return out;
};

contextBridge.exposeInMainWorld("ledger", {
  call,

  auth: group({
    login: "auth.login",
    session: "auth.session",
    logout: "auth.logout",
    changePassword: "auth.changePassword",
  }),

  /** Renderer-side crashes are logged next to crash.log in the data folder,
   *  where support can inspect them even when the window is unusable. */
  logError: (payload) => ipcRenderer.invoke("ledger:logError", payload),

  bootstrap: () => call("bootstrap"),
  dashboard: () => call("dashboard"),
  settings: () => call("settings"),
  search: (q) => call("searchAll", { q }),
  autoRenew: (limit) => call("autoRenew", { limit }),

  borrowers: group({
    page: "borrowersPage",
    get: "borrowerGet",
    statement: "borrowerStatement",
    pick: "borrowerPick",
    duplicate: "borrowerDuplicate",
    create: "borrowerCreate",
    update: "borrowerUpdate",
    remove: "borrowerDelete",
  }),

  loans: group({
    page: "loansPage",
    get: "loanGet",
    picker: "loansPicker",
    paymentContext: "loanPaymentContext",
    create: "loanCreate",
    update: "loanUpdate",
    voidLoan: "loanVoid",
    markPaid: "loanMarkPaid",
    renew: "loanRenew",
    remove: "loanDelete",
  }),

  payments: group({
    page: "paymentsPage",
    create: "paymentCreate",
    update: "paymentUpdate",
    remove: "paymentDelete",
  }),

  collateral: group({
    page: "collateralPage",
    create: "collateralCreate",
    update: "collateralUpdate",
    release: "collateralRelease",
    remove: "collateralDelete",
  }),

  expenses: group({
    page: "expensesPage",
    balances: "expenseBalances",
    create: "expenseCreate",
    update: "expenseUpdate",
    remove: "expenseDelete",
  }),

  funding: group({
    overview: "fundingOverview",
    events: "fundingEvents",
    open: "fundingOpen",
    repaymentContext: "fundRepaymentContext",
    create: "fundCreate",
    update: "fundUpdate",
    remove: "fundDelete",
    repaymentCreate: "fundRepaymentCreate",
    repaymentUpdate: "fundRepaymentUpdate",
    repaymentDelete: "fundRepaymentDelete",
  }),

  reports: group({
    summary: "reportsSummary",
  }),

  audit: group({
    page: "auditPage",
    log: "auditLog",
  }),

  approvals: group({
    page: "approvalsPage",
    request: "deletionRequest",
    approve: "deletionApprove",
    reject: "deletionReject",
  }),

  users: group({
    list: "usersList",
    create: "userCreate",
    update: "userUpdate",
    setActive: "userSetActive",
    remove: "userDelete",
  }),

  settingsUpdate: (params) => call("settingsUpdate", params),

  backup: {
    info: () => ipcRenderer.invoke("ledger:backupInfo"),
    now: () => ipcRenderer.invoke("ledger:backupNow"),
    exportFile: () => ipcRenderer.invoke("ledger:backupExport"),
    restoreFile: () => ipcRenderer.invoke("ledger:backupRestore"),
    openFolder: (which = "backups") => ipcRenderer.invoke("ledger:openFolder", which),
  },
});
