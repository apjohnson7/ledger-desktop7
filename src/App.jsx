import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, Users, Wallet, CreditCard, Lock, TrendingDown, BarChart3, Settings as SettingsIcon,
  Search, Plus, X, ChevronRight, Phone, MapPin, Briefcase, AlertTriangle, CheckCircle2,
  Clock, ArrowLeft, Edit2, Ban, Camera, FileText, ChevronDown, Calendar, DollarSign,
  TrendingUp, ShieldCheck, PackageCheck, Menu, RefreshCw, Landmark, ArrowDownCircle, ArrowUpCircle, Bell, History,
  Download, FileSpreadsheet, FileType, Trash2, Coins
} from "lucide-react";
import * as XLSX from "xlsx";
import loginHero from "./assets/login-hero.jpg";
import loginHeroAmbient from "./assets/login-hero-ambient.jpg";
import loginHeroMirror from "./assets/login-hero-mirror.jpg";
import interTightFont from "./assets/fonts/InterTight-latin.woff2";

/* ============================================================================
   LEDGER, a money lending management system
   Design language: aged-ledger / brass-and-ink. Warm paper surfaces, a deep
   forest-ink primary, a brass accent for money figures, rubber-stamp status
   badges, and a monospace face for anything numeric. The whole thing should
   feel like a well-kept physical ledger book that happens to be digital.
   ============================================================================ */

/* Bundled locally so the offline ledger never calls out to a font CDN. */
const FONT_IMPORT = `
@font-face {
  font-family: 'Inter Tight';
  font-style: normal;
  font-weight: 500 800;
  font-display: swap;
  src: url('${interTightFont}') format('woff2');
}`;

/* The display currency is a business-wide setting. It changes the label on
   every figure, not the stored numbers: this app is offline, so there are no
   live exchange rates to convert historical amounts with. */
const CURRENCY_OPTIONS = [
  { code: "UGX", name: "Ugandan Shilling", locale: "en-UG" },
  { code: "KES", name: "Kenyan Shilling", locale: "en-KE" },
  { code: "TZS", name: "Tanzanian Shilling", locale: "en-TZ" },
  { code: "RWF", name: "Rwandan Franc", locale: "en-RW" },
  { code: "BIF", name: "Burundian Franc", locale: "en-BI" },
  { code: "SSP", name: "South Sudanese Pound", locale: "en-SS" },
  { code: "CDF", name: "Congolese Franc", locale: "en-CD" },
  { code: "ETB", name: "Ethiopian Birr", locale: "en-ET" },
  { code: "SOS", name: "Somali Shilling", locale: "en-SO" },
  { code: "USD", name: "US Dollar", locale: "en-US" },
  { code: "EUR", name: "Euro", locale: "en-IE" },
  { code: "GBP", name: "British Pound", locale: "en-GB" },
];
const CURRENCY_BY_CODE = Object.fromEntries(CURRENCY_OPTIONS.map((c) => [c.code, c]));
let activeCurrencyCode = "UGX";
const currencyFormatters = new Map();

function setActiveCurrency(code) {
  activeCurrencyCode = CURRENCY_BY_CODE[code] ? code : "UGX";
}

