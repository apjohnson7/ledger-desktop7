import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, Users, Wallet, CreditCard, Lock, TrendingDown, BarChart3, Settings as SettingsIcon,
  Search, Plus, X, ChevronRight, Phone, MapPin, Briefcase, AlertTriangle, CheckCircle2,
  Clock, ArrowLeft, Edit2, Ban, Camera, FileText, ChevronDown, Calendar, DollarSign,
  TrendingUp, ShieldCheck, PackageCheck, Menu, RefreshCw, Landmark, ArrowDownCircle, ArrowUpCircle, Bell, History,
  Download, FileSpreadsheet, FileType, Trash2
} from "lucide-react";
import * as XLSX from "xlsx";

/* ============================================================================
   LEDGER, a money lending management system
   Design language: aged-ledger / brass-and-ink. Warm paper surfaces, a deep
   forest-ink primary, a brass accent for money figures, rubber-stamp status
   badges, and a monospace face for anything numeric. The whole thing should
   feel like a well-kept physical ledger book that happens to be digital.
   ============================================================================ */

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&display=swap');`;

const CURRENCY = "UGX";
const fmt = (n) => {
  const v = Math.round(Number(n) || 0);
  return `${CURRENCY} ${v.toLocaleString("en-UG")}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* -------------------------------- password hashing --------------------------------
   Passwords are never stored in plain text. Uses the browser/Electron's built-in
   Web Crypto API (PBKDF2, 100k iterations, SHA-256) with a random salt per user,
   so no extra native dependency is needed and it works identically whether this
   runs as a Claude artifact or inside the packaged desktop app. */

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = await hashPassword(password, salt);
  return constantTimeEqual(actual, expectedHash);
}

/** Upgrades any user still carrying a plain-text `password` field (from before
 *  hashing was added) to a salted hash, in place. Safe to call repeatedly. */
async function migrateLegacyPasswords(users) {
  for (const u of users) {
    if (u.password && !u.passwordHash) {
      const salt = randomSalt();
      u.passwordHash = await hashPassword(u.password, salt);
      u.passwordSalt = salt;
      delete u.password;
    }
  }
}

const formatTime = (isoTimestamp) => {
  if (!isoTimestamp) return "";
  const d = new Date(isoTimestamp);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

const CATEGORY_OPTIONS = [
  "Mobile Phone", "Laptop", "Television", "Motorcycle", "Vehicle",
  "Land Document", "House Document", "Jewellery", "Electronics", "Other"
];
const EXPENSE_CATEGORIES = [
  "Rent", "Transport", "Salaries", "Airtime/Internet", "Office Supplies",
  "Mobile Money Charges", "Bank Charges", "Marketing", "Other"
];
const PAYMENT_METHODS = ["Cash", "Mobile Money", "Bank Transfer", "Other"];
const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Custom"];

const FREQ_DAYS = { Daily: 1, Weekly: 7, Monthly: 30, Custom: 30 };

const PHONE_REGEX = /^(07|03|04)\d{8}$/;
const digitsOnly = (v) => v.replace(/\D/g, "").slice(0, 10);
const ninChars = (v) => v.replace(/\s/g, "").toUpperCase().slice(0, 14);
const isValidPhone = (v) => !v || PHONE_REGEX.test(v);
const isValidNin = (v) => !v || v.length === 14;

/* -------------------------------- translations -------------------------------- */

const LANGUAGES = {
  en: "English",
  lg: "Luganda",
  nyn: "Runyankole / Lunyankole",
};

const TR = {
  appName: { en: "Ledger", lg: "Ledger", nyn: "Ledger" },
  appTagline: { en: "Every entry, kept.", lg: "Buli kyakuwandiika, kikuumibwa.", nyn: "Buri kyahandiikirwe, nikwebwa." },
  openingLedger: { en: "Opening the ledger…", lg: "Tuggula ekitabo…", nyn: "Nitwiguura ekitabo…" },

  navDashboard: { en: "Dashboard", lg: "Olupapula lw'Ekika", nyn: "Orupapura rw'Ebiro" },
  navBorrowers: { en: "Borrowers", lg: "Abeewola", nyn: "Abeegura" },
  navLoans: { en: "Loans", lg: "Ebbanja", nyn: "Emiwendo/Ebbanja" },
  navPayments: { en: "Payments", lg: "Okusasula", nyn: "Okushasura" },
  navCollateral: { en: "Security / Collateral", lg: "Emmutwe / Ebikwatibwako", nyn: "Omutungo / Ebirikukwatibwaho" },
  navExpenses: { en: "Operational Costs", lg: "Ebisale by'Obusuubuzi", nyn: "Ebisasuro by'Omulimo" },
  navReports: { en: "Reports", lg: "Lipoota", nyn: "Ripoota" },
  navSettings: { en: "Settings", lg: "Entegeka", nyn: "Enteekateeko" },
  navUsers: { en: "Users", lg: "Abakozesa", nyn: "Abakoresa" },

  search: { en: "Search borrowers, loans, payments, collateral…", lg: "Noonya abeewola, ebbanja, okusasula, ebikwatibwako…", nyn: "Sherura abeegura, ebbanja, okushasura, omutungo…" },
  new: { en: "New", lg: "Kipya", nyn: "Ekiheeru" },
  newBorrower: { en: "New Borrower", lg: "Omwewozi Omupya", nyn: "Omweguzi Omuhya" },
  newLoan: { en: "New Loan", lg: "Ebbanja Eppya", nyn: "Ebbanja Ehyaka" },
  recordPayment: { en: "Record Payment", lg: "Wandiika Okusasula", nyn: "Handiika Okushasura" },
  recordExpense: { en: "Record Expense", lg: "Wandiika Ensasulo", nyn: "Handiika Ekishasuro" },
  signedInAs: { en: "Signed in as", lg: "Oyingidde nga", nyn: "Otahiremu nka" },
  logOut: { en: "Log out", lg: "Fuluma", nyn: "Shohoka" },

  goodDay: { en: "Good day.", lg: "Osiibye otya.", nyn: "Osiibire ota." },
  dashboardSub: { en: "Here's where the business stands today,", lg: "Bwe butyo obusuubuzi buli leero,", nyn: "Nuku ebyobusuubuzi biriho erizooba," },
  totalLent: { en: "Total money lent", lg: "Ssente zonna eziwolwa", nyn: "Sente zoona ezaaguzirwe" },
  totalCollected: { en: "Total money collected", lg: "Ssente zonna ezisasuddwa", nyn: "Sente zoona ezashasuriirwe" },
  totalOutstanding: { en: "Total outstanding balance", lg: "Ssente ezisigadde okusasulwa", nyn: "Sente ezisigaire kushasurwa" },
  activeLoansCard: { en: "Active loans", lg: "Ebbanja ebikyali mu maaso", nyn: "Ebbanja ebikyahiga" },
  overdueLoansCard: { en: "Overdue loans", lg: "Ebbanja ebiwedde entuuko", nyn: "Ebbanja ebihweireho entebeko" },
  totalOpCosts: { en: "Total operational costs", lg: "Ebisale byonna eby'obusuubuzi", nyn: "Ebisasuro byoona by'omulimo" },
  profitLoss: { en: "Estimated profit / loss", lg: "Amagoba/Okufiirwa okulowoozebwa", nyn: "Amagoba/Okuhwerekyerezibwa okuteekaniibwa" },
  profitLossDesc: { en: "Cash collected so far, minus cash lent out and running costs. Improves as outstanding loans are repaid.", lg: "Ssente ezisasuddwa okutuusa kaakano, nga ozzeeko ssente ezawoleddwa n'ebisale by'olunaku. Zeeyongera nga ebbanja lisasulwa.", nyn: "Sente ezashasuriirwe kuhika hati, nizaihwaho sente ezaaguzirwe n'ebisasuro by'omulimo. Nizeyongyera ebbanja obu rishasurwa." },
  loansDueToday: { en: "Loans due today", lg: "Ebbanja ebisaana okusasulwa leero", nyn: "Ebbanja ebishemereire kushasurwa erizooba" },
  nothingDueToday: { en: "Nothing due today.", lg: "Tewali kisaana kusasulwa leero.", nyn: "Tihariho ekishemereire kushasurwa erizooba." },
  overduePayments: { en: "Overdue payments", lg: "Ensasulo ezaviiriddewo", nyn: "Okushasura okwahweireho" },
  noOverdue: { en: "No overdue loans. Well kept.", lg: "Tewali bbanja liwedde entuuko. Nkuumye bulungi.", nyn: "Tihariho bbanja ryahweireho entebeko. Nikuumirwe gye." },
  recentPayments: { en: "Recent payments", lg: "Ensasulo eziyisiddewo", nyn: "Okushasura okwahingwireho" },
  noPaymentsYet: { en: "No payments recorded yet.", lg: "Tewali nsasulo ewandiikiddwa.", nyn: "Tihariho kushasura kuhandiikirwe." },
  recentLoans: { en: "Recent loans issued", lg: "Amabanja agaweereddwa aganno", nyn: "Ebbanja ebyahairwe ahonaaho" },
  noLoansYet: { en: "No loans yet.", lg: "Tewali bbanja.", nyn: "Tihariho bbanja." },

  outstandingLabel: { en: "outstanding", lg: "esigadde", nyn: "esigaireho" },
  remainingLabel: { en: "remaining", lg: "esigadde", nyn: "esigaireho" },

  filterAll: { en: "All", lg: "Byonna", nyn: "Byoona" },
  statusActive: { en: "Active", lg: "Ekikyali mu maaso", nyn: "Ekihiga" },
  statusOverdue: { en: "Overdue", lg: "Ekiwedde entuuko", nyn: "Ekihweireho" },
  statusFullyPaid: { en: "Fully Paid", lg: "Kisasuddwa Kyonna", nyn: "Kishasuriirwe Kyoona" },
  statusVoided: { en: "Voided", lg: "Kisaziddwaawo", nyn: "Kihanzirweho" },
  statusHeld: { en: "Held", lg: "Kikwatiddwa", nyn: "Kikwatiirwe" },
  statusReleased: { en: "Released", lg: "Kiwedde Okuddizibwa", nyn: "Kigarukanywe" },

  cancel: { en: "Cancel", lg: "Sazaamu", nyn: "Hendura" },
  saveChanges: { en: "Save changes", lg: "Tereka enkyukakyuka", nyn: "Biika enshoboorozi" },
  editProfile: { en: "Edit profile", lg: "Kyusa bulambulukufu", nyn: "Hindura ebirikukukwataho" },
  addCollateral: { en: "Add collateral", lg: "Wongera ekikwatibwako", nyn: "Ongyeraho omutungo" },
  voidAction: { en: "Void", lg: "Sazaamu", nyn: "Hanzaho" },
  releaseAction: { en: "Release", lg: "Ddiza", nyn: "Garukanya" },
  allBorrowers: { en: "All borrowers", lg: "Abeewola bonna", nyn: "Abeegura boona" },
  allLoans: { en: "All loans", lg: "Ebbanja byonna", nyn: "Ebbanja byoona" },
  registerBorrower: { en: "Register borrower", lg: "Wandiisa omwewozi", nyn: "Handiisa omweguzi" },
  issueLoan: { en: "Issue loan", lg: "Wa ebbanja", nyn: "Ha ebbanja" },
  saveCollateral: { en: "Save collateral", lg: "Tereka ekikwatibwako", nyn: "Biika omutungo" },
  saveExpense: { en: "Save expense", lg: "Tereka ensasulo", nyn: "Biika ekishasuro" },
  addUser: { en: "Add User", lg: "Wongera Omukozesa", nyn: "Ongyeraho Omukoresa" },
  deactivate: { en: "Deactivate", lg: "Ziyiza", nyn: "Ziibira" },
  reactivate: { en: "Reactivate", lg: "Zzaawo", nyn: "Garuka Kozesa" },
  editAction: { en: "Edit", lg: "Kyusa", nyn: "Hindura" },
  signIn: { en: "Sign in", lg: "Yingira", nyn: "Taahamu" },

  sectionBorrowers: { en: "Borrowers", lg: "Abeewola", nyn: "Abeegura" },
  sectionLoans: { en: "Loans", lg: "Ebbanja", nyn: "Ebbanja" },
  sectionPayments: { en: "Payments", lg: "Okusasula", nyn: "Okushasura" },
  sectionCollateral: { en: "Security / Collateral", lg: "Emmutwe / Ebikwatibwako", nyn: "Omutungo / Ebirikukwatibwaho" },
  sectionExpenses: { en: "Operational Costs", lg: "Ebisale by'Obusuubuzi", nyn: "Ebisasuro by'Omulimo" },
  sectionReports: { en: "Reports", lg: "Lipoota", nyn: "Ripoota" },
  sectionSettings: { en: "Settings", lg: "Entegeka", nyn: "Enteekateeko" },
  sectionUsers: { en: "Users", lg: "Abakozesa", nyn: "Abakoresa" },

  noBorrowersYet: { en: "No borrowers yet", lg: "Tewali beewola", nyn: "Tihariho beegura" },
  noBorrowersSub: { en: "Register your first borrower to get started.", lg: "Wandiisa omwewozi wo owookubanza okutandika.", nyn: "Handiisa omweguzi waawe ow'okubanza kutandika." },
  noLoansFound: { en: "No loans found", lg: "Tewali bbanja lizuuliddwa", nyn: "Tihariho bbanja ryabonekire" },
  noPaymentsRecorded: { en: "No payments recorded yet", lg: "Tewali nsasulo ewandiikiddwa", nyn: "Tihariho kushasura kuhandiikirwe" },
  noCollateralRecorded: { en: "No collateral recorded", lg: "Tewali kikwatibwako kiwandiikiddwa", nyn: "Tihariho mutungo gwahandiikirwe" },
  noExpensesYet: { en: "No expenses recorded yet", lg: "Tewali nsasulo ewandiikiddwa", nyn: "Tihariho bishasuro byahandiikirwe" },
  noExpenseData: { en: "No expense data yet", lg: "Tewali makuru g'ensasulo", nyn: "Tihariho biteekateeko by'ebishasuro" },
  noSearchMatches: { en: "No matches found", lg: "Tewali kizuuliddwa", nyn: "Tihariho kyabonekire" },
  searchTrySub: { en: "Try a different name, phone number, or loan number.", lg: "Gezaako erinnya erirala, ennamba y'essimu, oba namba y'ebbanja.", nyn: "Gyezeho eiziina erindi, namba y'esimu, nari namba y'ebbanja." },
  borrowerNotFound: { en: "Borrower not found", lg: "Omwewozi tazuuliddwa", nyn: "Omweguzi tarabonekire" },
  loanNotFound: { en: "Loan not found", lg: "Ebbanja teriizuuliddwa", nyn: "Ebbanja tiryabonekire" },

  notProvided: { en: "Not provided", lg: "Tekiweereddwa", nyn: "Tikiheirwe" },
  voided: { en: "Voided", lg: "Kisaziddwaawo", nyn: "Kihanzirweho" },
  on: { en: "on", lg: "ku", nyn: "aha" },
  reason: { en: "Reason", lg: "Ensonga", nyn: "Enshonga" },

  settingsHint: {
    en: "Currency is fixed to Ugandan Shillings (UGX). All figures on the dashboard and reports are calculated automatically from your borrowers, loans, payments, and expenses, nothing here needs manual upkeep. Records are never permanently deleted: use Void on a loan, payment, or expense to correct mistakes while keeping a full history.",
    lg: "Ssente ye Uganda Shillings (UGX). Ebibalo byonna ku lupapula lw'ekika ne lipoota bibalirirwa byokka okuva mu beewola, ebbanja, okusasula, n'ebisale, tewali kya kukola bugazi. Ebiwandiikiddwa tebisangulwa ddala: kozesa Void ku bbanja, okusasula, oba ensasulo okutereeza ensobi nga obulambulukufu bwonna bukyakuumiddwa.",
    nyn: "Sente ye Uganda Shillings (UGX). Ebibarirwa byoona aha rupapura n'omu ripoota nibibarirwa byonka kuruga aha beegura, ebbanja, okushasura, n'ebishasuro, tihariho eky'okukora n'engaro. Ebihandiikirwe tibisangurwaho rundi: koresa Void aha bbanja, okushasura, nari ekishasuro kuhindura enshobo waaba nooshigikiirira amakuru goona."
  },
  photoUploadNote: {
    en: "Photo and document upload isn't available in this preview, the record is saved with the details above.",
    lg: "Okuwaayo ebifaananyi n'ebiwandiiko tekukyalimu mu kalulu kano, ebiwandiiko bitereke n'ebikwata biri waggulu.",
    nyn: "Okworeka ebishushani n'ebihandiiko tikirikubaho omuriyo, ebihandiikirwe nibibiikwa n'ebirikubireeba biri aiguru."
  },
};

function translate(lang, key) {
  const entry = TR[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

/* ---------------------------- storage helpers ---------------------------- */

const STORE_KEY = "ledger-data-v1";

async function loadAll() {
  try {
    const res = await window.storage.get(STORE_KEY, false);
    if (res && res.value) return JSON.parse(res.value);
  } catch (e) { /* first run, nothing stored yet */ }
  return null;
}
async function saveAll(data) {
  try {
    await window.storage.set(STORE_KEY, JSON.stringify(data), false);
  } catch (e) { console.error("Save failed", e); }
}

const seedData = () => ({
  borrowers: [],
  loans: [],
  payments: [],
  collateral: [],
  expenses: [],
  externalFunds: [],
  fundRepayments: [],
  auditLog: [],
  users: [],
  settings: { businessName: "My Lending Business", language: "en", startingCashBalance: 0 }
});

/* -------------------------------- roles & access -------------------------------- */

const ROLES = {
  Administrator: {
    label: "Administrator",
    description: "Full access to every module, plus user management.",
    pages: ["dashboard", "borrowers", "loans", "payments", "collateral", "expenses", "funding", "reports", "settings", "users", "audit"],
    manageUsers: true,
  },
  Manager: {
    label: "Manager",
    description: "Full access to daily operations and reports, no user management.",
    pages: ["dashboard", "borrowers", "loans", "payments", "collateral", "expenses", "funding", "reports", "settings"],
    manageUsers: false,
  },
  "Loan Officer": {
    label: "Loan Officer",
    description: "Registers borrowers, issues loans, records payments and collateral.",
    pages: ["dashboard", "borrowers", "loans", "payments", "collateral"],
    manageUsers: false,
  },
  Cashier: {
    label: "Cashier",
    description: "Records payments and looks up borrowers, nothing else.",
    pages: ["dashboard", "borrowers", "payments"],
    manageUsers: false,
  },
  Viewer: {
    label: "Viewer",
    description: "Read-only access to the dashboard and reports.",
    pages: ["dashboard", "reports"],
    manageUsers: false,
  },
};
const ROLE_NAMES = Object.keys(ROLES);

/* --------------------------------- app ----------------------------------- */

export default function App() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [focusBorrowerId, setFocusBorrowerId] = useState(null);
  const [focusLoanId, setFocusLoanId] = useState(null);
  const [modal, setModal] = useState(null); // {type, payload}
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      const d = await loadAll();
      const base = d || seedData();
      if (!base.users || base.users.length === 0) {
        const salt = randomSalt();
        const hash = await hashPassword("admin", salt);
        base.users = [{ id: uid("usr"), username: "admin", passwordHash: hash, passwordSalt: salt, fullName: "Administrator", role: "Administrator", active: true, createdAt: todayISO() }];
      } else {
        await migrateLegacyPasswords(base.users);
      }
      if (!base.externalFunds) base.externalFunds = [];
      if (!base.fundRepayments) base.fundRepayments = [];
      if (!base.auditLog) base.auditLog = [];
      if (base.settings && base.settings.startingCashBalance === undefined) base.settings.startingCashBalance = 0;
      setData(base);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded && data) saveAll(data);
  }, [data, loaded]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // Automatically renew any loan that has passed its due date and hasn't
  // been paid off, voided, or renewed already. Runs on load and whenever
  // the books change, so a loan is rolled over as soon as it's noticed overdue.
  useEffect(() => {
    if (!loaded || !data) return;
    const toRenew = data.loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, data.payments) === "Overdue");
    if (toRenew.length === 0) return;
    setData((prev) => {
      const next = structuredClone(prev);
      if (!next.auditLog) next.auditLog = [];
      toRenew.forEach((l) => {
        const fresh = next.loans.find((x) => x.id === l.id);
        if (!fresh || fresh.voided || fresh.renewed) return;
        const term = Math.max(daysBetween(fresh.issueDate, fresh.dueDate), 7);
        const newDue = new Date();
        newDue.setDate(newDue.getDate() + term);
        const newId = renewLoan(next, fresh.id, { newDueDate: newDue.toISOString().slice(0, 10), auto: true });
        next.auditLog.push({
          id: uid("log"), timestamp: new Date().toISOString(), username: "System (auto-renewal)",
          action: `Automatically renewed overdue loan ${fresh.loanNumber} into ${next.loans.find((x) => x.id === newId)?.loanNumber || "a new loan"}`,
        });
      });
      return next;
    });
    showToast(`${toRenew.length} overdue loan${toRenew.length > 1 ? "s" : ""} automatically renewed.`);
  }, [loaded, data]);

  // Pop up an alert summary once per login, covering anything overdue,
  // due soon, or that was just rolled over automatically.
  const [showNotifications, setShowNotifications] = useState(false);
  const notifShownRef = useRef(false);
  useEffect(() => {
    if (!loaded || !data || !currentUser) return;
    if (notifShownRef.current) return;
    notifShownRef.current = true;
    const today = todayISO();
    const overdue = data.loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, data.payments) === "Overdue");
    const soon = data.loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, data.payments) === "Active" && daysBetween(today, l.dueDate) >= 0 && daysBetween(today, l.dueDate) <= 3);
    const autoRenewedToday = data.loans.filter((l) => l.autoRenewed && l.issuedAt && l.issuedAt.slice(0, 10) === today);
    if (overdue.length > 0 || soon.length > 0 || autoRenewedToday.length > 0) {
      setShowNotifications(true);
    }
  }, [loaded, data, currentUser]);

  if (!loaded || !data) {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
        <style>{FONT_IMPORT}</style>
        <div style={{ fontFamily: "'Times New Roman', Times, serif", color: C.ink3 }}>Opening the ledger…</div>
      </div>
    );
  }

  const update = (fn, logLabel) => setData((prev) => {
    const next = structuredClone(prev);
    fn(next);
    if (logLabel) {
      if (!next.auditLog) next.auditLog = [];
      next.auditLog.push({
        id: uid("log"), timestamp: new Date().toISOString(),
        username: currentUser ? (currentUser.fullName || currentUser.username) : "System",
        action: logLabel,
      });
    }
    return next;
  });

  if (!currentUser) {
    const handleLogin = (u) => {
      setData((prev) => {
        const next = structuredClone(prev);
        if (!next.auditLog) next.auditLog = [];
        next.auditLog.push({
          id: uid("log"), timestamp: new Date().toISOString(),
          username: u.fullName || u.username, action: "Signed in",
        });
        return next;
      });
      setCurrentUser(u);
    };
    return <LoginScreen data={data} onLogin={handleLogin} />;
  }

  const role = ROLES[currentUser.role] || ROLES.Viewer;
  const allowedPages = role.pages;
  const t = (key) => translate(data.settings.language || "en", key);

  const goBorrower = (id) => {
    if (!allowedPages.includes("borrowers")) return;
    setFocusBorrowerId(id); setFocusLoanId(null); setPage("borrower-detail");
  };
  const goLoan = (id) => {
    if (!allowedPages.includes("loans")) return;
    setFocusLoanId(id); setPage("loan-detail");
  };

  const ctx = { data, update, showToast, goBorrower, goLoan, setModal, setPage, currentUser, role, t };

  const today = todayISO();
  const overdueLoans = data.loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, data.payments) === "Overdue");
  const soonLoans = data.loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, data.payments) === "Active" && daysBetween(today, l.dueDate) >= 0 && daysBetween(today, l.dueDate) <= 3);
  const autoRenewedToday = data.loans.filter((l) => l.autoRenewed && l.issuedAt && l.issuedAt.slice(0, 10) === today);
  const alertCount = overdueLoans.length + soonLoans.length + autoRenewedToday.length;

  const safePage = (allowedPages.includes(page) || (page === "borrower-detail" && allowedPages.includes("borrowers")) || (page === "loan-detail" && allowedPages.includes("loans"))) ? page : "dashboard";

  return (
    <div style={S.page}>
      <style>{`${FONT_IMPORT}
        * { box-sizing: border-box; }
        input, select, textarea { font-family: 'Times New Roman', Times, serif; font-size: 16px; }
        input:focus, select:focus, textarea:focus { outline: 2px solid ${C.brass}; outline-offset: 1px; }
        button:focus-visible, [role=button]:focus-visible { outline: 2px solid ${C.brass}; outline-offset: 2px; }
        ::placeholder { color: ${C.ink4}; }
        .lm-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .lm-scroll::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        .lm-carousel { scrollbar-width: none; -ms-overflow-style: none; }
        .lm-carousel::-webkit-scrollbar { display: none; }
        @media (max-width: 860px) {
          .lm-sidebar { position: fixed; z-index: 40; left: 0; top: 0; bottom: 0; transform: translateX(-100%); transition: transform .22s ease; }
          .lm-sidebar.open { transform: translateX(0); }
          .lm-main { margin-left: 0 !important; }
        }
      `}</style>

      <Sidebar page={safePage} setPage={setPage} navOpen={navOpen} setNavOpen={setNavOpen} businessName={data.settings.businessName} allowedPages={allowedPages} />
      {navOpen && <div onClick={() => setNavOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(31,42,36,0.4)", zIndex: 30 }} />}

      <div className="lm-main" style={{ marginLeft: 240, minHeight: "100%" }}>
        <TopBar
          searchQ={searchQ} setSearchQ={setSearchQ}
          onOpenNav={() => setNavOpen(true)}
          onQuickAction={(t) => setModal({ type: t })}
          currentUser={currentUser}
          onLogout={() => { update(() => {}, "Signed out"); notifShownRef.current = false; setCurrentUser(null); setPage("dashboard"); }}
          allowedPages={allowedPages}
          alertCount={alertCount}
          onOpenNotifications={() => setShowNotifications(true)}
          setModal={setModal}
        />

        <div style={{ padding: "20px 24px 60px", maxWidth: 1180, margin: "0 auto" }}>
          {searchQ.trim().length > 0 ? (
            <SearchResults q={searchQ} data={data} goBorrower={goBorrower} goLoan={goLoan} clear={() => setSearchQ("")} />
          ) : (
            <>
              {safePage === "dashboard" && <Dashboard {...ctx} />}
              {safePage === "borrowers" && <Borrowers {...ctx} />}
              {safePage === "borrower-detail" && <BorrowerDetail {...ctx} borrowerId={focusBorrowerId} />}
              {safePage === "loans" && <Loans {...ctx} />}
              {safePage === "loan-detail" && <LoanDetail {...ctx} loanId={focusLoanId} />}
              {safePage === "payments" && <Payments {...ctx} />}
              {safePage === "collateral" && <Collateral {...ctx} />}
              {safePage === "expenses" && <Expenses {...ctx} />}
              {safePage === "funding" && <ExternalFunding {...ctx} />}
              {safePage === "reports" && <Reports {...ctx} />}
              {safePage === "settings" && <SettingsPage {...ctx} />}
              {safePage === "users" && role.manageUsers && <UsersPage {...ctx} />}
              {safePage === "audit" && role.manageUsers && <AuditLogPage {...ctx} />}
            </>
          )}
        </div>
      </div>

      {modal && (
        <ModalRouter modal={modal} close={() => setModal(null)} {...ctx} />
      )}

      {showNotifications && (
        <NotificationsModal
          overdueLoans={overdueLoans} soonLoans={soonLoans} autoRenewedToday={autoRenewedToday}
          data={data} close={() => setShowNotifications(false)} goLoan={goLoan}
        />
      )}

      {toast && (
        <div style={S.toast}>
          <CheckCircle2 size={16} color={C.brassDark} style={{ flexShrink: 0 }} />
          {toast}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- theme ---------------------------------- */

const C = {
  bg: "#F6F1E7",
  paper: "#FCF9F2",
  surface: "#FFFFFF",
  ink: "#20291F",
  ink2: "#3D4A3B",
  ink3: "#6B7566",
  ink4: "#9CA495",
  border: "#E4DCC7",
  borderStrong: "#D3C7A6",
  forest: "#2E4A32",
  forestDark: "#1D3220",
  forestSoft: "#E4EBDE",
  brass: "#B4863A",
  brassDark: "#8C6526",
  brassSoft: "#F3E7CC",
  rust: "#A23B2E",
  rustSoft: "#F5E2DD",
  gold: "#C9A227",
};

const S = {
  page: {
    background: C.bg,
    color: C.ink,
    fontFamily: "'Times New Roman', Times, serif",
    minHeight: "100%",
    fontSize: 20,
  },
  toast: {
    position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)",
    background: C.ink, color: "#F6F1E7", padding: "10px 18px", borderRadius: 8,
    fontSize: 15.5, display: "flex", alignItems: "center", gap: 8, zIndex: 80,
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)"
  },
};

const numFont = { fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 };
const displayFont = { fontFamily: "'Inter Tight', sans-serif", fontWeight: 700, letterSpacing: -0.2 };

/* -------------------------------- sidebar --------------------------------- */

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "borrowers", label: "Borrowers", icon: Users },
  { id: "loans", label: "Loans", icon: Wallet },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "collateral", label: "Security / Collateral", icon: Lock },
  { id: "expenses", label: "Operational Costs", icon: TrendingDown },
  { id: "funding", label: "External Funding", icon: Landmark },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "users", label: "Users", icon: ShieldCheck },
  { id: "audit", label: "Audit Log", icon: History },
];

function Sidebar({ page, setPage, navOpen, setNavOpen, businessName, allowedPages }) {
  const items = NAV.filter((n) => allowedPages.includes(n.id));
  return (
    <div className={`lm-sidebar${navOpen ? " open" : ""}`} style={{
      width: 240, background: C.forestDark, color: "#EDE7D6", minHeight: "100vh",
      display: "flex", flexDirection: "column", position: navOpen ? undefined : "fixed",
      top: 0, left: 0, bottom: 0
    }}>
      <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid rgba(237,231,214,0.14)" }}>
        <div style={{ ...displayFont, fontSize: 25, fontWeight: 600, letterSpacing: 0.3 }}>Ledger</div>
        <div style={{ fontSize: 14, color: "#B9C4AE", marginTop: 3, ...numFont }}>{businessName}</div>
      </div>
      <div style={{ flex: 1, padding: "10px 10px", overflowY: "auto" }} className="lm-scroll">
        {items.map((n) => {
          const active = page === n.id || (page === "borrower-detail" && n.id === "borrowers") || (page === "loan-detail" && n.id === "loans");
          const Icon = n.icon;
          return (
            <div key={n.id}
              onClick={() => { setPage(n.id); setNavOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 7,
                cursor: "pointer", marginBottom: 2, fontSize: 16, fontWeight: active ? 600 : 400,
                background: active ? "rgba(196,162,39,0.16)" : "transparent",
                color: active ? "#F3E7CC" : "#CBD3C1",
                borderLeft: active ? `3px solid ${C.gold}` : "3px solid transparent",
              }}>
              <Icon size={16} strokeWidth={2} />
              {n.label}
            </div>
          );
        })}
      </div>
      <div style={{ padding: "14px 20px", fontSize: 13, color: "#7C8974", borderTop: "1px solid rgba(237,231,214,0.1)" }}>
        Every entry, kept.
      </div>
    </div>
  );
}

function TopBar({ searchQ, setSearchQ, onOpenNav, onQuickAction, currentUser, onLogout, allowedPages, alertCount, onOpenNotifications, setModal }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showUser, setShowUser] = useState(false);
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 20, background: C.paper, borderBottom: `1px solid ${C.border}`,
      padding: "12px 20px", display: "flex", alignItems: "center", gap: 12
    }}>
      <div onClick={onOpenNav} style={{ display: "none", cursor: "pointer" }} className="lm-navbtn">
        <Menu size={20} />
      </div>
      <style>{`@media (max-width:860px){ .lm-navbtn{ display:flex !important; } }`}</style>
      <div style={{
        flex: 1, maxWidth: 480, display: "flex", alignItems: "center", gap: 8,
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, padding: "9px 12px"
      }}>
        <Search size={15} color={C.ink3} />
        <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Search borrowers, loans, payments, collateral…"
          style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 16, color: C.ink }} />
        {searchQ && <X size={14} color={C.ink3} style={{ cursor: "pointer" }} onClick={() => setSearchQ("")} />}
      </div>
      <div style={{ flex: 1 }} />
      <div onClick={onOpenNotifications} style={{
        position: "relative", width: 38, height: 38, borderRadius: "50%", border: `1px solid ${C.border}`,
        background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
      }}>
        <Bell size={16} color={C.ink3} />
        {alertCount > 0 && (
          <div style={{
            position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, borderRadius: "50%",
            background: C.rust, color: "#fff", fontSize: 10.5, fontWeight: 700, display: "flex",
            alignItems: "center", justifyContent: "center", padding: "0 3px", border: `1.5px solid ${C.paper}`
          }}>{alertCount > 9 ? "9+" : alertCount}</div>
        )}
      </div>
      {allowedPages.some((p) => ["borrowers", "loans", "payments", "expenses"].includes(p)) && (
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowAdd((v) => !v)} style={Btn.primary}>
            <Plus size={15} /> New
          </button>
          {showAdd && (
            <div style={{
              position: "absolute", right: 0, top: "115%", background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 10, boxShadow: "0 10px 30px rgba(31,42,36,0.16)", width: 200, zIndex: 50, overflow: "hidden"
            }}>
              {[
                ["New Borrower", "borrower", "borrowers"], ["New Loan", "loan", "loans"],
                ["Record Payment", "payment", "payments"], ["Record Expense", "expense", "expenses"]
              ].filter(([, , need]) => allowedPages.includes(need)).map(([label, type]) => (
                <div key={type} onClick={() => { onQuickAction(type); setShowAdd(false); }}
                  style={{ padding: "10px 14px", fontSize: 15.5, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={(e) => e.currentTarget.style.background = C.forestSoft}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  {label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <div onClick={() => setShowUser((v) => !v)} style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "6px 10px",
          borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%", background: C.forest, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700
          }}>{(currentUser.fullName || currentUser.username).slice(0, 1).toUpperCase()}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.ink2 }}>{currentUser.fullName || currentUser.username}</div>
          <ChevronDown size={13} color={C.ink3} />
        </div>
        {showUser && (
          <div style={{
            position: "absolute", right: 0, top: "115%", background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 10, boxShadow: "0 10px 30px rgba(31,42,36,0.16)", width: 200, zIndex: 50, overflow: "hidden"
          }}>
            <div style={{ padding: "10px 14px", fontSize: 14, color: C.ink3, borderBottom: `1px solid ${C.border}` }}>
              Signed in as <b>{currentUser.username}</b><br />{currentUser.role}
            </div>
            <div onClick={() => { setShowUser(false); setModal({ type: "changePassword" }); }} style={{ padding: "10px 14px", fontSize: 15.5, cursor: "pointer", color: C.ink2, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}
              onMouseEnter={(e) => e.currentTarget.style.background = C.forestSoft}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              Change password
            </div>
            <div onClick={onLogout} style={{ padding: "10px 14px", fontSize: 15.5, cursor: "pointer", color: C.rust, fontWeight: 600 }}
              onMouseEnter={(e) => e.currentTarget.style.background = C.rustSoft}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              Log out
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const Btn = {
  primary: {
    display: "flex", alignItems: "center", gap: 6, background: C.forest, color: "#fff", border: "none",
    borderRadius: 8, padding: "9px 15px", fontSize: 16, fontWeight: 600, cursor: "pointer",
  },
  secondary: {
    display: "flex", alignItems: "center", gap: 6, background: C.surface, color: C.ink2, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: "9px 15px", fontSize: 16, fontWeight: 600, cursor: "pointer",
  },
  ghost: {
    display: "flex", alignItems: "center", gap: 6, background: "transparent", color: C.forest, border: "none",
    borderRadius: 8, padding: "6px 8px", fontSize: 15.5, fontWeight: 600, cursor: "pointer",
  },
  danger: {
    display: "flex", alignItems: "center", gap: 6, background: C.rustSoft, color: C.rust, border: `1px solid #E3C3BB`,
    borderRadius: 8, padding: "8px 13px", fontSize: 15.5, fontWeight: 600, cursor: "pointer",
  }
};