const fmt = (n) => {
  const v = Math.round(Number(n) || 0);
  const info = CURRENCY_BY_CODE[activeCurrencyCode] || CURRENCY_BY_CODE.UGX;
  let formatter = currencyFormatters.get(info.code);
  if (!formatter) {
    formatter = new Intl.NumberFormat(info.locale, {
      style: "currency",
      currency: info.code,
      currencyDisplay: "code",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    currencyFormatters.set(info.code, formatter);
  }
  return formatter.format(v);
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const addDays = (dateStr, days) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* -------------------------------- data access --------------------------------
   All persistence lives in the Electron main process now. The renderer asks
   for a page of rows, a single record, or an aggregate; it never receives the
   whole ledger. Password hashing and verification also happen in the main
   process, so no password material is kept in React state. */

const api = () => window.ledger;
const actorOf = (user) => (user ? user.fullName || user.username : "System");

/** Small fetch helper for pages: reruns when any dependency changes. */
function useServerData(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.resolve()
      .then(loader)
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function Pager({ page, pageCount, total, onPage }) {
  if (!pageCount || pageCount <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 13.5, color: C.ink3 }}>
        Page {page} of {pageCount}
        {typeof total === "number" ? ` · ${total.toLocaleString()} record${total === 1 ? "" : "s"}` : ""}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={{ ...Btn.secondary, padding: "6px 12px", fontSize: 14 }} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button style={{ ...Btn.secondary, padding: "6px 12px", fontSize: 14 }} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function LoadingCard() {
  return <Card><div style={{ padding: "18px 0", color: C.ink3, fontSize: 15 }}>Loading…</div></Card>;
}

function ErrorCard({ error }) {
  return <Card><div style={{ padding: "10px 0", color: C.rust, fontSize: 15 }}>{error?.message || "Something went wrong loading this page."}</div></Card>;
}

function usePageState(initial = 1) {
  const [page, setPage] = useState(initial);
  return [page, (next) => setPage(Math.max(1, next)), () => setPage(initial)];
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
    en: "The display currency can be changed at any time from the currency button in the top bar. All figures on the dashboard and reports are calculated automatically from your borrowers, loans, payments, and expenses, nothing here needs manual upkeep. Records are never permanently deleted: use Void on a loan, payment, or expense to correct mistakes while keeping a full history.",
    lg: "Ensimbi ez'okulaga zisobola okukyusibwa buli kiseera okuva ku kifaananyi ky'ensimbi ku mutwe. Ebibalo byonna ku lupapula lw'ekika ne lipoota bibalirirwa byokka okuva mu beewola, ebbanja, okusasula, n'ebisale, tewali kya kukola bugazi. Ebiwandiikiddwa tebisangulwa ddala: kozesa Void ku bbanja, okusasula, oba ensasulo okutereeza ensobi nga obulambulukufu bwonna bukyakuumiddwa.",
    nyn: "Enshoro ez'okureeba zisobola kuhindurwa obwire bwona kuruga aha kishushani ky'enshoro aha mutwe. Ebibarirwa byoona aha rupapura n'omu ripoota nibibarirwa byonka kuruga aha beegura, ebbanja, okushasura, n'ebishasuro, tihariho eky'okukora n'engaro. Ebihandiikirwe tibisangurwaho rundi: koresa Void aha bbanja, okushasura, nari ekishasuro kuhindura enshobo waaba nooshigikiirira amakuru goona."
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

/* -------------------------------- roles & access -------------------------------- */

const ROLES = {
  Administrator: {
    label: "Administrator",
    description: "Full access to every module, plus user management.",
    pages: ["dashboard", "borrowers", "loans", "payments", "collateral", "expenses", "funding", "reports", "settings", "users", "audit", "approvals"],
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

const SESSION_KEY = "ledger.currentUser";

export default function App() {
  const [boot, setBoot] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [publicSettings, setPublicSettings] = useState(null);
  const [defaultPasswordWarning, setDefaultPasswordWarning] = useState(false);
  // Only a hint for the loading screen. The real identity lives in the main
  // process and is confirmed through auth.session below; localStorage alone
  // must never grant access.
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [focusBorrowerId, setFocusBorrowerId] = useState(null);
  const [focusLoanId, setFocusLoanId] = useState(null);
  const [modal, setModal] = useState(null); // {type, payload}
  const [toast, setToast] = useState(null);
  const [version, setVersion] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  // Every money label formats through the saved display currency. Before
  // sign-in only the public business settings are available.
  setActiveCurrency(boot?.settings?.currency || publicSettings?.currency);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const loadBootstrap = useCallback(async () => {
    let b = await api().bootstrap();
    // Roll over overdue loans as soon as the app opens, same as before, but
    // let the main process do it in bounded batches instead of cloning the
    // entire dataset in the renderer.
    if (b.counts && b.counts.overdue > 0) {
      try {
        const result = await api().autoRenew(5000);
        if (result.renewed > 0) {
          b = await api().bootstrap();
          showToast(`${result.renewed} overdue loan${result.renewed === 1 ? "" : "s"} automatically renewed.`);
        }
        if (result.remaining > 0) {
          b = { ...b, autoRenewRemaining: result.remaining };
        }
      } catch (e) {
        console.error("Automatic renewal failed:", e);
      }
    }
    setBoot(b);
    setBootError(null);
    setLoaded(true);
    return b;
  }, [showToast]);

  // Before sign-in, read only the public business settings (name, currency,
  // language). Borrower, loan, and user data stay behind the main process's
  // authenticated session. Also confirm that a saved session still exists in
  // the main process; localStorage by itself is not proof of sign-in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let settingsError = null;
      try {
        const settings = await api().settings();
        if (!cancelled) setPublicSettings(settings);
      } catch (error) {
        settingsError = error;
      }

      try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
        if (saved && saved.id) {
          const session = await api().auth.session();
          if (session && session.user) {
            if (!cancelled) {
              setCurrentUser(session.user);
              setDefaultPasswordWarning(!!session.defaultPassword);
            }
          } else {
            localStorage.removeItem(SESSION_KEY);
          }
        }
      } catch (e) {
        localStorage.removeItem(SESSION_KEY);
      }

      if (!cancelled) {
        if (settingsError) setBootError(settingsError);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadBootstrap().catch((error) => {
      setBootError(error);
      setLoaded(true);
    });
  }, [currentUser, version, loadBootstrap]);

  const notifShownRef = useRef(false);
  useEffect(() => {
    if (!loaded || !boot || !currentUser || notifShownRef.current) return;
    notifShownRef.current = true;
    const a = boot.alerts || {};
    const count = (a.overdue?.length || 0) + (a.soon?.length || 0) + (a.autoRenewedToday?.length || 0);
    if (count > 0) setShowNotifications(true);
  }, [loaded, boot, currentUser]);

  if (!loaded) {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
        <style>{FONT_IMPORT}</style>
        <div style={{ fontFamily: "'Times New Roman', Times, serif", color: C.ink3 }}>Opening the ledger…</div>
      </div>
    );
  }

  if (bootError && !boot) {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480, padding: 24 }}>
        <Card style={{ maxWidth: 560 }}>
          <div style={{ ...displayFont, fontSize: 22, fontWeight: 600, marginBottom: 8 }}>The ledger could not be opened</div>
          <div style={{ fontSize: 15, color: C.ink2, lineHeight: 1.6, marginBottom: 16 }}>{bootError.message || String(bootError)}</div>
          <div style={{ fontSize: 14, color: C.ink3, lineHeight: 1.6, marginBottom: 16 }}>
            Your saved data has not been changed. Try opening the ledger again; if the problem continues, open the backups folder and keep a copy of your latest backup before restoring it from Settings.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={Btn.primary} onClick={() => window.location.reload()}>Try again</button>
            <button style={Btn.secondary} onClick={() => window.ledger?.backup?.openFolder("backups")}>Open backups folder</button>
          </div>
        </Card>
      </div>
    );
  }

  if (!currentUser) {
    const handleLogin = (user, result) => {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      setCurrentUser(user);
      setDefaultPasswordWarning(!!result?.defaultPassword);
      setBoot(null);
      setBootError(null);
      setPage("dashboard");
      notifShownRef.current = false;
    };
    return <LoginScreen businessName={publicSettings?.businessName || boot?.settings?.businessName} onLogin={handleLogin} />;
  }

  if (!boot) {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 480 }}>
        <style>{FONT_IMPORT}</style>
        <div style={{ fontFamily: "'Times New Roman', Times, serif", color: C.ink3 }}>Opening the ledger…</div>
      </div>
    );
  }

  const role = ROLES[currentUser.role] || ROLES.Viewer;
  const allowedPages = role.pages;
  const t = (key) => translate(boot?.settings?.language || "en", key);

  const goBorrower = (id) => {
    if (!allowedPages.includes("borrowers")) return;
    setFocusBorrowerId(id); setFocusLoanId(null); setPage("borrower-detail");
  };
  const goLoan = (id) => {
    if (!allowedPages.includes("loans")) return;
    setFocusLoanId(id); setPage("loan-detail");
  };

  const logout = async () => {
    try {
      await api().auth.logout({ actor: actorOf(currentUser) });
    } catch (e) {
      /* logging out should always work, even if audit logging fails */
    }
    localStorage.removeItem(SESSION_KEY);
    notifShownRef.current = false;
    setCurrentUser(null);
    setDefaultPasswordWarning(false);
    setBoot(null);
    setPage("dashboard");
    setShowNotifications(false);
    setModal(null);
  };

  const changeCurrency = async (code) => {
    if (!CURRENCY_BY_CODE[code] || code === (boot?.settings?.currency || "UGX")) return;
    // Update the screen immediately; the database write follows.
    setBoot((b) => (b ? { ...b, settings: { ...b.settings, currency: code } } : b));
    try {
      const result = await api().settingsUpdate({
        actor: actorOf(currentUser),
        settings: { currency: code },
      });
      if (!result?.ok) {
        showToast(result?.error || "Could not change the display currency.");
        refresh();
        return;
      }
      showToast(`Display currency changed to ${code}.`);
    } catch (e) {
      showToast(e.message || "Could not change the display currency.");
      refresh();
    }
  };

  const ctx = {
    boot, update: refresh, refresh, showToast, goBorrower, goLoan, setModal, setPage,
    currentUser, role, t, version, actor: actorOf(currentUser),
    alertCount: boot?.alertCount || 0,
    onPasswordChanged: () => setDefaultPasswordWarning(false),
  };

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

      <Sidebar page={safePage} setPage={setPage} navOpen={navOpen} setNavOpen={setNavOpen} businessName={boot?.settings?.businessName || "My Lending Business"} allowedPages={allowedPages} />
      {navOpen && <div onClick={() => setNavOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(31,42,36,0.4)", zIndex: 30 }} />}

      <div className="lm-main" style={{ marginLeft: 240, minHeight: "100%" }}>
        <TopBar
          searchQ={searchQ} setSearchQ={setSearchQ}
          onOpenNav={() => setNavOpen(true)}
          onQuickAction={(type) => setModal({ type })}
          currentUser={currentUser}
          onLogout={logout}
          allowedPages={allowedPages}
          alertCount={boot?.alertCount || 0}
          onOpenNotifications={() => setShowNotifications(true)}
          setModal={setModal}
          currency={boot?.settings?.currency || "UGX"}
          onCurrencyChange={changeCurrency}
        />

        <div style={{ padding: "20px 24px 60px", maxWidth: 1180, margin: "0 auto" }}>
          {defaultPasswordWarning && (
            <Card style={{ marginBottom: 16, background: "#FFF6E2", border: "1px solid #E7D3A8" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ fontSize: 14.5, color: "#7A5A1E", lineHeight: 1.55, minWidth: 260, flex: 1 }}>
                  <b>You are still using the default administrator password.</b> Anyone who knows it can open this ledger. Change it before entering real borrower data.
                </div>
                <button style={Btn.primary} onClick={() => setModal({ type: "changePassword" })}>
                  Change password
                </button>
              </div>
            </Card>
          )}
          {boot?.migrationError && (
            <Card style={{ marginBottom: 16, background: C.rustSoft, border: "1px solid #E3C3BB" }}>
              <div style={{ fontSize: 14.5, color: C.rust }}>
                <b>Some old data could not be imported.</b> {boot.migrationError}. The original store file has been left untouched in the app's data folder.
              </div>
            </Card>
          )}
          {searchQ.trim().length > 0 ? (
            <SearchResults q={searchQ} goBorrower={goBorrower} goLoan={goLoan} clear={() => setSearchQ("")} version={version} />
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
              {safePage === "approvals" && role.manageUsers && <ApprovalsPage {...ctx} />}
            </>
          )}
        </div>
      </div>

      {modal && (
        <ModalRouter modal={modal} close={() => setModal(null)} {...ctx} />
      )}

      {showNotifications && (
        <NotificationsModal
          overdueLoans={boot?.alerts?.overdue || []}
          soonLoans={boot?.alerts?.soon || []}
          autoRenewedToday={boot?.alerts?.autoRenewedToday || []}
          close={() => setShowNotifications(false)}
          goLoan={goLoan}
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
  { id: "approvals", label: "Approvals", icon: CheckCircle2 },
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

function TopBar({ searchQ, setSearchQ, onOpenNav, onQuickAction, currentUser, onLogout, allowedPages, alertCount, onOpenNotifications, setModal, currency, onCurrencyChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [showCurrency, setShowCurrency] = useState(false);
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

      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          type="button"
          title="Change display currency"
          aria-label={`Change display currency (currently ${currency})`}
          onClick={() => setShowCurrency((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 11px",
            borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface,
            color: C.ink2, cursor: "pointer", fontFamily: "'Inter Tight', sans-serif",
            fontSize: 14.5, fontWeight: 600, letterSpacing: 0.1,
          }}
        >
          <Coins size={15} color={C.brassDark} />
          {currency}
          <ChevronDown size={12} color={C.ink3} />
        </button>
        {showCurrency && (
          <div style={{
            position: "absolute", right: 0, top: "115%", background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 10, boxShadow: "0 10px 30px rgba(31,42,36,0.16)", width: 258, zIndex: 50, overflow: "hidden"
          }}>
            <div style={{
              padding: "9px 14px", fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5,
              textTransform: "uppercase", color: C.ink3, borderBottom: `1px solid ${C.border}`, background: C.bg
            }}>
              Display currency
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }} className="lm-scroll">
              {CURRENCY_OPTIONS.map((c) => {
                const active = c.code === currency;
                return (
                  <div
                    key={c.code}
                    onClick={() => { setShowCurrency(false); if (!active) onCurrencyChange(c.code); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                      cursor: "pointer", background: active ? C.brassSoft : "transparent",
                      borderBottom: `1px solid ${C.border}`,
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.forestSoft; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: 42, ...displayFont, fontSize: 14, fontWeight: 700, color: active ? C.brassDark : C.forestDark }}>{c.code}</span>
                    <span style={{ flex: 1, fontSize: 14.5, color: C.ink2 }}>{c.name}</span>
                    {active && <CheckCircle2 size={15} color={C.brassDark} />}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "9px 14px", fontSize: 12.5, lineHeight: 1.45, color: C.ink3, background: C.bg }}>
              Changes the label on every figure. Existing amounts are not converted.
            </div>
          </div>
        )}
      </div>

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

const DEFAULT_INTEREST_RATE = 20;
const DEFAULT_PAPERWORK_FEE = 5000;

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

function Dashboard({ goBorrower, goLoan, setModal, setPage, version }) {
  const { loading, data, error } = useServerData(() => api().dashboard(), [version]);
  if (loading && !data) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!data) return null;

  const { totals, totalCosts, dueToday, overdue, recentPayments, recentLoans } = data;
  const netPosition = totals.totalCollected - totals.totalLent - totalCosts;

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
                title={l.borrowerName}
                sub={`${l.loanNumber} · ${fmt(l.remaining)} remaining`} />
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
                title={l.borrowerName}
                sub={`${l.loanNumber} · ${daysBetween(l.dueDate, todayISO())} days overdue`} />
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
                title={p.borrowerName}
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
                title={l.borrowerName}
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

function Borrowers({ goBorrower, setModal, t, version }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const [page, setPage] = usePageState();
  const { loading, data, error } = useServerData(
    () => api().borrowers.page({ page, q: search, limit: 50 }),
    [page, search, version]
  );
  useEffect(() => { setPage(1); }, [search]);

  const list = data?.items || [];

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "borrower" })}><Plus size={15} /> New Borrower</button>}>
        Borrowers
      </SectionTitle>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, phone, or national ID…"
        style={{ ...FieldStyle.input, marginBottom: 14, maxWidth: 380 }} />
      {loading && !data ? <LoadingCard /> : error ? <ErrorCard error={error} /> : list.length === 0 ? (
        <Card><EmptyState icon={Users} title="No borrowers yet" sub={search ? "No one matches that search." : "Register your first borrower to get started."} action={<button style={Btn.primary} onClick={() => setModal({ type: "borrower" })}><Plus size={15} /> New Borrower</button>} /></Card>
      ) : (
        <>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {list.map((b, i) => (
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
                    <span>{b.loanCount || 0} loan{(b.loanCount || 0) !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ ...numFont, fontWeight: 600, fontSize: 16, color: (b.outstanding || 0) > 0 ? C.rust : C.ink3 }}>{fmt(b.outstanding || 0)}</div>
                  <div style={{ fontSize: 13, color: C.ink4 }}>outstanding</div>
                </div>
              </div>
            ))}
          </Card>
          <Pager page={data.page} pageCount={data.pageCount} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function BorrowerDetail({ borrowerId, setPage, goLoan, setModal, t, update, showToast, role, currentUser, actor, boot, version }) {
  const [loanPage, setLoanPage] = usePageState();
  useEffect(() => { setLoanPage(1); }, [borrowerId]);
  const { loading, data, error } = useServerData(
    () => api().borrowers.get({ id: borrowerId, loanPage, loanLimit: 50 }),
    [borrowerId, loanPage, version]
  );
  if (loading && !data) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!data) return <EmptyState icon={Users} title="Borrower not found" />;

  const { borrower: b, summary, loans, collateral } = data;
  const outstanding = summary.outstanding;
  const outstandingNoInterest = summary.outstandingNoInterest;

  const markPaid = async (l) => {
    if (!window.confirm(`Mark ${l.loanNumber} as fully paid? This records a payment of ${fmt(l.outstanding)} to close it out.`)) return;
    const result = await api().loans.markPaid({ actor, id: l.id });
    if (!result?.ok) return showToast(result?.error || "Could not mark this loan as paid.");
    showToast("Loan marked as fully paid.");
    update();
  };

  const exportBorrower = async (kind) => {
    try {
      const statement = await api().borrowers.statement({ id: b.id });
      if (!statement) return;
      if (kind === "print") printHTMLAsPDF(borrowerRecordHTML(boot?.settings?.businessName || "Ledger", statement));
      else downloadBorrowerRecordCSV(boot?.settings?.businessName || "Ledger", statement);
    } catch (e) {
      showToast(e.message || "Could not build that file.");
    }
  };

  return (
    <div>
      <button style={Btn.ghost} onClick={() => setPage("borrowers")}><ArrowLeft size={14} /> All borrowers</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, margin: "10px 0 16px" }}>
        <div>
          <h1 style={{ ...displayFont, fontSize: 28, margin: 0, fontWeight: 600 }}>{b.fullName}</h1>
          <div style={{ color: C.ink3, fontSize: 15, marginTop: 4 }}>Registered {b.dateRegistered} · {summary.loanCount} loan{summary.loanCount !== 1 ? "s" : ""} on record</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={Btn.secondary} onClick={() => exportBorrower("print")}><FileType size={13} /> Print</button>
          <button style={Btn.secondary} onClick={() => exportBorrower("csv")}><Download size={13} /> Download CSV</button>
          <button style={Btn.secondary} onClick={() => setModal({ type: "borrower", payload: b })}><Edit2 size={13} /> Edit profile</button>
          <button style={Btn.primary} onClick={() => setModal({ type: "loan", payload: { borrowerId: b.id } })}><Plus size={13} /> New loan</button>
          <button style={Btn.danger} onClick={() => confirmOrRequestDelete({
            role, currentUser, update, showToast, setModal, actor,
            entityType: "borrower", entityId: b.id, entityLabel: `borrower "${b.fullName}"`,
            title: "Delete borrower permanently",
            message: `Permanently delete "${b.fullName}"? This will also delete their ${summary.loanCount} loan${summary.loanCount !== 1 ? "s" : ""}, ${summary.paymentCount} payment${summary.paymentCount !== 1 ? "s" : ""}, and ${summary.collateralCount} collateral record${summary.collateralCount !== 1 ? "s" : ""}. This cannot be undone.`,
            onDeleted: () => setPage("borrowers"),
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
            <>
              <Card style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
                {loans.map((l, i) => {
                  const st = l.status;
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
                          <button style={{ ...Btn.ghost, padding: "5px 8px", fontSize: 13, color: C.forestDark }} onClick={(e) => { e.stopPropagation(); markPaid(l); }}>
                            <CheckCircle2 size={12} /> Mark as Paid
                          </button>
                        )}
                        <StampBadge status={st} />
                      </div>
                    </div>
                  );
                })}
              </Card>
              <Pager page={data.loanPage} pageCount={data.loanPageCount} total={data.loanTotal} onPage={setLoanPage} />
            </>
          )}

          <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, margin: "14px 0 10px" }}>Collateral on file</div>
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

const GROUP_OPTIONS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

/* --------------------------------- external funding --------------------------------- */

const FUND_TYPES = ["External Loan", "Bank"];

function Loans({ goLoan, setModal, update, showToast, actor, version }) {
  const [filter, setFilter] = useState("All");
  const [groupBy, setGroupBy] = useState("month");
  const [selectedKey, setSelectedKey] = useState(null);
  const [page, setPage] = usePageState();
  const scrollRef = useRef(null);
  const { loading, data, error } = useServerData(
    () => api().loans.page({ filter, groupBy, groupKey: selectedKey, page, limit: 50 }),
    [filter, groupBy, selectedKey, page, version]
  );
  useEffect(() => { setSelectedKey(null); setPage(1); }, [filter, groupBy]);
  useEffect(() => { setPage(1); }, [selectedKey]);

  const groups = data?.groups || [];
  const activeGroup = groups.find((g) => g.key === data?.groupKey);

  const scrollBy = (dir) => {
    if (scrollRef.current) scrollRef.current.scrollBy({ left: dir * 240, behavior: "smooth" });
  };

  const markPaid = async (l) => {
    if (!window.confirm(`Mark ${l.loanNumber} as fully paid? This records a payment of ${fmt(l.outstanding)} to close it out.`)) return;
    const result = await api().loans.markPaid({ actor, id: l.id });
    if (!result?.ok) return showToast(result?.error || "Could not mark this loan as paid.");
    showToast("Loan marked as fully paid.");
    update();
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
          <div key={g.id} onClick={() => setGroupBy(g.id)} style={{
            padding: "5px 12px", borderRadius: 20, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
            background: groupBy === g.id ? C.brassDark : C.surface, color: groupBy === g.id ? "#fff" : C.ink2,
            border: `1px solid ${groupBy === g.id ? C.brassDark : C.border}`
          }}>{g.label}</div>
        ))}
      </div>

      {loading && !data ? <LoadingCard /> : error ? <ErrorCard error={error} /> : groups.length === 0 ? <Card><EmptyState icon={Wallet} title="No loans found" /></Card> : (
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
              {groups.map((group) => {
                const isActive = group.key === data.groupKey;
                return (
                  <div key={group.key} onClick={() => setSelectedKey(group.key)} style={{
                    flex: "0 0 auto", scrollSnapAlign: "start", width: 190, borderRadius: 12, padding: 14, cursor: "pointer",
                    background: isActive ? C.forest : C.surface, border: `1px solid ${isActive ? C.forest : C.border}`,
                    boxShadow: isActive ? "0 6px 18px rgba(46,74,50,0.25)" : "none", transition: "background .15s, box-shadow .15s"
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: isActive ? "#fff" : C.ink, ...displayFont, lineHeight: 1.25, minHeight: 36 }}>{group.label}</div>
                    <div style={{ fontSize: 12.5, color: isActive ? "#D8E3D2" : C.ink3, marginTop: 6 }}>{group.count} loan{group.count !== 1 ? "s" : ""}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${isActive ? "rgba(255,255,255,0.2)" : C.border}` }}>
                      <div>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Lent</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : C.ink }}>{fmt(group.totalPrincipal)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Owed</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : (group.totalOutstanding > 0 ? C.rust : C.ink) }}>{fmt(group.totalOutstanding)}</div>
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
            <>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, background: C.forestSoft, fontWeight: 700, fontSize: 14.5, color: C.forestDark }}>
                  {activeGroup.label}
                </div>
                {data.items.map((l, i) => {
                  const st = l.status;
                  const canMarkPaid = st === "Active" || st === "Overdue";
                  return (
                    <div key={l.id} onClick={() => goLoan(l.id)} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px",
                      borderBottom: i < data.items.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer"
                    }}
                      onMouseEnter={(e) => e.currentTarget.style.background = C.forestSoft}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 16, ...numFont }}>{l.loanNumber}</div>
                        <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 2 }}>{l.borrowerName || "Unknown borrower"} · issued {l.issueDate} · due {l.dueDate}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ ...numFont, fontWeight: 600, fontSize: 16 }}>{fmt(l.outstanding)}</div>
                          <div style={{ fontSize: 13, color: C.ink4 }}>remaining</div>
                        </div>
                        {canMarkPaid && (
                          <button style={{ ...Btn.ghost, padding: "5px 8px", fontSize: 13, color: C.forestDark }} onClick={(e) => {
                            e.stopPropagation();
                            markPaid(l);
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
              <Pager page={data.page} pageCount={data.pageCount} total={data.total} onPage={setPage} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function LoanDetail({ loanId, setPage, update, showToast, setModal, goBorrower, goLoan, t, role, currentUser, actor, boot, version }) {
  const { loading, data, error } = useServerData(
    () => api().loans.get({ id: loanId, paymentLimit: 1000 }),
    [loanId, version]
  );
  if (loading && !data) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!data) return <EmptyState icon={Wallet} title="Loan not found" />;

  const { loan: l, borrower, payments, paymentCount, paymentsTruncated, collateral } = data;
  const paid = l.paidAmount;
  const outstanding = l.outstanding;
  const outstandingNoInterest = l.outstandingNoInterest;
  const st = l.status;
  const nextDue = l.nextDueDate;

  const voidLoan = async () => {
    const reason = prompt("Reason for voiding this loan (required):");
    if (!reason) return;
    const result = await api().loans.voidLoan({ actor, id: l.id, reason });
    if (!result?.ok) return showToast(result?.error || "Could not void this loan.");
    showToast("Loan voided and kept in history.");
    update();
  };

  const markPaid = async () => {
    if (!window.confirm(`Mark ${l.loanNumber} as fully paid? This records a payment of ${fmt(outstanding)} to close it out.`)) return;
    const result = await api().loans.markPaid({ actor, id: l.id });
    if (!result?.ok) return showToast(result?.error || "Could not mark this loan as paid.");
    showToast("Loan marked as fully paid.");
    update();
  };

  const releaseCollateral = async (c) => {
    if (!window.confirm(`Mark "${c.description}" as collected by the borrower?`)) return;
    const result = await api().collateral.release({ actor, id: c.id });
    if (!result?.ok) return showToast(result?.error || "Could not update this collateral.");
    showToast("Collateral marked as paid / collected.");
    update();
  };

  const exportLoan = async (kind) => {
    try {
      const full = await api().loans.get({ id: l.id, paymentLimit: 5000 });
      if (!full) return;
      if (kind === "print") printHTMLAsPDF(loanRecordHTML(boot?.settings?.businessName || "Ledger", full));
      else downloadLoanRecordCSV(boot?.settings?.businessName || "Ledger", full);
    } catch (e) {
      showToast(e.message || "Could not build that file.");
    }
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
          <div onClick={() => goBorrower(l.borrowerId)} style={{ color: C.forest, fontSize: 15.5, marginTop: 5, cursor: "pointer", fontWeight: 600 }}>{borrower?.fullName} →</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <button style={Btn.secondary} onClick={() => exportLoan("print")}><FileType size={13} /> Print</button>
          <button style={Btn.secondary} onClick={() => exportLoan("csv")}><Download size={13} /> Download CSV</button>
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
          <button style={Btn.danger} onClick={() => confirmOrRequestDelete({
            role, currentUser, update, showToast, setModal, actor,
            entityType: "loan", entityId: l.id, entityLabel: `loan ${l.loanNumber}`,
            title: "Delete loan permanently",
            message: `Permanently delete loan ${l.loanNumber} for ${borrower?.fullName}? This will also permanently delete its ${paymentCount} payment${paymentCount !== 1 ? "s" : ""} and ${data.collateralCount} collateral record${data.collateralCount !== 1 ? "s" : ""}. This cannot be undone and is different from Void, which keeps history. Consider Void instead unless this loan was created by mistake.`,
            onDeleted: () => setPage("loans"),
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
            {l.renewedIntoId && <span style={{ color: "#5A4A8C", cursor: "pointer", fontWeight: 700, marginLeft: 6 }} onClick={() => goLoan(l.renewedIntoId)}>View the new loan →</span>}
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
            ...(l.repaymentMethod === "Instalments" && l.instalments ? [
              ["Instalments", `${l.instalments.count} × ${fmt(l.instalments.expectedAmount)}`],
              ["Frequency", l.instalments.frequency],
              ["First payment", l.instalments.firstPaymentDate],
              ...(st !== "Fully Paid" ? [["Next payment due", nextDue]] : []),
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
                    <button style={{ ...Btn.ghost, padding: "4px 6px", fontSize: 13.5 }} onClick={() => releaseCollateral(c)}><PackageCheck size={13} /> Mark as Paid</button>
                  )}
                  <button style={{ ...Btn.ghost, padding: "4px 6px", fontSize: 13.5 }} onClick={() => setModal({ type: "collateral", payload: { existing: c } })}><Edit2 size={13} /></button>
                  <button style={{ ...Btn.ghost, padding: "4px 6px", fontSize: 13.5, color: C.rust }} onClick={() => confirmOrRequestDelete({
                    role, currentUser, update, showToast, setModal, actor,
                    entityType: "collateral", entityId: c.id, entityLabel: `collateral "${c.description}"`,
                    title: "Delete collateral record",
                    message: `Permanently delete "${c.description}" from this loan? This cannot be undone.`,
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
                    <button style={{ ...Btn.ghost, padding: "4px 6px", color: C.rust }} onClick={() => confirmOrRequestDelete({
                      role, currentUser, update, showToast, setModal, actor,
                      entityType: "payment", entityId: p.id, entityLabel: `payment of ${fmt(p.amount)} on loan ${l.loanNumber}`,
                      title: "Delete payment",
                      message: `Permanently delete this payment of ${fmt(p.amount)} on ${p.date}? This will increase the loan's outstanding balance. This cannot be undone.`,
                    })}><Ban size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
            {paymentsTruncated && (
              <div style={{ padding: "10px 16px", fontSize: 13.5, color: C.ink3, background: C.bg }}>
                Showing the latest {payments.length} of {paymentCount} payments. The printed statement includes the most recent 5,000.
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- payments --------------------------------- */

function Payments({ update, showToast, goLoan, setModal, role, currentUser, actor, version }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const [page, setPage] = usePageState();
  const { loading, data, error } = useServerData(
    () => api().payments.page({ page, q: search, limit: 50 }),
    [page, search, version]
  );
  useEffect(() => { setPage(1); }, [search]);
  const list = data?.items || [];

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "payment" })}><Plus size={15} /> Record Payment</button>}>Payments</SectionTitle>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by borrower, loan number, or reference…"
        style={{ ...FieldStyle.input, marginBottom: 14, maxWidth: 400 }} />
      {loading && !data ? <LoadingCard /> : error ? <ErrorCard error={error} /> : list.length === 0 ? <Card><EmptyState icon={CreditCard} title="No payments recorded yet" sub={search ? "No payments match that search." : undefined} /></Card> : (
        <>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {list.map((p, i) => {
              const loan = { loanNumber: p.loanNumber };
              return (
                <div key={p.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px",
                  borderBottom: i < list.length - 1 ? `1px solid ${C.border}` : "none", opacity: p.voided ? 0.5 : 1
                }}>
                  <div onClick={() => goLoan(p.loanId)} style={{ cursor: "pointer", flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{p.borrowerName || "Unknown borrower"}</div>
                    <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 2 }}>{loan.loanNumber} · {p.date} · {p.method}{p.voided ? " · VOIDED" : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ ...numFont, fontWeight: 700, fontSize: 17 }}>{fmt(p.amount)}</div>
                    <div style={{ display: "flex", gap: 2 }}>
                      <button style={{ ...Btn.ghost, padding: "5px 7px" }} onClick={() => setModal({ type: "payment", payload: { existing: p } })}><Edit2 size={13} /></button>
                      <button style={{ ...Btn.ghost, padding: "5px 7px", color: C.rust }} onClick={() => confirmOrRequestDelete({
                        role, currentUser, update, showToast, setModal, actor,
                        entityType: "payment", entityId: p.id, entityLabel: `payment of ${fmt(p.amount)}${loan.loanNumber ? ` on loan ${loan.loanNumber}` : ""}`,
                        title: "Delete payment",
                        message: `Permanently delete this payment of ${fmt(p.amount)}${loan.loanNumber ? ` on loan ${loan.loanNumber}` : ""}? This will increase the loan's outstanding balance. This cannot be undone.`,
                      })}><Ban size={13} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
          <Pager page={data.page} pageCount={data.pageCount} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/* -------------------------------- collateral --------------------------------- */

function Collateral({ update, showToast, setModal, goLoan, role, currentUser, actor, version }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const [page, setPage] = usePageState();
  const { loading, data, error } = useServerData(
    () => api().collateral.page({ page, q: search, limit: 40 }),
    [page, search, version]
  );
  useEffect(() => { setPage(1); }, [search]);
  const list = data?.items || [];

  const markCollected = async (c, e) => {
    e.stopPropagation();
    if (!window.confirm(`Mark "${c.description}" as collected by the borrower?`)) return;
    const result = await api().collateral.release({ actor, id: c.id });
    if (!result?.ok) return showToast(result?.error || "Could not update this collateral.");
    showToast("Collateral marked as paid / collected.");
    update();
  };

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "collateral" })}><Plus size={15} /> Add Collateral</button>}>Security / Collateral</SectionTitle>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, borrower, or loan number…"
        style={{ ...FieldStyle.input, marginBottom: 14, maxWidth: 400 }} />
      {loading && !data ? <LoadingCard /> : error ? <ErrorCard error={error} /> : list.length === 0 ? <Card><EmptyState icon={Lock} title="No collateral recorded" sub={search ? "Nothing matches that search." : undefined} /></Card> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            {list.map((c) => (
              <Card key={c.id}>
                <div onClick={() => c.loanId && goLoan(c.loanId)} style={{ cursor: c.loanId ? "pointer" : "default" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{c.description}</div>
                    <StampBadge status={c.status} />
                  </div>
                  <div style={{ fontSize: 14.5, color: C.ink3, marginTop: 4 }}>{c.category}{c.brand ? ` · ${c.brand}` : ""}{c.model ? ` ${c.model}` : ""}</div>
                  <div style={{ fontSize: 14.5, color: C.ink3 }}>Borrower: {c.borrowerName || "Unknown"}{c.loanNumber ? ` · ${c.loanNumber}` : ""}</div>
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
                    confirmOrRequestDelete({
                      role, currentUser, update, showToast, setModal, actor,
                      entityType: "collateral", entityId: c.id, entityLabel: `collateral "${c.description}"`,
                      title: "Delete collateral record",
                      message: `Permanently delete "${c.description}" from this loan's collateral? This cannot be undone.`,
                    });
                  }}>
                    <Ban size={13} /> Delete
                  </button>
                </div>
              </Card>
            ))}
          </div>
          <Pager page={data.page} pageCount={data.pageCount} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/* --------------------------------- expenses --------------------------------- */

function Expenses({ update, showToast, setModal, role, currentUser, actor, version }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const [page, setPage] = usePageState();
  const [showAllDays, setShowAllDays] = useState(false);
  useEffect(() => { setPage(1); }, [search]);
  const { loading, data, error } = useServerData(
    () => api().expenses.page({ page, q: search, limit: 50 }),
    [page, search, version]
  );
  const balancesState = useServerData(
    () => api().expenses.balances({ limit: showAllDays ? 4000 : 14 }),
    [showAllDays, version]
  );
  const list = data?.items || [];
  const balances = balancesState.data?.days || [];
  const totalDays = balancesState.data?.totalDays || 0;

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "expense" })}><Plus size={15} /> Record Expense</button>}>Operational Costs</SectionTitle>
      <Card style={{ marginBottom: 20, maxWidth: 320 }}>
        <div style={{ fontSize: 14.5, color: C.ink3, fontWeight: 600 }}>Total operational costs</div>
        <div style={{ ...numFont, fontSize: 26, fontWeight: 700, marginTop: 4, color: C.rust }}>{fmt(data?.totalAmount || 0)}</div>
      </Card>

      <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 4 }}>Daily cash balance</div>
      <div style={{ fontSize: 14, color: C.ink3, marginBottom: 12 }}>
        Opening balance carries over from the day before. It moves every time a loan is given out, a borrower pays, or a cost is recorded. Set the starting figure in Settings.
      </div>
      {balancesState.loading && !balancesState.data ? <LoadingCard /> : balances.length === 0 ? (
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
          {balances.map((row) => (
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
          {totalDays > 14 && (
            <div onClick={() => setShowAllDays((v) => !v)} style={{
              textAlign: "center", padding: "11px", fontSize: 14, fontWeight: 600, color: C.forest,
              cursor: "pointer", borderTop: `1px solid ${C.border}`
            }}>
              {showAllDays ? "Show fewer days" : `Show all ${totalDays} days`}
            </div>
          )}
        </Card>
      )}

      <div style={{ fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>Expense log</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description, category, or method…"
        style={{ ...FieldStyle.input, marginBottom: 14, maxWidth: 400 }} />
      {loading && !data ? <LoadingCard /> : error ? <ErrorCard error={error} /> : list.length === 0 ? <Card><EmptyState icon={TrendingDown} title="No expenses recorded yet" sub={search ? "Nothing matches that search." : undefined} /></Card> : (
        <>
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
                    <button style={{ ...Btn.ghost, padding: "5px 7px", color: C.rust }} onClick={() => confirmOrRequestDelete({
                      role, currentUser, update, showToast, setModal, actor,
                      entityType: "expense", entityId: e.id, entityLabel: `expense "${e.description}" (${fmt(e.amount)})`,
                      title: "Delete expense",
                      message: `Permanently delete the "${e.description}" expense of ${fmt(e.amount)}? This cannot be undone.`,
                    })}><Ban size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </Card>
          <Pager page={data.page} pageCount={data.pageCount} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/* --------------------------------- external funding page --------------------------------- */

function ExternalFunding({ setModal, update, showToast, role, currentUser, actor, version }) {
  const [groupBy, setGroupBy] = useState("month");
  const [selectedKey, setSelectedKey] = useState(null);
  const scrollRef = useRef(null);
  const overviewState = useServerData(() => api().funding.overview({ groupBy }), [groupBy, version]);
  const groups = overviewState.data?.groups || [];
  const activeKey = selectedKey && groups.some((g) => g.key === selectedKey) ? selectedKey : groups[0]?.key;
  const eventsState = useServerData(
    () => (activeKey ? api().funding.events({ groupBy, groupKey: activeKey }) : Promise.resolve({ events: [], truncated: false })),
    [groupBy, activeKey, version]
  );
  const activeGroup = groups.find((g) => g.key === activeKey);
  const events = eventsState.data?.events || [];

  const scrollBy = (dir) => { if (scrollRef.current) scrollRef.current.scrollBy({ left: dir * 240, behavior: "smooth" }); };

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
          <div style={{ ...numFont, fontSize: 21, fontWeight: 700, marginTop: 5, color: (overviewState.data?.externalOutstanding || 0) > 0 ? C.rust : C.ink }}>{fmt(overviewState.data?.externalOutstanding || 0)}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 13, color: C.ink3, fontWeight: 600 }}>Bank funds outstanding</div>
          <div style={{ ...numFont, fontSize: 21, fontWeight: 700, marginTop: 5, color: (overviewState.data?.bankOutstanding || 0) > 0 ? C.rust : C.ink }}>{fmt(overviewState.data?.bankOutstanding || 0)}</div>
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

      {overviewState.loading && !overviewState.data ? <LoadingCard /> : overviewState.error ? <ErrorCard error={overviewState.error} /> : groups.length === 0 ? (
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
              {groups.map((group) => {
                const isActive = group.key === activeKey;
                return (
                  <div key={group.key} onClick={() => setSelectedKey(group.key)} style={{
                    flex: "0 0 auto", scrollSnapAlign: "start", width: 190, borderRadius: 12, padding: 14, cursor: "pointer",
                    background: isActive ? C.forest : C.surface, border: `1px solid ${isActive ? C.forest : C.border}`,
                    boxShadow: isActive ? "0 6px 18px rgba(46,74,50,0.25)" : "none", transition: "background .15s, box-shadow .15s"
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: isActive ? "#fff" : C.ink, ...displayFont, lineHeight: 1.25, minHeight: 36 }}>{group.label}</div>
                    <div style={{ fontSize: 12.5, color: isActive ? "#D8E3D2" : C.ink3, marginTop: 6 }}>{group.count} entr{group.count !== 1 ? "ies" : "y"}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${isActive ? "rgba(255,255,255,0.2)" : C.border}` }}>
                      <div>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Received</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : C.ink }}>{fmt(group.received)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: isActive ? "#D8E3D2" : C.ink4 }}>Paid</div>
                        <div style={{ ...numFont, fontSize: 13, fontWeight: 700, color: isActive ? "#fff" : C.ink }}>{fmt(group.paid)}</div>
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
              {eventsState.loading && !eventsState.data ? <LoadingCard /> : (
                <>
                  <FundGroupSection title="External loans received" icon={ArrowDownCircle} tone="forest" setModal={setModal} update={update} showToast={showToast} role={role} currentUser={currentUser} actor={actor}
                    events={events.filter((e) => e.type === "External Loan" && e.kind === "received")} kind="received" />
                  <FundGroupSection title="External loans paid" icon={ArrowUpCircle} tone="rust" setModal={setModal} update={update} showToast={showToast} role={role} currentUser={currentUser} actor={actor}
                    events={events.filter((e) => e.type === "External Loan" && e.kind === "paid")} kind="paid" />
                  <FundGroupSection title="Money from the bank" icon={ArrowDownCircle} tone="forest" setModal={setModal} update={update} showToast={showToast} role={role} currentUser={currentUser} actor={actor}
                    events={events.filter((e) => e.type === "Bank" && e.kind === "received")} kind="received" />
                  <FundGroupSection title="Money from the bank paid" icon={ArrowUpCircle} tone="rust" setModal={setModal} update={update} showToast={showToast} role={role} currentUser={currentUser} actor={actor}
                    events={events.filter((e) => e.type === "Bank" && e.kind === "paid")} kind="paid" />
                  {eventsState.data?.truncated && (
                    <div style={{ fontSize: 13.5, color: C.ink3 }}>Showing the most recent entries in this period.</div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FundGroupSection({ title, icon: Icon, tone, events, setModal, update, showToast, role, currentUser, actor }) {
  const total = events.reduce((s, e) => s + e.amount, 0);

  const editEvent = (e) => {
    if (e.kind === "received") setModal({ type: "fundReceived", payload: e.fund });
    else setModal({ type: "fundRepayment", payload: { existing: e.repayment } });
  };

  const deleteEvent = (e) => {
    if (e.kind === "received") {
      confirmOrRequestDelete({
        role, currentUser, update, showToast, setModal, actor,
        entityType: "fund", entityId: e.fund.id, entityLabel: `funding record from "${e.fund.source}" (${fmt(e.amount)})`,
        title: "Delete funding record",
        message: `Permanently delete the ${fmt(e.amount)} received from "${e.fund.source}"? Any repayments recorded against it will remain but no longer be linked to a source. This cannot be undone.`,
      });
    } else {
      confirmOrRequestDelete({
        role, currentUser, update, showToast, setModal, actor,
        entityType: "fundRepayment", entityId: e.repayment.id, entityLabel: `repayment of ${fmt(e.amount)} to "${e.fund.source}"`,
        title: "Delete repayment",
        message: `Permanently delete this repayment of ${fmt(e.amount)} to "${e.fund.source}"? This cannot be undone.`,
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

function loanRecordHTML(businessName, record) {
  const { loan, borrower, payments, collateral } = record;
  const outstanding = loan.outstanding;
  const outstandingNoInterest = loan.outstandingNoInterest;
  const status = loan.status || "";

  return `<!doctype html><html><head><title>Loan ${escapeHtml(loan.loanNumber)}</title><style>${RECORD_STYLE}</style></head><body>
    <h1>${escapeHtml(businessName)}</h1>
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

function downloadLoanRecordCSV(businessName, record) {
  const { loan, borrower, payments, collateral } = record;
  const outstanding = loan.outstanding;
  const outstandingNoInterest = loan.outstandingNoInterest;

  const rows = [];
  rows.push([businessName]);
  rows.push([`Loan record for ${loan.loanNumber}, printed ${new Date().toLocaleString()}`]);
  rows.push([]);
  rows.push(["Borrower", borrower?.fullName || "Unknown"]);
  rows.push(["Phone", borrower?.phone || ""]);
  rows.push(["National ID", borrower?.nationalId || ""]);
  rows.push(["Status", loan.status || ""]);
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

function borrowerRecordHTML(businessName, statement) {
  const { borrower, loans, collateral, payments, summary } = statement;
  const outstanding = summary.outstanding;
  const outstandingNoInterest = summary.outstandingNoInterest;

  return `<!doctype html><html><head><title>${escapeHtml(borrower.fullName)} history</title><style>${RECORD_STYLE}</style></head><body>
    <h1>${escapeHtml(businessName)}</h1>
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
        loans.map((l) => `<tr><td>${escapeHtml(l.loanNumber)}</td><td>${escapeHtml(l.issueDate)}</td><td>${escapeHtml(l.dueDate)}</td><td>${escapeHtml(fmt(l.amount))}</td><td>${escapeHtml(fmt(l.totalPayable))}</td><td>${escapeHtml(l.status || "")}</td></tr>`).join("")}
    </table>
    <h2>Security / collateral</h2>
    <table><tr><th>Description</th><th>Category</th><th>Value</th><th>Status</th></tr>
      ${collateral.length === 0 ? `<tr><td colspan="4">None recorded</td></tr>` :
        collateral.map((c) => `<tr><td>${escapeHtml(c.description)}</td><td>${escapeHtml(c.category)}</td><td>${escapeHtml(fmt(c.estimatedValue))}</td><td>${escapeHtml(c.status)}</td></tr>`).join("")}
    </table>
    <h2>Payment history</h2>
    <table><tr><th>Date</th><th>Loan</th><th>Method</th><th>Total</th></tr>
      ${payments.length === 0 ? `<tr><td colspan="4">No payments recorded</td></tr>` :
        payments.map((p) => `<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(p.loanNumber || "")}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(fmt(p.amount))}</td></tr>`).join("")}
    </table>
  </body></html>`;
}

function downloadBorrowerRecordCSV(businessName, statement) {
  const { borrower, loans, collateral, payments, summary } = statement;
  const outstanding = summary.outstanding;
  const outstandingNoInterest = summary.outstandingNoInterest;

  const rows = [];
  rows.push([businessName]);
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
  loans.forEach((l) => rows.push([l.loanNumber, l.issueDate, l.dueDate, fmt(l.amount), fmt(l.totalPayable), l.status || ""]));
  rows.push([]);
  rows.push(["Security / collateral"]);
  rows.push(["Description", "Category", "Value", "Status"]);
  collateral.forEach((c) => rows.push([c.description, c.category, fmt(c.estimatedValue), c.status]));
  rows.push([]);
  rows.push(["Payment history"]);
  rows.push(["Date", "Loan", "Method", "Total"]);
  payments.forEach((p) => rows.push([p.date, p.loanNumber || "", p.method, fmt(p.amount)]));

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadBlob(csv, "text/csv;charset=utf-8;", `borrower-${borrower.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`);
}

function Reports({ boot, version }) {
  const { loading, data, error } = useServerData(() => api().reports.summary(), [version]);
  if (loading && !data) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!data) return null;

  const businessName = boot?.settings?.businessName || "Ledger";
  const totals = data;
  const totalCosts = totals.totalCosts;
  const netPosition = totals.netPosition;
  const categoryRows = totals.categoryRows || [];

  const summaryCards = [
    ["Borrowers on file", totals.borrowerCount],
    ["Loans issued", totals.loanCount],
    ["Loans fully paid", totals.fullyPaid],
    ["Overdue loans", totals.overdueCount],
    ["Total lent", fmt(totals.totalLent)],
    ["Total collected", fmt(totals.totalCollected)],
    ["Outstanding balance", fmt(totals.outstanding)],
    ["Operational costs", fmt(totalCosts)],
  ];
  const summaryExportRows = [...summaryCards, ["Net position", (netPosition >= 0 ? "+" : "-") + fmt(Math.abs(netPosition))]];

  const reportFileBase = `report-${businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${todayISO()}`;

  const downloadCSV = () => {
    const rows = [];
    rows.push([businessName]);
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
    const html = `<!doctype html><html><head><title>${escapeHtml(businessName)} report</title>
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
      <h1>${escapeHtml(businessName)}</h1>
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
                <div style={{ height: "100%", width: `${Math.min(100, totalCosts > 0 ? (amt / totalCosts) * 100 : 0)}%`, background: C.brass }} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* --------------------------------- settings --------------------------------- */

function SettingsPage({ boot, update, showToast, t, actor }) {
  const settings = boot?.settings || {};
  const [name, setName] = useState(settings.businessName || "My Lending Business");
  const [startingBalance, setStartingBalance] = useState(String(settings.startingCashBalance ?? 0));
  const [saving, setSaving] = useState(false);
  const [backupInfo, setBackupInfo] = useState(null);
  const [busy, setBusy] = useState("");

  const loadBackupInfo = useCallback(async () => {
    try {
      setBackupInfo(await window.ledger.backup.info());
    } catch (e) {
      /* the backup panel just stays empty if the main process can't report */
    }
  }, []);

  useEffect(() => { loadBackupInfo(); }, [loadBackupInfo]);

  const saveSettings = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await api().settingsUpdate({
        actor,
        settings: { businessName: name, startingCashBalance: Number(startingBalance) || 0 },
      });
      if (!result?.ok) return showToast(result?.error || "Could not save settings.");
      showToast("Settings saved.");
      update();
    } catch (e) {
      showToast(e.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const exportData = async () => {
    if (busy) return;
    setBusy("export");
    try {
      const result = await window.ledger.backup.exportFile();
      if (result?.canceled) return;
      if (!result?.ok) return showToast(result?.error || "Could not create that backup.");
      showToast("Backup saved.");
      loadBackupInfo();
    } catch (e) {
      showToast(e.message || "Could not create that backup.");
    } finally {
      setBusy("");
    }
  };

  const backupNow = async () => {
    if (busy) return;
    setBusy("now");
    try {
      const result = await window.ledger.backup.now();
      if (!result?.ok) return showToast(result?.error || "Could not create a recovery point.");
      showToast("Recovery point created.");
      loadBackupInfo();
    } catch (e) {
      showToast(e.message || "Could not create a recovery point.");
    } finally {
      setBusy("");
    }
  };

  const restoreData = async () => {
    if (busy) return;
    if (!window.confirm("Restoring a backup REPLACES everything currently in Ledger with the contents of the file you choose. This cannot be undone. Continue?")) return;
    setBusy("restore");
    try {
      const result = await window.ledger.backup.restoreFile();
      if (result?.canceled) return;
      if (!result?.ok) return showToast(result?.error || "Could not restore that backup.");
      showToast("Backup restored. Reloading…");
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      showToast(e.message || "Could not restore that backup.");
    } finally {
      setBusy("");
    }
  };

  const lastBackup = backupInfo?.lastBackupAt
    ? new Date(backupInfo.lastBackupAt).toLocaleString()
    : "No automatic backup yet";

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
        <button style={{ ...Btn.primary, marginTop: 10, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={saveSettings}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </Card>

      <Card style={{ maxWidth: 520, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Backup &amp; restore</div>
        <div style={{ fontSize: 14, color: C.ink3, lineHeight: 1.55, marginBottom: 12 }}>
          Download a complete, portable copy of everything in Ledger (borrowers, loans, payments, users, settings) as one readable JSON file you control. This is also the right way to move Ledger to a new computer: the database on disk is encrypted to this computer, so copying it directly won't open elsewhere, but a backup file downloaded here will restore anywhere.
        </div>
        <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", fontSize: 13.5, color: C.ink2, marginBottom: 12 }}>
          <div>Automatic recovery points: <b>{backupInfo?.files?.length ?? 0}</b></div>
          <div>Last backup: <b>{lastBackup}</b></div>
          {backupInfo?.backupsDir && <div style={{ marginTop: 4, wordBreak: "break-all", color: C.ink3 }}>{backupInfo.backupsDir}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={Btn.secondary} disabled={!!busy} onClick={exportData}><Download size={14} /> Download full backup</button>
          <button style={Btn.secondary} disabled={!!busy} onClick={backupNow}><RefreshCw size={14} /> Create recovery point</button>
          <button style={Btn.secondary} disabled={!!busy} onClick={restoreData}><RefreshCw size={14} /> Restore from backup file</button>
          <button style={Btn.ghost} onClick={() => window.ledger.backup.openFolder("backups")}>Open backups folder</button>
        </div>
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

function LedgerSeal({ size = 82 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label="Ledger">
      <defs>
        <radialGradient id="lgSealBg" cx="34%" cy="26%" r="86%">
          <stop offset="0%" stopColor="#FFFEF9" />
          <stop offset="58%" stopColor="#F8F1E1" />
          <stop offset="100%" stopColor="#EDE1C9" />
        </radialGradient>
        <linearGradient id="lgSealInk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2F5B3F" />
          <stop offset="55%" stopColor="#5C7A4A" />
          <stop offset="100%" stopColor="#B4863A" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="46" fill="url(#lgSealBg)" stroke="rgba(180,134,58,0.5)" strokeWidth="1.1" />
      <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(180,134,58,0.16)" strokeWidth="1" />
      <g fill="none" stroke="url(#lgSealInk)" strokeWidth="1.6" opacity="0.9">
        <ellipse cx="48" cy="48" rx="31" ry="13" />
        <ellipse cx="48" cy="48" rx="31" ry="13" transform="rotate(60 48 48)" />
        <ellipse cx="48" cy="48" rx="31" ry="13" transform="rotate(120 48 48)" />
      </g>
      <g fill="#B4863A">
        <circle cx="48" cy="48" r="3.6" />
        <circle cx="75.5" cy="33.5" r="2.3" opacity="0.9" />
        <circle cx="27" cy="63.5" r="1.9" opacity="0.75" />
        <circle cx="66" cy="70" r="1.5" opacity="0.65" />
      </g>
    </svg>
  );
}

/** The sign-in backdrop: the jar-of-coins photo shown whole across the top,
 *  a blurred mirror of its left edge filling the spare width, and the app's
 *  brass secondary colour across the bottom. */
function LoginBackdrop() {
  return (
    <div className="lg-backdrop" aria-hidden="true">
      <div className="lg-photo">
        <div className="lg-photo-wash" style={{ backgroundImage: `url(${loginHeroAmbient})` }} />
        <div className="lg-photo-strip">
          <img className="lg-photo-mirror" src={loginHeroMirror} alt="" draggable="false" />
          <img className="lg-photo-frame" src={loginHero} alt="" draggable="false" />
        </div>
      </div>
      <div className="lg-lower" />
    </div>
  );
}

function LoginScreen({ businessName, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (checking) return;
    if (!username.trim() || !password) {
      setError("Incorrect username or password.");
      return;
    }
    setChecking(true);
    try {
      const result = await api().auth.login({ username, password });
      if (!result?.ok) {
        setError(result?.error || "Incorrect username or password.");
        return;
      }
      setError("");
      onLogin(result.user, result);
    } catch (e) {
      setError(e.message || "Could not sign in.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="lg-page">
      <style>{`${FONT_IMPORT}
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; }
        .lg-page {
          position: relative; min-height: 100vh; width: 100%;
          display: flex; align-items: flex-start; justify-content: center;
          padding: clamp(30px, 6vh, 64px) 24px 48px;
          overflow: hidden;
          font-family: 'Inter Tight', sans-serif;
          background: ${C.brass};
        }
        .lg-backdrop { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }

        /* Upper 62%: the jar-of-coins photo shown whole, never cropped.
           A blurred copy of the same photo softly fills the spare width. */
        .lg-photo {
          position: absolute; top: 0; left: 0; right: 0; height: 62%;
          overflow: hidden;
          background: #0B2BB4;
        }
        .lg-photo-wash {
          position: absolute; inset: -4%;
          background-size: cover;
          background-position: center;
        }
        .lg-photo-strip {
          position: absolute; top: 0; right: 0; height: 100%;
          display: flex; align-items: stretch; flex-wrap: nowrap;
        }
        .lg-photo-strip img {
          display: block; height: 100%; width: auto; max-width: none; flex: 0 0 auto;
          user-select: none;
        }
        /* The mirror continues the photo's left edge into a soft, blurred
           backdrop. Its baked-in blur means the seam is invisible and the
           whole original photo stays visible, uncropped. */
        .lg-photo-mirror { pointer-events: none; }
        /* A gentle top shade for depth, and a warm edge into the brass. */
        .lg-photo::after {
          content: ''; position: absolute; inset: 0;
          background:
            linear-gradient(180deg, rgba(8, 20, 52, 0.16) 0%, rgba(8, 20, 52, 0) 26%),
            linear-gradient(180deg, rgba(180, 134, 58, 0) 90%, rgba(180, 134, 58, 0.22) 100%);
        }

        /* Lower 38%: the app's secondary colour, in a soft brass gradient. */
        .lg-lower {
          position: absolute; left: 0; right: 0; bottom: 0; height: 38%;
          background:
            radial-gradient(120% 85% at 50% 0%, rgba(255, 246, 218, 0.18) 0%, rgba(255, 246, 218, 0) 60%),
            linear-gradient(180deg, #C1964A 0%, #B4863A 38%, #A47A31 100%);
          box-shadow: inset 0 1px 0 rgba(255, 247, 222, 0.55);
        }
        /* Faint ledger ruling on the brass so the lower panel isn't flat. */
        .lg-lower::before {
          content: ''; position: absolute; inset: 0;
          background: repeating-linear-gradient(
            180deg,
            rgba(92, 64, 20, 0.07) 0px,
            rgba(92, 64, 20, 0.07) 1px,
            transparent 1px,
            transparent 34px
          );
          opacity: 0.5;
        }

        .lg-card {
          position: relative; z-index: 2;
          width: min(430px, 100%);
          padding: 32px 38px 30px;
          border-radius: 20px;
          background: rgba(255, 254, 250, 0.98);
          border: 1px solid rgba(180, 134, 58, 0.14);
          box-shadow:
            0 18px 45px rgba(3, 30, 18, 0.17),
            0 2px 8px rgba(3, 30, 18, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
          animation: lg-rise 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }
        .lg-card::before {
          content: ''; position: absolute; top: 0; left: 26px; right: 26px; height: 1.5px;
          border-radius: 2px;
          background: linear-gradient(90deg, transparent, #D9BD70 28%, #F3E2A8 50%, #D9BD70 72%, transparent);
          opacity: 0.45;
        }
        @keyframes lg-rise {
          from { opacity: 0; transform: translateY(14px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .lg-seal { display: flex; justify-content: center; margin: -2px 0 13px; filter: drop-shadow(0 4px 10px rgba(80, 60, 20, 0.12)); }
        .lg-title {
          margin: 0 0 28px; text-align: center;
          font-family: 'Inter Tight', sans-serif; font-size: 33px; line-height: 1;
          font-weight: 600; letter-spacing: -0.7px; color: #1D3B28;
        }
        .lg-field { margin-bottom: 17px; }
        .lg-field label {
          display: block; margin-bottom: 7px; text-align: center;
          font-size: 14.5px; font-weight: 600; letter-spacing: 0.1px; color: #1D3B28;
        }
        .lg-field input {
          width: 100%; height: 50px; padding: 0 14px;
          border: 1.5px solid #E7D7B2; border-radius: 9px;
          background: #FBF4E4; color: #1F2A1F;
          font-family: 'Inter Tight', sans-serif; font-size: 16px;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .lg-field input::placeholder { color: #A89C83; }
        .lg-field input:focus {
          outline: none; border-color: #C9A227; background: #FFFBF2;
          box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.18);
        }
        .lg-error {
          display: flex; align-items: flex-start; gap: 7px;
          margin: -3px 0 13px; padding: 9px 11px;
          border: 1px solid #ECCFC9; border-radius: 8px;
          background: #FBF0ED; color: #9A3427;
          font-size: 13.5px; line-height: 1.4;
        }
        .lg-submit {
          width: 100%; height: 50px; margin-top: 5px;
          border: none; border-radius: 9px; cursor: pointer;
          background: linear-gradient(180deg, #1E4A31 0%, #123A24 100%);
          color: #FFFFFF;
          font-family: 'Inter Tight', sans-serif; font-size: 16.5px; font-weight: 700; letter-spacing: 0.1px;
          box-shadow: 0 8px 18px rgba(18, 58, 36, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.12);
          transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
        }
        .lg-submit:hover:not(:disabled) {
          background: linear-gradient(180deg, #255B3D 0%, #16462B 100%);
          transform: translateY(-1px);
          box-shadow: 0 12px 24px rgba(18, 58, 36, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.14);
        }
        .lg-submit:active:not(:disabled) { transform: translateY(0); }
        .lg-submit:disabled { opacity: 0.72; cursor: default; }
        .lg-imprint {
          position: absolute; z-index: 2; left: 50%; bottom: 14px; transform: translateX(-50%);
          display: flex; align-items: center; gap: 9px; white-space: nowrap;
          font-size: 10px; font-weight: 600; letter-spacing: 1.7px; text-transform: uppercase;
          color: rgba(64, 43, 12, 0.62);
        }
        .lg-imprint b { font-weight: 700; color: rgba(48, 31, 6, 0.8); }
        .lg-imprint i { width: 3px; height: 3px; border-radius: 50%; background: rgba(255, 247, 224, 0.9); opacity: 0.9; }

        @media (max-width: 860px) {
          .lg-photo { height: 58%; }
          .lg-lower { height: 42%; }
        }
        @media (max-width: 520px) {
          .lg-page { padding: 22px 16px 44px; }
          .lg-card { padding: 27px 22px 25px; border-radius: 16px; }
          .lg-title { font-size: 30px; margin-bottom: 22px; }
          .lg-imprint { font-size: 9px; letter-spacing: 1.1px; }
        }
        @media (max-height: 760px) {
          .lg-page { padding-top: 22px; padding-bottom: 34px; }
          .lg-card { padding-top: 24px; padding-bottom: 22px; }
          .lg-seal svg { width: 66px; height: 66px; }
          .lg-seal { margin-bottom: 9px; }
          .lg-title { font-size: 30px; margin-bottom: 20px; }
          .lg-field { margin-bottom: 13px; }
          .lg-field input, .lg-submit { height: 46px; }
          .lg-imprint { bottom: 8px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lg-card { animation: none; }
          .lg-submit { transition: none; }
        }
      `}</style>

      <LoginBackdrop />

      <form
        className="lg-card"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        noValidate
      >
        <div className="lg-seal"><LedgerSeal /></div>
        <h1 className="lg-title">Ledger</h1>

        <div className="lg-field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>

        <div className="lg-field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <div className="lg-error" role="alert">
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="lg-submit" disabled={checking}>
          {checking ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="lg-imprint">
        <b>{businessName || "Ledger"}</b>
        <i />
        <span>Local · Encrypted · Offline</span>
      </div>
    </div>
  );
}

function UsersPage({ update, showToast, currentUser, setModal, role, actor, version }) {
  const { loading, data, error } = useServerData(() => api().users.list(), [version]);
  const users = data || [];

  const toggleActive = async (u) => {
    if (u.username === "admin") return showToast("The default administrator account can't be deactivated.");
    const result = await api().users.setActive({ actor, id: u.id, active: !u.active });
    if (!result?.ok) return showToast(result?.error || "Could not update this account.");
    showToast(u.active ? "User deactivated." : "User reactivated.");
    update();
  };

  const deleteUser = (u) => {
    if (u.username === "admin") return showToast("The default administrator account can't be deleted.");
    confirmOrRequestDelete({
      role, currentUser, update, showToast, setModal, actor,
      entityType: "user", entityId: u.id, entityLabel: `user account "${u.username}"`,
      title: "Delete user permanently",
      message: `Permanently delete the account "${u.username}" (${u.fullName})? This removes their login entirely. Consider Deactivate instead if you just want to revoke access while keeping the record. This cannot be undone.`,
    });
  };

  return (
    <div>
      <SectionTitle action={<button style={Btn.primary} onClick={() => setModal({ type: "user" })}><Plus size={15} /> Add User</button>}>Users</SectionTitle>
      <div style={{ fontSize: 14.5, color: C.ink3, marginBottom: 14, maxWidth: 620 }}>
        Add a login for each member of staff and choose what they're allowed to see and do. Deactivating revokes access while keeping the record and audit trail intact, use Delete only when you want the account gone entirely.
      </div>
      {loading && !data ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
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
      )}

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

function AuditLogPage({ version }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const [userFilter, setUserFilter] = useState("All");
  const [page, setPage] = usePageState();
  const { loading, data, error } = useServerData(
    () => api().audit.page({ page, q: search, user: userFilter, limit: 60 }),
    [page, search, userFilter, version]
  );
  useEffect(() => { setPage(1); }, [search, userFilter]);

  const log = data?.items || [];
  const usernames = ["All", ...(data?.usernames || [])];

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

      {loading && !data ? <LoadingCard /> : error ? <ErrorCard error={error} /> : log.length === 0 ? (
        <Card><EmptyState icon={History} title="No matching activity" sub="Actions taken across the system will appear here as they happen." /></Card>
      ) : (
        <>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {log.map((e, i) => {
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
          <Pager page={data.page} pageCount={data.pageCount} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function ApprovalsPage({ update, showToast, actor, version }) {
  const { loading, data, error } = useServerData(() => api().approvals.page(), [version]);
  const pending = data?.pending || [];
  const resolved = data?.resolved || [];

  const approve = async (req) => {
    if (!window.confirm(`Approve this deletion: ${req.entityLabel}? This will permanently delete it and cannot be undone.`)) return;
    const result = await api().approvals.approve({ actor, id: req.id });
    if (!result?.ok) return showToast(result?.error || "Could not approve this request.");
    showToast("Deletion approved and completed.");
    update();
  };

  const reject = async (req) => {
    const result = await api().approvals.reject({ actor, id: req.id });
    if (!result?.ok) return showToast(result?.error || "Could not reject this request.");
    showToast("Deletion request rejected. Nothing was deleted.");
    update();
  };

  if (loading && !data) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;

  return (
    <div>
      <SectionTitle>Approvals</SectionTitle>
      <div style={{ fontSize: 14.5, color: C.ink3, marginBottom: 18, maxWidth: 620 }}>
        Only administrators can delete records directly. When anyone else tries to delete something, it lands here as a request instead, nothing is removed until an administrator approves it.
      </div>

      <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>
        Pending {pending.length > 0 && `(${pending.length})`}
      </div>
      {pending.length === 0 ? (
        <Card style={{ marginBottom: 24 }}><EmptyState icon={CheckCircle2} title="Nothing waiting for approval" /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
          {pending.map((r, i) => (
            <div key={r.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px",
              borderBottom: i < pending.length - 1 ? `1px solid ${C.border}` : "none"
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16, textTransform: "capitalize" }}>{r.entityLabel}</div>
                <div style={{ fontSize: 14, color: C.ink3, marginTop: 2 }}>Requested by {r.requestedByName || r.requestedBy} · {formatTime(r.createdAt)} on {r.createdAt.slice(0, 10)}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={Btn.secondary} onClick={() => reject(r)}>Reject</button>
                <button style={Btn.danger} onClick={() => approve(r)}><Trash2 size={13} /> Approve delete</button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {resolved.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 14.5, textTransform: "uppercase", letterSpacing: 0.4, color: C.ink3, marginBottom: 10 }}>History</div>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {resolved.map((r, i) => (
              <div key={r.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px",
                borderBottom: i < resolved.length - 1 ? `1px solid ${C.border}` : "none", opacity: 0.75
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, textTransform: "capitalize" }}>{r.entityLabel}</div>
                  <div style={{ fontSize: 13.5, color: C.ink3, marginTop: 2 }}>Requested by {r.requestedByName || r.requestedBy} · {r.status === "approved" ? "Approved" : "Rejected"} by {r.resolvedBy}</div>
                </div>
                <div style={{
                  fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                  padding: "3px 10px", borderRadius: 20,
                  background: r.status === "approved" ? C.rustSoft : C.forestSoft,
                  color: r.status === "approved" ? C.rust : C.forestDark,
                }}>{r.status}</div>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function UserForm({ update, showToast, close, existing, actor }) {
  const [f, setF] = useState(existing
    ? { username: existing.username, password: "", fullName: existing.fullName, role: existing.role }
    : { username: "", password: "", fullName: "", role: "Loan Officer" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    if (saving) return;
    if (!f.fullName.trim()) return showToast("Enter the user's full name.");
    if (!f.username.trim()) return showToast("Choose a username.");
    if (!existing && !f.password.trim()) return showToast("Set a password for the new user.");
    setSaving(true);
    try {
      const result = existing
        ? await api().users.update({
            actor,
            id: existing.id,
            username: f.username.trim(),
            fullName: f.fullName.trim(),
            role: f.role,
            ...(f.password.trim() ? { password: f.password.trim() } : {}),
          })
        : await api().users.create({
            actor,
            username: f.username.trim(),
            fullName: f.fullName.trim(),
            role: f.role,
            password: f.password.trim(),
          });
      if (!result?.ok) return showToast(result?.error || "Could not save this user.");
      showToast(existing ? "User updated." : "User added.");
      close();
      update();
    } catch (e) {
      showToast(e.message || "Could not save this user.");
    } finally {
      setSaving(false);
    }
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
        <button style={Btn.primary} disabled={saving} onClick={submit}>{saving ? "Saving…" : existing ? "Save changes" : "Add user"}</button>
      </div>
    </ModalShell>
  );
}

/* -------------------------------- global search ------------------------------- */

function SearchResults({ q, goBorrower, goLoan, clear, version }) {
  const search = useDebounced(q, 250);
  const { loading, data, error } = useServerData(
    () => api().search(search),
    [search, version]
  );
  const borrowers = data?.borrowers || [];
  const loans = data?.loans || [];
  const payments = data?.payments || [];
  const collateral = data?.collateral || [];
  const nothing = !loading && borrowers.length + loans.length + payments.length + collateral.length === 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 15.5, color: C.ink3 }}>Results for "<b>{q}</b>"</div>
        <button style={Btn.ghost} onClick={clear}><X size={13} /> Clear</button>
      </div>
      {loading && !data && <LoadingCard />}
      {error && <ErrorCard error={error} />}
      {nothing && <Card><EmptyState icon={Search} title="No matches found" sub="Try a different name, phone number, or loan number." /></Card>}
      {borrowers.length > 0 && (
        <ResultGroup title="Borrowers" items={borrowers.map((b) => ({
          key: b.id, title: b.fullName, sub: b.phone, onClick: () => goBorrower(b.id)
        }))} />
      )}
      {loans.length > 0 && (
        <ResultGroup title="Loans" items={loans.map((l) => ({
          key: l.id, title: l.loanNumber, sub: `${l.borrowerName || "Unknown borrower"} · ${fmt(l.amount)}`, onClick: () => goLoan(l.id)
        }))} />
      )}
      {payments.length > 0 && (
        <ResultGroup title="Payments" items={payments.map((p) => ({
          key: p.id, title: fmt(p.amount), sub: `${p.borrowerName || "Unknown borrower"} · ${p.date}`, onClick: () => goLoan(p.loanId)
        }))} />
      )}
      {collateral.length > 0 && (
        <ResultGroup title="Collateral" items={collateral.map((c) => ({
          key: c.id, title: c.description, sub: `${c.borrowerName || "Unknown borrower"} · ${c.category}`, onClick: () => goLoan(c.loanId)
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


function NotificationsModal({ overdueLoans, soonLoans, autoRenewedToday, close, goLoan }) {
  const today = todayISO();
  const nothing = overdueLoans.length === 0 && soonLoans.length === 0 && autoRenewedToday.length === 0;

  const Row = ({ l, sub, tone }) => (
    <div onClick={() => { close(); goLoan(l.id); }} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0",
      borderBottom: `1px solid ${C.border}`, cursor: "pointer"
    }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, color: tone || C.ink }}>{l.borrowerName || "Unknown borrower"}</div>
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

function ModalRouter({ modal, close, update, showToast, goBorrower, goLoan, setModal, currentUser, role, t, actor, boot, version, onPasswordChanged }) {
  if (modal.type === "borrower") return <BorrowerForm update={update} showToast={showToast} close={close} existing={modal.payload} goBorrower={goBorrower} actor={actor} />;
  if (modal.type === "loan") return <LoanForm update={update} showToast={showToast} close={close} payload={modal.payload} goLoan={goLoan} setModal={setModal} actor={actor} version={version} />;
  if (modal.type === "payment") return <PaymentForm update={update} showToast={showToast} close={close} payload={modal.payload} existing={modal.payload?.existing} actor={actor} version={version} />;
  if (modal.type === "collateral") return <CollateralForm update={update} showToast={showToast} close={close} payload={modal.payload} existing={modal.payload?.existing} t={t} actor={actor} version={version} />;
  if (modal.type === "expense") return <ExpenseForm update={update} showToast={showToast} close={close} existing={modal.payload} actor={actor} />;
  if (modal.type === "user") return <UserForm update={update} showToast={showToast} close={close} existing={modal.payload} actor={actor} />;
  if (modal.type === "renew") return <RenewLoanForm update={update} showToast={showToast} close={close} payload={modal.payload} goLoan={goLoan} actor={actor} version={version} />;
  if (modal.type === "editLoan") return <EditLoanForm update={update} showToast={showToast} close={close} payload={modal.payload} actor={actor} version={version} />;
  if (modal.type === "fundReceived") return <FundReceivedForm update={update} showToast={showToast} close={close} existing={modal.payload} actor={actor} />;
  if (modal.type === "fundRepayment") return <FundRepaymentForm update={update} showToast={showToast} close={close} payload={modal.payload} existing={modal.payload?.existing} actor={actor} version={version} />;
  if (modal.type === "changePassword") return <ChangePasswordForm showToast={showToast} close={close} currentUser={currentUser} onPasswordChanged={onPasswordChanged} />;
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

/* -------------------------------- deletion permissions -------------------------------- */

const canDeleteDirectly = (role) => role?.manageUsers === true;

/** Calls the correct main-process delete mutation for an entity type. Kept
 *  in one place so an admin's immediate delete and an approved request both
 *  go through exactly the same code path. */
function removeEntity(entityType, { actor, id, entityLabel }) {
  switch (entityType) {
    case "borrower": return api().borrowers.remove({ actor, id, entityLabel });
    case "loan": return api().loans.remove({ actor, id, entityLabel });
    case "payment": return api().payments.remove({ actor, id, entityLabel });
    case "collateral": return api().collateral.remove({ actor, id, entityLabel });
    case "expense": return api().expenses.remove({ actor, id, entityLabel });
    case "fund": return api().funding.remove({ actor, id, entityLabel });
    case "fundRepayment": return api().funding.repaymentDelete({ actor, id, entityLabel });
    case "user": return api().users.remove({ actor, id, entityLabel });
    default: return Promise.resolve({ ok: false, error: "Unknown record type." });
  }
}

/** The single entry point every "Delete" button in the app should call.
 *  Administrators delete immediately (after the usual confirm popup).
 *  Everyone else instead sends a deletion request that sits in the
 *  Approvals page until an administrator approves or rejects it, nothing
 *  is actually removed until that happens. */
function confirmOrRequestDelete({ role, currentUser, update, showToast, setModal, actor, entityType, entityId, entityLabel, title, message, onDeleted }) {
  if (canDeleteDirectly(role)) {
    setModal({
      type: "confirmDelete",
      payload: {
        title, message,
        onConfirm: async () => {
          try {
            const result = await removeEntity(entityType, { actor: actor || actorOf(currentUser), id: entityId, entityLabel });
            if (!result?.ok) return showToast(result?.error || "Could not delete this record.");
            showToast(`${entityLabel} deleted.`);
            if (onDeleted) onDeleted();
            update();
          } catch (e) {
            showToast(e.message || "Could not delete this record.");
          }
        },
      },
    });
  } else {
    setModal({
      type: "confirmDelete",
      payload: {
        title: "Request deletion approval",
        message: `You don't have permission to delete this directly. ${message} This will send a request to an administrator, nothing is deleted until they approve it.`,
        confirmLabel: "Send request",
        onConfirm: async () => {
          try {
            const result = await api().approvals.request({
              actor: actor || actorOf(currentUser),
              requestedBy: currentUser.username,
              requestedByName: currentUser.fullName,
              entityType, entityId, entityLabel,
            });
            if (!result?.ok) return showToast(result?.error || "Could not send that request.");
            showToast("Deletion request sent to an administrator for approval.");
            update();
          } catch (e) {
            showToast(e.message || "Could not send that request.");
          }
        },
      },
    });
  }
}

function ChangePasswordForm({ showToast, close, currentUser, onPasswordChanged }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    if (!newPassword || newPassword.length < 4) return showToast("New password must be at least 4 characters.");
    if (newPassword !== confirmPassword) return showToast("New passwords don't match.");
    setSaving(true);
    try {
      const result = await api().auth.changePassword({
        userId: currentUser.id,
        currentPassword,
        newPassword,
      });
      if (!result?.ok) return showToast(result?.error || "Could not change your password.");
      showToast("Password updated.");
      if (onPasswordChanged) onPasswordChanged();
      close();
    } catch (e) {
      showToast(e.message || "Could not change your password.");
    } finally {
      setSaving(false);
    }
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

function FundReceivedForm({ update, showToast, close, existing, actor }) {
  const [type, setType] = useState(existing?.type || "External Loan");
  const [source, setSource] = useState(existing?.source || "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [dateReceived, setDateReceived] = useState(existing?.dateReceived || todayISO());
  const [expectedRepaymentDate, setExpectedRepaymentDate] = useState(existing?.expectedRepaymentDate || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    if (!source.trim()) return showToast(type === "Bank" ? "Enter the bank's name." : "Enter the lender's name.");
    if (!amount || Number(amount) <= 0) return showToast("Enter the amount received.");
    setSaving(true);
    try {
      const data = {
        type, source: source.trim(), amount: Number(amount), dateReceived,
        expectedRepaymentDate, notes,
      };
      const result = existing
        ? await api().funding.update({ actor, id: existing.id, data })
        : await api().funding.create({ actor, data });
      if (!result?.ok) return showToast(result?.error || "Could not save this funding record.");
      showToast(existing ? "Updated." : "Recorded.");
      close();
      update();
    } catch (e) {
      showToast(e.message || "Could not save this funding record.");
    } finally {
      setSaving(false);
    }
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

function FundRepaymentForm({ update, showToast, close, payload, existing, actor, version }) {
  const [fundId, setFundId] = useState(existing?.fundId || payload?.fundId || "");
  const [fq, setFq] = useState("");
  const search = useDebounced(fq, 250);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing?.date || todayISO());
  const [method, setMethod] = useState(existing?.method || "Cash");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [saving, setSaving] = useState(false);

  const openState = useServerData(
    () => api().funding.open({ q: search, selectedFundId: fundId, excludeRepaymentId: existing?.id, limit: 40 }),
    [search, fundId, existing?.id, version]
  );
  const contextState = useServerData(
    () => (fundId ? api().funding.repaymentContext({ fundId, excludeRepaymentId: existing?.id }) : Promise.resolve(null)),
    [fundId, existing?.id, version]
  );
  const openFunds = openState.data || [];
  const selectedFund = contextState.data;
  const outstanding = selectedFund?.outstanding || 0;

  const submit = async () => {
    if (saving) return;
    if (!fundId) return showToast("Select which loan or bank fund this repayment is for.");
    if (!amount || Number(amount) <= 0) return showToast("Enter the repayment amount.");
    setSaving(true);
    try {
      const data = { fundId, amount: Number(amount), date, method, notes };
      const result = existing
        ? await api().funding.repaymentUpdate({ actor, id: existing.id, data })
        : await api().funding.repaymentCreate({ actor, data });
      if (!result?.ok) return showToast(result?.error || "Could not save this repayment.");
      showToast(existing ? "Repayment updated." : "Repayment recorded.");
      close();
      update();
    } catch (e) {
      showToast(e.message || "Could not save this repayment.");
    } finally {
      setSaving(false);
    }
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
              {openFunds.length === 0 && <div style={{ padding: 10, fontSize: 13, color: C.ink3 }}>No outstanding external funding matches.</div>}
              {openFunds.map((f) => (
                <div key={f.id} onClick={() => setFundId(f.id)} style={{ padding: "8px 11px", fontSize: 15, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  <b>{f.source}</b> · {f.type} <span style={{ color: C.ink4 }}>· {fmt(f.outstanding || 0)} left</span>
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

function EditLoanForm({ update, showToast, close, payload, actor, version }) {
  const { loading, data, error } = useServerData(
    () => (payload?.loanId ? api().loans.get({ id: payload.loanId, paymentLimit: 0 }) : Promise.resolve(null)),
    [payload?.loanId, version]
  );
  const loan = data?.loan;
  const borrower = data?.borrower;

  const [amount, setAmount] = useState("");
  const [interestType, setInterestType] = useState("Percent");
  const [interestValue, setInterestValue] = useState("");
  const [hasPaperworkFee, setHasPaperworkFee] = useState(false);
  const [paperworkFee, setPaperworkFee] = useState(String(DEFAULT_PAPERWORK_FEE));
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [repaymentMethod, setRepaymentMethod] = useState("Full Payment");
  const [instCount, setInstCount] = useState("");
  const [instFreq, setInstFreq] = useState("Monthly");
  const [instAmount, setInstAmount] = useState("");
  const [instFirst, setInstFirst] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loan) return;
    setAmount(String(loan.amount));
    setInterestType(loan.interestType || "Percent");
    setInterestValue(String(loan.interestValue || 0));
    setHasPaperworkFee((loan.paperworkFee || 0) > 0);
    setPaperworkFee(String(loan.paperworkFee || DEFAULT_PAPERWORK_FEE));
    setIssueDate(loan.issueDate || todayISO());
    setDueDate(loan.dueDate || todayISO());
    setRepaymentMethod(loan.repaymentMethod || "Full Payment");
    setInstCount(loan.instalments ? String(loan.instalments.count) : "");
    setInstFreq(loan.instalments ? loan.instalments.frequency : "Monthly");
    setInstAmount(loan.instalments ? String(loan.instalments.expectedAmount) : "");
    setInstFirst(loan.instalments ? loan.instalments.firstPaymentDate : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan?.id]);

  if (loading && !data) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!loan) return null;

  const interestAmount = interestType === "Percent" ? (Number(amount) || 0) * (Number(interestValue) || 0) / 100 : (Number(interestValue) || 0);
  const feeAmount = hasPaperworkFee ? (Number(paperworkFee) || 0) : 0;
  const totalPayable = (Number(amount) || 0) + interestAmount + feeAmount;
  const alreadyPaid = loan.paidAmount;

  const submit = async () => {
    if (saving) return;
    if (!amount || Number(amount) <= 0) return showToast("Enter a loan amount.");
    if (!dueDate) return showToast("Set the due date.");
    if (totalPayable < alreadyPaid) {
      return showToast(`The new total (${fmt(totalPayable)}) can't be less than what's already been paid (${fmt(alreadyPaid)}).`);
    }
    setSaving(true);
    try {
      const result = await api().loans.update({
        actor,
        id: loan.id,
        data: {
          amount: Number(amount), interestType, interestValue: Number(interestValue) || 0,
          paperworkFee: feeAmount, issueDate, dueDate, repaymentMethod,
          instalments: repaymentMethod === "Instalments" ? {
            count: Number(instCount) || 0, frequency: instFreq,
            expectedAmount: Number(instAmount) || 0, firstPaymentDate: instFirst,
          } : null,
        },
      });
      if (!result?.ok) return showToast(result?.error || "Could not update this loan.");
      showToast("Loan updated.");
      close();
      update();
    } catch (e) {
      showToast(e.message || "Could not update this loan.");
    } finally {
      setSaving(false);
    }
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

function RenewLoanForm({ update, showToast, close, payload, goLoan, actor, version }) {
  const { loading, data, error } = useServerData(
    () => (payload?.loanId ? api().loans.get({ id: payload.loanId, paymentLimit: 0 }) : Promise.resolve(null)),
    [payload?.loanId, version]
  );
  const loan = data?.loan;
  const borrower = data?.borrower;
  const outstanding = loan ? Math.max(0, loan.totalPayable - loan.paidAmount) : 0;

  const [principal, setPrincipal] = useState("");
  const [interestType, setInterestType] = useState("Percent");
  const [interestValue, setInterestValue] = useState(String(DEFAULT_INTEREST_RATE));
  const [newDueDate, setNewDueDate] = useState("");
  const [hasFee, setHasFee] = useState(false);
  const [fee, setFee] = useState(String(DEFAULT_PAPERWORK_FEE));
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!loan || initialized) return;
    const term = Math.max(daysBetween(loan.issueDate, loan.dueDate), 7);
    const d = new Date();
    d.setDate(d.getDate() + term);
    setPrincipal(String(Math.max(0, loan.totalPayable - loan.paidAmount)));
    setNewDueDate(d.toISOString().slice(0, 10));
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan?.id]);

  const interestAmt = interestType === "Percent" ? (Number(principal) || 0) * (Number(interestValue) || 0) / 100 : (Number(interestValue) || 0);
  const feeAmt = hasFee ? (Number(fee) || 0) : 0;
  const totalPayable = (Number(principal) || 0) + interestAmt + feeAmt;

  if (loading && !data) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!loan) return null;

  const submit = async () => {
    if (saving) return;
    if (!newDueDate) return showToast("Set the new due date for this loan.");
    if (!principal || Number(principal) <= 0) return showToast("Enter the amount being carried into the renewed loan.");
    setSaving(true);
    try {
      const result = await api().loans.renew({
        actor,
        id: loan.id,
        opts: {
          newPrincipal: Number(principal),
          interestType,
          interestValue: Number(interestValue) || 0,
          newDueDate,
          paperworkFee: feeAmt,
        },
      });
      if (!result?.ok) return showToast(result?.error || "This loan can't be renewed.");
      showToast("Loan renewed.");
      update();
      close();
      goLoan(result.id);
    } catch (e) {
      showToast(e.message || "This loan can't be renewed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Renew loan" onClose={close} wide>
      <div style={{ background: C.forestSoft, border: "1px solid #B9CDAE", borderRadius: 9, padding: 12, marginBottom: 14, fontSize: 14.5 }}>
        Renewing <b>{loan.loanNumber}</b> for <b>{borrower?.fullName}</b>. The outstanding balance of <b>{fmt(outstanding)}</b> will roll into a brand new loan, and {loan.loanNumber} will be marked Renewed and kept in the borrower's history.
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
        <button style={Btn.primary} disabled={saving} onClick={submit}>{saving ? "Renewing…" : "Renew loan"}</button>
      </div>
    </ModalShell>
  );
}

function BorrowerForm({ update, showToast, close, existing, goBorrower, actor }) {
  const [f, setF] = useState(existing ? {
    fullName: existing.fullName || "", phone: existing.phone || "", altPhone: existing.altPhone || "",
    nationalId: existing.nationalId || "", address: existing.address || "", occupation: existing.occupation || "",
    nextOfKin: existing.nextOfKin || "", nextOfKinPhone: existing.nextOfKinPhone || "", notes: existing.notes || "",
  } : {
    fullName: "", phone: "", altPhone: "", nationalId: "", address: "", occupation: "",
    nextOfKin: "", nextOfKinPhone: "", notes: "",
  });
  const [duplicateMatch, setDuplicateMatch] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDuplicateMatch(null); };
  const setPhone = (k) => (e) => { setF({ ...f, [k]: digitsOnly(e.target.value) }); setDuplicateMatch(null); };
  const setNin = (e) => setF({ ...f, nationalId: ninChars(e.target.value) });

  const doSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const data = {
        fullName: f.fullName.trim(), phone: f.phone.trim(), altPhone: f.altPhone,
        nationalId: f.nationalId, address: f.address, occupation: f.occupation,
        nextOfKin: f.nextOfKin, nextOfKinPhone: f.nextOfKinPhone, notes: f.notes,
      };
      const result = existing
        ? await api().borrowers.update({ actor, id: existing.id, data })
        : await api().borrowers.create({ actor, data: { ...data, dateRegistered: todayISO() } });
      if (!result?.ok) return showToast(result?.error || "Could not save this borrower.");
      showToast(existing ? "Borrower profile updated." : "Borrower registered.");
      close();
      update();
      if (!existing && result.borrower) goBorrower(result.borrower.id);
    } catch (e) {
      showToast(e.message || "Could not save this borrower.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (saving) return;
    if (!f.fullName.trim()) return showToast("Full name is required.");
    if (!f.phone.trim()) return showToast("Phone number is required.");
    if (!isValidPhone(f.phone)) return showToast("Phone number must be exactly 10 digits, starting with 07, 03, or 04.");
    if (f.altPhone && !isValidPhone(f.altPhone)) return showToast("Alternative phone number must be exactly 10 digits, starting with 07, 03, or 04.");
    if (f.nextOfKinPhone && !isValidPhone(f.nextOfKinPhone)) return showToast("Next of kin phone number must be exactly 10 digits, starting with 07, 03, or 04.");
    if (f.nationalId && !isValidNin(f.nationalId)) return showToast("National ID number must be exactly 14 characters.");

    try {
      const dup = await api().borrowers.duplicate({
        name: f.fullName.trim(),
        phone: f.phone.trim(),
        excludeId: existing?.id,
      });
      if (dup) { setDuplicateMatch(dup); return; }
    } catch (e) {
      return showToast(e.message || "Could not check for a duplicate borrower.");
    }
    doSave();
  };

  const saveAnyway = () => { setDuplicateMatch(null); doSave(); };
  const viewExisting = () => { close(); goBorrower(duplicateMatch.id); };

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

      {duplicateMatch && (
        <div style={{ background: C.rustSoft, border: "1px solid #E3C3BB", borderRadius: 9, padding: 14, marginBottom: 6 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <AlertTriangle size={17} color={C.rust} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15.5, color: C.rust }}>Possible duplicate borrower</div>
              <div style={{ fontSize: 14, color: C.ink2, marginTop: 4, lineHeight: 1.5 }}>
                A borrower named <b>{duplicateMatch.fullName}</b> with phone <b>{duplicateMatch.phone}</b> is already registered (added {duplicateMatch.dateRegistered}). Creating another profile for the same person will split their loan history across two separate records.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button style={Btn.secondary} onClick={viewExisting}>View existing profile instead</button>
                <button style={Btn.danger} onClick={saveAnyway}>They're different people, save anyway</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <button style={Btn.secondary} onClick={close}>Cancel</button>
        <button style={Btn.primary} disabled={saving} onClick={submit}>{saving ? "Saving…" : existing ? "Save changes" : "Register borrower"}</button>
      </div>
    </ModalShell>
  );
}

function LoanForm({ update, showToast, close, payload, goLoan, setModal, actor, version }) {
  const [borrowerId, setBorrowerId] = useState(payload?.borrowerId || "");
  const [bq, setBq] = useState("");
  const [selectedBorrower, setSelectedBorrower] = useState(null);
  const [saving, setSaving] = useState(false);
  const search = useDebounced(bq, 250);
  const pickerState = useServerData(
    () => (search.trim() ? api().borrowers.pick({ q: search, limit: 20 }) : Promise.resolve([])),
    [search, version]
  );
  const prefillState = useServerData(
    () => (payload?.borrowerId ? api().borrowers.get({ id: payload.borrowerId, loanLimit: 1 }) : Promise.resolve(null)),
    [payload?.borrowerId, version]
  );
  useEffect(() => {
    if (payload?.borrowerId && prefillState.data?.borrower) setSelectedBorrower(prefillState.data.borrower);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.borrowerId, prefillState.data?.borrower?.id]);
  const [amount, setAmount] = useState("");
  const [interestType, setInterestType] = useState("Percent");
  const [interestValue, setInterestValue] = useState(String(DEFAULT_INTEREST_RATE));
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(addDays(todayISO(), 30));
  const [dueDateTouched, setDueDateTouched] = useState(false);

  const handleIssueDateChange = (v) => {
    setIssueDate(v);
    // Keep the due date exactly 30 days after the issue date, unless the
    // admin has already picked a different due date themselves, in which
    // case we leave their choice alone.
    if (!dueDateTouched) setDueDate(addDays(v, 30));
  };
  const handleDueDateChange = (v) => { setDueDate(v); setDueDateTouched(true); };
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

  const matches = pickerState.data || [];

  const submit = async () => {
    if (saving) return;
    if (!borrowerId) return showToast("Please select a borrower first.");
    if (!amount || Number(amount) <= 0) return showToast("Enter a loan amount.");
    if (!dueDate) return showToast("Please set the date this loan is expected to be paid.");
    if (repaymentMethod === "Instalments" && (!instCount || !instAmount || !instFirst)) return showToast("Fill in all instalment details.");
    if (hasCollateral && !col.description.trim()) return showToast("Describe the security/collateral, or turn that section off.");
    if (isHistorical && priorPaid && Number(priorPaid) > totalPayable) return showToast("Amount already paid can't be more than the total amount payable.");

    setSaving(true);
    try {
      const result = await api().loans.create({
        actor,
        data: {
          borrowerId,
          amount: Number(amount),
          interestType,
          interestValue: Number(interestValue) || 0,
          paperworkFee: feeAmount,
          issueDate,
          dueDate,
          repaymentMethod,
          instalments: repaymentMethod === "Instalments" ? {
            count: Number(instCount), frequency: instFreq,
            expectedAmount: Number(instAmount), firstPaymentDate: instFirst,
          } : null,
          isHistorical,
          collateral: hasCollateral && col.description.trim()
            ? { ...col, estimatedValue: Number(col.estimatedValue) || 0 }
            : null,
          priorPaid: isHistorical ? Number(priorPaid) || 0 : 0,
          priorPaidDate,
          priorPaidMethod,
        },
      });
      if (!result?.ok) return showToast(result?.error || "Could not issue this loan.");
      showToast(hasCollateral ? "Loan issued with security recorded." : "Loan issued.");
      close();
      update();
      goLoan(result.id);
    } catch (e) {
      showToast(e.message || "Could not issue this loan.");
    } finally {
      setSaving(false);
    }
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
        {borrowerId ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.forestSoft }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>{selectedBorrower ? selectedBorrower.fullName : "Loading borrower…"}</span>
            <span style={{ color: C.forest, fontSize: 14.5, cursor: "pointer", fontWeight: 600 }} onClick={() => { setBorrowerId(""); setSelectedBorrower(null); setBq(""); }}>Change</span>
          </div>
        ) : (
          <>
            <input style={FieldStyle.input} placeholder="Search existing borrower by name…" value={bq} onChange={(e) => setBq(e.target.value)} />
            {matches.length > 0 && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, marginTop: 4, maxHeight: 140, overflowY: "auto" }}>
                {matches.map((b) => (
                  <div key={b.id} onClick={() => { setBorrowerId(b.id); setSelectedBorrower(b); setBq(""); }} style={{ padding: "8px 11px", fontSize: 15.5, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>{b.fullName} <span style={{ color: C.ink4 }}>· {b.phone}</span></div>
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
          <Field label="Paperwork cost" hint={`Defaults to ${fmt(DEFAULT_PAPERWORK_FEE)}, adjust if this loan is different`}>
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
        <Field label="Loan issue date" required><DatePicker value={issueDate} onChange={handleIssueDateChange} /></Field>
        <Field label="Expected payment / due date" required hint="Defaults to 30 days after the issue date"><DatePicker value={dueDate} onChange={handleDueDateChange} /></Field>
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
        <button style={Btn.primary} disabled={saving} onClick={submit}>{saving ? "Issuing…" : "Issue loan"}</button>
      </div>
    </ModalShell>
  );
}

function PaymentForm({ update, showToast, close, payload, existing, actor, version }) {
  const [loanId, setLoanId] = useState(existing?.loanId || payload?.loanId || "");
  const [lq, setLq] = useState("");
  const [principalAmt, setPrincipalAmt] = useState(existing ? String(existing.principalPaid || 0) : "");
  const [interestAmt, setInterestAmt] = useState(existing ? String(existing.interestPaid || 0) : "");
  const [date, setDate] = useState(existing?.date || todayISO());
  const [method, setMethod] = useState(existing?.method || "Cash");
  const [reference, setReference] = useState(existing?.reference || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [saving, setSaving] = useState(false);

  const search = useDebounced(lq, 250);
  const pickerState = useServerData(
    () => api().loans.picker({ q: search, mode: "active", limit: 50 }),
    [search, version]
  );
  const contextState = useServerData(
    () => (loanId ? api().loans.paymentContext({ id: loanId, excludePaymentId: existing?.id }) : Promise.resolve(null)),
    [loanId, existing?.id, version]
  );
  const openLoans = pickerState.data || [];
  const context = contextState.data;
  const selectedLoan = context?.loan;
  const outstanding = context?.outstanding || 0;
  const remainingPrincipal = context?.remainingPrincipal || 0;
  const remainingInterest = context?.remainingInterest || 0;
  const totalAmount = (Number(principalAmt) || 0) + (Number(interestAmt) || 0);

  const submit = async () => {
    if (saving) return;
    if (!loanId) return showToast("Select a loan to record a payment against.");
    if (totalAmount <= 0) return showToast("Enter an amount towards principal, interest, or both.");
    setSaving(true);
    try {
      const data = {
        principalPaid: Number(principalAmt) || 0,
        interestPaid: Number(interestAmt) || 0,
        amount: totalAmount,
        date, method, reference, notes,
      };
      const result = existing
        ? await api().payments.update({ actor, id: existing.id, data })
        : await api().payments.create({ actor, data: { ...data, loanId } });
      if (!result?.ok) return showToast(result?.error || "Could not save this payment.");
      showToast(existing ? "Payment updated." : result.fullyPaid ? "Payment recorded. This loan is now fully paid." : "Payment recorded.");
      close();
      update();
    } catch (e) {
      showToast(e.message || "Could not save this payment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={existing ? "Edit payment" : "Record a payment"} onClose={close}>
      <Field label="Loan" required>
        {loanId ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.forestSoft }}>
            <span style={{ fontSize: 15.5 }}>
              {selectedLoan ? (
                <><b>{selectedLoan.loanNumber}</b> · {context?.borrower?.fullName || "Unknown borrower"}<br /><span style={{ fontSize: 14, color: C.ink3, ...numFont }}>{fmt(outstanding)} outstanding</span></>
              ) : "Loading loan…"}
            </span>
            {!existing && <span style={{ color: C.forest, fontSize: 14.5, cursor: "pointer", fontWeight: 600 }} onClick={() => setLoanId("")}>Change</span>}
          </div>
        ) : (
          <>
            <input style={FieldStyle.input} placeholder="Search borrower name or loan number…" value={lq} onChange={(e) => setLq(e.target.value)} />
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, marginTop: 4, maxHeight: 160, overflowY: "auto" }}>
              {openLoans.length === 0 && <div style={{ padding: 10, fontSize: 15, color: C.ink3 }}>No open loans match.</div>}
              {openLoans.map((l) => (
                <div key={l.id} onClick={() => setLoanId(l.id)} style={{ padding: "8px 11px", fontSize: 15.5, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  <b>{l.loanNumber}</b> · {l.borrowerName || "Unknown borrower"} <span style={{ color: C.ink4 }}>· {fmt(l.outstanding || 0)} left</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Field>

      {context && (
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
        <button style={Btn.primary} disabled={saving} onClick={submit}>{saving ? "Saving…" : existing ? "Save changes" : "Record payment"}</button>
      </div>
    </ModalShell>
  );
}

function CollateralForm({ update, showToast, close, payload, existing, t, actor, version }) {
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
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const search = useDebounced(lq, 250);
  const pickerState = useServerData(
    () => api().loans.picker({ q: search, mode: "active", limit: 50 }),
    [search, version]
  );
  const contextState = useServerData(
    () => (loanId ? api().loans.get({ id: loanId, paymentLimit: 0 }) : Promise.resolve(null)),
    [loanId, version]
  );
  const openLoans = pickerState.data || [];
  const selectedLoan = contextState.data?.loan;
  const selectedBorrower = contextState.data?.borrower;

  const submit = async () => {
    if (saving) return;
    if (!loanId) return showToast("Select the loan this collateral belongs to.");
    if (!f.description.trim()) return showToast("Describe the item.");
    setSaving(true);
    try {
      const data = {
        loanId,
        description: f.description.trim(),
        category: f.category,
        brand: f.brand,
        model: f.model,
        serial: f.serial,
        estimatedValue: Number(f.estimatedValue) || 0,
        condition: f.condition,
        dateReceived: f.dateReceived,
        storageLocation: f.storageLocation,
        notes: f.notes,
      };
      const result = existing
        ? await api().collateral.update({ actor, id: existing.id, data })
        : await api().collateral.create({ actor, data });
      if (!result?.ok) return showToast(result?.error || "Could not save this collateral.");
      showToast(existing ? "Collateral updated." : "Collateral recorded.");
      close();
      update();
    } catch (e) {
      showToast(e.message || "Could not save this collateral.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={existing ? "Edit security / collateral" : "Add security / collateral"} onClose={close} wide>
      <Field label="Loan" required>
        {loanId ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.forestSoft }}>
            <span style={{ fontSize: 15.5 }}>
              {selectedLoan ? <><b>{selectedLoan.loanNumber}</b> · {selectedBorrower?.fullName || "Unknown borrower"}</> : "Loading loan…"}
            </span>
            <span style={{ color: C.forest, fontSize: 14.5, cursor: "pointer", fontWeight: 600 }} onClick={() => setLoanId("")}>Change</span>
          </div>
        ) : (
          <>
            <input style={FieldStyle.input} placeholder="Search borrower name or loan number…" value={lq} onChange={(e) => setLq(e.target.value)} />
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 7, marginTop: 4, maxHeight: 140, overflowY: "auto" }}>
              {openLoans.map((l) => (
                <div key={l.id} onClick={() => setLoanId(l.id)} style={{ padding: "8px 11px", fontSize: 15.5, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  <b>{l.loanNumber}</b> · {l.borrowerName || "Unknown borrower"}
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
        <button style={Btn.primary} disabled={saving} onClick={submit}>{saving ? "Saving…" : existing ? "Save changes" : "Save collateral"}</button>
      </div>
    </ModalShell>
  );
}

function ExpenseForm({ update, showToast, close, existing, actor }) {
  const [f, setF] = useState(existing
    ? { description: existing.description, category: existing.category, amount: String(existing.amount), date: existing.date, method: existing.method, notes: existing.notes || "" }
    : { description: "", category: EXPENSE_CATEGORIES[0], amount: "", date: todayISO(), method: "Cash", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (saving) return;
    if (!f.description.trim()) return showToast("Describe the expense.");
    if (!f.amount || Number(f.amount) <= 0) return showToast("Enter an amount.");
    setSaving(true);
    try {
      const data = {
        description: f.description.trim(), category: f.category,
        amount: Number(f.amount), date: f.date, method: f.method, notes: f.notes,
      };
      const result = existing
        ? await api().expenses.update({ actor, id: existing.id, data })
        : await api().expenses.create({ actor, data });
      if (!result?.ok) return showToast(result?.error || "Could not save this expense.");
      showToast(existing ? "Expense updated." : "Expense recorded.");
      close();
      update();
    } catch (e) {
      showToast(e.message || "Could not save this expense.");
    } finally {
      setSaving(false);
    }
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
        <button style={Btn.primary} disabled={saving} onClick={submit}>{saving ? "Saving…" : existing ? "Save changes" : "Save expense"}</button>
      </div>
    </ModalShell>
  );
}