/* -------------------------------- helpers ---------------------------------- */

function paidAmountFor(loanId, payments) {
  return payments.filter((p) => p.loanId === loanId && !p.voided).reduce((s, p) => s + Number(p.amount), 0);
}
function principalPaidFor(loanId, payments) {
  return payments.filter((p) => p.loanId === loanId && !p.voided)
    .reduce((s, p) => s + Number(p.principalPaid ?? p.amount), 0);
}
function interestPaidFor(loanId, payments) {
  return payments.filter((p) => p.loanId === loanId && !p.voided)
    .reduce((s, p) => s + Number(p.interestPaid ?? 0), 0);
}
function loanInterestAmount(loan) {
  return loan.interestType === "Percent" ? Number(loan.amount) * (Number(loan.interestValue) || 0) / 100 : (Number(loan.interestValue) || 0);
}
function loanStatus(loan, payments) {
  if (loan.voided) return "Voided";
  if (loan.renewed) return "Renewed";
  const paid = paidAmountFor(loan.id, payments);
  if (paid >= loan.totalPayable - 0.5) return "Fully Paid";
  if (new Date(loan.dueDate) < new Date(todayISO())) return "Overdue";
  return "Active";
}
function nextDueDate(loan, payments) {
  if (loan.repaymentMethod !== "Instalments" || !loan.instalments) return loan.dueDate;
  const paidCount = payments.filter((p) => p.loanId === loan.id && !p.voided).length;
  const step = FREQ_DAYS[loan.instalments.frequency] || 30;
  const d = new Date(loan.instalments.firstPaymentDate);
  d.setDate(d.getDate() + paidCount * step);
  return d.toISOString().slice(0, 10);
}
function borrowerName(borrowers, id) {
  const b = borrowers.find((x) => x.id === id);
  return b ? b.fullName : "Unknown borrower";
}
function loanTotals(loans, payments) {
  const nonVoided = loans.filter((l) => !l.voided);
  const totalLent = nonVoided.reduce((s, l) => s + Number(l.amount), 0);
  const totalCollected = payments.filter((p) => !p.voided).reduce((s, p) => s + Number(p.amount), 0);
  let outstanding = 0, activeCount = 0, overdueCount = 0;
  nonVoided.filter((l) => !l.renewed).forEach((l) => {
    const st = loanStatus(l, payments);
    if (st !== "Fully Paid") {
      outstanding += Math.max(0, l.totalPayable - paidAmountFor(l.id, payments));
      activeCount++;
      if (st === "Overdue") overdueCount++;
    }
  });
  return { totalLent, totalCollected, outstanding, activeCount, overdueCount };
}

/** Builds a chronological day-by-day cash ledger: every loan disbursed is
 *  cash out, every payment received is cash in, every expense is cash out.
 *  Renewals don't move new cash, so they're excluded. Returned in ascending
 *  date order, running from the business's starting cash balance. */
function computeDailyCashBalances(data) {
  const dayMap = {};
  const touch = (date) => { if (!dayMap[date]) dayMap[date] = { in: 0, out: 0 }; return dayMap[date]; };

  data.loans.forEach((l) => {
    if (l.voided || l.renewedFromId) return;
    touch(l.issueDate).out += Number(l.amount);
  });
  data.payments.forEach((p) => {
    if (p.voided) return;
    touch(p.date).in += Number(p.amount);
  });
  data.expenses.forEach((e) => {
    if (e.voided) return;
    touch(e.date).out += Number(e.amount);
  });

  const days = Object.keys(dayMap).sort();
  let running = Number(data.settings.startingCashBalance) || 0;
  return days.map((date) => {
    const { in: cashIn, out: cashOut } = dayMap[date];
    const opening = running;
    const closing = opening + cashIn - cashOut;
    running = closing;
    return { date, opening, cashIn, cashOut, closing };
  });
}

const DEFAULT_INTEREST_RATE = 20;
const DEFAULT_PAPERWORK_FEE = 5000;

/** Rolls a loan's outstanding balance into a brand new loan, and marks the
 *  original as Renewed (kept in history, excluded from active totals). */
function renewLoan(d, oldLoanId, opts = {}) {
  const old = d.loans.find((l) => l.id === oldLoanId);
  if (!old || old.voided || old.renewed) return null;
  const paid = paidAmountFor(old.id, d.payments);
  const outstanding = Math.max(0, old.totalPayable - paid);
  const principal = opts.newPrincipal != null && opts.newPrincipal > 0 ? opts.newPrincipal : outstanding;
  const interestType = opts.interestType || "Percent";
  const interestValue = opts.interestValue != null ? opts.interestValue : DEFAULT_INTEREST_RATE;
  const paperworkFee = opts.paperworkFee || 0;
  const interestAmt = interestType === "Percent" ? principal * interestValue / 100 : interestValue;
  const totalPayable = principal + interestAmt + paperworkFee;
  const count = (d.loans.filter((l) => l.loanNumber?.startsWith(`LN-${new Date().getFullYear()}`)).length) + 1;
  const loanNumber = `LN-${new Date().getFullYear()}-${String(count).padStart(4, "0")}`;
  const id = uid("loan");
  const issueDate = todayISO();
  d.loans.push({
    id, loanNumber, borrowerId: old.borrowerId, amount: principal, interestType, interestValue,
    paperworkFee, totalPayable, issueDate, dueDate: opts.newDueDate, repaymentMethod: "Full Payment",
    instalments: null, voided: false, renewedFromId: old.id, autoRenewed: !!opts.auto,
    issuedAt: new Date().toISOString(),
  });
  old.renewed = true;
  old.renewedIntoId = id;
  old.renewedAt = todayISO();
  return id;
}

/** Records a payment for whatever remains on a loan, closing it out in one step. */
function markLoanPaidInData(d, loanId) {
  const loan = d.loans.find((l) => l.id === loanId);
  if (!loan) return false;
  const paid = paidAmountFor(loan.id, d.payments);
  const outstanding = Math.max(0, loan.totalPayable - paid);
  if (outstanding <= 0) return false;
  const remainingPrincipal = Math.max(0, loan.amount - principalPaidFor(loan.id, d.payments));
  const principalPaid = Math.min(remainingPrincipal, outstanding);
  const interestPaid = outstanding - principalPaid;
  d.payments.push({
    id: uid("pay"), loanId: loan.id, borrowerId: loan.borrowerId, amount: outstanding,
    principalPaid, interestPaid,
    date: todayISO(), method: "Cash", reference: "", notes: "Marked as fully paid by admin.", voided: false,
  });
  return true;
}

function StampBadge({ status }) {
  const map = {
    "Fully Paid": { bg: C.forestSoft, fg: C.forestDark, bd: "#B9CDAE" },
    "Active": { bg: C.brassSoft, fg: C.brassDark, bd: "#DFC488" },
    "Overdue": { bg: C.rustSoft, fg: C.rust, bd: "#E3C3BB" },
    "Voided": { bg: "#EDEAE0", fg: C.ink3, bd: C.border },
    "Renewed": { bg: "#E7E1F2", fg: "#5A4A8C", bd: "#D2C6E8" },
    "Held": { bg: C.brassSoft, fg: C.brassDark, bd: "#DFC488" },
    "Released": { bg: C.forestSoft, fg: C.forestDark, bd: "#B9CDAE" },
  };
  const st = map[status] || map["Active"];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700,
      letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 9px", borderRadius: 20,
      background: st.bg, color: st.fg, border: `1px solid ${st.bd}`, ...numFont
    }}>
      {status}
    </span>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <h2 style={{ ...displayFont, fontSize: 25, fontWeight: 600, margin: 0, color: C.ink }}>{children}</h2>
      {action}
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, ...style }}>{children}</div>;
}

function EmptyState({ icon: Icon, title, sub, action }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 20px", color: C.ink3 }}>
      <Icon size={28} color={C.ink4} style={{ marginBottom: 10 }} />
      <div style={{ fontSize: 18, fontWeight: 600, color: C.ink2, ...displayFont }}>{title}</div>
      {sub && <div style={{ fontSize: 15.5, marginTop: 4 }}>{sub}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/* -------------------------------- dashboard -------------------------------- */

function Dashboard({ data, goBorrower, goLoan, setModal, setPage }) {
  const { borrowers, loans, payments, expenses } = data;
  const totals = loanTotals(loans, payments);
  const totalCosts = expenses.filter((e) => !e.voided).reduce((s, e) => s + Number(e.amount), 0);
  const income = totals.totalCollected - totals.totalLent; // cash-basis estimate
  const netPosition = income - totalCosts;

  const today = todayISO();
  const dueToday = loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, payments) !== "Fully Paid" && nextDueDate(l, payments) === today);
  const overdue = loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, payments) === "Overdue")
    .sort((a, b) => daysBetween(b.dueDate, today) - daysBetween(a.dueDate, today));
  const recentPayments = [...payments].filter(p=>!p.voided).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const recentLoans = [...loans].filter(l=>!l.voided).sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate)).slice(0, 5);

  const cards = [
    { label: "Total money lent", value: fmt(totals.totalLent), icon: Wallet, tone: "forest" },
    { label: "Total money collected", value: fmt(totals.totalCollected), icon: CreditCard, tone: "brass" },
    { label: "Total outstanding balance", value: fmt(totals.outstanding), icon: Clock, tone: "rust" },
    { label: "Active loans", value: totals.activeCount, icon: Users, tone: "forest" },
    { label: "Overdue loans", value: totals.overdueCount, icon: AlertTriangle, tone: "rust" },
    { label: "Total operational costs", value: fmt(totalCosts), icon: TrendingDown, tone: "brass" },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ ...displayFont, fontSize: 30, margin: 0, fontWeight: 600 }}>Good day.</h1>
          <div style={{ color: C.ink3, fontSize: 15.5, marginTop: 3 }}>Here's where the business stands today, {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={Btn.secondary} onClick={() => setModal({ type: "borrower" })}><Plus size={14} /> Borrower</button>
          <button style={Btn.secondary} onClick={() => setModal({ type: "loan" })}><Plus size={14} /> Loan</button>
          <button style={Btn.primary} onClick={() => setModal({ type: "payment" })}><Plus size={14} /> Payment</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, marginBottom: 14 }}>
        {cards.map((c) => (
          <Card key={c.label}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 14.5, color: C.ink3, fontWeight: 600 }}>{c.label}</div>
              <c.icon size={16} color={c.tone === "rust" ? C.rust : c.tone === "brass" ? C.brassDark : C.forest} />
            </div>
            <div style={{ ...numFont, fontSize: 26, fontWeight: 600, marginTop: 8, color: c.tone === "rust" && Number(String(c.value).replace(/\D/g,''))>0 ? C.rust : C.ink }}>{c.value}</div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: 16, background: netPosition >= 0 ? C.forestSoft : C.rustSoft, border: `1px solid ${netPosition >= 0 ? "#B9CDAE" : "#E3C3BB"}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: netPosition >= 0 ? C.forestDark : C.rust, textTransform: "uppercase", letterSpacing: 0.5 }}>Estimated profit / loss</div>
            <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 3 }}>Cash collected so far, minus cash lent out and running costs. Improves as outstanding loans are repaid.</div>
          </div>
          <div style={{ ...numFont, fontSize: 32, fontWeight: 700, color: netPosition >= 0 ? C.forestDark : C.rust }}>
            {netPosition >= 0 ? "+" : "−"}{fmt(Math.abs(netPosition))}
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Calendar size={15} color={C.brassDark} />
            <div style={{ fontWeight: 700, fontSize: 16 }}>Loans due today</div>
          </div>
          {dueToday.length === 0 ? <div style={{ fontSize: 15.5, color: C.ink3 }}>Nothing due today.</div> :
            dueToday.map((l) => (
              <AlertRow key={l.id} onClick={() => goLoan(l.id)}
                title={borrowerName(borrowers, l.borrowerId)}
                sub={`${l.loanNumber} · ${fmt(l.totalPayable - paidAmountFor(l.id, payments))} remaining`} />
            ))}
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <AlertTriangle size={15} color={C.rust} />
            <div style={{ fontWeight: 700, fontSize: 16 }}>Overdue payments</div>
          </div>
          {overdue.length === 0 ? <div style={{ fontSize: 15.5, color: C.ink3 }}>No overdue loans. Well kept.</div> :
            overdue.slice(0, 6).map((l) => (
              <AlertRow key={l.id} onClick={() => goLoan(l.id)} danger
                title={borrowerName(borrowers, l.borrowerId)}
                sub={`${l.loanNumber} · ${daysBetween(l.dueDate, today)} days overdue`} />
            ))}
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <CreditCard size={15} color={C.forest} />
            <div style={{ fontWeight: 700, fontSize: 16 }}>Recent payments</div>
          </div>
          {recentPayments.length === 0 ? <div style={{ fontSize: 15.5, color: C.ink3 }}>No payments recorded yet.</div> :
            recentPayments.map((p) => (
              <AlertRow key={p.id} onClick={() => goLoan(p.loanId)}
                title={borrowerName(borrowers, p.borrowerId)}
                sub={`${fmt(p.amount)} · ${p.date}`} />
            ))}
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Wallet size={15} color={C.brassDark} />
            <div style={{ fontWeight: 700, fontSize: 16 }}>Recent loans issued</div>
          </div>
          {recentLoans.length === 0 ? <div style={{ fontSize: 15.5, color: C.ink3 }}>No loans yet.</div> :
            recentLoans.map((l) => (
              <AlertRow key={l.id} onClick={() => goLoan(l.id)}
                title={borrowerName(borrowers, l.borrowerId)}
                sub={`${l.loanNumber} · ${fmt(l.amount)}`} />
            ))}
        </Card>
      </div>
    </div>
  );
}

function AlertRow({ title, sub, onClick, danger }) {
  return (
    <div onClick={onClick} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0",
      borderBottom: `1px solid ${C.border}`, cursor: "pointer"
    }}>
      <div>
        <div style={{ fontSize: 15.5, fontWeight: 600, color: danger ? C.rust : C.ink }}>{title}</div>
        <div style={{ fontSize: 14, color: C.ink3, ...numFont }}>{sub}</div>
      </div>
      <ChevronRight size={14} color={C.ink4} />
    </div>
  );
}

/* -------------------------------- borrowers -------------------------------- */

function Borrowers({ data, goBorrower, setModal, t }) {
  const [q, setQ] = useState("");
  const list = data.borrowers.filter((b) =>
    !q || [b.fullName, b.phone, b.nationalId].join(" ").toLowerCase().includes(q.toLowerCase())
  ).sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "borrower" })}><Plus size={15} /> New Borrower</button>}>
        Borrowers
      </SectionTitle>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, phone, or national ID…"
        style={{ ...FieldStyle.input, marginBottom: 14, maxWidth: 380 }} />
      {list.length === 0 ? (
        <Card><EmptyState icon={Users} title="No borrowers yet" sub="Register your first borrower to get started." action={<button style={Btn.primary} onClick={() => setModal({ type: "borrower" })}><Plus size={15} /> New Borrower</button>} /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {list.map((b, i) => {
            const loans = data.loans.filter((l) => l.borrowerId === b.id && !l.voided);
            const outstanding = loans.reduce((s, l) => s + Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments)), 0);
            return (
              <div key={b.id} onClick={() => goBorrower(b.id)} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px",
                borderBottom: i < list.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer"
              }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.forestSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 17 }}>{b.fullName}</div>
                  <div style={{ fontSize: 14.5, color: C.ink3, display: "flex", gap: 12, marginTop: 2 }}>
                    <span><Phone size={11} style={{ verticalAlign: -1 }} /> {b.phone || t("notProvided")}</span>
                    <span>{loans.length} loan{loans.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ ...numFont, fontWeight: 600, fontSize: 16, color: outstanding > 0 ? C.rust : C.ink3 }}>{fmt(outstanding)}</div>
                  <div style={{ fontSize: 13, color: C.ink4 }}>outstanding</div>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function BorrowerDetail({ data, borrowerId, setPage, goLoan, setModal, t, update, showToast }) {
  const b = data.borrowers.find((x) => x.id === borrowerId);
  if (!b) return <EmptyState icon={Users} title="Borrower not found" />;
  const loans = data.loans.filter((l) => l.borrowerId === b.id);
  const payments = data.payments.filter((p) => p.borrowerId === b.id && !p.voided);
  const collateral = data.collateral.filter((c) => c.borrowerId === b.id);
  const outstanding = loans.filter(l=>!l.voided && !l.renewed).reduce((s, l) => s + Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments)), 0);
  const outstandingNoInterest = loans.filter(l=>!l.voided && !l.renewed).reduce((s, l) => s + Math.max(0, l.amount - principalPaidFor(l.id, data.payments)), 0);

  return (
    <div>
      <button style={Btn.ghost} onClick={() => setPage("borrowers")}><ArrowLeft size={14} /> All borrowers</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, margin: "10px 0 16px" }}>
        <div>
          <h1 style={{ ...displayFont, fontSize: 28, margin: 0, fontWeight: 600 }}>{b.fullName}</h1>
          <div style={{ color: C.ink3, fontSize: 15, marginTop: 4 }}>Registered {b.dateRegistered} · {loans.length} loan{loans.length !== 1 ? "s" : ""} on record</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={Btn.secondary} onClick={() => printHTMLAsPDF(borrowerRecordHTML(data, b))}><FileType size={13} /> Print</button>
          <button style={Btn.secondary} onClick={() => downloadBorrowerRecordCSV(data, b)}><Download size={13} /> Download CSV</button>
          <button style={Btn.secondary} onClick={() => setModal({ type: "borrower", payload: b })}><Edit2 size={13} /> Edit profile</button>
          <button style={Btn.primary} onClick={() => setModal({ type: "loan", payload: { borrowerId: b.id } })}><Plus size={13} /> New loan</button>
          <button style={Btn.danger} onClick={() => setModal({
            type: "confirmDelete", payload: {
              title: "Delete borrower permanently",
              message: `Permanently delete "${b.fullName}"? This will also delete their ${loans.length} loan${loans.length !== 1 ? "s" : ""}, ${payments.length} payment${payments.length !== 1 ? "s" : ""}, and ${collateral.length} collateral record${collateral.length !== 1 ? "s" : ""}. This cannot be undone.`,
              onConfirm: () => {
                update((d) => {
                  const loanIds = d.loans.filter((l) => l.borrowerId === b.id).map((l) => l.id);
                  d.payments = d.payments.filter((p) => !loanIds.includes(p.loanId));
                  d.collateral = d.collateral.filter((c) => !loanIds.includes(c.loanId));
                  d.loans = d.loans.filter((l) => l.borrowerId !== b.id);
                  d.borrowers = d.borrowers.filter((x) => x.id !== b.id);
                }, `Deleted borrower "${b.fullName}" and all their records`);
                showToast("Borrower and all related records deleted.");
                setPage("borrowers");
              },
            }
          })}><Ban size={13} /> Delete</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr", gap: 16 }}>
        <div>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Profile</div>
            {[
              ["Phone", b.phone], ["Alternative phone", b.altPhone], ["National ID", b.nationalId],
              ["Address", b.address], ["Occupation / Business", b.occupation],
              ["Next of kin", b.nextOfKin], ["Next of kin phone", b.nextOfKinPhone],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: 15 }}>
                <span style={{ color: C.ink3 }}>{k}</span><span style={{ fontWeight: 500, textAlign: "right" }}>{v || t("notProvided")}</span>
              </div>
            ))}
            {b.notes && <div style={{ marginTop: 10, fontSize: 15, color: C.ink2, background: C.bg, padding: 10, borderRadius: 7 }}>{b.notes}</div>}
          </Card>
          <Card style={{ background: outstanding > 0 ? C.rustSoft : C.forestSoft, border: `1px solid ${outstanding > 0 ? "#E3C3BB" : "#B9CDAE"}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13.5, color: C.ink3, fontWeight: 600 }}>Outstanding (with interest)</div>
                <div style={{ ...numFont, fontSize: 24, fontWeight: 700, color: outstanding > 0 ? C.rust : C.forestDark, marginTop: 4 }}>{fmt(outstanding)}</div>
              </div>
              <div>
                <div style={{ fontSize: 13.5, color: C.ink3, fontWeight: 600 }}>Outstanding (without interest)</div>
                <div style={{ ...numFont, fontSize: 24, fontWeight: 700, color: outstanding > 0 ? C.rust : C.forestDark, marginTop: 4 }}>{fmt(outstandingNoInterest)}</div>
              </div>
            </div>
          </Card>
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Loan history</div>
          {loans.length === 0 ? <Card><EmptyState icon={Wallet} title="No loans yet" /></Card> : (
            <Card style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
              {loans.sort((a,b)=>new Date(b.issueDate)-new Date(a.issueDate)).map((l, i) => {
                const st = loanStatus(l, data.payments);
                const canRenew = st === "Active" || st === "Overdue";
                return (
                  <div key={l.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px",
                    borderBottom: i < loans.length - 1 ? `1px solid ${C.border}` : "none"
                  }}>
                    <div onClick={() => goLoan(l.id)} style={{ cursor: "pointer", flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15.5, ...numFont }}>{l.loanNumber}</div>
                      <div style={{ fontSize: 14, color: C.ink3 }}>
                        Issued {l.issueDate}{l.issuedAt ? ` at ${formatTime(l.issuedAt)}` : ""} · Expires {l.dueDate} · {fmt(l.amount)} principal{l.renewedFromId ? " · renewal" : ""}{l.isHistorical ? " · migrated record" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {canRenew && (
                        <button style={{ ...Btn.ghost, padding: "5px 8px", fontSize: 13 }} onClick={(e) => { e.stopPropagation(); setModal({ type: "renew", payload: { loanId: l.id } }); }}>
                          <RefreshCw size={12} /> Renew
                        </button>
                      )}
                      {canRenew && (
                        <button style={{ ...Btn.ghost, padding: "5px 8px", fontSize: 13, color: C.forestDark }} onClick={(e) => {
                          e.stopPropagation();
                          const outstanding = Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments));
                          if (!window.confirm(`Mark ${l.loanNumber} as fully paid? This records a payment of ${fmt(outstanding)} to close it out.`)) return;
                          update((d) => { markLoanPaidInData(d, l.id); }, `Marked loan ${l.loanNumber} as fully paid`);
                          showToast("Loan marked as fully paid.");
                        }}>
                          <CheckCircle2 size={12} /> Mark as Paid
                        </button>
                      )}
                      <StampBadge status={st} />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Collateral on file</div>
          {collateral.length === 0 ? <Card><EmptyState icon={Lock} title="No collateral recorded" /></Card> : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {collateral.map((c, i) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderBottom: i < collateral.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15.5 }}>{c.description}</div>
                    <div style={{ fontSize: 14, color: C.ink3 }}>{c.category} · Est. {fmt(c.estimatedValue)}</div>
                  </div>
                  <StampBadge status={c.status} />
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- loans ----------------------------------- */

function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 0 = Monday
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function loanGroupKey(dateStr, groupBy) {
  const d = new Date(dateStr + "T00:00:00");
  if (groupBy === "day") {
    return { key: dateStr, label: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) };
  }
  if (groupBy === "week") {
    const start = startOfWeek(d);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const key = start.toISOString().slice(0, 10);
    const label = `Week of ${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
    return { key, label };
  }
  if (groupBy === "year") {
    return { key: String(d.getFullYear()), label: String(d.getFullYear()) };
  }
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { key, label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
}

const GROUP_OPTIONS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

/* --------------------------------- external funding --------------------------------- */

const FUND_TYPES = ["External Loan", "Bank"];

function fundRepaidAmount(fundId, fundRepayments) {
  return fundRepayments.filter((r) => r.fundId === fundId && !r.voided).reduce((s, r) => s + Number(r.amount), 0);
}
function fundStatus(fund, fundRepayments) {
  if (fund.voided) return "Voided";
  const repaid = fundRepaidAmount(fund.id, fundRepayments);
  if (repaid >= fund.amount - 0.5) return "Fully Paid";
  return "Outstanding";
}

function Loans({ data, goLoan, setModal, update, showToast }) {
  const [filter, setFilter] = useState("All");
  const [groupBy, setGroupBy] = useState("month");
  const [selectedKey, setSelectedKey] = useState(null);
  const scrollRef = useRef(null);

  const loans = data.loans.filter((l) => {
    if (filter === "All") return true;
    return loanStatus(l, data.payments) === filter;
  }).sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));

  const groups = {};
  loans.forEach((l) => {
    const { key, label } = loanGroupKey(l.issueDate, groupBy);
    if (!groups[key]) groups[key] = { label, loans: [] };
    groups[key].loans.push(l);
  });
  const groupKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const activeKey = (selectedKey && groups[selectedKey]) ? selectedKey : groupKeys[0];
  const activeGroup = activeKey ? groups[activeKey] : null;

  const scrollBy = (dir) => {
    if (scrollRef.current) scrollRef.current.scrollBy({ left: dir * 240, behavior: "smooth" });
  };

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "loan" })}><Plus size={15} /> New Loan</button>}>Loans</SectionTitle>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {["All", "Active", "Overdue", "Fully Paid", "Renewed", "Voided"].map((f) => (
          <div key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 13px", borderRadius: 20, fontSize: 15, fontWeight: 600, cursor: "pointer",
            background: filter === f ? C.forest : C.surface, color: filter === f ? "#fff" : C.ink2,
            border: `1px solid ${filter === f ? C.forest : C.border}`
          }}>{f}</div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, color: C.ink3, fontWeight: 600 }}>Group by</span>
        {GROUP_OPTIONS.map((g) => (
          <div key={g.id} onClick={() => { setGroupBy(g.id); setSelectedKey(null); }} style={{
            padding: "5px 12px", borderRadius: 20, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
            background: groupBy === g.id ? C.brassDark : C.surface, color: groupBy === g.id ? "#fff" : C.ink2,
            border: `1px solid ${groupBy === g.id ? C.brassDark : C.border}`
          }}>{g.label}</div>
        ))}
      </div>

      {loans.length === 0 ? <Card><EmptyState icon={Wallet} title="No loans found" /></Card> : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div onClick={() => scrollBy(-1)} style={{
              width: 32, height: 32, borderRadius: "50%", border: `1px solid ${C.border}`, background: C.surface,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
            }}><ChevronRight size={16} color={C.ink3} style={{ transform: "rotate(180deg)" }} /></div>

            <div ref={scrollRef} className="lm-carousel" style={{
              display: "flex", gap: 10, overflowX: "auto", scrollSnapType: "x proximity",
              padding: "4px 2px 10px"
            }}>
              {groupKeys.map((key) => {
                const group = groups[key];
                const isActive = key === activeKey;
                const totalPrincipal = group.loans.reduce((s, l) => s + Number(l.amount), 0);
                const totalOutstanding = group.loans.reduce((s, l) => s + Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments)), 0);
                return (
                  <div key={key} onClick={() => setSelectedKey(key)} style={{
                    flex: "0 0 auto", scrollSnapAlign: "start", width: 190, borderRadius: 12, padding: 14, cursor: "pointer",
                    background: isActive ? C.forest : C.surface, border: `1px solid ${isActive ? C.forest : C.border}`,
                    boxShadow: isActive ? "0 6px 18px rgba(46,74,50,0.25)" : "none", transition: "background .15s, box-shadow .15s"
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: isActive ? "#fff" : C.ink, ...displayFont, lineHeight: 1.25, minHeight: 36 }}>{group.label}</div>
                    <div style={{ fontSize: 12.5, color: isActive ? "#D8E3D2" : C.ink3, marginTop: 6 }}>{group.loans.length} loan{group.loans.length !== 1 ? "s" : ""}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${isActive ? "rgba(255,255,255,0.2)" : C.border}` }}>
                      <div>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Lent</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : C.ink }}>{fmt(totalPrincipal)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Owed</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : (totalOutstanding > 0 ? C.rust : C.ink) }}>{fmt(totalOutstanding)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div onClick={() => scrollBy(1)} style={{
              width: 32, height: 32, borderRadius: "50%", border: `1px solid ${C.border}`, background: C.surface,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
            }}><ChevronRight size={16} color={C.ink3} /></div>
          </div>

          {activeGroup && (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, background: C.forestSoft, fontWeight: 700, fontSize: 14.5, color: C.forestDark }}>
                {activeGroup.label}
              </div>
              {activeGroup.loans.map((l, i) => {
                const st = loanStatus(l, data.payments);
                const outstanding = Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments));
                const canMarkPaid = st === "Active" || st === "Overdue";
                return (
                  <div key={l.id} onClick={() => goLoan(l.id)} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px",
                    borderBottom: i < activeGroup.loans.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer"
                  }}
                    onMouseEnter={(e) => e.currentTarget.style.background = C.forestSoft}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 16, ...numFont }}>{l.loanNumber}</div>
                      <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 2 }}>{borrowerName(data.borrowers, l.borrowerId)} · issued {l.issueDate} · due {l.dueDate}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ ...numFont, fontWeight: 600, fontSize: 16 }}>{fmt(outstanding)}</div>
                        <div style={{ fontSize: 13, color: C.ink4 }}>remaining</div>
                      </div>
                      {canMarkPaid && (
                        <button style={{ ...Btn.ghost, padding: "5px 8px", fontSize: 13, color: C.forestDark }} onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm(`Mark ${l.loanNumber} as fully paid? This records a payment of ${fmt(outstanding)} to close it out.`)) return;
                          update((d) => { markLoanPaidInData(d, l.id); }, `Marked loan ${l.loanNumber} as fully paid`);
                          showToast("Loan marked as fully paid.");
                        }}>
                          <CheckCircle2 size={12} /> Mark as Paid
                        </button>
                      )}
                      <StampBadge status={st} />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function LoanDetail({ data, loanId, setPage, update, showToast, setModal, goBorrower, goLoan, t }) {
  const l = data.loans.find((x) => x.id === loanId);
  if (!l) return <EmptyState icon={Wallet} title="Loan not found" />;
  const borrower = data.borrowers.find((b) => b.id === l.borrowerId);
  const payments = data.payments.filter((p) => p.loanId === l.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const collateral = data.collateral.filter((c) => c.loanId === l.id);
  const paid = paidAmountFor(l.id, data.payments);
  const outstanding = Math.max(0, l.totalPayable - paid);
  const outstandingNoInterest = Math.max(0, l.amount - principalPaidFor(l.id, data.payments));
  const st = loanStatus(l, data.payments);
  const nextDue = st !== "Fully Paid" ? nextDueDate(l, data.payments) : null;

  const voidLoan = () => {
    const reason = prompt("Reason for voiding this loan (required):");
    if (!reason) return;
    update((d) => {
      const loan = d.loans.find((x) => x.id === l.id);
      loan.voided = true; loan.voidReason = reason; loan.voidedAt = todayISO();
    }, `Voided loan ${l.loanNumber} (reason: ${reason})`);
    showToast("Loan voided and kept in history.");
  };

  const markPaid = () => {
    if (!window.confirm(`Mark ${l.loanNumber} as fully paid? This records a payment of ${fmt(outstanding)} to close it out.`)) return;
    update((d) => { markLoanPaidInData(d, l.id); }, `Marked loan ${l.loanNumber} as fully paid`);
    showToast("Loan marked as fully paid.");
  };

  return (
    <div>
      <button style={Btn.ghost} onClick={() => setPage("loans")}><ArrowLeft size={14} /> All loans</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, margin: "10px 0 16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ ...displayFont, fontSize: 26, margin: 0, fontWeight: 600, ...numFont }}>{l.loanNumber}</h1>
            <StampBadge status={st} />
            {l.isHistorical && (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.brassDark, background: C.brassSoft, border: "1px solid #DFC488", borderRadius: 20, padding: "3px 10px" }}>Migrated record</span>
            )}
          </div>
          <div onClick={() => goBorrower(borrower.id)} style={{ color: C.forest, fontSize: 15.5, marginTop: 5, cursor: "pointer", fontWeight: 600 }}>{borrower?.fullName} →</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <button style={Btn.secondary} onClick={() => printHTMLAsPDF(loanRecordHTML(data, l))}><FileType size={13} /> Print</button>
          <button style={Btn.secondary} onClick={() => downloadLoanRecordCSV(data, l)}><Download size={13} /> Download CSV</button>
          <button style={Btn.secondary} onClick={() => setModal({ type: "editLoan", payload: { loanId: l.id } })}><Edit2 size={13} /> Edit loan</button>
          {!l.voided && !l.renewed && (
            <>
              <button style={Btn.secondary} onClick={() => setModal({ type: "collateral", payload: { loanId: l.id, borrowerId: l.borrowerId } })}><Lock size={13} /> Add collateral</button>
              {st !== "Fully Paid" && (
                <button style={Btn.secondary} onClick={() => setModal({ type: "renew", payload: { loanId: l.id } })}><RefreshCw size={13} /> Renew loan</button>
              )}
              <button style={Btn.primary} onClick={() => setModal({ type: "payment", payload: { loanId: l.id, borrowerId: l.borrowerId } })}><Plus size={13} /> Record payment</button>
              {st !== "Fully Paid" && (
                <button style={{ ...Btn.secondary, background: C.forestSoft, color: C.forestDark, borderColor: "#B9CDAE" }} onClick={markPaid}><CheckCircle2 size={13} /> Mark as Paid</button>
              )}
              <button style={Btn.danger} onClick={voidLoan}><Ban size={13} /> Void</button>
            </>
          )}
          <button style={Btn.danger} onClick={() => setModal({
            type: "confirmDelete", payload: {
              title: "Delete loan permanently",
              message: `Permanently delete loan ${l.loanNumber} for ${borrower?.fullName}? This will also permanently delete its ${payments.length} payment${payments.length !== 1 ? "s" : ""} and ${collateral.length} collateral record${collateral.length !== 1 ? "s" : ""}. This cannot be undone and is different from Void, which keeps history. Consider Void instead unless this loan was created by mistake.`,
              onConfirm: () => {
                update((d) => {
                  d.payments = d.payments.filter((p) => p.loanId !== l.id);
                  d.collateral = d.collateral.filter((c) => c.loanId !== l.id);
                  d.loans = d.loans.filter((x) => x.id !== l.id);
                }, `Permanently deleted loan ${l.loanNumber}`);
                showToast("Loan permanently deleted.");
                setPage("loans");
              }
            }
          })}><Ban size={13} /> Delete permanently</button>
        </div>
      </div>

      {l.voided && (
        <Card style={{ background: "#EDEAE0", marginBottom: 14 }}>
          <div style={{ fontSize: 15, color: C.ink2 }}><b>{t("voided")}</b> {t("on")} {l.voidedAt}. {t("reason")}: {l.voidReason}</div>
        </Card>
      )}

      {l.renewed && (
        <Card style={{ background: "#E7E1F2", border: "1px solid #D2C6E8", marginBottom: 14 }}>
          <div style={{ fontSize: 15, color: "#4A3B72" }}>
            This loan was renewed on {l.renewedAt}. Its balance was carried into a new loan.
            <span style={{ color: "#5A4A8C", cursor: "pointer", fontWeight: 700, marginLeft: 6 }} onClick={() => goLoan(l.renewedIntoId)}>View the new loan →</span>
          </div>
        </Card>
      )}

      {l.renewedFromId && (
        <Card style={{ background: C.forestSoft, border: "1px solid #B9CDAE", marginBottom: 14 }}>
          <div style={{ fontSize: 15, color: C.forestDark }}>
            This loan is a renewal.
            <span style={{ color: C.forest, cursor: "pointer", fontWeight: 700, marginLeft: 6 }} onClick={() => goLoan(l.renewedFromId)}>View the original loan →</span>
          </div>
        </Card>
      )}

      {st === "Fully Paid" && (
        <Card style={{ background: C.forestSoft, border: "1px solid #B9CDAE", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, color: C.forestDark, fontWeight: 700 }}>
            <CheckCircle2 size={18} color={C.forestDark} /> This loan has been paid in full.
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 16 }}>
        {[
          ["Principal", fmt(l.amount)], ["Total payable (with interest)", fmt(l.totalPayable)],
          ["Paid so far", fmt(paid)], ["Outstanding (with interest)", fmt(outstanding)],
          ["Outstanding (without interest)", fmt(outstandingNoInterest)],
        ].map(([k, v]) => (
          <Card key={k}>
            <div style={{ fontSize: 14, color: C.ink3, fontWeight: 600 }}>{k}</div>
            <div style={{ ...numFont, fontSize: 21, fontWeight: 700, marginTop: 5 }}>{v}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Loan details</div>
          {[
            ["Interest margin", l.interestType === "Percent" ? `${l.interestValue}%` : fmt(l.interestValue)],
            ["Paperwork cost", l.paperworkFee > 0 ? fmt(l.paperworkFee) : "Not charged"],
            ["Issue date", l.issueDate + (l.issuedAt ? ` at ${formatTime(l.issuedAt)}` : "")], ["Due date", l.dueDate],
            ["Repayment method", l.repaymentMethod],
            ...(l.repaymentMethod === "Instalments" ? [
              ["Instalments", `${l.instalments.count} × ${fmt(l.instalments.expectedAmount)}`],
              ["Frequency", l.instalments.frequency],
              ["First payment", l.instalments.firstPaymentDate],
              ...(nextDue ? [["Next payment due", nextDue]] : []),
            ] : []),
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: 15 }}>
              <span style={{ color: C.ink3 }}>{k}</span><span style={{ fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </Card>

        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Security / collateral</div>
          {collateral.length === 0 ? <div style={{ fontSize: 15.5, color: C.ink3 }}>No collateral recorded for this loan.</div> :
            collateral.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 600 }}>{c.description}</div>
                  <div style={{ fontSize: 14, color: C.ink3 }}>{c.category} · est. {fmt(c.estimatedValue)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StampBadge status={c.status} />
                  {c.status !== "Released" && (
                    <button style={{ ...Btn.ghost, padding: "4px 6px", fontSize: 13.5 }} onClick={() => {
                      if (!window.confirm(`Mark "${c.description}" as collected by the borrower?`)) return;
                      update((d) => { d.collateral.find((x) => x.id === c.id).status = "Released"; }, `Marked collateral "${c.description}" as collected (loan ${l.loanNumber})`);
                      showToast("Collateral marked as paid / collected.");
                    }}><PackageCheck size={13} /> Mark as Paid</button>
                  )}
                  <button style={{ ...Btn.ghost, padding: "4px 6px", fontSize: 13.5 }} onClick={() => setModal({ type: "collateral", payload: { existing: c } })}><Edit2 size={13} /></button>
                  <button style={{ ...Btn.ghost, padding: "4px 6px", fontSize: 13.5, color: C.rust }} onClick={() => setModal({
                    type: "confirmDelete", payload: {
                      title: "Delete collateral record", message: `Permanently delete "${c.description}" from this loan? This cannot be undone.`,
                      onConfirm: () => {
                        update((d) => { d.collateral = d.collateral.filter((x) => x.id !== c.id); }, `Deleted collateral "${c.description}" (loan ${l.loanNumber})`);
                        showToast("Collateral record deleted.");
                      }
                    }
                  })}><Ban size={13} /></button>
                </div>
              </div>
            ))}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Payment history</div>
        {payments.length === 0 ? <Card><EmptyState icon={CreditCard} title="No payments recorded yet" /></Card> : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {payments.map((p, i) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderBottom: i < payments.length - 1 ? `1px solid ${C.border}` : "none", opacity: p.voided ? 0.5 : 1 }}>
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 600 }}>{p.date} · {p.method}</div>
                  <div style={{ fontSize: 14, color: C.ink3 }}>
                    {p.reference ? `Ref: ${p.reference}` : "No reference"}
                    {(p.principalPaid > 0 || p.interestPaid > 0) && ` · Principal ${fmt(p.principalPaid || 0)}, interest ${fmt(p.interestPaid || 0)}`}
                    {p.voided ? " · VOIDED" : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ ...numFont, fontWeight: 700, fontSize: 16 }}>{fmt(p.amount)}</div>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button style={{ ...Btn.ghost, padding: "4px 6px" }} onClick={() => setModal({ type: "payment", payload: { existing: p } })}><Edit2 size={13} /></button>
                    <button style={{ ...Btn.ghost, padding: "4px 6px", color: C.rust }} onClick={() => setModal({
                      type: "confirmDelete", payload: {
                        title: "Delete payment", message: `Permanently delete this payment of ${fmt(p.amount)} on ${p.date}? This will increase the loan's outstanding balance. This cannot be undone.`,
                        onConfirm: () => {
                          update((d) => { d.payments = d.payments.filter((x) => x.id !== p.id); }, `Deleted payment of ${fmt(p.amount)} on loan ${l.loanNumber}`);
                          showToast("Payment deleted.");
                        }
                      }
                    })}><Ban size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- payments --------------------------------- */

function Payments({ data, update, showToast, goLoan, setModal }) {
  const list = [...data.payments].sort((a, b) => new Date(b.date) - new Date(a.date));
  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "payment" })}><Plus size={15} /> Record Payment</button>}>Payments</SectionTitle>
      {list.length === 0 ? <Card><EmptyState icon={CreditCard} title="No payments recorded yet" /></Card> : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {list.map((p, i) => {
            const loan = data.loans.find((l) => l.id === p.loanId);
            return (
              <div key={p.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px",
                borderBottom: i < list.length - 1 ? `1px solid ${C.border}` : "none", opacity: p.voided ? 0.5 : 1
              }}>
                <div onClick={() => goLoan(p.loanId)} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{borrowerName(data.borrowers, p.borrowerId)}</div>
                  <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 2 }}>{loan?.loanNumber} · {p.date} · {p.method}{p.voided ? " · VOIDED" : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ ...numFont, fontWeight: 700, fontSize: 17 }}>{fmt(p.amount)}</div>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button style={{ ...Btn.ghost, padding: "5px 7px" }} onClick={() => setModal({ type: "payment", payload: { existing: p } })}><Edit2 size={13} /></button>
                    <button style={{ ...Btn.ghost, padding: "5px 7px", color: C.rust }} onClick={() => setModal({
                      type: "confirmDelete", payload: {
                        title: "Delete payment", message: `Permanently delete this payment of ${fmt(p.amount)}${loan ? ` on loan ${loan.loanNumber}` : ""}? This will increase the loan's outstanding balance. This cannot be undone.`,
                        onConfirm: () => {
                          update((d) => { d.payments = d.payments.filter((x) => x.id !== p.id); }, `Deleted payment of ${fmt(p.amount)}${loan ? ` on loan ${loan.loanNumber}` : ""}`);
                          showToast("Payment deleted.");
                        }
                      }
                    })}><Ban size={13} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

/* -------------------------------- collateral --------------------------------- */

function Collateral({ data, update, showToast, setModal, goLoan }) {
  const list = [...data.collateral].sort((a, b) => new Date(b.dateReceived) - new Date(a.dateReceived));

  const markCollected = (c, e) => {
    e.stopPropagation();
    if (!window.confirm(`Mark "${c.description}" as collected by the borrower?`)) return;
    update((d) => { d.collateral.find((x) => x.id === c.id).status = "Released"; }, `Marked collateral "${c.description}" as collected`);
    showToast("Collateral marked as paid / collected.");
  };

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "collateral" })}><Plus size={15} /> Add Collateral</button>}>Security / Collateral</SectionTitle>
      {list.length === 0 ? <Card><EmptyState icon={Lock} title="No collateral recorded" /></Card> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
          {list.map((c) => (
            <Card key={c.id}>
              <div onClick={() => goLoan(c.loanId)} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{c.description}</div>
                  <StampBadge status={c.status} />
                </div>
                <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 4 }}>{c.category}{c.brand ? ` · ${c.brand}` : ""}{c.model ? ` ${c.model}` : ""}</div>
                <div style={{ fontSize: 14.5, color: C.ink3 }}>Borrower: {borrowerName(data.borrowers, c.borrowerId)}</div>
                <div style={{ ...numFont, fontWeight: 600, fontSize: 17, marginTop: 8 }}>{fmt(c.estimatedValue)}</div>
                <div style={{ fontSize: 13.5, color: C.ink4, marginTop: 4 }}>{c.storageLocation ? `Stored: ${c.storageLocation}` : ""}</div>
              </div>
              {c.status !== "Released" && (
                <button style={{ ...Btn.secondary, width: "100%", justifyContent: "center", marginTop: 12 }} onClick={(e) => markCollected(c, e)}>
                  <PackageCheck size={13} /> Mark as Paid
                </button>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button style={{ ...Btn.ghost, flex: 1, justifyContent: "center", padding: "6px 8px" }} onClick={(e) => { e.stopPropagation(); setModal({ type: "collateral", payload: { existing: c } }); }}>
                  <Edit2 size={13} /> Edit
                </button>
                <button style={{ ...Btn.ghost, flex: 1, justifyContent: "center", padding: "6px 8px", color: C.rust }} onClick={(e) => {
                  e.stopPropagation();
                  setModal({
                    type: "confirmDelete", payload: {
                      title: "Delete collateral record", message: `Permanently delete "${c.description}" from this loan's collateral? This cannot be undone.`,
                      onConfirm: () => {
                        update((d) => { d.collateral = d.collateral.filter((x) => x.id !== c.id); }, `Deleted collateral "${c.description}"`);
                        showToast("Collateral record deleted.");
                      }
                    }
                  });
                }}>
                  <Ban size={13} /> Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- expenses --------------------------------- */

function Expenses({ data, update, showToast, setModal }) {
  const list = [...data.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
  const total = list.filter(e=>!e.voided).reduce((s, e) => s + Number(e.amount), 0);
  const balances = [...computeDailyCashBalances(data)].reverse();
  const [showAllDays, setShowAllDays] = useState(false);
  const visibleBalances = showAllDays ? balances : balances.slice(0, 14);

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "expense" })}><Plus size={15} /> Record Expense</button>}>Operational Costs</SectionTitle>
      <Card style={{ marginBottom: 20, maxWidth: 320 }}>
        <div style={{ fontSize: 14.5, color: C.ink3, fontWeight: 600 }}>Total operational costs</div>
        <div style={{ ...numFont, fontSize: 26, fontWeight: 700, marginTop: 4, color: C.rust }}>{fmt(total)}</div>
      </Card>

      <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 4 }}>Daily cash balance</div>
      <div style={{ fontSize: 14, color: C.ink3, marginBottom: 12 }}>
        Opening balance carries over from the day before. It moves every time a loan is given out, a borrower pays, or a cost is recorded. Set the starting figure in Settings.
      </div>
      {balances.length === 0 ? (
        <Card style={{ marginBottom: 20 }}><EmptyState icon={Wallet} title="No cash movement yet" sub="This fills in as soon as a loan is issued, a payment comes in, or a cost is recorded." /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 1fr 1.1fr", padding: "10px 18px",
            background: C.bg, fontSize: 12.5, fontWeight: 700, color: C.ink3, textTransform: "uppercase", letterSpacing: 0.3
          }}>
            <div>Date</div><div style={{ textAlign: "right" }}>Opening</div><div style={{ textAlign: "right" }}>Cash in</div>
            <div style={{ textAlign: "right" }}>Cash out</div><div style={{ textAlign: "right" }}>Closing</div>
          </div>
          {visibleBalances.map((row, i) => (
            <div key={row.date} style={{
              display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 1fr 1.1fr", padding: "11px 18px", alignItems: "center",
              borderTop: `1px solid ${C.border}`, fontSize: 14.5
            }}>
              <div style={{ fontWeight: 600 }}>{row.date}</div>
              <div style={{ textAlign: "right", ...numFont }}>{fmt(row.opening)}</div>
              <div style={{ textAlign: "right", ...numFont, color: row.cashIn > 0 ? C.forestDark : C.ink4 }}>{row.cashIn > 0 ? `+${fmt(row.cashIn)}` : fmt(0)}</div>
              <div style={{ textAlign: "right", ...numFont, color: row.cashOut > 0 ? C.rust : C.ink4 }}>{row.cashOut > 0 ? `-${fmt(row.cashOut)}` : fmt(0)}</div>
              <div style={{ textAlign: "right", ...numFont, fontWeight: 700, color: row.closing < 0 ? C.rust : C.ink }}>{fmt(row.closing)}</div>
            </div>
          ))}
          {balances.length > 14 && (
            <div onClick={() => setShowAllDays((v) => !v)} style={{
              textAlign: "center", padding: "11px", fontSize: 14, fontWeight: 600, color: C.forest,
              cursor: "pointer", borderTop: `1px solid ${C.border}`
            }}>
              {showAllDays ? "Show fewer days" : `Show all ${balances.length} days`}
            </div>
          )}
        </Card>
      )}

      <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Expense log</div>
      {list.length === 0 ? <Card><EmptyState icon={TrendingDown} title="No expenses recorded yet" /></Card> : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {list.map((e, i) => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px", borderBottom: i < list.length - 1 ? `1px solid ${C.border}` : "none", opacity: e.voided ? 0.5 : 1 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{e.description}</div>
                <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 2 }}>{e.category} · {e.date} · {e.method}{e.voided ? " · VOIDED" : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ ...numFont, fontWeight: 700, fontSize: 17 }}>{fmt(e.amount)}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button style={{ ...Btn.ghost, padding: "5px 7px" }} onClick={() => setModal({ type: "expense", payload: e })}><Edit2 size={13} /></button>
                  <button style={{ ...Btn.ghost, padding: "5px 7px", color: C.rust }} onClick={() => setModal({
                    type: "confirmDelete", payload: {
                      title: "Delete expense", message: `Permanently delete the "${e.description}" expense of ${fmt(e.amount)}? This cannot be undone.`,
                      onConfirm: () => {
                        update((d) => { d.expenses = d.expenses.filter((x) => x.id !== e.id); }, `Deleted expense "${e.description}" (${fmt(e.amount)})`);
                        showToast("Expense deleted.");
                      }
                    }
                  })}><Ban size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* --------------------------------- external funding page --------------------------------- */

function ExternalFunding({ data, setModal, update, showToast }) {
  const [groupBy, setGroupBy] = useState("month");
  const [selectedKey, setSelectedKey] = useState(null);
  const scrollRef = useRef(null);

  const funds = data.externalFunds.filter((f) => !f.voided);
  const repayments = data.fundRepayments.filter((r) => !r.voided);

  const events = [];
  funds.forEach((f) => events.push({ date: f.dateReceived, kind: "received", type: f.type, amount: f.amount, fund: f }));
  repayments.forEach((r) => {
    const fund = data.externalFunds.find((f) => f.id === r.fundId);
    if (!fund) return;
    events.push({ date: r.date, kind: "paid", type: fund.type, amount: r.amount, fund, repayment: r });
  });

  const groups = {};
  events.forEach((ev) => {
    const { key, label } = loanGroupKey(ev.date, groupBy);
    if (!groups[key]) groups[key] = { label, events: [] };
    groups[key].events.push(ev);
  });
  const groupKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const activeKey = (selectedKey && groups[selectedKey]) ? selectedKey : groupKeys[0];
  const activeGroup = activeKey ? groups[activeKey] : null;

  const scrollBy = (dir) => { if (scrollRef.current) scrollRef.current.scrollBy({ left: dir * 240, behavior: "smooth" }); };

  const totalExternalOutstanding = funds.filter((f) => f.type === "External Loan").reduce((s, f) => s + Math.max(0, f.amount - fundRepaidAmount(f.id, data.fundRepayments)), 0);
  const totalBankOutstanding = funds.filter((f) => f.type === "Bank").reduce((s, f) => s + Math.max(0, f.amount - fundRepaidAmount(f.id, data.fundRepayments)), 0);

  return (
    <div>
      <SectionTitle action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={Btn.secondary} onClick={() => setModal({ type: "fundReceived" })}><ArrowDownCircle size={15} /> Money Received</button>
          <button style={Btn.primary} onClick={() => setModal({ type: "fundRepayment" })}><ArrowUpCircle size={15} /> Record Repayment</button>
        </div>
      }>External Funding</SectionTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 18 }}>
        <Card>
          <div style={{ fontSize: 13, color: C.ink3, fontWeight: 600 }}>External loans outstanding</div>
          <div style={{ ...numFont, fontSize: 21, fontWeight: 700, marginTop: 5, color: totalExternalOutstanding > 0 ? C.rust : C.ink }}>{fmt(totalExternalOutstanding)}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 13, color: C.ink3, fontWeight: 600 }}>Bank funds outstanding</div>
          <div style={{ ...numFont, fontSize: 21, fontWeight: 700, marginTop: 5, color: totalBankOutstanding > 0 ? C.rust : C.ink }}>{fmt(totalBankOutstanding)}</div>
        </Card>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, color: C.ink3, fontWeight: 600 }}>Group by</span>
        {GROUP_OPTIONS.map((g) => (
          <div key={g.id} onClick={() => { setGroupBy(g.id); setSelectedKey(null); }} style={{
            padding: "5px 12px", borderRadius: 20, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
            background: groupBy === g.id ? C.brassDark : C.surface, color: groupBy === g.id ? "#fff" : C.ink2,
            border: `1px solid ${groupBy === g.id ? C.brassDark : C.border}`
          }}>{g.label}</div>
        ))}
      </div>

      {events.length === 0 ? (
        <Card><EmptyState icon={Landmark} title="No external funding recorded yet" sub="Record money your business receives from external lenders or the bank, and repayments you make on it." /></Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div onClick={() => scrollBy(-1)} style={{
              width: 32, height: 32, borderRadius: "50%", border: `1px solid ${C.border}`, background: C.surface,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
            }}><ChevronRight size={16} color={C.ink3} style={{ transform: "rotate(180deg)" }} /></div>

            <div ref={scrollRef} className="lm-carousel" style={{
              display: "flex", gap: 10, overflowX: "auto", scrollSnapType: "x proximity", padding: "4px 2px 10px"
            }}>
              {groupKeys.map((key) => {
                const group = groups[key];
                const isActive = key === activeKey;
                const received = group.events.filter((e) => e.kind === "received").reduce((s, e) => s + e.amount, 0);
                const paid = group.events.filter((e) => e.kind === "paid").reduce((s, e) => s + e.amount, 0);
                return (
                  <div key={key} onClick={() => setSelectedKey(key)} style={{
                    flex: "0 0 auto", scrollSnapAlign: "start", width: 190, borderRadius: 12, padding: 14, cursor: "pointer",
                    background: isActive ? C.forest : C.surface, border: `1px solid ${isActive ? C.forest : C.border}`,
                    boxShadow: isActive ? "0 6px 18px rgba(46,74,50,0.25)" : "none", transition: "background .15s, box-shadow .15s"
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: isActive ? "#fff" : C.ink, ...displayFont, lineHeight: 1.25, minHeight: 36 }}>{group.label}</div>
                    <div style={{ fontSize: 12.5, color: isActive ? "#D8E3D2" : C.ink3, marginTop: 6 }}>{group.events.length} entr{group.events.length !== 1 ? "ies" : "y"}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${isActive ? "rgba(255,255,255,0.2)" : C.border}` }}>
                      <div>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Received</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : C.ink }}>{fmt(received)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Paid</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : C.ink }}>{fmt(paid)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div onClick={() => scrollBy(1)} style={{
              width: 32, height: 32, borderRadius: "50%", border: `1px solid ${C.border}`, background: C.surface,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
            }}><ChevronRight size={16} color={C.ink3} /></div>
          </div>

          {activeGroup && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: C.ink3, textTransform: "uppercase", letterSpacing: 0.4 }}>{activeGroup.label}</div>
              <FundGroupSection title="External loans received" icon={ArrowDownCircle} tone="forest" setModal={setModal} update={update} showToast={showToast}
                events={activeGroup.events.filter((e) => e.type === "External Loan" && e.kind === "received")} kind="received" />
              <FundGroupSection title="External loans paid" icon={ArrowUpCircle} tone="rust" setModal={setModal} update={update} showToast={showToast}
                events={activeGroup.events.filter((e) => e.type === "External Loan" && e.kind === "paid")} kind="paid" />
              <FundGroupSection title="Money from the bank" icon={ArrowDownCircle} tone="forest" setModal={setModal} update={update} showToast={showToast}
                events={activeGroup.events.filter((e) => e.type === "Bank" && e.kind === "received")} kind="received" />
              <FundGroupSection title="Money from the bank paid" icon={ArrowUpCircle} tone="rust" setModal={setModal} update={update} showToast={showToast}
                events={activeGroup.events.filter((e) => e.type === "Bank" && e.kind === "paid")} kind="paid" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FundGroupSection({ title, icon: Icon, tone, events, setModal, update, showToast }) {
  const total = events.reduce((s, e) => s + e.amount, 0);

  const editEvent = (e) => {
    if (e.kind === "received") setModal({ type: "fundReceived", payload: e.fund });
    else setModal({ type: "fundRepayment", payload: { existing: e.repayment } });
  };

  const deleteEvent = (e) => {
    if (e.kind === "received") {
      setModal({
        type: "confirmDelete", payload: {
          title: "Delete funding record", message: `Permanently delete the ${fmt(e.amount)} received from "${e.fund.source}"? Any repayments recorded against it will remain but no longer be linked to a source. This cannot be undone.`,
          onConfirm: () => {
            update((d) => { d.externalFunds = d.externalFunds.filter((f) => f.id !== e.fund.id); }, `Deleted funding record from "${e.fund.source}" (${fmt(e.amount)})`);
            showToast("Deleted.");
          },
        }
      });
    } else {
      setModal({
        type: "confirmDelete", payload: {
          title: "Delete repayment", message: `Permanently delete this repayment of ${fmt(e.amount)} to "${e.fund.source}"? This cannot be undone.`,
          onConfirm: () => {
            update((d) => { d.fundRepayments = d.fundRepayments.filter((r) => r.id !== e.repayment.id); }, `Deleted repayment of ${fmt(e.amount)} to "${e.fund.source}"`);
            showToast("Deleted.");
          },
        }
      });
    }
  };

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px",
        background: tone === "rust" ? C.rustSoft : C.forestSoft, borderBottom: `1px solid ${C.border}`
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon size={15} color={tone === "rust" ? C.rust : C.forestDark} />
          <div style={{ fontWeight: 700, fontSize: 14.5, color: tone === "rust" ? C.rust : C.forestDark }}>{title}</div>
        </div>
        <div style={{ ...numFont, fontWeight: 700, fontSize: 15, color: tone === "rust" ? C.rust : C.forestDark }}>{fmt(total)}</div>
      </div>
      {events.length === 0 ? (
        <div style={{ padding: "14px 18px", fontSize: 13.5, color: C.ink3 }}>None in this period.</div>
      ) : events.map((e, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 18px", borderBottom: i < events.length - 1 ? `1px solid ${C.border}` : "none" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{e.fund.source}</div>
            <div style={{ fontSize: 13, color: C.ink3, marginTop: 2 }}>
              {e.kind === "received" ? `Received ${e.date}` : `Repaid ${e.date} · ${e.repayment.method}`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ ...numFont, fontWeight: 700, fontSize: 15 }}>{fmt(e.amount)}</div>
            <button style={{ ...Btn.ghost, padding: "4px 6px" }} onClick={() => editEvent(e)}><Edit2 size={13} /></button>
            <button style={{ ...Btn.ghost, padding: "4px 6px", color: C.rust }} onClick={() => deleteEvent(e)}><Ban size={13} /></button>
          </div>
        </div>
      ))}
    </Card>
  );
}

/* --------------------------------- reports --------------------------------- */

/* --------------------------------- report export helpers --------------------------------- */

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Prints a standalone HTML document via a hidden iframe, so the person can
 *  choose "Save as PDF" in the print dialog without leaving the app. */
function printHTMLAsPDF(html) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 1000);
  }, 300);
}

const RECORD_STYLE = `
  body { font-family: 'Times New Roman', Times, serif; padding: 32px; color: #20291F; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 16px; margin-top: 26px; border-bottom: 2px solid #2E4A32; padding-bottom: 5px; }
  .sub { color: #6B7566; font-size: 13px; margin-bottom: 4px; }
  .status { display: inline-block; font-size: 12px; font-weight: bold; padding: 3px 10px; border-radius: 20px; background: #F3E7CC; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #E4DCC7; font-size: 13.5px; }
  th { background: #F3E7CC; }
  @media print { body { padding: 0; } }
`;

function loanRecordHTML(data, loan) {
  const borrower = data.borrowers.find((b) => b.id === loan.borrowerId);
  const payments = data.payments.filter((p) => p.loanId === loan.id).sort((a, b) => new Date(a.date) - new Date(b.date));
  const collateral = data.collateral.filter((c) => c.loanId === loan.id);
  const paid = paidAmountFor(loan.id, data.payments);
  const outstanding = Math.max(0, loan.totalPayable - paid);
  const outstandingNoInterest = Math.max(0, loan.amount - principalPaidFor(loan.id, data.payments));
  const status = loanStatus(loan, data.payments);

  return `<!doctype html><html><head><title>Loan ${escapeHtml(loan.loanNumber)}</title><style>${RECORD_STYLE}</style></head><body>
    <h1>${escapeHtml(data.settings.businessName)}</h1>
    <div class="sub">Loan record, printed ${escapeHtml(new Date().toLocaleString())}</div>
    <h2>${escapeHtml(loan.loanNumber)}<span class="status">${escapeHtml(status)}</span></h2>
    <table>
      <tr><td>Borrower</td><td>${escapeHtml(borrower?.fullName || "Unknown")}</td></tr>
      <tr><td>Phone</td><td>${escapeHtml(borrower?.phone || "")}</td></tr>
      <tr><td>National ID</td><td>${escapeHtml(borrower?.nationalId || "")}</td></tr>
      <tr><td>Principal</td><td>${escapeHtml(fmt(loan.amount))}</td></tr>
      <tr><td>Interest margin</td><td>${escapeHtml(loan.interestType === "Percent" ? `${loan.interestValue}%` : fmt(loan.interestValue))}</td></tr>
      <tr><td>Paperwork cost</td><td>${escapeHtml(loan.paperworkFee > 0 ? fmt(loan.paperworkFee) : "Not charged")}</td></tr>
      <tr><td>Total payable</td><td>${escapeHtml(fmt(loan.totalPayable))}</td></tr>
      <tr><td>Issue date</td><td>${escapeHtml(loan.issueDate)}${loan.issuedAt ? ` at ${escapeHtml(formatTime(loan.issuedAt))}` : ""}</td></tr>
      <tr><td>Due date</td><td>${escapeHtml(loan.dueDate)}</td></tr>
      <tr><td>Repayment method</td><td>${escapeHtml(loan.repaymentMethod)}</td></tr>
      <tr><td>Outstanding (with interest)</td><td>${escapeHtml(fmt(outstanding))}</td></tr>
      <tr><td>Outstanding (without interest)</td><td>${escapeHtml(fmt(outstandingNoInterest))}</td></tr>
    </table>
    <h2>Security / collateral</h2>
    <table><tr><th>Description</th><th>Category</th><th>Value</th><th>Status</th></tr>
      ${collateral.length === 0 ? `<tr><td colspan="4">None recorded</td></tr>` :
        collateral.map((c) => `<tr><td>${escapeHtml(c.description)}</td><td>${escapeHtml(c.category)}</td><td>${escapeHtml(fmt(c.estimatedValue))}</td><td>${escapeHtml(c.status)}</td></tr>`).join("")}
    </table>
    <h2>Payment history</h2>
    <table><tr><th>Date</th><th>Method</th><th>Reference</th><th>Principal</th><th>Interest</th><th>Total</th></tr>
      ${payments.length === 0 ? `<tr><td colspan="6">No payments recorded</td></tr>` :
        payments.map((p) => `<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(p.reference || "")}</td><td>${escapeHtml(fmt(p.principalPaid || 0))}</td><td>${escapeHtml(fmt(p.interestPaid || 0))}</td><td>${escapeHtml(fmt(p.amount))}</td></tr>`).join("")}
    </table>
  </body></html>`;
}

function downloadLoanRecordCSV(data, loan) {
  const borrower = data.borrowers.find((b) => b.id === loan.borrowerId);
  const payments = data.payments.filter((p) => p.loanId === loan.id).sort((a, b) => new Date(a.date) - new Date(b.date));
  const collateral = data.collateral.filter((c) => c.loanId === loan.id);
  const paid = paidAmountFor(loan.id, data.payments);
  const outstanding = Math.max(0, loan.totalPayable - paid);
  const outstandingNoInterest = Math.max(0, loan.amount - principalPaidFor(loan.id, data.payments));

  const rows = [];
  rows.push([data.settings.businessName]);
  rows.push([`Loan record for ${loan.loanNumber}, printed ${new Date().toLocaleString()}`]);
  rows.push([]);
  rows.push(["Borrower", borrower?.fullName || "Unknown"]);
  rows.push(["Phone", borrower?.phone || ""]);
  rows.push(["National ID", borrower?.nationalId || ""]);
  rows.push(["Status", loanStatus(loan, data.payments)]);
  rows.push(["Principal", fmt(loan.amount)]);
  rows.push(["Interest margin", loan.interestType === "Percent" ? `${loan.interestValue}%` : fmt(loan.interestValue)]);
  rows.push(["Paperwork cost", loan.paperworkFee > 0 ? fmt(loan.paperworkFee) : "Not charged"]);
  rows.push(["Total payable", fmt(loan.totalPayable)]);
  rows.push(["Issue date", loan.issueDate]);
  rows.push(["Due date", loan.dueDate]);
  rows.push(["Outstanding (with interest)", fmt(outstanding)]);
  rows.push(["Outstanding (without interest)", fmt(outstandingNoInterest)]);
  rows.push([]);
  rows.push(["Security / collateral"]);
  rows.push(["Description", "Category", "Value", "Status"]);
  collateral.forEach((c) => rows.push([c.description, c.category, fmt(c.estimatedValue), c.status]));
  rows.push([]);
  rows.push(["Payment history"]);
  rows.push(["Date", "Method", "Reference", "Principal", "Interest", "Total"]);
  payments.forEach((p) => rows.push([p.date, p.method, p.reference || "", fmt(p.principalPaid || 0), fmt(p.interestPaid || 0), fmt(p.amount)]));

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadBlob(csv, "text/csv;charset=utf-8;", `loan-${loan.loanNumber}.csv`);
}

function borrowerRecordHTML(data, borrower) {
  const loans = data.loans.filter((l) => l.borrowerId === borrower.id).sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
  const collateral = data.collateral.filter((c) => c.borrowerId === borrower.id);
  const payments = data.payments.filter((p) => p.borrowerId === borrower.id && !p.voided).sort((a, b) => new Date(a.date) - new Date(b.date));
  const outstanding = loans.filter((l) => !l.voided && !l.renewed).reduce((s, l) => s + Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments)), 0);
  const outstandingNoInterest = loans.filter((l) => !l.voided && !l.renewed).reduce((s, l) => s + Math.max(0, l.amount - principalPaidFor(l.id, data.payments)), 0);

  return `<!doctype html><html><head><title>${escapeHtml(borrower.fullName)} history</title><style>${RECORD_STYLE}</style></head><body>
    <h1>${escapeHtml(data.settings.businessName)}</h1>
    <div class="sub">Borrower history, printed ${escapeHtml(new Date().toLocaleString())}</div>
    <h2>${escapeHtml(borrower.fullName)}</h2>
    <table>
      <tr><td>Phone</td><td>${escapeHtml(borrower.phone || "")}</td></tr>
      <tr><td>Alternative phone</td><td>${escapeHtml(borrower.altPhone || "")}</td></tr>
      <tr><td>National ID</td><td>${escapeHtml(borrower.nationalId || "")}</td></tr>
      <tr><td>Address</td><td>${escapeHtml(borrower.address || "")}</td></tr>
      <tr><td>Occupation / Business</td><td>${escapeHtml(borrower.occupation || "")}</td></tr>
      <tr><td>Next of kin</td><td>${escapeHtml(borrower.nextOfKin || "")}</td></tr>
      <tr><td>Next of kin phone</td><td>${escapeHtml(borrower.nextOfKinPhone || "")}</td></tr>
      <tr><td>Date registered</td><td>${escapeHtml(borrower.dateRegistered || "")}</td></tr>
      <tr><td>Outstanding (with interest)</td><td>${escapeHtml(fmt(outstanding))}</td></tr>
      <tr><td>Outstanding (without interest)</td><td>${escapeHtml(fmt(outstandingNoInterest))}</td></tr>
    </table>
    <h2>Loan history</h2>
    <table><tr><th>Loan</th><th>Issued</th><th>Due</th><th>Principal</th><th>Total payable</th><th>Status</th></tr>
      ${loans.length === 0 ? `<tr><td colspan="6">No loans on file</td></tr>` :
        loans.map((l) => `<tr><td>${escapeHtml(l.loanNumber)}</td><td>${escapeHtml(l.issueDate)}</td><td>${escapeHtml(l.dueDate)}</td><td>${escapeHtml(fmt(l.amount))}</td><td>${escapeHtml(fmt(l.totalPayable))}</td><td>${escapeHtml(loanStatus(l, data.payments))}</td></tr>`).join("")}
    </table>
    <h2>Security / collateral</h2>
    <table><tr><th>Description</th><th>Category</th><th>Value</th><th>Status</th></tr>
      ${collateral.length === 0 ? `<tr><td colspan="4">None recorded</td></tr>` :
        collateral.map((c) => `<tr><td>${escapeHtml(c.description)}</td><td>${escapeHtml(c.category)}</td><td>${escapeHtml(fmt(c.estimatedValue))}</td><td>${escapeHtml(c.status)}</td></tr>`).join("")}
    </table>
    <h2>Payment history</h2>
    <table><tr><th>Date</th><th>Loan</th><th>Method</th><th>Total</th></tr>
      ${payments.length === 0 ? `<tr><td colspan="4">No payments recorded</td></tr>` :
        payments.map((p) => { const l = data.loans.find((x) => x.id === p.loanId); return `<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(l?.loanNumber || "")}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(fmt(p.amount))}</td></tr>`; }).join("")}
    </table>
  </body></html>`;
}

function downloadBorrowerRecordCSV(data, borrower) {
  const loans = data.loans.filter((l) => l.borrowerId === borrower.id).sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
  const collateral = data.collateral.filter((c) => c.borrowerId === borrower.id);
  const payments = data.payments.filter((p) => p.borrowerId === borrower.id && !p.voided).sort((a, b) => new Date(a.date) - new Date(b.date));
  const outstanding = loans.filter((l) => !l.voided && !l.renewed).reduce((s, l) => s + Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments)), 0);
  const outstandingNoInterest = loans.filter((l) => !l.voided && !l.renewed).reduce((s, l) => s + Math.max(0, l.amount - principalPaidFor(l.id, data.payments)), 0);

  const rows = [];
  rows.push([data.settings.businessName]);
  rows.push([`Borrower history for ${borrower.fullName}, printed ${new Date().toLocaleString()}`]);
  rows.push([]);
  rows.push(["Phone", borrower.phone || ""]);
  rows.push(["Alternative phone", borrower.altPhone || ""]);
  rows.push(["National ID", borrower.nationalId || ""]);
  rows.push(["Address", borrower.address || ""]);
  rows.push(["Occupation / Business", borrower.occupation || ""]);
  rows.push(["Next of kin", borrower.nextOfKin || ""]);
  rows.push(["Next of kin phone", borrower.nextOfKinPhone || ""]);
  rows.push(["Date registered", borrower.dateRegistered || ""]);
  rows.push(["Outstanding (with interest)", fmt(outstanding)]);
  rows.push(["Outstanding (without interest)", fmt(outstandingNoInterest)]);
  rows.push([]);
  rows.push(["Loan history"]);
  rows.push(["Loan", "Issued", "Due", "Principal", "Total payable", "Status"]);
  loans.forEach((l) => rows.push([l.loanNumber, l.issueDate, l.dueDate, fmt(l.amount), fmt(l.totalPayable), loanStatus(l, data.payments)]));
  rows.push([]);
  rows.push(["Security / collateral"]);
  rows.push(["Description", "Category", "Value", "Status"]);
  collateral.forEach((c) => rows.push([c.description, c.category, fmt(c.estimatedValue), c.status]));
  rows.push([]);
  rows.push(["Payment history"]);
  rows.push(["Date", "Loan", "Method", "Total"]);
  payments.forEach((p) => { const l = data.loans.find((x) => x.id === p.loanId); rows.push([p.date, l?.loanNumber || "", p.method, fmt(p.amount)]); });

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadBlob(csv, "text/csv;charset=utf-8;", `borrower-${borrower.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`);
}

function Reports({ data }) {
  const { borrowers, loans, payments, expenses } = data;
  const totals = loanTotals(loans, payments);
  const totalCosts = expenses.filter(e=>!e.voided).reduce((s, e) => s + Number(e.amount), 0);
  const netPosition = (totals.totalCollected - totals.totalLent) - totalCosts;
  const fullyPaid = loans.filter((l) => !l.voided && loanStatus(l, payments) === "Fully Paid").length;
  const byCategory = {};
  expenses.filter(e=>!e.voided).forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount); });
  const categoryRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  const summaryCards = [
    ["Borrowers on file", borrowers.length],
    ["Loans issued", loans.filter(l=>!l.voided).length],
    ["Loans fully paid", fullyPaid],
    ["Overdue loans", totals.overdueCount],
    ["Total lent", fmt(totals.totalLent)],
    ["Total collected", fmt(totals.totalCollected)],
    ["Outstanding balance", fmt(totals.outstanding)],
    ["Operational costs", fmt(totalCosts)],
  ];
  const summaryExportRows = [...summaryCards, ["Net position", (netPosition >= 0 ? "+" : "-") + fmt(Math.abs(netPosition))]];

  const reportFileBase = `report-${data.settings.businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${todayISO()}`;

  const downloadCSV = () => {
    const rows = [];
    rows.push([data.settings.businessName]);
    rows.push([`Report generated ${new Date().toLocaleString()}`]);
    rows.push([]);
    rows.push(["Summary"]);
    rows.push(["Metric", "Value"]);
    summaryExportRows.forEach(([k, v]) => rows.push([k, v]));
    rows.push([]);
    rows.push(["Operational costs by category"]);
    rows.push(["Category", "Amount"]);
    categoryRows.forEach(([cat, amt]) => rows.push([cat, fmt(amt)]));
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadBlob(csv, "text/csv;charset=utf-8;", `${reportFileBase}.csv`);
  };

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet([["Metric", "Value"], ...summaryExportRows]);
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
    const catSheet = XLSX.utils.aoa_to_sheet([["Category", "Amount"], ...categoryRows.map(([cat, amt]) => [cat, fmt(amt)])]);
    XLSX.utils.book_append_sheet(wb, catSheet, "Costs by Category");
    XLSX.writeFile(wb, `${reportFileBase}.xlsx`);
  };

  const downloadPDF = () => {
    const html = `<!doctype html><html><head><title>${escapeHtml(data.settings.businessName)} report</title>
      <style>
        body { font-family: 'Times New Roman', Times, serif; padding: 32px; color: #20291F; }
        h1 { font-size: 22px; margin: 0 0 2px; }
        .sub { color: #6B7566; font-size: 13px; margin-bottom: 22px; }
        h2 { font-size: 16px; margin-top: 26px; border-bottom: 2px solid #2E4A32; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #E4DCC7; font-size: 13.5px; }
        th { background: #F3E7CC; }
        @media print { body { padding: 0; } }
      </style>
      </head><body>
      <h1>${escapeHtml(data.settings.businessName)}</h1>
      <div class="sub">Report generated ${escapeHtml(new Date().toLocaleString())}</div>
      <h2>Summary</h2>
      <table><tr><th>Metric</th><th>Value</th></tr>
        ${summaryExportRows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}
      </table>
      <h2>Operational costs by category</h2>
      <table><tr><th>Category</th><th>Amount</th></tr>
        ${categoryRows.length === 0 ? `<tr><td colspan="2">No expense data yet</td></tr>` :
          categoryRows.map(([cat, amt]) => `<tr><td>${escapeHtml(cat)}</td><td>${escapeHtml(fmt(amt))}</td></tr>`).join("")}
      </table>
      </body></html>`;
    printHTMLAsPDF(html);
  };

  return (
    <div>
      <SectionTitle action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={Btn.secondary} onClick={downloadCSV}><Download size={14} /> CSV</button>
          <button style={Btn.secondary} onClick={downloadExcel}><FileSpreadsheet size={14} /> Excel</button>
          <button style={Btn.secondary} onClick={downloadPDF}><FileType size={14} /> PDF</button>
        </div>
      }>Reports</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 18 }}>
        {summaryCards.map(([k, v]) => (
          <Card key={k}><div style={{ fontSize: 14, color: C.ink3, fontWeight: 600 }}>{k}</div><div style={{ ...numFont, fontSize: 21, fontWeight: 700, marginTop: 5 }}>{v}</div></Card>
        ))}
      </div>

      <Card style={{ marginBottom: 16, background: netPosition >= 0 ? C.forestSoft : C.rustSoft }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: netPosition >= 0 ? C.forestDark : C.rust, textTransform: "uppercase" }}>Net position (income from loans − operational costs)</div>
        <div style={{ ...numFont, fontSize: 30, fontWeight: 700, marginTop: 6, color: netPosition >= 0 ? C.forestDark : C.rust }}>
          {netPosition >= 0 ? "+" : "−"}{fmt(Math.abs(netPosition))}
        </div>
      </Card>

      <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Operational costs by category</div>
      {categoryRows.length === 0 ? <Card><EmptyState icon={BarChart3} title="No expense data yet" /></Card> : (
        <Card>
          {categoryRows.map(([cat, amt]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 4 }}>
                <span>{cat}</span><span style={{ ...numFont, fontWeight: 600 }}>{fmt(amt)}</span>
              </div>
              <div style={{ height: 6, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (amt / totalCosts) * 100)}%`, background: C.brass }} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* --------------------------------- settings --------------------------------- */

function SettingsPage({ data, update, showToast, t }) {
  const [name, setName] = useState(data.settings.businessName);
  const [startingBalance, setStartingBalance] = useState(String(data.settings.startingCashBalance ?? 0));
  const fileInputRef = useRef(null);

  const exportData = () => {
    const payload = JSON.stringify(data, null, 2);
    const base = data.settings.businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    downloadBlob(payload, "application/json", `ledger-backup-${base}-${todayISO()}.json`);
    showToast("Backup downloaded.");
  };

  const triggerImport = () => fileInputRef.current?.click();

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.borrowers) || !Array.isArray(parsed.loans) || !Array.isArray(parsed.users)) {
          showToast("That file doesn't look like a Ledger backup.");
          return;
        }
        if (!window.confirm("This will REPLACE all current data in Ledger with the contents of this backup file. This cannot be undone. Continue?")) return;
        update((d) => { Object.assign(d, parsed); }, `Restored data from backup file "${file.name}"`);
        showToast("Backup restored. Reloading…");
        setTimeout(() => window.location.reload(), 800);
      } catch (err) {
        showToast("Couldn't read that file, make sure it's a valid Ledger backup (.json).");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div>
      <SectionTitle>Settings</SectionTitle>
      <Card style={{ maxWidth: 460, marginBottom: 14 }}>
        <Field label="Business name">
          <input style={FieldStyle.input} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Starting cash balance" hint="The cash on hand before you started using this system. Daily opening balances build from this figure.">
          <input type="number" style={FieldStyle.input} value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
        </Field>
        <button style={{ ...Btn.primary, marginTop: 10 }} onClick={() => {
          update((d) => { d.settings.businessName = name; d.settings.startingCashBalance = Number(startingBalance) || 0; }, "Updated business settings");
          showToast("Settings saved.");
        }}>Save changes</button>
      </Card>

      <Card style={{ maxWidth: 460, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Backup &amp; restore</div>
        <div style={{ fontSize: 14, color: C.ink3, lineHeight: 1.55, marginBottom: 12 }}>
          Download a complete, portable copy of everything in Ledger, borrowers, loans, payments, users, settings, all of it, as one file you control. This is also the right way to move Ledger to a new computer: the data file on disk is encrypted to this Windows account, so copying it directly won't open elsewhere, but a backup file downloaded here will restore anywhere.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={Btn.secondary} onClick={exportData}><Download size={14} /> Download full backup</button>
          <button style={Btn.secondary} onClick={triggerImport}><RefreshCw size={14} /> Restore from backup file</button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleImportFile} />
        <div style={{ fontSize: 13, color: C.rust, marginTop: 10 }}>
          Restoring replaces everything currently in Ledger with the contents of the file you choose. It can't be undone, so only use it to recover from a real backup.
        </div>
      </Card>

      <Card style={{ maxWidth: 460, fontSize: 15, color: C.ink3, lineHeight: 1.6 }}>
        {t("settingsHint")}
      </Card>
    </div>
  );
}

/* ---------------------------------- users & login ----------------------------------- */

function LoginScreen({ data, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (checking) return;
    const u = data.users.find((x) => x.username.toLowerCase() === username.trim().toLowerCase());
    if (!u) { setError("Incorrect username or password."); return; }
    setChecking(true);
    const ok = await verifyPassword(password, u.passwordSalt, u.passwordHash);
    setChecking(false);
    if (!ok) { setError("Incorrect username or password."); return; }
    if (!u.active) { setError("This account has been deactivated. Contact your administrator."); return; }
    setError("");
    onLogin(u);
  };

  const onKeyDown = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div style={{ ...S.page, minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <style>{`${FONT_IMPORT}
        * { box-sizing: border-box; }
        input { font-family: 'Times New Roman', Times, serif; font-size: 16px; }
        input:focus { outline: 2px solid ${C.brass}; outline-offset: 1px; }
      `}</style>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "34px 30px",
        width: "100%", maxWidth: 380, boxShadow: "0 12px 40px rgba(31,42,36,0.12)"
      }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ ...displayFont, fontSize: 30, fontWeight: 600, color: C.forestDark }}>Ledger</div>
          <div style={{ fontSize: 15, color: C.ink3, marginTop: 4 }}>Sign in to open the books.</div>
        </div>
        <Field label="Username">
          <input style={FieldStyle.input} value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={onKeyDown} autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" style={FieldStyle.input} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onKeyDown} />
        </Field>
        {error && <div style={{ color: C.rust, fontSize: 14.5, marginBottom: 10 }}>{error}</div>}
        <button type="button" onClick={submit} disabled={checking} style={{ ...Btn.primary, width: "100%", justifyContent: "center", padding: "11px 15px", marginTop: 6, opacity: checking ? 0.7 : 1 }}>{checking ? "Checking…" : "Sign in"}</button>
      </div>
    </div>
  );
}

function UsersPage({ data, update, showToast, currentUser, setModal }) {
  const users = [...data.users].sort((a, b) => a.username.localeCompare(b.username));

  const toggleActive = (u) => {
    if (u.username === "admin") return showToast("The default administrator account can't be deactivated.");
    update((d) => { d.users.find((x) => x.id === u.id).active = !u.active; }, `${u.active ? "Deactivated" : "Reactivated"} user account "${u.username}"`);
    showToast(u.active ? "User deactivated." : "User reactivated.");
  };

  const deleteUser = (u) => {
    if (u.username === "admin") return showToast("The default administrator account can't be deleted.");
    setModal({
      type: "confirmDelete", payload: {
        title: "Delete user permanently",
        message: `Permanently delete the account "${u.username}" (${u.fullName})? This removes their login entirely. Consider Deactivate instead if you just want to revoke access while keeping the record. This cannot be undone.`,
        onConfirm: () => {
          update((d) => { d.users = d.users.filter((x) => x.id !== u.id); }, `Deleted user account "${u.username}"`);
          showToast("User deleted.");
        },
      }
    });
  };

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "user" })}><Plus size={15} /> Add User</button>}>Users</SectionTitle>
      <div style={{ fontSize: 14.5, color: C.ink3, marginBottom: 14, maxWidth: 620 }}>
        Add a login for each member of staff and choose what they're allowed to see and do. Deactivating revokes access while keeping the record and audit trail intact, use Delete only when you want the account gone entirely.
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {users.map((u, i) => (
          <div key={u.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px",
            borderBottom: i < users.length - 1 ? `1px solid ${C.border}` : "none", opacity: u.active ? 1 : 0.5
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%", background: C.forestSoft, color: C.forestDark,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700
              }}>{u.fullName.slice(0, 1).toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{u.fullName} {u.username === "admin" && <span style={{ fontSize: 12, color: C.ink4 }}>(default admin)</span>}</div>
                <div style={{ fontSize: 14, color: C.ink3 }}>@{u.username} · {u.role}{!u.active ? " · Inactive" : ""}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button style={Btn.ghost} onClick={() => setModal({ type: "user", payload: u })}><Edit2 size={13} /> Edit</button>
              {u.id !== currentUser.id && (
                <button style={u.active ? Btn.danger : Btn.secondary} onClick={() => toggleActive(u)}>
                  {u.active ? <><Ban size={13} /> Deactivate</> : <><CheckCircle2 size={13} /> Reactivate</>}
                </button>
              )}
              {u.id !== currentUser.id && u.username !== "admin" && (
                <button style={{ ...Btn.ghost, color: C.rust }} onClick={() => deleteUser(u)}><Ban size={13} /> Delete</button>
              )}
            </div>
          </div>
        ))}
      </Card>

      <div style={{ marginTop: 20, fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Privilege levels</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        {ROLE_NAMES.map((r) => (
          <Card key={r}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{r}</div>
            <div style={{ fontSize: 13.5, color: C.ink3, marginTop: 4 }}>{ROLES[r].description}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AuditLogPage({ data }) {
  const [q, setQ] = useState("");
  const [userFilter, setUserFilter] = useState("All");

  const log = [...(data.auditLog || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const usernames = ["All", ...Array.from(new Set(log.map((e) => e.username))).sort()];

  const filtered = log.filter((e) => {
    if (userFilter !== "All" && e.username !== userFilter) return false;
    if (q && !e.action.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  let lastDay = null;

  return (
    <div>
      <SectionTitle>Audit Log</SectionTitle>
      <div style={{ fontSize: 14.5, color: C.ink3, marginBottom: 14, maxWidth: 620 }}>
        A running, unchangeable record of who did what and when: loans issued, payments recorded, voids, renewals, user changes, sign-ins, and more.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions…" style={{ ...FieldStyle.input, maxWidth: 320 }} />
        <select style={{ ...FieldStyle.input, maxWidth: 220 }} value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          {usernames.map((u) => <option key={u} value={u}>{u === "All" ? "All users" : u}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card><EmptyState icon={History} title="No matching activity" sub="Actions taken across the system will appear here as they happen." /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {filtered.map((e, i) => {
            const d = new Date(e.timestamp);
            const dayLabel = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
            const showDayHeader = dayLabel !== lastDay;
            lastDay = dayLabel;
            return (
              <React.Fragment key={e.id}>
                {showDayHeader && (
                  <div style={{ padding: "9px 18px", background: C.bg, fontSize: 12.5, fontWeight: 700, color: C.ink3, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {dayLabel}
                  </div>
                )}
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, padding: "12px 18px",
                  borderTop: showDayHeader ? "none" : `1px solid ${C.border}`
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{e.action}</div>
                    <div style={{ fontSize: 13, color: C.ink3, marginTop: 3, ...numFont }}>{e.username}</div>
                  </div>
                  <div style={{ fontSize: 13, color: C.ink4, ...numFont, whiteSpace: "nowrap" }}>{formatTime(e.timestamp)}</div>
                </div>
              </React.Fragment>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function UserForm({ data, update, showToast, close, existing }) {
  const [f, setF] = useState(existing
    ? { username: existing.username, password: "", fullName: existing.fullName, role: existing.role }
    : { username: "", password: "", fullName: "", role: "Loan Officer" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    if (!f.fullName.trim()) return showToast("Enter the user's full name.");
    if (!f.username.trim()) return showToast("Choose a username.");
    const clash = data.users.find((u) => u.username.toLowerCase() === f.username.trim().toLowerCase() && u.id !== existing?.id);
    if (clash) return showToast("That username is already taken.");

    if (existing) {
      let newHash = null, newSalt = null;
      if (f.password.trim()) {
        newSalt = randomSalt();
        newHash = await hashPassword(f.password.trim(), newSalt);
      }
      update((d) => {
        const u = d.users.find((x) => x.id === existing.id);
        u.username = f.username.trim();
        u.fullName = f.fullName.trim();
        u.role = f.role;
        if (newHash) { u.passwordHash = newHash; u.passwordSalt = newSalt; delete u.password; }
      }, `Edited user account "${f.username.trim()}"`);
      showToast("User updated.");
    } else {
      if (!f.password.trim()) return showToast("Set a password for the new user.");
      const salt = randomSalt();
      const hash = await hashPassword(f.password.trim(), salt);
      update((d) => {
        d.users.push({
          id: uid("usr"), username: f.username.trim(), passwordHash: hash, passwordSalt: salt,
          fullName: f.fullName.trim(), role: f.role, active: true, createdAt: todayISO()
        });
      }, `Added user account "${f.username.trim()}" (${f.role})`);
      showToast("User added.");
    }
    close();
  };

  return (
    <ModalShell title={existing ? "Edit user" : "Add a new user"} onClose={close}>
      <Field label="Full name" required><input style={FieldStyle.input} value={f.fullName} onChange={set("fullName")} /></Field>
      <Field label="Username" required><input style={FieldStyle.input} value={f.username} onChange={set("username")} /></Field>
      <Field label={existing ? "New password" : "Password"} required={!existing} hint={existing ? "Leave blank to keep the current password." : undefined}>
        <input type="password" style={FieldStyle.input} value={f.password} onChange={set("password")} />
      </Field>
      <Field label="Privilege level">
        <select style={FieldStyle.input} value={f.role} onChange={set("role")}>
          {ROLE_NAMES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div style={{ fontSize: 13.5, color: C.ink4, marginTop: 5 }}>{ROLES[f.role].description}</div>
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>{existing ? "Save changes" : "Add user"}</button>
      </div>
    </ModalShell>
  );
}

/* -------------------------------- global search ------------------------------- */

function SearchResults({ q, data, goBorrower, goLoan, clear }) {
  const query = q.toLowerCase();
  const borrowers = data.borrowers.filter((b) => [b.fullName, b.phone, b.altPhone, b.nationalId].join(" ").toLowerCase().includes(query));
  const loans = data.loans.filter((l) => [l.loanNumber, borrowerName(data.borrowers, l.borrowerId)].join(" ").toLowerCase().includes(query));
  const payments = data.payments.filter((p) => [p.reference, borrowerName(data.borrowers, p.borrowerId)].join(" ").toLowerCase().includes(query));
  const collateral = data.collateral.filter((c) => [c.description, c.category, borrowerName(data.borrowers, c.borrowerId)].join(" ").toLowerCase().includes(query));
  const nothing = borrowers.length + loans.length + payments.length + collateral.length === 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 15.5, color: C.ink3 }}>Results for "<b>{q}</b>"</div>
        <button style={Btn.ghost} onClick={clear}><X size={13} /> Clear</button>
      </div>
      {nothing && <Card><EmptyState icon={Search} title="No matches found" sub="Try a different name, phone number, or loan number." /></Card>}
      {borrowers.length > 0 && (
        <ResultGroup title="Borrowers" items={borrowers.map((b) => ({
          key: b.id, title: b.fullName, sub: b.phone, onClick: () => goBorrower(b.id)
        }))} />
      )}
      {loans.length > 0 && (
        <ResultGroup title="Loans" items={loans.map((l) => ({
          key: l.id, title: l.loanNumber, sub: `${borrowerName(data.borrowers, l.borrowerId)} · ${fmt(l.amount)}`, onClick: () => goLoan(l.id)
        }))} />
      )}
      {payments.length > 0 && (
        <ResultGroup title="Payments" items={payments.map((p) => ({
          key: p.id, title: fmt(p.amount), sub: `${borrowerName(data.borrowers, p.borrowerId)} · ${p.date}`, onClick: () => goLoan(p.loanId)
        }))} />
      )}
      {collateral.length > 0 && (
        <ResultGroup title="Collateral" items={collateral.map((c) => ({
          key: c.id, title: c.description, sub: `${borrowerName(data.borrowers, c.borrowerId)} · ${c.category}`, onClick: () => goLoan(c.loanId)
        }))} />
      )}
    </div>
  );
}

function ResultGroup({ title, items }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 8 }}>{title}</div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {items.map((it, i) => (
          <div key={it.key} onClick={it.onClick} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", cursor: "pointer", borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <div style={{ fontWeight: 600, fontSize: 15.5 }}>{it.title}</div>
            <div style={{ fontSize: 14.5, color: C.ink3 }}>{it.sub}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------------------------- modals ----------------------------------- */

const FieldStyle = {
  input: {
    width: "100%", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7,
    fontSize: 16, background: C.paper, color: C.ink,
  },
};

function Field({ label, children, required, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 14.5, fontWeight: 600, color: C.ink2, marginBottom: 5 }}>
        {label}{required && <span style={{ color: C.rust }}> *</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 13.5, color: C.ink4, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

/* --------------------------------- date picker --------------------------------- */

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function CalNavBtn({ children, onClick, wide }) {
  return (
    <div onClick={onClick} style={{
      width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.border}`, background: C.paper,
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.ink3
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = C.forestSoft}
      onMouseLeave={(e) => e.currentTarget.style.background = C.paper}>
      {children}
    </div>
  );
}

function DatePicker({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => value ? new Date(value + "T00:00:00") : new Date());
  const [temp, setTemp] = useState(value || "");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTemp(value || "");
      setViewDate(value ? new Date(value + "T00:00:00") : new Date());
    }
  }, [open]);

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = startWeekday - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true, dateStr: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, muted: false, dateStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  }
  const remainder = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remainder; d++) cells.push({ day: d, muted: true, dateStr: null });

  const todayStr = todayISO();
  const changeMonth = (delta) => setViewDate(new Date(year, month + delta, 1));
  const changeYear = (delta) => setViewDate(new Date(year + delta, month, 1));

  const displayValue = value
    ? new Date(value + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div onClick={() => setOpen((v) => !v)} style={{
        ...FieldStyle.input, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <span style={{ color: value ? C.ink : C.ink4 }}>{displayValue || placeholder || "Select date"}</span>
        <Calendar size={15} color={C.ink3} />
      </div>
      {open && (
        <div style={{
          position: "absolute", zIndex: 70, top: "calc(100% + 6px)", left: 0, background: C.surface,
          border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 16px 40px rgba(31,42,36,0.2)",
          padding: 16, width: 300
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <CalNavBtn onClick={() => changeYear(-1)}>«</CalNavBtn>
              <CalNavBtn onClick={() => changeMonth(-1)}>‹</CalNavBtn>
            </div>
            <div style={{ ...displayFont, fontSize: 16.5, fontWeight: 600 }}>{monthLabel}</div>
            <div style={{ display: "flex", gap: 4 }}>
              <CalNavBtn onClick={() => changeMonth(1)}>›</CalNavBtn>
              <CalNavBtn onClick={() => changeYear(1)}>»</CalNavBtn>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: 12.5, color: C.ink4, fontWeight: 600, padding: "4px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {cells.map((c, i) => {
              const isSelected = c.dateStr && c.dateStr === temp;
              const isToday = c.dateStr && c.dateStr === todayStr && !isSelected;
              return (
                <div key={i}
                  onClick={() => c.dateStr && setTemp(c.dateStr)}
                  style={{
                    textAlign: "center", padding: "8px 0", borderRadius: 8, fontSize: 14.5,
                    cursor: c.dateStr ? "pointer" : "default",
                    color: c.muted ? C.ink4 : (isSelected ? "#fff" : C.ink),
                    background: isSelected ? C.forest : (isToday ? C.forestSoft : "transparent"),
                    fontWeight: isSelected ? 700 : 400,
                  }}>
                  {c.day}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={{ ...Btn.secondary, flex: 1, justifyContent: "center" }} onClick={() => setOpen(false)}>Cancel</button>
            <button style={{ ...Btn.primary, flex: 1, justifyContent: "center" }} onClick={() => { onChange(temp); setOpen(false); }}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(31,42,36,0.45)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 16px", overflowY: "auto" }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: 14, width: "100%", maxWidth: wide ? 640 : 480,
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ ...displayFont, fontSize: 21, fontWeight: 600 }}>{title}</div>
          <X size={18} style={{ cursor: "pointer" }} color={C.ink3} onClick={onClose} />
        </div>
        <div style={{ padding: 20, maxHeight: "72vh", overflowY: "auto" }} className="lm-scroll">{children}</div>
      </div>
    </div>
  );
}


function NotificationsModal({ overdueLoans, soonLoans, autoRenewedToday, data, close, goLoan }) {
  const today = todayISO();
  const nothing = overdueLoans.length === 0 && soonLoans.length === 0 && autoRenewedToday.length === 0;

  const Row = ({ l, sub, tone }) => (
    <div onClick={() => { close(); goLoan(l.id); }} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0",
      borderBottom: `1px solid ${C.border}`, cursor: "pointer"
    }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, color: tone || C.ink }}>{borrowerName(data.borrowers, l.borrowerId)}</div>
        <div style={{ fontSize: 13.5, color: C.ink3, ...numFont }}>{l.loanNumber} · {sub}</div>
      </div>
      <ChevronRight size={14} color={C.ink4} />
    </div>
  );

  return (
    <ModalShell title="Loan alerts" onClose={close}>
      {nothing ? (
        <div style={{ fontSize: 15.5, color: C.ink3 }}>Nothing needs your attention right now. Well kept.</div>
      ) : (
        <>
          {overdueLoans.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <AlertTriangle size={16} color={C.rust} />
                <div style={{ fontWeight: 700, fontSize: 16 }}>{overdueLoans.length} overdue loan{overdueLoans.length !== 1 ? "s" : ""}</div>
              </div>
              {overdueLoans.slice(0, 8).map((l) => (
                <Row key={l.id} l={l} tone={C.rust} sub={`${daysBetween(l.dueDate, today)} days overdue`} />
              ))}
            </div>
          )}
          {soonLoans.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <Clock size={16} color={C.brassDark} />
                <div style={{ fontWeight: 700, fontSize: 16 }}>{soonLoans.length} loan{soonLoans.length !== 1 ? "s" : ""} ending soon</div>
              </div>
              {soonLoans.slice(0, 8).map((l) => {
                const days = daysBetween(today, l.dueDate);
                return <Row key={l.id} l={l} sub={days === 0 ? "due today" : `due in ${days} day${days !== 1 ? "s" : ""}`} />;
              })}
            </div>
          )}
          {autoRenewedToday.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <RefreshCw size={16} color={C.forest} />
                <div style={{ fontWeight: 700, fontSize: 16 }}>{autoRenewedToday.length} loan{autoRenewedToday.length !== 1 ? "s" : ""} automatically renewed today</div>
              </div>
              {autoRenewedToday.slice(0, 8).map((l) => (
                <Row key={l.id} l={l} tone={C.forest} sub="passed its due date and was rolled over" />
              ))}
            </div>
          )}
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button style={Btn.primary} onClick={close}>Got it</button>
      </div>
    </ModalShell>
  );
}

function ModalRouter({ modal, close, data, update, showToast, goBorrower, goLoan, setModal, currentUser, t }) {
  if (modal.type === "borrower") return <BorrowerForm data={data} update={update} showToast={showToast} close={close} existing={modal.payload} goBorrower={goBorrower} />;
  if (modal.type === "loan") return <LoanForm data={data} update={update} showToast={showToast} close={close} payload={modal.payload} existing={modal.payload?.existing} goLoan={goLoan} setModal={setModal} />;
  if (modal.type === "payment") return <PaymentForm data={data} update={update} showToast={showToast} close={close} payload={modal.payload} existing={modal.payload?.existing} />;
  if (modal.type === "collateral") return <CollateralForm data={data} update={update} showToast={showToast} close={close} payload={modal.payload} existing={modal.payload?.existing} t={t} />;
  if (modal.type === "expense") return <ExpenseForm update={update} showToast={showToast} close={close} existing={modal.payload} />;
  if (modal.type === "user") return <UserForm data={data} update={update} showToast={showToast} close={close} existing={modal.payload} />;
  if (modal.type === "renew") return <RenewLoanForm data={data} update={update} showToast={showToast} close={close} payload={modal.payload} goLoan={goLoan} />;
  if (modal.type === "editLoan") return <EditLoanForm data={data} update={update} showToast={showToast} close={close} payload={modal.payload} />;
  if (modal.type === "fundReceived") return <FundReceivedForm update={update} showToast={showToast} close={close} existing={modal.payload} />;
  if (modal.type === "fundRepayment") return <FundRepaymentForm data={data} update={update} showToast={showToast} close={close} payload={modal.payload} existing={modal.payload?.existing} />;
  if (modal.type === "changePassword") return <ChangePasswordForm data={data} update={update} showToast={showToast} close={close} currentUser={currentUser} />;
  if (modal.type === "confirmDelete") return <ConfirmModal payload={modal.payload} close={close} />;
  return null;
}

/** Generic "are you sure" popup used before every permanent delete across
 *  the app. payload: { title, message, confirmLabel, onConfirm } */
function ConfirmModal({ payload, close }) {
  const { title = "Delete this?", message, confirmLabel = "Delete permanently", onConfirm } = payload || {};
  return (
    <ModalShell title={title} onClose={close}>
      <div style={{ fontSize: 15.5, color: C.ink2, lineHeight: 1.6, marginBottom: 18 }}>{message}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.danger} onClick={() => { onConfirm(); close(); }}>{confirmLabel}</button>
      </div>
    </ModalShell>
  );
}

function ChangePasswordForm({ data, update, showToast, close, currentUser }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const submit = async () => {
    const user = data.users.find((u) => u.id === currentUser.id);
    const ok = user ? await verifyPassword(currentPassword, user.passwordSalt, user.passwordHash) : false;
    if (!ok) return showToast("Current password is incorrect.");
    if (!newPassword || newPassword.length < 4) return showToast("New password must be at least 4 characters.");
    if (newPassword !== confirmPassword) return showToast("New passwords don't match.");
    const salt = randomSalt();
    const hash = await hashPassword(newPassword, salt);
    update((d) => {
      const u = d.users.find((x) => x.id === currentUser.id);
      u.passwordHash = hash; u.passwordSalt = salt; delete u.password;
    }, "Changed own password");
    showToast("Password updated.");
    close();
  };

  return (
    <ModalShell title="Change password" onClose={close}>
      <Field label="Current password" required>
        <input type="password" style={FieldStyle.input} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      </Field>
      <Field label="New password" required>
        <input type="password" style={FieldStyle.input} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </Field>
      <Field label="Confirm new password" required>
        <input type="password" style={FieldStyle.input} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>Update password</button>
      </div>
    </ModalShell>
  );
}

function FundReceivedForm({ update, showToast, close, existing }) {
  const [type, setType] = useState(existing?.type || "External Loan");
  const [source, setSource] = useState(existing?.source || "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [dateReceived, setDateReceived] = useState(existing?.dateReceived || todayISO());
  const [expectedRepaymentDate, setExpectedRepaymentDate] = useState(existing?.expectedRepaymentDate || "");
  const [notes, setNotes] = useState(existing?.notes || "");

  const submit = () => {
    if (!source.trim()) return showToast(type === "Bank" ? "Enter the bank's name." : "Enter the lender's name.");
    if (!amount || Number(amount) <= 0) return showToast("Enter the amount received.");
    if (existing) {
      update((d) => {
        Object.assign(d.externalFunds.find((f) => f.id === existing.id), {
          type, source: source.trim(), amount: Number(amount), dateReceived, expectedRepaymentDate, notes,
        });
      }, `Edited funding record from ${source.trim()} (${type})`);
      showToast("Updated.");
    } else {
      update((d) => {
        d.externalFunds.push({
          id: uid("fund"), type, source: source.trim(), amount: Number(amount), dateReceived,
          expectedRepaymentDate, notes, voided: false,
        });
      }, `Recorded ${fmt(Number(amount))} received from ${source.trim()} (${type})`);
      showToast("Recorded.");
    }
    close();
  };

  return (
    <ModalShell title={existing ? "Edit funding record" : "Record money received"} onClose={close}>
      <Field label="Source">
        <div style={{ display: "flex", gap: 8 }}>
          {FUND_TYPES.map((ty) => (
            <div key={ty} onClick={() => setType(ty)} style={{
              flex: 1, textAlign: "center", padding: "9px", borderRadius: 7, cursor: "pointer", fontSize: 15.5, fontWeight: 600,
              background: type === ty ? C.forest : C.paper, color: type === ty ? "#fff" : C.ink2,
              border: `1px solid ${type === ty ? C.forest : C.border}`
            }}>{ty === "External Loan" ? "External Loan" : "Bank"}</div>
          ))}
        </div>
      </Field>
      <Field label={type === "Bank" ? "Bank name" : "Lender name"} required>
        <input style={FieldStyle.input} value={source} onChange={(e) => setSource(e.target.value)} placeholder={type === "Bank" ? "e.g. Centenary Bank" : "e.g. Investor or individual name"} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Amount received" required><input type="number" style={FieldStyle.input} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date received" required><DatePicker value={dateReceived} onChange={setDateReceived} /></Field>
        <Field label="Expected repayment date" hint="Optional"><DatePicker value={expectedRepaymentDate} onChange={setExpectedRepaymentDate} /></Field>
      </div>
      <Field label="Notes"><textarea style={{ ...FieldStyle.input, minHeight: 50 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>{existing ? "Save changes" : "Save"}</button>
      </div>
    </ModalShell>
  );
}

function FundRepaymentForm({ data, update, showToast, close, payload, existing }) {
  const [fundId, setFundId] = useState(existing?.fundId || payload?.fundId || "");
  const [fq, setFq] = useState("");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing?.date || todayISO());
  const [method, setMethod] = useState(existing?.method || "Cash");
  const [notes, setNotes] = useState(existing?.notes || "");

  const openFunds = data.externalFunds.filter((f) => !f.voided && (fundStatus(f, data.fundRepayments) !== "Fully Paid" || f.id === existing?.fundId));
  const matches = fq ? openFunds.filter((f) => (f.source + " " + f.type).toLowerCase().includes(fq.toLowerCase())) : openFunds;
  const selectedFund = data.externalFunds.find((f) => f.id === fundId);
  // When editing, exclude this repayment's own amount so "outstanding" reflects what it'd be after saving.
  const otherRepayments = existing ? data.fundRepayments.filter((r) => r.id !== existing.id) : data.fundRepayments;
  const outstanding = selectedFund ? Math.max(0, selectedFund.amount - fundRepaidAmount(selectedFund.id, otherRepayments)) : 0;

  const submit = () => {
    if (!fundId) return showToast("Select which loan or bank fund this repayment is for.");
    if (!amount || Number(amount) <= 0) return showToast("Enter the repayment amount.");
    if (existing) {
      update((d) => {
        Object.assign(d.fundRepayments.find((r) => r.id === existing.id), { fundId, amount: Number(amount), date, method, notes });
      }, `Edited repayment to ${selectedFund.source} (${selectedFund.type})`);
      showToast("Repayment updated.");
    } else {
      update((d) => {
        d.fundRepayments.push({ id: uid("fundpay"), fundId, amount: Number(amount), date, method, notes, voided: false });
      }, `Recorded repayment of ${fmt(Number(amount))} to ${selectedFund.source} (${selectedFund.type})`);
      showToast("Repayment recorded.");
    }
    close();
  };

  return (
    <ModalShell title={existing ? "Edit repayment" : "Record a repayment"} onClose={close}>
      <Field label="Loan or bank fund" required>
        {selectedFund ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.forestSoft }}>
            <span style={{ fontSize: 15.5 }}><b>{selectedFund.source}</b> · {selectedFund.type}<br /><span style={{ fontSize: 14, color: C.ink3, ...numFont }}>{fmt(outstanding)} outstanding</span></span>
            <span style={{ color: C.forest, fontSize: 14.5, cursor: "pointer", fontWeight: 600 }} onClick={() => setFundId("")}>Change</span>
          </div>
        ) : (
          <>
            <input style={FieldStyle.input} placeholder="Search lender or bank name…" value={fq} onChange={(e) => setFq(e.target.value)} />
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, marginTop: 4, maxHeight: 160, overflowY: "auto" }}>
              {matches.length === 0 && <div style={{ padding: 10, fontSize: 13, color: C.ink3 }}>No outstanding external funding matches.</div>}
              {matches.map((f) => (
                <div key={f.id} onClick={() => setFundId(f.id)} style={{ padding: "8px 11px", fontSize: 15, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  <b>{f.source}</b> · {f.type} <span style={{ color: C.ink4 }}>· {fmt(Math.max(0, f.amount - fundRepaidAmount(f.id, otherRepayments)))} left</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Amount paid" required><input type="number" style={FieldStyle.input} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Payment date" required><DatePicker value={date} onChange={setDate} /></Field>
        <Field label="Payment method">
          <select style={FieldStyle.input} value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea style={{ ...FieldStyle.input, minHeight: 50 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>{existing ? "Save changes" : "Record repayment"}</button>
      </div>
    </ModalShell>
  );
}

function EditLoanForm({ data, update, showToast, close, payload }) {
  const loan = data.loans.find((l) => l.id === payload?.loanId);
  if (!loan) return null;
  const borrower = data.borrowers.find((b) => b.id === loan.borrowerId);

  const [amount, setAmount] = useState(String(loan.amount));
  const [interestType, setInterestType] = useState(loan.interestType);
  const [interestValue, setInterestValue] = useState(String(loan.interestValue));
  const [hasPaperworkFee, setHasPaperworkFee] = useState((loan.paperworkFee || 0) > 0);
  const [paperworkFee, setPaperworkFee] = useState(String(loan.paperworkFee || DEFAULT_PAPERWORK_FEE));
  const [issueDate, setIssueDate] = useState(loan.issueDate);
  const [dueDate, setDueDate] = useState(loan.dueDate);
  const [repaymentMethod, setRepaymentMethod] = useState(loan.repaymentMethod);
  const [instCount, setInstCount] = useState(loan.instalments ? String(loan.instalments.count) : "");
  const [instFreq, setInstFreq] = useState(loan.instalments ? loan.instalments.frequency : "Monthly");
  const [instAmount, setInstAmount] = useState(loan.instalments ? String(loan.instalments.expectedAmount) : "");
  const [instFirst, setInstFirst] = useState(loan.instalments ? loan.instalments.firstPaymentDate : "");

  const interestAmount = interestType === "Percent" ? (Number(amount) || 0) * (Number(interestValue) || 0) / 100 : (Number(interestValue) || 0);
  const feeAmount = hasPaperworkFee ? (Number(paperworkFee) || 0) : 0;
  const totalPayable = (Number(amount) || 0) + interestAmount + feeAmount;
  const alreadyPaid = paidAmountFor(loan.id, data.payments);

  const submit = () => {
    if (!amount || Number(amount) <= 0) return showToast("Enter a loan amount.");
    if (!dueDate) return showToast("Set the due date.");
    if (totalPayable < alreadyPaid) {
      return showToast(`The new total (${fmt(totalPayable)}) can't be less than what's already been paid (${fmt(alreadyPaid)}).`);
    }
    update((d) => {
      const l = d.loans.find((x) => x.id === loan.id);
      Object.assign(l, {
        amount: Number(amount), interestType, interestValue: Number(interestValue) || 0,
        paperworkFee: feeAmount, totalPayable, issueDate, dueDate, repaymentMethod,
        instalments: repaymentMethod === "Instalments" ? {
          count: Number(instCount) || 0, frequency: instFreq, expectedAmount: Number(instAmount) || 0, firstPaymentDate: instFirst
        } : null,
      });
    }, `Edited loan ${loan.loanNumber}`);
    showToast("Loan updated.");
    close();
  };

  return (
    <ModalShell title={`Edit loan ${loan.loanNumber}`} onClose={close} wide>
      <div style={{ background: C.bg, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 15 }}>
        Borrower: <b>{borrower?.fullName}</b> · Already paid: <b>{fmt(alreadyPaid)}</b>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Amount borrowed" required><input type="number" style={FieldStyle.input} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Interest margin type">
          <select style={FieldStyle.input} value={interestType} onChange={(e) => setInterestType(e.target.value)}>
            <option value="Percent">Percentage of loan</option>
            <option value="Fixed">Fixed amount</option>
          </select>
        </Field>
        <Field label={interestType === "Percent" ? "Interest margin (%)" : "Interest margin amount"}>
          <input type="number" style={FieldStyle.input} value={interestValue} onChange={(e) => setInterestValue(e.target.value)} />
        </Field>
        <Field label="Total amount payable" hint="Recalculated automatically">
          <input style={{ ...FieldStyle.input, ...numFont, fontWeight: 700, background: C.bg }} value={fmt(totalPayable)} disabled />
        </Field>
        <Field label="Issue date" required><DatePicker value={issueDate} onChange={setIssueDate} /></Field>
        <Field label="Due date" required><DatePicker value={dueDate} onChange={setDueDate} /></Field>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 10px" }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3 }}>Paperwork cost</div>
        <div onClick={() => setHasPaperworkFee((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.forest }}>
          <div style={{ width: 36, height: 20, borderRadius: 12, background: hasPaperworkFee ? C.forest : C.border, position: "relative" }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: hasPaperworkFee ? 18 : 2 }} />
          </div>
          {hasPaperworkFee ? "Charged on this loan" : "Not charged"}
        </div>
      </div>
      {hasPaperworkFee && (
        <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 6, maxWidth: 260 }}>
          <Field label="Paperwork cost"><input type="number" style={FieldStyle.input} value={paperworkFee} onChange={(e) => setPaperworkFee(e.target.value)} /></Field>
        </div>
      )}

      <Field label="Repayment method">
        <div style={{ display: "flex", gap: 8 }}>
          {["Full Payment", "Instalments"].map((m) => (
            <div key={m} onClick={() => setRepaymentMethod(m)} style={{
              flex: 1, textAlign: "center", padding: "9px", borderRadius: 7, cursor: "pointer", fontSize: 15.5, fontWeight: 600,
              background: repaymentMethod === m ? C.forest : C.paper, color: repaymentMethod === m ? "#fff" : C.ink2,
              border: `1px solid ${repaymentMethod === m ? C.forest : C.border}`
            }}>{m}</div>
          ))}
        </div>
      </Field>
      {repaymentMethod === "Instalments" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14, background: C.bg, padding: 12, borderRadius: 8 }}>
          <Field label="Number of instalments"><input type="number" style={FieldStyle.input} value={instCount} onChange={(e) => setInstCount(e.target.value)} /></Field>
          <Field label="Frequency">
            <select style={FieldStyle.input} value={instFreq} onChange={(e) => setInstFreq(e.target.value)}>
              {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Expected instalment amount"><input type="number" style={FieldStyle.input} value={instAmount} onChange={(e) => setInstAmount(e.target.value)} /></Field>
          <Field label="First payment date"><DatePicker value={instFirst} onChange={setInstFirst} /></Field>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>Save changes</button>
      </div>
    </ModalShell>
  );
}

function RenewLoanForm({ data, update, showToast, close, payload, goLoan }) {
  const old = data.loans.find((l) => l.id === payload?.loanId);
  if (!old) return null;
  const borrower = data.borrowers.find((b) => b.id === old.borrowerId);
  const outstanding = Math.max(0, old.totalPayable - paidAmountFor(old.id, data.payments));
  const defaultTerm = Math.max(daysBetween(old.issueDate, old.dueDate), 7);
  const defaultDue = (() => {
    const d = new Date();
    d.setDate(d.getDate() + defaultTerm);
    return d.toISOString().slice(0, 10);
  })();

  const [principal, setPrincipal] = useState(String(outstanding));
  const [interestType, setInterestType] = useState("Percent");
  const [interestValue, setInterestValue] = useState(String(DEFAULT_INTEREST_RATE));
  const [newDueDate, setNewDueDate] = useState(defaultDue);
  const [hasFee, setHasFee] = useState(false);
  const [fee, setFee] = useState(String(DEFAULT_PAPERWORK_FEE));

  const interestAmt = interestType === "Percent" ? (Number(principal) || 0) * (Number(interestValue) || 0) / 100 : (Number(interestValue) || 0);
  const feeAmt = hasFee ? (Number(fee) || 0) : 0;
  const totalPayable = (Number(principal) || 0) + interestAmt + feeAmt;

  const submit = () => {
    if (!newDueDate) return showToast("Set the new due date for this loan.");
    if (!principal || Number(principal) <= 0) return showToast("Enter the amount being carried into the renewed loan.");
    let newId = null;
    update((d) => {
      newId = renewLoan(d, old.id, {
        newPrincipal: Number(principal), interestType, interestValue: Number(interestValue) || 0,
        newDueDate, paperworkFee: feeAmt,
      });
    }, `Renewed loan ${old.loanNumber}`);
    if (!newId) return showToast("This loan can't be renewed.");
    showToast("Loan renewed.");
    close();
    goLoan(newId);
  };

  return (
    <ModalShell title="Renew loan" onClose={close} wide>
      <div style={{ background: C.forestSoft, border: "1px solid #B9CDAE", borderRadius: 9, padding: 12, marginBottom: 14, fontSize: 14.5 }}>
        Renewing <b>{old.loanNumber}</b> for <b>{borrower?.fullName}</b>. The outstanding balance of <b>{fmt(outstanding)}</b> will roll into a brand new loan, and {old.loanNumber} will be marked Renewed and kept in the borrower's history.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Amount carried into new loan" required hint="Defaults to the outstanding balance">
          <input type="number" style={FieldStyle.input} value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <Field label="New due date" required>
          <DatePicker value={newDueDate} onChange={setNewDueDate} />
        </Field>
        <Field label="Interest margin type">
          <select style={FieldStyle.input} value={interestType} onChange={(e) => setInterestType(e.target.value)}>
            <option value="Percent">Percentage of loan</option>
            <option value="Fixed">Fixed amount</option>
          </select>
        </Field>
        <Field label={interestType === "Percent" ? "Interest margin (%)" : "Interest margin amount"} hint="Fixed at 20% by default, adjust if needed">
          <input type="number" style={FieldStyle.input} value={interestValue} onChange={(e) => setInterestValue(e.target.value)} />
        </Field>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 10px" }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3 }}>Paperwork cost</div>
        <div onClick={() => setHasFee((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.forest }}>
          <div style={{ width: 36, height: 20, borderRadius: 12, background: hasFee ? C.forest : C.border, position: "relative", transition: "background .15s" }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: hasFee ? 18 : 2, transition: "left .15s" }} />
          </div>
          {hasFee ? "Added to this renewal" : "Not charged on this renewal"}
        </div>
      </div>
      {hasFee && (
        <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 6, maxWidth: 260 }}>
          <Field label="Paperwork cost"><input type="number" style={FieldStyle.input} value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
        </div>
      )}

      <Card style={{ marginTop: 8, background: C.bg }}>
        <div style={{ fontSize: 13, color: C.ink3, fontWeight: 600 }}>New total amount payable</div>
        <div style={{ ...numFont, fontSize: 22, fontWeight: 700, marginTop: 4 }}>{fmt(totalPayable)}</div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>Renew loan</button>
      </div>
    </ModalShell>
  );
}

function BorrowerForm({ data, update, showToast, close, existing, goBorrower }) {
  const [f, setF] = useState(existing || {
    fullName: "", phone: "", altPhone: "", nationalId: "", address: "", occupation: "",
    nextOfKin: "", nextOfKinPhone: "", notes: "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setPhone = (k) => (e) => setF({ ...f, [k]: digitsOnly(e.target.value) });
  const setNin = (e) => setF({ ...f, nationalId: ninChars(e.target.value) });

  const submit = () => {
    if (!f.fullName.trim()) return showToast("Full name is required.");
    if (!f.phone.trim()) return showToast("Phone number is required.");
    if (!isValidPhone(f.phone)) return showToast("Phone number must be exactly 10 digits, starting with 07, 03, or 04.");
    if (f.altPhone && !isValidPhone(f.altPhone)) return showToast("Alternative phone number must be exactly 10 digits, starting with 07, 03, or 04.");
    if (f.nextOfKinPhone && !isValidPhone(f.nextOfKinPhone)) return showToast("Next of kin phone number must be exactly 10 digits, starting with 07, 03, or 04.");
    if (f.nationalId && !isValidNin(f.nationalId)) return showToast("National ID number must be exactly 14 characters.");
    if (existing) {
      update((d) => { Object.assign(d.borrowers.find((b) => b.id === existing.id), f); }, `Edited borrower profile "${f.fullName.trim()}"`);
      showToast("Borrower profile updated.");
      close();
    } else {
      const id = uid("bor");
      update((d) => { d.borrowers.push({ ...f, id, dateRegistered: todayISO() }); }, `Registered new borrower "${f.fullName.trim()}"`);
      showToast("Borrower registered.");
      close();
      goBorrower(id);
    }
  };
  return (
    <ModalShell title={existing ? "Edit borrower profile" : "New borrower"} onClose={close} wide>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, columnGap: 14 }}>
        <Field label="Full name" required><input style={FieldStyle.input} value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label="Phone number" required hint="10 digits, starting with 07, 03, or 04">
          <input style={FieldStyle.input} value={f.phone} onChange={setPhone("phone")} inputMode="numeric" maxLength={10} placeholder="07XXXXXXXX" />
        </Field>
        <Field label="Alternative phone number" hint="10 digits, starting with 07, 03, or 04">
          <input style={FieldStyle.input} value={f.altPhone} onChange={setPhone("altPhone")} inputMode="numeric" maxLength={10} placeholder="07XXXXXXXX" />
        </Field>
        <Field label="National ID number" hint="Exactly 14 characters">
          <input style={FieldStyle.input} value={f.nationalId} onChange={setNin} maxLength={14} />
        </Field>
        <Field label="Occupation / Business"><input style={FieldStyle.input} value={f.occupation} onChange={set("occupation")} /></Field>
        <Field label="Physical address"><input style={FieldStyle.input} value={f.address} onChange={set("address")} /></Field>
        <Field label="Next of kin"><input style={FieldStyle.input} value={f.nextOfKin} onChange={set("nextOfKin")} /></Field>
        <Field label="Next of kin phone number" hint="10 digits, starting with 07, 03, or 04">
          <input style={FieldStyle.input} value={f.nextOfKinPhone} onChange={setPhone("nextOfKinPhone")} inputMode="numeric" maxLength={10} placeholder="07XXXXXXXX" />
        </Field>
      </div>
      <Field label="Notes"><textarea style={{ ...FieldStyle.input, minHeight: 60 }} value={f.notes} onChange={set("notes")} /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>{existing ? "Save changes" : "Register borrower"}</button>
      </div>
    </ModalShell>
  );
}

function LoanForm({ data, update, showToast, close, payload, goLoan, setModal }) {
  const [borrowerId, setBorrowerId] = useState(payload?.borrowerId || "");
  const [bq, setBq] = useState("");
  const [amount, setAmount] = useState("");
  const [interestType, setInterestType] = useState("Percent");
  const [interestValue, setInterestValue] = useState(String(DEFAULT_INTEREST_RATE));
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [repaymentMethod, setRepaymentMethod] = useState("Full Payment");
  const [instCount, setInstCount] = useState("");
  const [instFreq, setInstFreq] = useState("Monthly");
  const [instAmount, setInstAmount] = useState("");
  const [instFirst, setInstFirst] = useState("");

  const [hasPaperworkFee, setHasPaperworkFee] = useState(true);
  const [paperworkFee, setPaperworkFee] = useState(String(DEFAULT_PAPERWORK_FEE));

  const [hasCollateral, setHasCollateral] = useState(false);
  const [col, setCol] = useState({
    description: "", category: CATEGORY_OPTIONS[0], brand: "", model: "", serial: "",
    estimatedValue: "", condition: "", storageLocation: "", notes: "",
  });
  const setColField = (k) => (e) => setCol({ ...col, [k]: e.target.value });

  const [isHistorical, setIsHistorical] = useState(false);
  const [priorPaid, setPriorPaid] = useState("");
  const [priorPaidDate, setPriorPaidDate] = useState(todayISO());
  const [priorPaidMethod, setPriorPaidMethod] = useState("Cash");

  const interestAmount = useMemo(() => {
    const amt = Number(amount) || 0;
    if (interestType === "Percent") return amt * (Number(interestValue) || 0) / 100;
    return Number(interestValue) || 0;
  }, [amount, interestType, interestValue]);

  const feeAmount = hasPaperworkFee ? (Number(paperworkFee) || 0) : 0;

  const totalPayable = useMemo(() => {
    const amt = Number(amount) || 0;
    return amt + interestAmount + feeAmount;
  }, [amount, interestAmount, feeAmount]);

  const matches = bq ? data.borrowers.filter((b) => b.fullName.toLowerCase().includes(bq.toLowerCase())) : [];
  const selectedBorrower = data.borrowers.find((b) => b.id === borrowerId);

  const submit = () => {
    if (!borrowerId) return showToast("Please select a borrower first.");
    if (!amount || Number(amount) <= 0) return showToast("Enter a loan amount.");
    if (!dueDate) return showToast("Please set the date this loan is expected to be paid.");
    if (repaymentMethod === "Instalments" && (!instCount || !instAmount || !instFirst)) return showToast("Fill in all instalment details.");
    if (hasCollateral && !col.description.trim()) return showToast("Describe the security/collateral, or turn that section off.");
    if (isHistorical && priorPaid && Number(priorPaid) > totalPayable) return showToast("Amount already paid can't be more than the total amount payable.");

    const count = (data.loans.filter(l=>l.loanNumber?.startsWith(`LN-${new Date().getFullYear()}`)).length) + 1;
    const loanNumber = `LN-${new Date().getFullYear()}-${String(count).padStart(4, "0")}`;
    const id = uid("loan");
    update((d) => {
      d.loans.push({
        id, loanNumber, borrowerId, amount: Number(amount), interestType, interestValue: Number(interestValue) || 0,
        paperworkFee: feeAmount,
        totalPayable, issueDate, dueDate, repaymentMethod,
        issuedAt: new Date().toISOString(),
        instalments: repaymentMethod === "Instalments" ? {
          count: Number(instCount), frequency: instFreq, expectedAmount: Number(instAmount), firstPaymentDate: instFirst
        } : null,
        voided: false,
        isHistorical,
      });
      if (hasCollateral && col.description.trim()) {
        d.collateral.push({
          id: uid("col"), loanId: id, borrowerId, ...col,
          estimatedValue: Number(col.estimatedValue) || 0, dateReceived: issueDate, status: "Held", photos: [],
        });
      }
      if (isHistorical && priorPaid && Number(priorPaid) > 0) {
        d.payments.push({
          id: uid("pay"), loanId: id, borrowerId, amount: Number(priorPaid), date: priorPaidDate,
          method: priorPaidMethod, reference: "", notes: "Entered while recording previous loan history.", voided: false,
        });
      }
    }, `Issued loan ${loanNumber} for ${fmt(Number(amount))}${isHistorical ? " (migrated record)" : ""}`);
    showToast(hasCollateral ? "Loan issued with security recorded." : "Loan issued.");
    close();
    goLoan(id);
  };

  return (
    <ModalShell title="New loan" onClose={close} wide>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, padding: 12, borderRadius: 9, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>This is a previous loan</div>
          <div style={{ fontSize: 13.5, color: C.ink3, marginTop: 2 }}>Use this when entering old, pre-system records so history migrates correctly</div>
        </div>
        <div onClick={() => setIsHistorical((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.forest, flexShrink: 0 }}>
          <div style={{ width: 36, height: 20, borderRadius: 12, background: isHistorical ? C.forest : C.border, position: "relative", transition: "background .15s" }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: isHistorical ? 18 : 2, transition: "left .15s" }} />
          </div>
        </div>
      </div>

      <Field label="Borrower" required>
        {selectedBorrower ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.forestSoft }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>{selectedBorrower.fullName}</span>
            <span style={{ color: C.forest, fontSize: 14.5, cursor: "pointer", fontWeight: 600 }} onClick={() => setBorrowerId("")}>Change</span>
          </div>
        ) : (
          <>
            <input style={FieldStyle.input} placeholder="Search existing borrower by name…" value={bq} onChange={(e) => setBq(e.target.value)} />
            {matches.length > 0 && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, marginTop: 4, maxHeight: 140, overflowY: "auto" }}>
                {matches.map((b) => (
                  <div key={b.id} onClick={() => { setBorrowerId(b.id); setBq(""); }} style={{ padding: "8px 11px", fontSize: 15.5, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>{b.fullName} <span style={{ color: C.ink4 }}>· {b.phone}</span></div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <button style={Btn.ghost} onClick={() => { close(); setTimeout(() => setModal({ type: "borrower" }), 50); }}><Plus size={13} /> Add new borrower</button>
            </div>
          </>
        )}
      </Field>

      <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, margin: "16px 0 10px" }}>Amount &amp; interest margin</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Amount borrowed" required hint="The principal handed to the borrower"><input type="number" style={FieldStyle.input} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Interest margin type">
          <select style={FieldStyle.input} value={interestType} onChange={(e) => setInterestType(e.target.value)}>
            <option value="Percent">Percentage of loan</option>
            <option value="Fixed">Fixed amount</option>
          </select>
        </Field>
        <Field label={interestType === "Percent" ? "Interest margin (%)" : "Interest margin amount"} hint={interestType === "Percent" ? "Fixed at 20% by default, adjust if needed" : "What the business earns on this loan"}>
          <input type="number" style={FieldStyle.input} value={interestValue} onChange={(e) => setInterestValue(e.target.value)} />
        </Field>
        <Field label="Total amount payable" hint="Amount borrowed + interest + paperwork cost (if added), calculated automatically">
          <input style={{ ...FieldStyle.input, ...numFont, fontWeight: 700, background: C.bg }} value={fmt(totalPayable)} disabled />
        </Field>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 10px" }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3 }}>Paperwork cost</div>
        <div onClick={() => setHasPaperworkFee((v) => !v)} style={{
          display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.forest
        }}>
          <div style={{
            width: 36, height: 20, borderRadius: 12, background: hasPaperworkFee ? C.forest : C.border,
            position: "relative", transition: "background .15s"
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2,
              left: hasPaperworkFee ? 18 : 2, transition: "left .15s"
            }} />
          </div>
          {hasPaperworkFee ? "Added to this loan" : "Not charged on this loan"}
        </div>
      </div>
      {hasPaperworkFee && (
        <div style={{ background: C.bg, padding: 12, borderRadius: 8, marginBottom: 6, maxWidth: 260 }}>
          <Field label="Paperwork cost" hint="Defaults to UGX 5,000, adjust if this loan is different">
            <input type="number" style={FieldStyle.input} value={paperworkFee} onChange={(e) => setPaperworkFee(e.target.value)} />
          </Field>
        </div>
      )}

      {isHistorical && (
        <>
          <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, margin: "16px 0 10px" }}>Amount already paid so far</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14, background: C.bg, padding: 12, borderRadius: 8 }}>
            <Field label="Amount already paid" hint="Leave at 0 if nothing has been paid on this loan yet">
              <input type="number" style={FieldStyle.input} value={priorPaid} onChange={(e) => setPriorPaid(e.target.value)} />
            </Field>
            <Field label="Date of that payment"><DatePicker value={priorPaidDate} onChange={setPriorPaidDate} /></Field>
            <Field label="Payment method">
              <select style={FieldStyle.input} value={priorPaidMethod} onChange={(e) => setPriorPaidMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
        </>
      )}

      <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, margin: "16px 0 10px" }}>When it's expected to be paid</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Loan issue date" required><DatePicker value={issueDate} onChange={setIssueDate} /></Field>
        <Field label="Expected payment / due date" required><DatePicker value={dueDate} onChange={setDueDate} /></Field>
      </div>

      <Field label="Repayment method">
        <div style={{ display: "flex", gap: 8 }}>
          {["Full Payment", "Instalments"].map((m) => (
            <div key={m} onClick={() => setRepaymentMethod(m)} style={{
              flex: 1, textAlign: "center", padding: "9px", borderRadius: 7, cursor: "pointer", fontSize: 15.5, fontWeight: 600,
              background: repaymentMethod === m ? C.forest : C.paper, color: repaymentMethod === m ? "#fff" : C.ink2,
              border: `1px solid ${repaymentMethod === m ? C.forest : C.border}`
            }}>{m}</div>
          ))}
        </div>
      </Field>

      {repaymentMethod === "Instalments" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14, background: C.bg, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <Field label="Number of instalments" required><input type="number" style={FieldStyle.input} value={instCount} onChange={(e) => setInstCount(e.target.value)} /></Field>
          <Field label="Frequency">
            <select style={FieldStyle.input} value={instFreq} onChange={(e) => setInstFreq(e.target.value)}>
              {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Expected instalment amount" required><input type="number" style={FieldStyle.input} value={instAmount} onChange={(e) => setInstAmount(e.target.value)} /></Field>
          <Field label="First payment date" required><DatePicker value={instFirst} onChange={setInstFirst} /></Field>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 10px" }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3 }}>Security / collateral attached</div>
        <div onClick={() => setHasCollateral((v) => !v)} style={{
          display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.forest
        }}>
          <div style={{
            width: 36, height: 20, borderRadius: 12, background: hasCollateral ? C.forest : C.border,
            position: "relative", transition: "background .15s"
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2,
              left: hasCollateral ? 18 : 2, transition: "left .15s"
            }} />
          </div>
          {hasCollateral ? "Borrower is providing security" : "No security for this loan"}
        </div>
      </div>

      {hasCollateral && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14, background: C.bg, padding: 12, borderRadius: 8, marginBottom: 6 }}>
          <Field label="Security / item description" required><input style={FieldStyle.input} value={col.description} onChange={setColField("description")} placeholder="e.g. Samsung TV, 43 inch" /></Field>
          <Field label="Category">
            <select style={FieldStyle.input} value={col.category} onChange={setColField("category")}>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Brand"><input style={FieldStyle.input} value={col.brand} onChange={setColField("brand")} /></Field>
          <Field label="Model"><input style={FieldStyle.input} value={col.model} onChange={setColField("model")} /></Field>
          <Field label="Serial number (if applicable)"><input style={FieldStyle.input} value={col.serial} onChange={setColField("serial")} /></Field>
          <Field label="Estimated value"><input type="number" style={FieldStyle.input} value={col.estimatedValue} onChange={setColField("estimatedValue")} /></Field>
          <Field label="Condition"><input style={FieldStyle.input} value={col.condition} onChange={setColField("condition")} placeholder="e.g. Good, used" /></Field>
          <Field label="Storage location"><input style={FieldStyle.input} value={col.storageLocation} onChange={setColField("storageLocation")} /></Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Notes"><textarea style={{ ...FieldStyle.input, minHeight: 46 }} value={col.notes} onChange={setColField("notes")} /></Field>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>Issue loan</button>
      </div>
    </ModalShell>
  );
}

function PaymentForm({ data, update, showToast, close, payload, existing }) {
  const [loanId, setLoanId] = useState(existing?.loanId || payload?.loanId || "");
  const [lq, setLq] = useState("");
  const [principalAmt, setPrincipalAmt] = useState(existing ? String(existing.principalPaid || 0) : "");
  const [interestAmt, setInterestAmt] = useState(existing ? String(existing.interestPaid || 0) : "");
  const [date, setDate] = useState(existing?.date || todayISO());
  const [method, setMethod] = useState(existing?.method || "Cash");
  const [reference, setReference] = useState(existing?.reference || "");
  const [notes, setNotes] = useState(existing?.notes || "");

  const openLoans = data.loans.filter((l) => !l.voided && !l.renewed && loanStatus(l, data.payments) !== "Fully Paid");
  const matches = lq ? openLoans.filter((l) => (l.loanNumber + " " + borrowerName(data.borrowers, l.borrowerId)).toLowerCase().includes(lq.toLowerCase())) : openLoans;
  const selectedLoan = data.loans.find((l) => l.id === loanId);
  // When editing, exclude this payment's own amount from "already paid" so the
  // remaining figures reflect what they'd be once this edit is saved.
  const otherPayments = existing ? data.payments.filter((p) => p.id !== existing.id) : data.payments;
  const outstanding = selectedLoan ? Math.max(0, selectedLoan.totalPayable - paidAmountFor(selectedLoan.id, otherPayments)) : 0;
  const remainingPrincipal = selectedLoan ? Math.max(0, selectedLoan.amount - principalPaidFor(selectedLoan.id, otherPayments)) : 0;
  const remainingInterest = selectedLoan ? Math.max(0, loanInterestAmount(selectedLoan) - interestPaidFor(selectedLoan.id, otherPayments)) : 0;
  const totalAmount = (Number(principalAmt) || 0) + (Number(interestAmt) || 0);

  const submit = () => {
    if (!loanId) return showToast("Select a loan to record a payment against.");
    if (totalAmount <= 0) return showToast("Enter an amount towards principal, interest, or both.");
    if (existing) {
      update((d) => {
        Object.assign(d.payments.find((p) => p.id === existing.id), {
          amount: totalAmount, principalPaid: Number(principalAmt) || 0, interestPaid: Number(interestAmt) || 0,
          date, method, reference, notes,
        });
      }, `Edited payment of ${fmt(totalAmount)} on loan ${selectedLoan.loanNumber}`);
      showToast("Payment updated.");
    } else {
      const willBeFullyPaid = (paidAmountFor(selectedLoan.id, data.payments) + totalAmount) >= (selectedLoan.totalPayable - 0.5);
      update((d) => {
        d.payments.push({
          id: uid("pay"), loanId, borrowerId: selectedLoan.borrowerId, amount: totalAmount,
          principalPaid: Number(principalAmt) || 0, interestPaid: Number(interestAmt) || 0,
          date, method, reference, notes, voided: false
        });
      }, `Recorded payment of ${fmt(totalAmount)} on loan ${selectedLoan.loanNumber}`);
      showToast(willBeFullyPaid ? "Payment recorded. This loan is now fully paid." : "Payment recorded.");
    }
    close();
  };

  return (
    <ModalShell title={existing ? "Edit payment" : "Record a payment"} onClose={close}>
      <Field label="Loan" required>
        {selectedLoan ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.forestSoft }}>
            <span style={{ fontSize: 15.5 }}><b>{selectedLoan.loanNumber}</b> · {borrowerName(data.borrowers, selectedLoan.borrowerId)}<br /><span style={{ fontSize: 14, color: C.ink3, ...numFont }}>{fmt(outstanding)} outstanding</span></span>
            {!existing && <span style={{ color: C.forest, fontSize: 14.5, cursor: "pointer", fontWeight: 600 }} onClick={() => setLoanId("")}>Change</span>}
          </div>
        ) : (
          <>
            <input style={FieldStyle.input} placeholder="Search borrower name or loan number…" value={lq} onChange={(e) => setLq(e.target.value)} />
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, marginTop: 4, maxHeight: 160, overflowY: "auto" }}>
              {matches.length === 0 && <div style={{ padding: 10, fontSize: 15, color: C.ink3 }}>No open loans match.</div>}
              {matches.map((l) => (
                <div key={l.id} onClick={() => setLoanId(l.id)} style={{ padding: "8px 11px", fontSize: 15.5, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  <b>{l.loanNumber}</b> · {borrowerName(data.borrowers, l.borrowerId)} <span style={{ color: C.ink4 }}>· {fmt(Math.max(0, l.totalPayable - paidAmountFor(l.id, data.payments)))} left</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Field>

      {selectedLoan && (
        <div style={{ display: "flex", gap: 20, background: C.bg, borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12.5, color: C.ink3, fontWeight: 600 }}>Principal remaining</div>
            <div style={{ ...numFont, fontSize: 15, fontWeight: 700 }}>{fmt(remainingPrincipal)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, color: C.ink3, fontWeight: 600 }}>Interest remaining</div>
            <div style={{ ...numFont, fontSize: 15, fontWeight: 700 }}>{fmt(remainingInterest)}</div>
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>How this payment is applied</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Amount towards principal" required><input type="number" style={FieldStyle.input} value={principalAmt} onChange={(e) => setPrincipalAmt(e.target.value)} /></Field>
        <Field label="Amount towards interest" required><input type="number" style={FieldStyle.input} value={interestAmt} onChange={(e) => setInterestAmt(e.target.value)} /></Field>
      </div>
      <Field label="Total amount paid" hint="Principal + interest, calculated automatically">
        <input style={{ ...FieldStyle.input, ...numFont, fontWeight: 700, background: C.bg }} value={fmt(totalAmount)} disabled />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Payment date" required><DatePicker value={date} onChange={setDate} /></Field>
        <Field label="Payment method">
          <select style={FieldStyle.input} value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Transaction / reference number"><input style={FieldStyle.input} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea style={{ ...FieldStyle.input, minHeight: 50 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>{existing ? "Save changes" : "Record payment"}</button>
      </div>
    </ModalShell>
  );
}

function CollateralForm({ data, update, showToast, close, payload, existing, t }) {
  const [loanId, setLoanId] = useState(existing?.loanId || payload?.loanId || "");
  const [lq, setLq] = useState("");
  const [f, setF] = useState(existing
    ? {
        description: existing.description, category: existing.category, brand: existing.brand || "", model: existing.model || "",
        serial: existing.serial || "", estimatedValue: String(existing.estimatedValue || ""), condition: existing.condition || "",
        dateReceived: existing.dateReceived, storageLocation: existing.storageLocation || "", notes: existing.notes || "",
      }
    : {
        description: "", category: CATEGORY_OPTIONS[0], brand: "", model: "", serial: "",
        estimatedValue: "", condition: "", dateReceived: todayISO(), storageLocation: "", notes: "",
      });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const loans = data.loans.filter((l) => !l.voided && !l.renewed);
  const matches = lq ? loans.filter((l) => (l.loanNumber + " " + borrowerName(data.borrowers, l.borrowerId)).toLowerCase().includes(lq.toLowerCase())) : loans;
  const selectedLoan = data.loans.find((l) => l.id === loanId);

  const submit = () => {
    if (!loanId) return showToast("Select the loan this collateral belongs to.");
    if (!f.description.trim()) return showToast("Describe the item.");
    if (existing) {
      update((d) => {
        Object.assign(d.collateral.find((c) => c.id === existing.id), { ...f, loanId, borrowerId: selectedLoan.borrowerId, estimatedValue: Number(f.estimatedValue) || 0 });
      }, `Edited collateral "${f.description.trim()}"`);
      showToast("Collateral updated.");
    } else {
      update((d) => {
        d.collateral.push({
          id: uid("col"), loanId, borrowerId: selectedLoan.borrowerId, ...f,
          estimatedValue: Number(f.estimatedValue) || 0, status: "Held", photos: [],
        });
      }, `Added collateral "${f.description.trim()}" on loan ${selectedLoan.loanNumber}`);
      showToast("Collateral recorded.");
    }
    close();
  };

  return (
    <ModalShell title={existing ? "Edit security / collateral" : "Add security / collateral"} onClose={close} wide>
      <Field label="Loan" required>
        {selectedLoan ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.forestSoft }}>
            <span style={{ fontSize: 15.5 }}><b>{selectedLoan.loanNumber}</b> · {borrowerName(data.borrowers, selectedLoan.borrowerId)}</span>
            <span style={{ color: C.forest, fontSize: 14.5, cursor: "pointer", fontWeight: 600 }} onClick={() => setLoanId("")}>Change</span>
          </div>
        ) : (
          <>
            <input style={FieldStyle.input} placeholder="Search borrower name or loan number…" value={lq} onChange={(e) => setLq(e.target.value)} />
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, marginTop: 4, maxHeight: 140, overflowY: "auto" }}>
              {matches.map((l) => (
                <div key={l.id} onClick={() => setLoanId(l.id)} style={{ padding: "8px 11px", fontSize: 15.5, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  <b>{l.loanNumber}</b> · {borrowerName(data.borrowers, l.borrowerId)}
                </div>
              ))}
            </div>
          </>
        )}
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Security / item description" required><input style={FieldStyle.input} value={f.description} onChange={set("description")} /></Field>
        <Field label="Category">
          <select style={FieldStyle.input} value={f.category} onChange={set("category")}>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Brand"><input style={FieldStyle.input} value={f.brand} onChange={set("brand")} /></Field>
        <Field label="Model"><input style={FieldStyle.input} value={f.model} onChange={set("model")} /></Field>
        <Field label="Serial number (if applicable)"><input style={FieldStyle.input} value={f.serial} onChange={set("serial")} /></Field>
        <Field label="Estimated value"><input type="number" style={FieldStyle.input} value={f.estimatedValue} onChange={set("estimatedValue")} /></Field>
        <Field label="Condition"><input style={FieldStyle.input} value={f.condition} onChange={set("condition")} placeholder="e.g. Good, used" /></Field>
        <Field label="Date received"><DatePicker value={f.dateReceived} onChange={(v) => setF({ ...f, dateReceived: v })} /></Field>
        <Field label="Storage location"><input style={FieldStyle.input} value={f.storageLocation} onChange={set("storageLocation")} /></Field>
      </div>
      <Field label="Notes"><textarea style={{ ...FieldStyle.input, minHeight: 50 }} value={f.notes} onChange={set("notes")} /></Field>
      <div style={{ fontSize: 14, color: C.ink4, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Camera size={13} /> {t("photoUploadNote")}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>{existing ? "Save changes" : "Save collateral"}</button>
      </div>
    </ModalShell>
  );
}

function ExpenseForm({ update, showToast, close, existing }) {
  const [f, setF] = useState(existing
    ? { description: existing.description, category: existing.category, amount: String(existing.amount), date: existing.date, method: existing.method, notes: existing.notes || "" }
    : { description: "", category: EXPENSE_CATEGORIES[0], amount: "", date: todayISO(), method: "Cash", notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = () => {
    if (!f.description.trim()) return showToast("Describe the expense.");
    if (!f.amount || Number(f.amount) <= 0) return showToast("Enter an amount.");
    if (existing) {
      update((d) => { Object.assign(d.expenses.find((e) => e.id === existing.id), { ...f, amount: Number(f.amount) }); }, `Edited expense "${f.description.trim()}"`);
      showToast("Expense updated.");
    } else {
      update((d) => { d.expenses.push({ id: uid("exp"), ...f, amount: Number(f.amount), voided: false }); }, `Recorded expense "${f.description.trim()}" (${fmt(Number(f.amount))})`);
      showToast("Expense recorded.");
    }
    close();
  };
  return (
    <ModalShell title={existing ? "Edit expense" : "Record an operational expense"} onClose={close}>
      <Field label="Expense description" required><input style={FieldStyle.input} value={f.description} onChange={set("description")} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        <Field label="Category">
          <select style={FieldStyle.input} value={f.category} onChange={set("category")}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Amount" required><input type="number" style={FieldStyle.input} value={f.amount} onChange={set("amount")} /></Field>
        <Field label="Date"><DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label="Payment method">
          <select style={FieldStyle.input} value={f.method} onChange={set("method")}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea style={{ ...FieldStyle.input, minHeight: 50 }} value={f.notes} onChange={set("notes")} /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} onClick={submit}>{existing ? "Save changes" : "Save expense"}</button>
      </div>
    </ModalShell>
  );
}
