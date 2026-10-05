const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const SAFE_INLINE_ACTIONS = new Set([
  "approveRecoveryProposalGroup", "assignRecoveryStaffFromRegister", "changeWorkingCalendarMonth", "closeGroupFolder", "closeRecoveryCentre",
  "completeHistoricalLoanEntries", "deleteLoanRecord", "deleteVerificationGroup",
  "directorEditApprovedRecovery", "downloadCustomerSchedule", "downloadGroupSchedule",
  "assignStaffToAssistantManager", "editGroup", "editHoldTransaction", "editLoanRecord", "editRecoveryProposal", "editTeamIncentive",
  "openHoldEntry", "openLoanFolder", "openRecoveryFolderAccount", "removeEmployee",
  "removeHoliday", "saveHistoricalRecovery", "saveInlinePenalty", "saveInlineRecovery",
  "saveAttendance", "saveRecurringDeposit", "saveTeamIncentive", "selectEmployeeTeamFolder", "setDirectorRecoveryEntryDate", "setLoanHistoryRecoveryDate", "stageRecoveryPhoto",
  "toggleRecoveryCentre", "viewCustomer", "viewGroup",
]);

function parseSafeAction(expression, element) {
  const invocation = /^([A-Za-z_$][\w$]*)\((.*)\)$/.exec(String(expression || "").trim());
  if (!invocation || !SAFE_INLINE_ACTIONS.has(invocation[1])) return null;
  const args = [];
  const source = invocation[2].trim();
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (source.startsWith("this.value", cursor)) {
      args.push(element.value);
      cursor += "this.value".length;
    } else if (["'", '"'].includes(source[cursor])) {
      const quote = source[cursor++];
      const end = source.indexOf(quote, cursor);
      if (end < 0) return null;
      args.push(source.slice(cursor, end));
      cursor = end + 1;
    } else {
      const number = /^-?\d+(?:\.\d+)?/.exec(source.slice(cursor));
      if (!number) return null;
      args.push(Number(number[0]));
      cursor += number[0].length;
    }
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (cursor < source.length) {
      if (source[cursor] !== ",") return null;
      cursor += 1;
    }
  }
  return { name: invocation[1], args };
}

function migrateInlineActions(root = document) {
  const elements = [];
  if (root instanceof Element && (root.hasAttribute("onclick") || root.hasAttribute("onchange"))) elements.push(root);
  if (root.querySelectorAll) elements.push(...root.querySelectorAll("[onclick],[onchange]"));
  elements.forEach((element) => {
    if (element.hasAttribute("onclick")) {
      element.dataset.safeClick = element.getAttribute("onclick");
      element.removeAttribute("onclick");
    }
    if (element.hasAttribute("onchange")) {
      element.dataset.safeChange = element.getAttribute("onchange");
      element.removeAttribute("onchange");
    }
  });
}

function installCspSafeActions() {
  migrateInlineActions();
  new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => migrateInlineActions(node))))
    .observe(document.body, { childList: true, subtree: true });
  const invoke = (event, attribute) => {
    const target = event.target instanceof Element ? event.target.closest(`[${attribute}]`) : null;
    if (!target) return;
    const parsed = parseSafeAction(target.dataset[attribute === "data-safe-click" ? "safeClick" : "safeChange"], target);
    if (!parsed || typeof window[parsed.name] !== "function") return;
    event.preventDefault();
    Promise.resolve(window[parsed.name](...parsed.args)).catch((error) => toast(error?.message || "Action could not be completed."));
  };
  document.addEventListener("click", (event) => invoke(event, "data-safe-click"));
  document.addEventListener("change", (event) => invoke(event, "data-safe-change"));
}

const STORAGE = {
  groups: "nmcGroups",
  loans: "nmcLoans",
  cashbook: "nmcCashbook",
  holidays: "nmcBankHolidays",
  employees: "nmcEmployees",
  npaRegistry: "nmcNpaRegistry",
  workingRecords: "nmcWorkingRecords",
  importHistory: "nmcOldDataImportHistory",
  directorCleanup: "nmcDirectorCleanupV1",
  employeeMigration: "nmcEmployeeMigrationV2",
};

const ROLE_ACCESS = {
  Director: ["overview", "verification", "loans", "recovery", "approvals", "hold", "cashbook", "calendar", "employees"],
  Manager: ["overview", "verification", "loans", "recovery", "working", "hold", "cashbook", "calendar", "employees"],
  "Assistant Manager": ["verification", "recovery", "working", "team-target"],
  Cashier: ["verification", "loans", "recovery", "approvals", "working", "hold", "cashbook"],
  Executive: ["verification", "loans", "recovery", "approvals", "working", "hold"],
  Staff: ["recovery", "approvals", "working", "hold"],
};

const PAGE_TITLES = {
  overview: "Good morning",
  verification: "Group verification",
  loans: "Loan record",
  recovery: "Recovery demand",
  approvals: "Staff entry approvals",
  working: "My Working",
  "team-target": "Team monthly target",
  hold: "Hold loan",
  cashbook: "Daybook",
  calendar: "Bank holiday calendar",
  employees: "Employee management",
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LOAN_SLABS = {
  12000: { term: 26, emi: 600, hold: 2000 },
  15000: { term: 28, emi: 700, hold: 3000 },
  20000: { term: 26, emi: 1000, hold: 4000 },
  25000: { term: 26, emi: 1250, hold: 5000 },
  30000: { term: 26, emi: 1500, hold: 6000 },
};
const PROCESSING_FEES = {
  12000: { standard: 600, over50: 825 },
  15000: { standard: 930, over50: 1265 },
  20000: { standard: 1240, over50: 1690 },
  25000: { standard: 1550, over50: 2000 },
  30000: { standard: 1860, over50: 2310 },
};

function readJson(key, fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

let groups = readJson(STORAGE.groups);
let loans = readJson(STORAGE.loans);
let cashEntries = readJson(STORAGE.cashbook);
if (!Array.isArray(cashEntries)) cashEntries = [];
const cashEntryCountBeforeFeatureRemoval = cashEntries.length;
cashEntries = cashEntries.filter(
  (entry) => entry?.source !== "staff-allowance" &&
    entry?.daybookCategory !== "allowance" &&
    entry?.source !== "scheduled-recovery-demand"
);
try {
  localStorage.removeItem("nmcStaffAllowances");
  if (cashEntries.length !== cashEntryCountBeforeFeatureRemoval) {
    localStorage.setItem(STORAGE.cashbook, JSON.stringify(cashEntries));
  }
} catch {
  // Continue without legacy cleanup when browser storage is unavailable.
}
let bankHolidays = readJson(STORAGE.holidays);
let employeeAccounts = readJson(STORAGE.employees);
let npaRegistry = readJson(STORAGE.npaRegistry);
if (!Array.isArray(npaRegistry)) npaRegistry = [];
let workingRecords = readJson(STORAGE.workingRecords);
if (!Array.isArray(workingRecords)) workingRecords = [];
let oldDataImportHistory = readJson(STORAGE.importHistory);
if (!Array.isArray(oldDataImportHistory)) oldDataImportHistory = [];
let stagedOldDataImport = null;
let currentUser = null;
let selectedDay = "Monday";
let selectedRecoveryStaff = "all";
let selectedRecoveryLoanIndex = null;
const directorRecoveryEntryDates = new Map();
const recoveryFolderState = { npa: false, balance: false };
const stagedRecoveryPhotos = new Map();
let toastTimer = null;
let calendarViewDate = new Date();
calendarViewDate.setDate(1);
let selectedEmployeeManagementView = "login";
const selectedEmployeeTeamFolders = { salary: "", working: "", attendance: "" };
let backendMode = false;
let backendStateVersion = 0;
let backendSaveQueue = Promise.resolve();
let currentIncentiveProfile = null;
let currentWorkingProfile = null;
let workingCalendarMonth = todayIso().slice(0, 7);
let salaryBookMonth = todayIso().slice(0, 7);
let recurringDepositMonth = todayIso().slice(0, 7);
let teamTargetMonth = todayIso().slice(0, 7);

function applicationStatePayload() {
  return {
    groups,
    loans,
    cashEntries,
    bankHolidays,
    npaRegistry,
    workingRecords,
    oldDataImportHistory,
  };
}

function applyBackendState(payload) {
  const data = payload?.data || {};
  groups = Array.isArray(data.groups) ? data.groups : [];
  loans = Array.isArray(data.loans) ? data.loans : [];
  cashEntries = Array.isArray(data.cashEntries) ? data.cashEntries : [];
  bankHolidays = Array.isArray(data.bankHolidays) ? data.bankHolidays : [];
  npaRegistry = Array.isArray(data.npaRegistry) ? data.npaRegistry : [];
  workingRecords = Array.isArray(data.workingRecords) ? data.workingRecords : [];
  oldDataImportHistory = Array.isArray(data.oldDataImportHistory) ? data.oldDataImportHistory : [];
  employeeAccounts = Array.isArray(payload?.employees) ? payload.employees : [];
  currentIncentiveProfile = payload?.incentiveProfile && typeof payload.incentiveProfile === "object"
    ? payload.incentiveProfile
    : null;
  if (currentIncentiveProfile?.loginId) {
    const ownAccount = employeeAccounts.find(
      (account) => String(account.loginId || "").toLowerCase() === String(currentIncentiveProfile.loginId).toLowerCase()
    );
    if (ownAccount) ownAccount.incentive = Math.max(0, Number(currentIncentiveProfile.incentive || 0));
  }
  currentWorkingProfile = payload?.workingProfile && typeof payload.workingProfile === "object"
    ? payload.workingProfile
    : null;
  if (currentWorkingProfile?.loginId) {
    const ownAccount = employeeAccounts.find(
      (account) => String(account.loginId || "").toLowerCase() === String(currentWorkingProfile.loginId).toLowerCase()
    );
    if (ownAccount) Object.assign(ownAccount, {
      salary: Math.max(0, Number(currentWorkingProfile.salary || 0)),
      petrolAllowance: Math.max(0, Number(currentWorkingProfile.recoveryAllowance || 0)),
      businessAllowance: Math.max(0, Number(currentWorkingProfile.businessAllowance || 0)),
      incentive: Math.max(0, Number(currentWorkingProfile.incentive || 0)),
      recurringDeposit: Math.max(0, Number(currentWorkingProfile.recurringDeposit || 0)),
      recurringDepositStartedAt: String(currentWorkingProfile.recurringDepositStartedAt || ""),
    });
  }
  const teamWorkingProfiles = Array.isArray(payload?.teamWorkingProfiles) ? payload.teamWorkingProfiles : [];
  teamWorkingProfiles.forEach((profile) => {
    const teamAccount = employeeAccounts.find(
      (account) => String(account.loginId || "").toLowerCase() === String(profile.loginId || "").toLowerCase()
    );
    if (teamAccount) Object.assign(teamAccount, {
      salary: Math.max(0, Number(profile.salary || 0)),
      performanceAllowance: Math.max(0, Number(profile.performanceAllowance || 0)),
      petrolAllowance: Math.max(0, Number(profile.petrolAllowance || 0)),
      businessAllowance: Math.max(0, Number(profile.businessAllowance || 0)),
      incentive: Math.max(0, Number(profile.incentive || 0)),
      recurringDeposit: Math.max(0, Number(profile.recurringDeposit || 0)),
      recurringDepositStartedAt: String(profile.recurringDepositStartedAt || ""),
    });
  });
  backendStateVersion = Number(payload?.version || 0);
}

function queueBackendSave() {
  if (!backendMode || !currentUser || !window.NeelavatiApi) return;
  const snapshot = JSON.parse(JSON.stringify(applicationStatePayload()));
  backendSaveQueue = backendSaveQueue
    .then(() => window.NeelavatiApi.saveState(snapshot, backendStateVersion))
    .then((result) => {
      backendStateVersion = Number(result.version || backendStateVersion);
    })
    .catch((error) => {
      if (error?.code === "version_conflict") {
        toast("Data changed on another device. Sign out and sign in again before editing.");
      } else {
        toast(error?.message || "Secure server could not save the latest change.");
      }
    });
}

function initializeEmployees() {
  if (!Array.isArray(employeeAccounts)) employeeAccounts = [];
  const roleNames = Object.keys(ROLE_ACCESS);
  employeeAccounts = employeeAccounts
    .filter((account) => account && typeof account === "object")
    .map((account) => {
      const rawDesignation = String(
        account.designation || account.role || account.accessLevel || account.access || "Staff"
      ).trim();
      const employeeName = String(account.name || account.employeeName || account.employee || "Employee").trim();
      const loginId = String(account.loginId || account.login || account.username || "").trim();
      let designation =
        roleNames.find((name) => name.toLowerCase() === rawDesignation.toLowerCase()) || "Staff";
      if (employeeName.toLowerCase() === "amol ingle" || loginId.toLowerCase() === "amol") {
        designation = "Assistant Manager";
      }
      const { dailyAllowance: _removedDailyAllowance, ...accountWithoutAllowance } = account;
      const recurringDeposit = Math.max(0, Number(account.recurringDeposit || 0));
      const savedRecurringDepositStart = String(account.recurringDepositStartedAt || "").slice(0, 7);
      const legacyRecurringDepositStart = String(account.createdAt || "").slice(0, 7);
      return {
        ...accountWithoutAllowance,
        name: employeeName,
        loginId,
        password: String(account.password || account.passcode || account.pass || ""),
        designation,
        managerLoginId: String(account.managerLoginId || "").trim(),
        managerName: String(account.managerName || "").trim(),
        assistantManagerLoginId: String(account.assistantManagerLoginId || "").trim(),
        assistantManagerName: String(account.assistantManagerName || "").trim(),
        salary: Math.max(0, Number(account.salary || 0)),
        performanceAllowance: Math.max(0, Number(account.performanceAllowance || 0)),
        petrolAllowance: Math.max(0, Number(account.petrolAllowance || 0)),
        businessAllowance: Math.max(0, Number(account.businessAllowance || 0)),
        incentive: Math.max(0, Number(account.incentive || 0)),
        recurringDeposit,
        recurringDepositStartedAt: recurringDeposit > 0
          ? (validYearMonth(savedRecurringDepositStart)
              ? savedRecurringDepositStart
              : validYearMonth(legacyRecurringDepositStart) ? legacyRecurringDepositStart : todayIso().slice(0, 7))
          : "",
        active: account.active !== false && account.status !== "Inactive",
        lastActive: account.lastActive || "Never",
      };
    })
    .filter((account) => account.loginId);

  let migrationDone = false;
  try {
    migrationDone = localStorage.getItem(STORAGE.employeeMigration) === "done";
  } catch {
    migrationDone = false;
  }
  if (!migrationDone) {
    employeeAccounts = employeeAccounts.filter((account) =>
      account.designation !== "Director" ||
      String(account.loginId).toLowerCase() === "shubham" ||
      String(account.name).toLowerCase().includes("shubham")
    );
    try {
      localStorage.setItem(STORAGE.directorCleanup, "done");
      localStorage.setItem(STORAGE.employeeMigration, "done");
    } catch {
      // The application can still sign in when browser storage is unavailable or full.
    }
  }
  let shubham = employeeAccounts.find(
    (account) =>
      String(account.loginId).toLowerCase() === "shubham" ||
      String(account.name).toLowerCase().includes("shubham")
  );
  if (!shubham) {
    shubham = {
      name: "Shubham",
      loginId: "shubham",
      password: "Shubham@123",
      designation: "Director",
      lastActive: "Never",
      active: true,
    };
    employeeAccounts.unshift(shubham);
  } else {
    shubham.name = "Shubham";
    shubham.loginId = "shubham";
    shubham.designation = "Director";
    shubham.active = true;
    shubham.password = "Shubham@123";
  }
  employeeAccounts.forEach((account) => {
    if (account.active === undefined) account.active = true;
  });
  try {
    localStorage.setItem(STORAGE.employees, JSON.stringify(employeeAccounts));
  } catch (error) {
    console.warn("Employee accounts are available for this session but could not be saved.", error);
  }
}

initializeEmployees();

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 4200);
}

function staticDemoLoginAllowed() {
  const hostname = String(location.hostname || "").toLowerCase();
  return (
    location.protocol === "file:" ||
    hostname.endsWith(".chatgpt.site") ||
    hostname.endsWith(".github.io")
  );
}

function persistAll() {
  try {
    localStorage.setItem(STORAGE.groups, JSON.stringify(groups));
    localStorage.setItem(STORAGE.loans, JSON.stringify(loans));
    localStorage.setItem(STORAGE.cashbook, JSON.stringify(cashEntries));
    localStorage.setItem(STORAGE.holidays, JSON.stringify(bankHolidays));
    localStorage.setItem(STORAGE.employees, JSON.stringify(employeeAccounts));
    localStorage.setItem(STORAGE.npaRegistry, JSON.stringify(npaRegistry));
    localStorage.setItem(STORAGE.workingRecords, JSON.stringify(workingRecords));
    localStorage.setItem(STORAGE.importHistory, JSON.stringify(oldDataImportHistory));
    queueBackendSave();
    return true;
  } catch (error) {
    console.error("Unable to save application data", error);
    toast("Unable to save. Device storage may be full; download a backup and remove unused photos.");
    return false;
  }
}

function fmt(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function dateText(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN");
}

function localIsoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIso() {
  return localIsoDate();
}

function isValidIsoDate(value) {
  const normalized = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const date = new Date(`${normalized}T00:00:00`);
  return !Number.isNaN(date.getTime()) && localIsoDate(date) === normalized;
}

function weekdayForIsoDate(value) {
  if (!isValidIsoDate(value)) return "";
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    new Date(`${String(value).slice(0, 10)}T00:00:00`).getDay()
  ];
}

function directorRecoveryEntryDate(loanIndex) {
  if (!canBackdateOperationalEntries()) return todayIso();
  const selected = String(directorRecoveryEntryDates.get(Number(loanIndex)) || "").slice(0, 10);
  return isValidIsoDate(selected) && selected <= todayIso() ? selected : todayIso();
}

function setDirectorRecoveryEntryDate(loanIndex, value) {
  if (!canBackdateOperationalEntries()) {
    toast("Only the Director can select a previous recovery entry date.");
    return;
  }
  const selected = String(value || "").slice(0, 10);
  if (!isValidIsoDate(selected) || selected > todayIso()) {
    toast("Select today or a previous recovery date.");
    renderRecoveryCentre(Number(loanIndex));
    return;
  }
  directorRecoveryEntryDates.set(Number(loanIndex), selected);
  renderRecoveryCentre(Number(loanIndex));
}

function todayWeekday() {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
}

function addActivity(message) {
  const activity = $("#activity");
  if (!activity) return;
  const item = document.createElement("li");
  item.innerHTML = `<i></i><span>${escapeHtml(message)}</span><small>Now</small>`;
  activity.prepend(item);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function role() {
  return currentUser?.designation || $("#userRole")?.textContent || "";
}

function hasPageAccess(page) {
  return Boolean(ROLE_ACCESS[role()]?.includes(page));
}

function canManageVerification() {
  return ["Director", "Manager", "Assistant Manager"].includes(role());
}

function canEditVerificationGroup(group) {
  if (!canManageVerification()) return false;
  return !loanForGroup(group) || role() === "Director";
}

function canDeleteVerificationGroup(group) {
  return role() === "Director" && !loanForGroup(group);
}

function canDecideVerification() {
  return ["Director", "Manager"].includes(role());
}

function canManageEmployees() {
  return ["Director", "Manager"].includes(role());
}

function canCreateDebitVoucher() {
  return ["Director", "Manager", "Cashier"].includes(role());
}

function canManageCalendar() {
  return ["Director", "Manager"].includes(role());
}

function canImportOldData() {
  return role() === "Director";
}

function canBackdateOperationalEntries() {
  return role() === "Director";
}

function canEnterRecovery() {
  return role() !== "Staff" && ["Director", "Manager", "Cashier", "Executive"].includes(role());
}

function canProposeRecovery() {
  return role() === "Staff";
}

function canReassignRecoveryStaff() {
  return ["Director", "Cashier", "Assistant Manager"].includes(role());
}

function isAssistantManagerTeamViewer() {
  return role() === "Assistant Manager";
}

function recoveryUsesTeamScope() {
  return canProposeRecovery() || isAssistantManagerTeamViewer();
}

function assistantManagerRecoveryStaffNames() {
  if (!isAssistantManagerTeamViewer()) return [];
  return assignedTeamStaff(currentUser).map((staff) => staff.name).filter(Boolean);
}

function recoveryStaffAccount(staffName, staffLoginId = "") {
  const loginKey = String(staffLoginId || "").trim().toLowerCase();
  const nameKey = String(staffName || "").trim().toLowerCase();
  return employeeAccounts.find((account) => account.designation === "Staff" && (
    (loginKey && String(account.loginId || "").trim().toLowerCase() === loginKey) ||
    (nameKey && String(account.name || "").trim().toLowerCase() === nameKey)
  )) || null;
}

function recoveryStaffAssignmentFields(account) {
  return {
    recoveryStaffLoginId: String(account?.loginId || ""),
    recoveryManagerLoginId: String(account?.managerLoginId || ""),
    recoveryManagerName: String(account?.managerName || ""),
    recoveryAssistantManagerLoginId: String(account?.assistantManagerLoginId || ""),
    recoveryAssistantManagerName: String(account?.assistantManagerName || ""),
  };
}

function canViewRecoveryLoan(loan) {
  if (canProposeRecovery()) return String(loan?.staff || "") === String(currentUser?.name || "");
  if (isAssistantManagerTeamViewer()) {
    const assistantLogin = String(currentUser?.loginId || "").trim().toLowerCase();
    if (assistantLogin && String(loan?.recoveryAssistantManagerLoginId || "").trim().toLowerCase() === assistantLogin) return true;
    const assignedAccount = recoveryStaffAccount(loan?.staff, loan?.recoveryStaffLoginId);
    if (assignedAccount?.active === false && String(assignedAccount.assistantManagerLoginId || "").trim().toLowerCase() === assistantLogin) return true;
    if (!assignedAccount) return true;
    return assistantManagerRecoveryStaffNames().includes(loan?.staff);
  }
  return true;
}

function canApproveRecoveryProposal() {
  return ["Cashier", "Executive"].includes(role());
}

function canEditRecoveryProposal() {
  return role() === "Director";
}

function canEditHoldEntries() {
  return role() === "Director";
}

function canEnterHoldLoan() {
  return hasPageAccess("hold");
}

function holdReleaseEmployeeName(transaction) {
  return String(
    transaction?.releasedByName ||
    transaction?.releasedBy ||
    transaction?.enteredByName ||
    transaction?.enteredBy ||
    "Employee unavailable (old entry)"
  );
}

function canManageProcessedLoans() {
  return role() === "Director";
}

function firstPageForRole(userRole) {
  return ROLE_ACCESS[userRole]?.[0] || "overview";
}

function showPage(page) {
  if (!hasPageAccess(page)) {
    toast("Your login does not have access to this feature.");
    return;
  }
  window.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
  $$(".page").forEach((section) => section.classList.remove("active-page"));
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  $(`#${page}`).classList.add("active-page");
  $("#breadcrumb").textContent = page === "overview" ? "OPERATIONS DESK" : page.toUpperCase();
  $("#pageTitle").textContent = PAGE_TITLES[page] || page;
  renderAll();
  if (page === "verification") renderGroups();
  if (page === "loans") renderLoans();
  if (page === "recovery") renderRecovery();
  if (page === "team-target") renderTeamMonthlyTarget();
  if (page === "approvals") renderRecoveryApprovals();
  if (page === "hold") renderHoldLoans();
  if (page === "cashbook") renderCashbook();
  if (page === "calendar") renderCalendar();
  if (page === "employees") {
    renderEmployees();
    renderSalaryManagement();
    updateEmployeeManagementView();
  }
}

function updateNavigation() {
  const allowed = ROLE_ACCESS[role()] || [];
  $$(".nav").forEach((button) => {
    button.style.display = allowed.includes(button.dataset.page) ? "flex" : "none";
  });
  $$("[data-go]").forEach((button) => {
    button.style.display = allowed.includes(button.dataset.go) ? "" : "none";
  });
}

function loanProcessingTotal(loan) {
  const customerTotal = (loan?.individualLoans || []).reduce(
    (sum, item) => sum + Number(item.processingFee || 0),
    0
  );
  const savedTotal = Number(loan?.processingFees);
  return Number.isFinite(savedTotal) && savedTotal > 0 ? savedTotal : customerTotal;
}

function monthlyProcessingRecords(asOf = todayIso()) {
  const month = asOf.slice(0, 7);
  return loans
    .filter((loan) => {
      const date = cashbookDate(loan.disbursedOn);
      return date.slice(0, 7) === month && date <= asOf;
    })
    .sort((a, b) => cashbookDate(b.disbursedOn).localeCompare(cashbookDate(a.disbursedOn)));
}

function processingCustomerBreakupHtml(loan) {
  const group = groups.find(
    (record) => record.code === loan.groupCode || record.code === loan.code || record.number === loan.groupNumber
  );
  const fees = (loan.individualLoans || [])
    .map((individual, index) => {
      const memberIndex = Number.isFinite(Number(individual.memberIndex)) ? Number(individual.memberIndex) : index;
      const amount = Number(individual.processingFee || 0);
      if (amount <= 0) return "";
      const name = group?.members?.[memberIndex]?.name || individual.customerName || `Customer A${String(memberIndex + 1).padStart(2, "0")}`;
      return `<span><b>${escapeHtml(name)}</b><strong>${fmt(amount)}</strong></span>`;
    })
    .filter(Boolean);
  return fees.length
    ? `<div class="processing-customer-breakup">${fees.join("")}</div>`
    : '<small class="muted">Customer-wise breakup unavailable for this older record.</small>';
}

function renderMonthlyProcessingDetails(records, asOf = todayIso()) {
  const body = $("#monthlyProcessingRows");
  const total = records.reduce((sum, loan) => sum + loanProcessingTotal(loan), 0);
  $("#monthlyProcessingDetailsTotal").textContent = fmt(total);
  $("#monthlyProcessingDetailsTitle").textContent = `${new Date(`${asOf.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  })} processing entries up to ${dateText(asOf)}`;
  body.innerHTML = records.length
    ? records.map((loan) => `<tr><td>${dateText(cashbookDate(loan.disbursedOn))}</td><td><b>${escapeHtml(loan.groupNumber || "Not assigned")}</b><small>${escapeHtml(loan.groupName || "Centre")}</small></td><td>${processingCustomerBreakupHtml(loan)}</td><td><b>${fmt(loanProcessingTotal(loan))}</b><small>${Number(loan.members || loan.individualLoans?.length || 0)} customers</small></td></tr>`).join("")
    : '<tr><td colspan="4" class="empty">No processing was collected in this month up to today.</td></tr>';
}

function setMonthlyProcessingDetailsOpen(open) {
  const allowed = ["Director", "Manager"].includes(role());
  const details = $("#monthlyProcessingDetails");
  const card = $("#monthlyProcessingCard");
  const shouldOpen = Boolean(open && allowed);
  details.classList.toggle("hidden", !shouldOpen);
  details.setAttribute("aria-hidden", String(!shouldOpen));
  card.setAttribute("aria-expanded", String(shouldOpen));
}

function toggleMonthlyProcessingDetails() {
  if (!["Director", "Manager"].includes(role())) return;
  setMonthlyProcessingDetailsOpen($("#monthlyProcessingDetails").classList.contains("hidden"));
}

function currentMarketOutstandingTotal() {
  return loans.reduce((total, loan) => {
    const customerLoans = Array.isArray(loan?.individualLoans) ? loan.individualLoans : [];
    const outstanding = customerLoans.length
      ? customerLoans.reduce((sum, individual) => sum + customerTotalBalance(individual), 0)
      : Math.max(0, Number(loan?.balance || 0));
    return total + outstanding;
  }, 0);
}

function activeCentreWeeklyRecovery(loan) {
  const customerLoans = Array.isArray(loan?.individualLoans) ? loan.individualLoans : [];
  if (customerLoans.length) {
    return customerLoans.reduce((total, individual) => {
      const principalBalance = Math.max(0, Number(individual?.balance || 0));
      if (individual?.closedAt || principalBalance <= 0) return total;
      return total + Math.min(Math.max(0, Number(individual?.emi || 0)), principalBalance);
    }, 0);
  }
  return Math.min(Math.max(0, Number(loan?.emi || 0)), Math.max(0, Number(loan?.balance || 0)));
}

function weeklyRecoveryTotalsByDay() {
  const totals = Object.fromEntries(DAYS.map((day) => [day, { centres: 0, amount: 0 }]));
  loans.forEach((loan) => {
    const recoveryDay = DAYS.includes(loan?.day) ? loan.day : "";
    const singleRecovery = activeCentreWeeklyRecovery(loan);
    if (!recoveryDay || singleRecovery <= 0) return;
    totals[recoveryDay].centres += 1;
    totals[recoveryDay].amount += singleRecovery;
  });
  return totals;
}

function allTimeRecoveryTotal(totalsByDay = weeklyRecoveryTotalsByDay()) {
  return DAYS.reduce((total, day) => total + Number(totalsByDay[day]?.amount || 0), 0);
}

function renderOverview() {
  const activeBalance = currentMarketOutstandingTotal();
  const recoveryByDay = weeklyRecoveryTotalsByDay();
  const allTimeRecovery = allTimeRecoveryTotal(recoveryByDay);
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const asOf = todayIso();
  const currentMonth = asOf.slice(0, 7);
  const canViewMonthlyProcessing = ["Director", "Manager"].includes(role());
  const processingRecords = canViewMonthlyProcessing ? monthlyProcessingRecords(asOf) : [];
  const monthlyProcessing = processingRecords.reduce((sum, loan) => sum + loanProcessingTotal(loan), 0);
  const todayDemand = loans
    .filter((loan) => loan.day === todayName)
    .reduce((sum, loan) => sum + currentLoanDemand(loan), 0);
  $("#pendingCount").textContent = groups.filter((group) =>
    !loanForGroup(group) && group.members.some((member) => member.status === "Pending")
  ).length;
  $("#portfolio").textContent = fmt(activeBalance);
  $("#allTimeRecovery").textContent = fmt(allTimeRecovery);
  $("#allTimeRecoveryByDay").innerHTML = DAYS.map(
    (day) => `<span><i>${day.slice(0, 3)}</i><b>${fmt(recoveryByDay[day].amount)}</b><em>${recoveryByDay[day].centres} centre${recoveryByDay[day].centres === 1 ? "" : "s"}</em></span>`
  ).join("");
  $("#due").textContent = fmt(todayDemand);
  $("#monthlyProcessingCard").classList.toggle("hidden", !canViewMonthlyProcessing);
  $("#monthlyProcessing").textContent = canViewMonthlyProcessing ? fmt(monthlyProcessing) : fmt(0);
  $("#monthlyProcessingPeriod").textContent = canViewMonthlyProcessing
    ? `${new Date(`${currentMonth}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })} · Open details`
    : "";
  if (canViewMonthlyProcessing) renderMonthlyProcessingDetails(processingRecords, asOf);
  else {
    $("#monthlyProcessingRows").innerHTML = "";
    setMonthlyProcessingDetailsOpen(false);
  }
  $("#fieldOfficerCount").textContent = employeeAccounts.filter(
    (account) =>
      account.active !== false &&
      ["Assistant Manager", "Executive", "Staff"].includes(account.designation)
  ).length;
  $("#today").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function normalizeGroup(group, index) {
  if (!group.code) group.code = `NMC-${String(index + 1).padStart(3, "0")}`;
  if (!Array.isArray(group.members)) group.members = [];
  group.members.forEach((member) => {
    if (!member.status) member.status = "Pending";
  });
  return group;
}

groups = groups.map(normalizeGroup);

function loanForGroup(group) {
  return loans.find((loan) => loan.groupCode === group.code || loan.code === group.code);
}

function approvedMembers(group) {
  return group.members
    .map((member, index) => ({ member, index }))
    .filter(
      ({ member }) =>
        member.status === "Approved" && memberHasCompleteAadhaar(member) && !memberNpaRegistryMatch(member)
    );
}

function nextGroupNumber() {
  const used = [...groups, ...loans]
    .map((item) => Number(String(item.number || item.groupNumber || "").replace(/^G/i, "")))
    .filter((value) => Number.isFinite(value));
  return `G${used.length ? Math.max(...used) + 1 : 1}`;
}

function groupNumber(group) {
  return group.number || "Not assigned";
}

function normalizeAadhaar(value) {
  return String(value || "").replace(/\D/g, "");
}

function maskedAadhaar(value) {
  const aadhaar = normalizeAadhaar(value);
  return aadhaar.length === 12 ? `XXXX XXXX ${aadhaar.slice(-4)}` : "Aadhaar not entered";
}

function memberHasCompleteAadhaar(member) {
  return normalizeAadhaar(member?.uuid).length === 12 && normalizeAadhaar(member?.guarantorAadhaar).length === 12;
}

function npaRegistryMatch(value) {
  const aadhaar = normalizeAadhaar(value);
  if (aadhaar.length !== 12) return null;
  return npaRegistry.find((record) => record.aadhaar === aadhaar) || null;
}

function memberNpaRegistryMatch(member) {
  const customerMatch = npaRegistryMatch(member?.uuid);
  if (customerMatch) return { record: customerMatch, field: "Customer Aadhaar" };
  const guarantorMatch = npaRegistryMatch(member?.guarantorAadhaar);
  if (guarantorMatch) return { record: guarantorMatch, field: "Guarantor Aadhaar" };
  return null;
}

function registerNpaCustomer(loan, individual, group, asOf = todayIso()) {
  const member = group?.members?.[individual?.memberIndex];
  const identities = [
    { aadhaar: member?.uuid, name: member?.name || "Customer", sourceRole: "Customer" },
    { aadhaar: member?.guarantorAadhaar, name: member?.guarantor || "Guarantor", sourceRole: "Guarantor" },
  ];
  let changed = false;
  identities.forEach((identity) => {
    const aadhaar = normalizeAadhaar(identity.aadhaar);
    if (aadhaar.length !== 12 || npaRegistry.some((record) => record.aadhaar === aadhaar)) return;
    npaRegistry.push({
      aadhaar,
      name: identity.name,
      sourceRole: identity.sourceRole,
      linkedCustomerName: member?.name || "Customer",
      groupNumber: loan?.groupNumber || group?.number || "",
      groupName: loan?.groupName || group?.name || "",
      loanId: loan?.id || loan?.groupCode || loan?.code || "",
      addedAt: asOf,
      status: "NPA",
    });
    changed = true;
  });
  return changed;
}

function updateMemberNpaStatus(member, notify = false) {
  if (!member) return null;
  const blocked = memberNpaRegistryMatch({
    uuid: member.querySelector(".m-uuid")?.value,
    guarantorAadhaar: member.querySelector(".m-guarantor-aadhaar")?.value,
  });
  const match = blocked?.record;
  const wasBlocked = member.dataset.npaBlocked === "true";
  const decisionStatus = member.querySelector(".decision-status");
  let alert = member.querySelector(".npa-customer-alert");

  if (match) {
    member.dataset.npaBlocked = "true";
    member.dataset.npaBlockedField = blocked.field;
    member.dataset.status = "NPA Customer";
    member.classList.add("npa-customer");
    member.querySelectorAll(".decision-btn").forEach((button) => {
      button.classList.remove("selected");
      button.disabled = true;
    });
    if (decisionStatus) decisionStatus.textContent = "NPA BLOCKED";
    if (!alert) {
      alert = document.createElement("div");
      alert.className = "npa-customer-alert";
      member.querySelector(".member-title")?.insertAdjacentElement("afterend", alert);
    }
    alert.innerHTML = `<b>NPA CUSTOMER / GUARANTOR</b><span>${escapeHtml(blocked.field)} ${escapeHtml(maskedAadhaar(match.aadhaar))} matches blocked ${escapeHtml(match.sourceRole || "Customer")} ${escapeHtml(match.name || "")}${match.groupNumber ? ` · NPA account ${escapeHtml(match.groupNumber)}` : ""}. This verification can never be approved.</span>`;
    if (notify && !wasBlocked) toast("NPA blocked: customer or guarantor Aadhaar cannot be approved for a loan.");
    return blocked;
  }

  delete member.dataset.npaBlocked;
  delete member.dataset.npaBlockedField;
  member.classList.remove("npa-customer");
  alert?.remove();
  if (member.dataset.status === "NPA Customer") {
    member.dataset.status = "Pending";
    if (decisionStatus) decisionStatus.textContent = "Pending";
  }
  return null;
}

function renderVerificationPhoto(member) {
  const preview = member?.querySelector(".verification-photo-preview");
  if (!preview) return;
  const photoData = member.dataset.photoData || "";
  const customerName = member.querySelector(".m-name")?.value?.trim() || "Customer";
  preview.classList.toggle("has-photo", Boolean(photoData));
  preview.innerHTML = photoData
    ? `<img src="${photoData}" alt="${escapeHtml(customerName)} customer photo">`
    : '<div class="verification-photo-empty"><span>◎</span><small>Photo not uploaded</small></div>';
}

function memberNode(data = {}) {
  const fragment = $("#memberTemplate").content.cloneNode(true);
  const member = fragment.querySelector(".member");
  const status = data.status || "Pending";
  member.dataset.status = status;
  member.dataset.photoData = data.photoData || "";
  member.dataset.location = data.location ? JSON.stringify(data.location) : "";

  const fields = {
    name: ".m-name",
    uuid: ".m-uuid",
    address: ".m-address",
    dob: ".m-dob",
    mobile: ".m-mobile",
    occupation: ".m-occupation",
    income: ".m-income",
    guarantor: ".m-guarantor",
    guarantorAadhaar: ".m-guarantor-aadhaar",
    gdob: ".m-gdob",
    goccupation: ".m-goccupation",
    gincome: ".m-gincome",
    relation: ".m-relation",
    purpose: ".m-purpose",
    request: ".m-request",
  };
  Object.entries(fields).forEach(([key, selector]) => {
    member.querySelector(selector).value = data[key] ?? "";
  });
  member.querySelector(".m-loans").checked = Boolean(data.loans);
  member.querySelector(".m-cheque").checked = Boolean(data.cheque);
  member.querySelector(".decision-status").textContent = status;
  if (status === "Approved") member.querySelector(".decision-btn.approve")?.classList.add("selected");
  if (status === "Cancelled") member.querySelector(".decision-btn.cancel")?.classList.add("selected");
  if (data.location) member.querySelector(".location-status").textContent = "Location captured ✓";
  renderVerificationPhoto(member);
  return fragment;
}

function updateMemberLabels() {
  [...$("#members").children].forEach((member, index) => {
    member.querySelector(".member-number").textContent = String(index + 1).padStart(2, "0");
    member.querySelector(".member-label").textContent =
      index === 0 ? "Group Head 1" : index === 1 ? "Group Head 2" : `Customer ${index + 1}`;
    member.querySelector(".remove-member").style.display = $("#members").children.length > 5 ? "" : "none";
    updateMemberNpaStatus(member);
  });
  applyVerificationPermissions();
}

function applyVerificationPermissions() {
  const editable = canManageVerification();
  const decision = canDecideVerification();
  $("#verificationForm")
    ?.querySelectorAll("input, select")
    .forEach((control) => {
      if (!control.classList.contains("m-photo")) control.disabled = !editable;
    });
  $$(".decision-btn").forEach((button) => {
    button.style.display = decision ? "inline-block" : "none";
    button.disabled = !decision || button.closest(".member")?.dataset.npaBlocked === "true";
  });
  $$(".location, .remove-member, #addMember, #saveGroup").forEach((button) => {
    button.style.display = editable ? "" : "none";
  });
  $$(".decision").forEach((area) => {
    let note = area.querySelector(".decision-note");
    if (!decision && !note) {
      note = document.createElement("small");
      note.className = "decision-note";
      note.textContent = "Decision by Director / Manager";
      area.append(note);
    } else if (decision && note) {
      note.remove();
    }
  });
}

function readMember(element) {
  const value = (selector) => element.querySelector(selector)?.value?.trim() || "";
  let location = null;
  try {
    location = element.dataset.location ? JSON.parse(element.dataset.location) : null;
  } catch {
    location = null;
  }
  return {
    name: value(".m-name"),
    uuid: value(".m-uuid"),
    address: value(".m-address"),
    dob: value(".m-dob"),
    mobile: value(".m-mobile"),
    occupation: value(".m-occupation"),
    income: value(".m-income"),
    guarantor: value(".m-guarantor"),
    guarantorAadhaar: value(".m-guarantor-aadhaar"),
    gdob: value(".m-gdob"),
    goccupation: value(".m-goccupation"),
    gincome: value(".m-gincome"),
    relation: value(".m-relation"),
    purpose: value(".m-purpose"),
    request: value(".m-request"),
    loans: element.querySelector(".m-loans").checked,
    cheque: element.querySelector(".m-cheque").checked,
    status: element.dataset.npaBlocked === "true" ? "NPA Customer" : element.dataset.status || "Pending",
    photoData: element.dataset.photoData || "",
    location,
  };
}

function openVerificationWorkspace() {
  showPage("verification");
  const targetHost = $("#verificationFormHost");
  const form = $("#verificationForm");
  if (targetHost && form && form.parentElement !== targetHost) targetHost.appendChild(form);
}

function newVerification() {
  if (!canManageVerification()) {
    toast("Your login can view verification records but cannot create them.");
    return;
  }
  openVerificationWorkspace();
  delete $("#verificationForm").dataset.edit;
  $("#groupName").value = "";
  $("#centreAddress").value = "";
  $("#fieldOfficer").value = "";
  $("#meetingDay").value = "Monday";
  $("#recoveryTime").value = "10:00";
  $("#members").innerHTML = "";
  for (let index = 0; index < 5; index += 1) $("#members").append(memberNode());
  populateStaffSelects();
  updateMemberLabels();
  $("#verificationForm").classList.remove("hidden");
}

function editGroup(index) {
  const group = groups[index];
  if (!group) return;
  if (!canEditVerificationGroup(group)) {
    toast("After loan disbursement, only the Director can edit this record.");
    return;
  }
  openVerificationWorkspace();
  $("#verificationForm").dataset.edit = String(index);
  $("#groupName").value = group.name || "";
  $("#centreAddress").value = group.centreAddress || "";
  $("#fieldOfficer").value = group.officer || "";
  $("#meetingDay").value = group.day || "Monday";
  $("#recoveryTime").value = group.recoveryTime || "10:00";
  populateStaffSelects();
  $("#groupLoanStaff").value = group.loanStaff || $("#groupLoanStaff").options[0]?.value || "";
  $("#groupRecoveryStaff").value = group.recoveryStaff || $("#groupRecoveryStaff").options[0]?.value || "";
  $("#members").innerHTML = "";
  group.members.forEach((member) => $("#members").append(memberNode(member)));
  updateMemberLabels();
  $("#verificationForm").classList.remove("hidden");
}

function saveGroup() {
  if (!canManageVerification()) {
    toast("Only Director, Manager, or Assistant Manager can edit verification details.");
    return;
  }
  const editIndex = $("#verificationForm").dataset.edit;
  const previous = editIndex !== undefined ? groups[Number(editIndex)] : null;
  if (previous && loanForGroup(previous) && role() !== "Director") {
    toast("After loan disbursement, only the Director can edit this record.");
    return;
  }
  const name = $("#groupName").value.trim();
  [...$("#members").children].forEach((member) => updateMemberNpaStatus(member));
  const members = [...$("#members").children].map(readMember);
  if (!name) {
    toast("Enter the group or centre name.");
    return;
  }
  if (members.length < 5 || members.length > 9) {
    toast("A group must contain between 5 and 9 customers.");
    return;
  }
  if (members.some((member) => !member.name)) {
    toast("Enter a name for every customer.");
    return;
  }
  const group = {
    name,
    code: previous?.code || `NMC-${Date.now()}`,
    number: previous?.number,
    centreAddress: $("#centreAddress").value.trim(),
    recoveryTime: $("#recoveryTime").value || "10:00",
    officer: $("#fieldOfficer").value.trim(),
    day: $("#meetingDay").value,
    loanStaff: $("#groupLoanStaff").value,
    recoveryStaff: $("#groupRecoveryStaff").value,
    members,
    createdAt: previous?.createdAt || new Date().toISOString(),
    createdByLogin: previous?.createdByLogin || currentUser?.loginId || "",
    createdByName: previous?.createdByName || currentUser?.name || "",
    updatedAt: new Date().toISOString(),
  };
  if (previous) groups[Number(editIndex)] = group;
  else groups.push(group);
  if (!persistAll()) {
    if (previous) groups[Number(editIndex)] = previous;
    else groups.pop();
    return;
  }
  $("#verificationForm").classList.add("hidden");
  renderAll();
  addActivity(`Verification saved for ${name}`);
  toast(previous ? "Verification group updated." : "Verification group saved.");
}

function renderGroups() {
  const query = $("#groupSearch").value || "";
  const visible = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => !loanForGroup(group))
    .filter(({ group }) => matchesGroupSearch(
      query,
      group.number,
      [group.name, ...(group.members || []).map((member) => member.name)]
    ));
  const verificationCreateButton = $("#newVerification");
  if (verificationCreateButton) verificationCreateButton.style.display = canManageVerification() ? "" : "none";
  $("#verificationList").innerHTML = visible.length
    ? visible
        .map(({ group, index }) => {
          const approved = approvedMembers(group).length;
          const npaBlocked = group.members.filter(
            (member) => member.status === "NPA Customer" || Boolean(memberNpaRegistryMatch(member))
          ).length;
          const cancelled = group.members.filter(
            (member) => member.status === "Cancelled" && !memberNpaRegistryMatch(member)
          ).length;
          const pending = group.members.length - approved - cancelled - npaBlocked;
          return `<article class="group-card">
            <p class="eyebrow">VERIFICATION FILE</p>
            <h3>${escapeHtml(group.name)}</h3>
            <p>Group Head 1: ${escapeHtml(group.members[0]?.name || "Not entered")}</p>
            <div class="badges">
              <span class="badge">${approved} approved</span>
              ${cancelled ? `<span class="badge cancelled">${cancelled} cancelled</span>` : ""}
              ${npaBlocked ? `<span class="badge npa-badge">${npaBlocked} NPA blocked</span>` : ""}
              <span class="badge pending">${pending} pending</span>
            </div>
            <footer>
              <span>${group.members.length} members</span>
              <span>${escapeHtml(group.day || "—")}</span>
              <button class="collection-btn" type="button" onclick="viewGroup(${index})">Open folder</button>
            </footer>
          </article>`;
        })
        .join("")
    : '<div class="empty panel">No pending verification groups. Processed groups are available in Loan Record.</div>';
}

function memberRoleLabel(index) {
  return index === 0 ? "Group Head 1" : index === 1 ? "Group Head 2" : `Customer ${index + 1}`;
}

function loanSanctionDate(loan) {
  return String(loan?.sanctionDate || loan?.disbursedOn || "").slice(0, 10);
}

function loanRecoveryStartMode(loan) {
  const firstRecoveryDate = String(loan?.firstRecoveryDate || "").slice(0, 10);
  if (loan?.recoveryStartWeek === "custom" && isValidIsoDate(firstRecoveryDate)) {
    return `date:${firstRecoveryDate}`;
  }
  return ["current", "next"].includes(loan?.recoveryStartWeek) ? loan.recoveryStartWeek : "legacy";
}

function recoveryStartSelectionForEdit(loan) {
  const saved = loanRecoveryStartMode(loan);
  if (saved.startsWith("date:")) return "custom";
  if (saved !== "legacy") return saved;
  const disbursed = new Date(loan?.disbursedOn || new Date().toISOString());
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const targetDay = weekdays.indexOf(loan?.day);
  if (Number.isNaN(disbursed.getTime()) || targetDay < 0) return "next";
  return (targetDay - disbursed.getDay() + 7) % 7 === 0 ? "next" : "current";
}

function viewGroup(index) {
  const group = groups[index];
  if (!group) return;
  const activePage = $(".page.active-page")?.id;
  const folderHost = activePage === "loans" ? $("#loanGroupFolderHost") : $("#verification");
  const folder = $("#groupFolder");
  if (folderHost && folder && folder.parentElement !== folderHost) folderHost.appendChild(folder);
  const loan = loanForGroup(group);
  const loanIndex = loan ? loans.indexOf(loan) : -1;
  const editable = canEditVerificationGroup(group);
  const deletable = canDeleteVerificationGroup(group);
  const groupProcessingTotal = loan
    ? Number(loan.processingFees ?? (loan.individualLoans || []).reduce((sum, item) => sum + Number(item.processingFee || 0), 0))
    : 0;
  $("#groupFolder").innerHTML = `
    <div class="panel-head">
      <div><p class="eyebrow">GROUP FOLDER · ${escapeHtml(groupNumber(group))}</p><h3>${escapeHtml(group.name)}</h3></div>
      <div class="group-folder-head-actions">${loan ? `<div class="folder-processing-total"><span>Group processing total</span><b>${fmt(groupProcessingTotal)}</b></div>` : ""}${editable ? `<button class="outline" type="button" onclick="editGroup(${index})">Edit group</button>` : loan ? '<span class="status">Director edit only</span>' : ""}
      ${deletable ? `<button class="outline danger-action" type="button" onclick="deleteVerificationGroup(${index})">Delete group</button>` : ""}
      <button class="icon-close" type="button" onclick="closeGroupFolder()">×</button></div>
    </div>
    <div class="details-grid">
      <div><span>Centre ID</span><b>${loan ? `${escapeHtml(loan.groupNumber)} (A1-A${String(group.members.length).padStart(2, "0")})` : "Assigned during loan processing"}</b></div>
      <div><span>Centre Name</span><b>${escapeHtml(group.name)}</b></div>
      <div><span>Centre Rec Day</span><b>${escapeHtml(group.day || "—")}</b></div>
      <div><span>Centre Rec Time</span><b>${escapeHtml(group.recoveryTime || "10:00")}</b></div>
      <div><span>Centre Rec Amt</span><b>${loan ? fmt(currentLoanDemand(loan)) : "Not set"}</b></div>
      <div><span>No. of Members</span><b>${group.members.length}</b></div>
      <div class="detail-wide"><span>Centre Address</span><b>${escapeHtml(group.centreAddress || "Not entered")}</b></div>
      <div><span>Group Loan Amt</span><b>${loan ? fmt(loan.amount) : "Not disbursed"}</b></div>
      <div><span>Loan Sanction Date</span><b>${loan ? dateText(loanSanctionDate(loan)) : "Not sanctioned"}</b></div>
      <div><span>Recovery Schedule Starts</span><b>${loan ? `${recoveryStartSelectionForEdit(loan) === "next" ? "Next week" : "Current week"}` : "Not selected"}</b></div>
      <div><span>First Recovery Date</span><b>${loan ? dateText(scheduleRows(1, loan.disbursedOn, loan.day, loanRecoveryStartMode(loan)).find((row) => row.type === "installment")?.date) : "—"}</b></div>
      <div><span>Total Processing Fees</span><b>${loan ? fmt(groupProcessingTotal) : "Not calculated"}</b></div>
      <div><span>Group Leader-1</span><b>${escapeHtml(group.members[0]?.name || "—")}</b></div>
      <div><span>Group Leader-2</span><b>${escapeHtml(group.members[1]?.name || "—")}</b></div>
      <div><span>Executive Name</span><b>${escapeHtml(group.loanStaff || group.officer || "—")}</b></div>
    </div>
    ${loan && canBackdateOperationalEntries() ? `<section class="historical-recovery-workspace"><div class="member-bar historical-recovery-bar"><div><h3>Previous recovery entry · Director</h3><p>Enter customer recovery already received for this old loan, using the correct previous date.</p></div>${loan.historyImportPending ? '<span class="status history-import-status">Old entries pending · penalty/NPA paused</span>' : '<span class="status">Director only</span>'}</div><div id="loanHistoryRecoveryPanel" class="historical-recovery-panel"></div></section>` : ""}
    <div class="member-bar"><div><h3>Customer folders</h3><p>Open an individual customer file and repayment schedule.</p></div></div>
    <div class="customer-folders">
      ${group.members
        .map(
          (member, memberIndex) =>
            `<button type="button" onclick="viewCustomer(${index},${memberIndex})">◫<span>${memberRoleLabel(memberIndex)}</span><small>${escapeHtml(member.name || "Customer")}</small></button>`
        )
        .join("")}
    </div>
    <div class="member-bar">
      <div><h3>Weekly group recovery</h3><p>Scheduled group EMI, automatic update time, EMI, advance, and closing entries.</p></div>
      ${
        loan
          ? `<div><button class="outline" type="button" onclick="downloadGroupSchedule(${index})">⇩ Download Excel</button></div>`
          : ""
      }
    </div>
    ${groupScheduleHtml(loan)}
  `;
  $("#groupFolder").classList.remove("hidden");
  if (loan && canBackdateOperationalEntries()) renderLoanHistoryRecoveryPanel(loanIndex);
}

function renderLoanHistoryRecoveryPanel(loanIndex) {
  const panel = $("#loanHistoryRecoveryPanel");
  if (!panel) return;
  if (!canBackdateOperationalEntries()) {
    panel.innerHTML = '<div class="view-only-note">Only the Director can enter previous recovery in Loan Record.</div>';
    return;
  }
  const loan = loans[Number(loanIndex)];
  const group = groups.find(
    (item) => item.code === loan?.groupCode || item.code === loan?.code || item.number === loan?.groupNumber
  );
  if (!loan || !group || !Array.isArray(loan.individualLoans)) {
    panel.innerHTML = '<div class="view-only-note">The customer loan record could not be found.</div>';
    return;
  }
  const entryDate = directorRecoveryEntryDate(loanIndex);
  const recordedEntries = (loan.recoveries || []).filter((recovery) => String(recovery.date || "").slice(0, 10) <= entryDate);
  const recordedTotal = recordedEntries.reduce((sum, recovery) => sum + Number(recovery.amount || 0), 0);
  panel.innerHTML = `
    <div class="historical-recovery-toolbar">
      <div><p class="eyebrow">${escapeHtml(loan.groupNumber || "GROUP")} · RECOVERY HISTORY</p><h4>Enter recovery received up to ${dateText(entryDate)}</h4><p>${loan.historyImportPending ? "Penalty and NPA calculations remain paused until old entries are finished." : "This loan is live. The Director can still correct a missing previous recovery entry."}</p></div>
      <div class="historical-recovery-tools"><label class="director-entry-date">Recovery received date<input type="date" value="${entryDate}" max="${todayIso()}" onchange="setLoanHistoryRecoveryDate(${loanIndex},this.value)"></label><div class="historical-recorded-total"><span>Recorded up to date</span><b>${fmt(recordedTotal)}</b><small>${recordedEntries.length} entries</small></div></div>
    </div>
    <div class="recovery-member-list historical-member-list">
      ${loan.individualLoans.map((individual, position) => {
        const memberIndex = Number.isFinite(Number(individual.memberIndex)) ? Number(individual.memberIndex) : position;
        const member = group.members?.[memberIndex] || {};
        const snapshot = memberDemandSnapshot(loan, individual, entryDate);
        const recoveryDisabled = snapshot.closed || snapshot.demand <= 0;
        const standardAmount = inlineRecoveryDefaultAmount("recovery", snapshot);
        const closingAmount = inlineRecoveryDefaultAmount("closing", snapshot);
        const input = (type, value, disabled = false) => `<input class="inline-entry-amount" type="number" min="${type === "closing" ? "0" : "1"}" step="1" value="${Math.round(value)}" aria-label="Previous ${proposalTypeLabel(type)} amount for ${escapeHtml(member.name || `Customer ${position + 1}`)}" data-history-loan="${loanIndex}" data-history-member="${memberIndex}" data-history-type="${type}"${disabled ? " disabled" : ""}>`;
        return `<article class="recovery-member historical-recovery-member ${snapshot.closed ? "is-closed" : ""}">
          <div class="recovery-member-name"><span>A${String(memberIndex + 1).padStart(2, "0")}</span><div><b>${escapeHtml(member.name || `Customer ${position + 1}`)}</b><small>${escapeHtml(member.mobile || "No mobile number")}</small></div></div>
          <div class="recovery-member-figures"><div><span>Weekly EMI</span><b>${fmt(snapshot.emi)}</b></div><div><span>Demand on selected date</span><b>${fmt(snapshot.demand)}</b></div><div><span>Recovery recorded</span><b>${fmt(snapshot.recovered)}</b></div><div><span>Balance after entries</span><b>${fmt(snapshot.balance)}</b></div></div>
          <div class="recovery-member-status">${recoveryMemberStatusHtml(snapshot, individual)}</div>
          <div class="recovery-member-actions inline-amount-actions">
            ${snapshot.closed ? '<span class="closed-label">CLOSED</span>' : `<div class="inline-entry-option"><label>Recovery${input("recovery", standardAmount, recoveryDisabled)}</label><button class="collection-btn" type="button" onclick="saveHistoricalRecovery(${loanIndex},${memberIndex},'recovery')"${recoveryDisabled ? " disabled" : ""}>Save</button></div><div class="inline-entry-option advance-option"><label>Advance recovery${input("advance", 0)}</label><button class="collection-btn advance-action" type="button" onclick="saveHistoricalRecovery(${loanIndex},${memberIndex},'advance')">Save</button></div><div class="inline-entry-option closing-option"><label>Closing${input("closing", closingAmount)}</label><button class="collection-btn closing-action" type="button" onclick="saveHistoricalRecovery(${loanIndex},${memberIndex},'closing')">Save</button></div>`}
          </div>
          ${memberRecoveryHistoryHtml(loan, memberIndex)}
        </article>`;
      }).join("")}
    </div>
    ${loan.historyImportPending ? `<div class="historical-finish-row"><div><b>All previous recovery and hold entries completed?</b><span>Finish only after every old entry has been checked. Normal penalty and NPA calculation will start.</span></div><button class="collection-btn history-complete-action" type="button" onclick="completeHistoricalLoanEntries(${loanIndex})">Finish old entries</button></div>` : ""}
  `;
}

function setLoanHistoryRecoveryDate(loanIndex, value) {
  if (!canBackdateOperationalEntries()) {
    toast("Only the Director can select a previous recovery date.");
    return;
  }
  const selected = String(value || "").slice(0, 10);
  if (!isValidIsoDate(selected) || selected > todayIso()) {
    toast("Select today or a previous recovery date.");
    renderLoanHistoryRecoveryPanel(Number(loanIndex));
    return;
  }
  directorRecoveryEntryDates.set(Number(loanIndex), selected);
  renderLoanHistoryRecoveryPanel(Number(loanIndex));
}

function saveHistoricalRecovery(loanIndex, memberIndex, entryType) {
  if (!canBackdateOperationalEntries()) {
    toast("Only the Director can enter previous recovery from Loan Record.");
    return;
  }
  if (!["recovery", "advance", "closing"].includes(entryType)) return;
  const panel = $("#loanHistoryRecoveryPanel");
  const input = panel?.querySelector(
    `[data-history-loan="${loanIndex}"][data-history-member="${memberIndex}"][data-history-type="${entryType}"]`
  );
  const amount = Number(input?.value || 0);
  if (!input || !Number.isFinite(amount) || amount < 0 || (entryType !== "closing" && amount <= 0)) {
    toast("Enter a valid previous recovery amount.");
    input?.focus();
    return;
  }
  const loan = loans[Number(loanIndex)];
  if (!loan) return;
  const entryDate = directorRecoveryEntryDate(loanIndex);
  const form = $("#recoveryEntry");
  delete form.dataset.editProposal;
  form.dataset.loan = String(loanIndex);
  form.dataset.member = String(memberIndex);
  form.dataset.type = entryType;
  form.dataset.demandDate = entryDate;
  form.dataset.photoData = "";
  $("#entryDate").value = entryDate;
  $("#entryReceipt").value = "";
  $("#entryAmount").value = String(amount);
  $("#entryPenalty").value = "0";
  $("#entryTimeIn").value = "";
  $("#entryTimeOut").value = "";
  $("#entryAttendance").value = "";
  $("#entryReview").value = `Previous ${proposalTypeLabel(entryType).toLowerCase()} entered by Director`;
  form.classList.add("hidden");
  const recoveryCount = (loan.recoveries || []).length;
  saveRecoveryEntry();
  if ((loan.recoveries || []).length > recoveryCount) renderLoanHistoryRecoveryPanel(Number(loanIndex));
}

function closeGroupFolder() {
  $("#groupFolder").classList.add("hidden");
}

function deleteVerificationGroup(index) {
  const group = groups[index];
  if (!group) return;
  if (role() !== "Director") {
    toast("Only the Director can delete a verification group.");
    return;
  }
  if (loanForGroup(group)) {
    toast("This group cannot be deleted because its loan has already been disbursed.");
    return;
  }
  const confirmed = window.confirm(
    `Delete the verification folder for ${group.name}? This action cannot be undone.`
  );
  if (!confirmed) return;
  const removed = groups.splice(index, 1)[0];
  if (!persistAll()) {
    groups.splice(index, 0, removed);
    return;
  }
  delete $("#verificationForm").dataset.edit;
  $("#verificationForm").classList.add("hidden");
  closeGroupFolder();
  renderAll();
  addActivity(`Verification folder deleted for ${removed.name}`);
  toast("Verification group folder deleted.");
}

function holdForAmount(amount) {
  return LOAN_SLABS[Number(amount)]?.hold || 0;
}

function ageOnDate(dateOfBirth, assessmentDate = todayIso()) {
  if (!dateOfBirth) return null;
  const birth = new Date(`${String(dateOfBirth).slice(0, 10)}T00:00:00`);
  const assessed = new Date(`${String(assessmentDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(assessed.getTime()) || birth > assessed) return null;
  let age = assessed.getFullYear() - birth.getFullYear();
  const beforeBirthday = assessed.getMonth() < birth.getMonth() ||
    (assessed.getMonth() === birth.getMonth() && assessed.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function processingFeeDetails(member, amount, assessmentDate = todayIso()) {
  const slab = PROCESSING_FEES[Number(amount)];
  const customerAge = ageOnDate(member?.dob, assessmentDate);
  const guarantorAge = ageOnDate(member?.gdob, assessmentDate);
  const complete = Boolean(member?.guarantor && customerAge !== null && guarantorAge !== null);
  const customerOver50 = customerAge !== null && customerAge > 50;
  const guarantorOver50 = guarantorAge !== null && guarantorAge > 50;
  const higherFee = customerOver50 || guarantorOver50;
  const reasons = [];
  if (customerOver50) reasons.push(`Customer age ${customerAge}`);
  if (guarantorOver50) reasons.push(`Guarantor age ${guarantorAge}`);
  return {
    configured: Boolean(slab),
    complete,
    customerAge,
    guarantorAge,
    higherFee,
    fee: slab ? Number(higherFee ? slab.over50 : slab.standard) : 0,
    reason: !complete
      ? "Customer DOB, guarantor name and guarantor DOB are required"
      : !slab
        ? "Processing fee is not configured for this custom loan amount"
        : reasons.length
          ? `${reasons.join(" and ")} · higher processing fee`
          : `Customer age ${customerAge}, guarantor age ${guarantorAge} · standard processing fee`,
  };
}

function updateProcessingFeeDisplay(row, group, assessmentDate) {
  const memberIndex = Number(row.dataset.memberIndex);
  const amount = Number(row.querySelector(".i-amount")?.value || 0);
  const details = processingFeeDetails(group?.members?.[memberIndex], amount, assessmentDate);
  row.querySelector(".i-processing-fee").textContent = details.configured && details.complete ? fmt(details.fee) : "Cannot calculate";
  row.querySelector(".i-processing-note").textContent = details.reason;
  row.querySelector(".i-processing").value = details.fee;
  row.querySelector(".processing-fee-box").classList.toggle("fee-warning", !details.configured || !details.complete);
  updateGroupProcessingTotal();
}

function ensureGroupProcessingTotal() {
  let summary = $("#groupProcessingTotalBox");
  if (summary) return summary;
  const panelHead = $("#loanForm .panel-head");
  if (!panelHead) return null;
  summary = document.createElement("div");
  summary.id = "groupProcessingTotalBox";
  summary.className = "group-processing-total";
  summary.innerHTML = "<span>Group processing total</span><b>₹0</b><small>0 customer fees</small>";
  panelHead.insertBefore(summary, panelHead.querySelector(".icon-close"));
  return summary;
}

function updateGroupProcessingTotal() {
  const summary = ensureGroupProcessingTotal();
  if (!summary) return;
  const rows = $$("#individualLoanInputs .individual-loan");
  const total = rows.reduce(
    (sum, row) => sum + Number(row.querySelector(".i-processing")?.value || 0),
    0
  );
  const incomplete = rows.filter((row) => row.querySelector(".processing-fee-box")?.classList.contains("fee-warning")).length;
  summary.querySelector("b").textContent = fmt(total);
  summary.querySelector("small").textContent = incomplete
    ? `${incomplete} customer fee${incomplete === 1 ? "" : "s"} need complete details`
    : `${rows.length} customer fee${rows.length === 1 ? "" : "s"}`;
  summary.classList.toggle("fee-warning", incomplete > 0);
}

function renderIndividualLoanInputs(groupIndex, existingLoan = null) {
  const group = groups[groupIndex];
  if (!group) return;
  const processingAssessmentDate = existingLoan?.disbursedOn || todayIso();
  const participants = existingLoan?.individualLoans?.length
    ? existingLoan.individualLoans.map((loan) => ({
        member: group.members[loan.memberIndex],
        index: loan.memberIndex,
        loan,
      }))
    : approvedMembers(group).map(({ member, index }) => ({ member, index, loan: null }));
  $("#individualLoanInputs").innerHTML = participants
    .map(({ member, index, loan }) => {
      const requested = Number(loan?.amount ?? member?.request ?? 0);
      const term = Number(loan?.term || LOAN_SLABS[requested]?.term || 0);
      const emi = Number(loan?.emi || LOAN_SLABS[requested]?.emi || 0);
      const slabValue = `${requested}|${term}|${emi}`;
      const processing = processingFeeDetails(member, requested, processingAssessmentDate);
      return `<article class="member individual-loan" data-member-index="${index}">
        <div class="member-title">
          <span class="member-number">${String(index + 1).padStart(2, "0")}</span>
          <div><b>${escapeHtml(member?.name || `Customer ${index + 1}`)}</b><small>${memberRoleLabel(index)}</small></div>
        </div>
        <div class="form-grid">
          <label>Loan slab
            <select class="i-slab">
              <option value="">Custom loan</option>
              ${Object.entries(LOAN_SLABS)
                .map(
                  ([amount, details]) =>
                    `<option value="${amount}|${details.term}|${details.emi}" ${slabValue === `${amount}|${details.term}|${details.emi}` ? "selected" : ""}>${fmt(amount)} · ${details.term} weeks · ${fmt(details.emi)} EMI</option>`
                )
                .join("")}
            </select>
          </label>
          <label>Loan amount<input class="i-amount" type="number" min="1" value="${requested || ""}" placeholder="0"></label>
          <label>Loan term (weeks)<input class="i-term" type="number" min="1" value="${term || ""}" placeholder="0"></label>
          <label>Weekly EMI<input class="i-emi" type="number" min="1" value="${emi || ""}" placeholder="0"></label>
        </div>
        <div class="processing-fee-box ${!processing.configured || !processing.complete ? "fee-warning" : ""}"><div><span>Processing fee · automatically calculated</span><b class="i-processing-fee">${processing.configured && processing.complete ? fmt(processing.fee) : "Cannot calculate"}</b></div><small class="i-processing-note">${escapeHtml(processing.reason)}</small><input class="i-processing" type="hidden" value="${processing.fee}"></div>
      </article>`;
    })
    .join("");

  $$(".i-slab").forEach((select) => {
    select.addEventListener("change", () => {
      if (!select.value) return;
      const [amount, term, emi] = select.value.split("|");
      const row = select.closest(".individual-loan");
      row.querySelector(".i-amount").value = amount;
      row.querySelector(".i-term").value = term;
      row.querySelector(".i-emi").value = emi;
      updateProcessingFeeDisplay(row, group, processingAssessmentDate);
    });
  });
  $$("#individualLoanInputs .i-amount").forEach((input) => {
    input.addEventListener("input", () => updateProcessingFeeDisplay(input.closest(".individual-loan"), group, processingAssessmentDate));
  });
  updateGroupProcessingTotal();
}

function updateLoanFirstRecoveryPreview() {
  const preview = $("#loanFirstRecoveryDate");
  const sanctionDateInput = $("#loanSanctionDate");
  if (!preview) return;
  const startChoice = $("#loanRecoveryStart")?.value || "next";
  const customOption = $("#loanRecoveryStart")?.querySelector('option[value="custom"]');
  const directorCustom = canBackdateOperationalEntries() && startChoice === "custom";
  if (customOption) {
    customOption.hidden = !canBackdateOperationalEntries();
    customOption.disabled = !canBackdateOperationalEntries();
  }
  preview.readOnly = !directorCustom;
  preview.max = directorCustom ? todayIso() : "";
  sanctionDateInput.readOnly = !directorCustom;
  $("#loanFirstRecoveryHelp").textContent = directorCustom
    ? "Director old-data mode: select today or any previous recovery date."
    : "Calculated automatically from recovery day.";
  if (directorCustom) {
    if (!isValidIsoDate(preview.value) || preview.value > todayIso()) preview.value = todayIso();
    sanctionDateInput.max = preview.value;
    if (!isValidIsoDate(sanctionDateInput.value) || sanctionDateInput.value > preview.value) {
      sanctionDateInput.value = addCalendarDays(preview.value, -7);
    }
    $("#loanSanctionDateHelp").textContent = "Director can enter the original old loan sanction date.";
    const chosenDay = weekdayForIsoDate(preview.value);
    if (DAYS.includes(chosenDay)) $("#loanDay").value = chosenDay;
    return;
  }
  sanctionDateInput.max = "";
  sanctionDateInput.value = String($("#loanForm")?.dataset.disbursedOn || todayIso()).slice(0, 10);
  $("#loanSanctionDateHelp").textContent = "Today's date is applied automatically.";
  const disbursedOn = $("#loanForm")?.dataset.disbursedOn || todayIso();
  const firstInstallment = scheduleRows(
    1,
    disbursedOn,
    $("#loanDay")?.value,
    $("#loanRecoveryStart")?.value || "next"
  ).find((row) => row.type === "installment");
  preview.value = firstInstallment?.date || "";
}

function placeLoanFormBelowPageHeader() {
  const loanForm = $("#loanForm");
  const pageHeader = $("#loans .page-intro");
  if (loanForm && pageHeader && loanForm.previousElementSibling !== pageHeader) {
    pageHeader.insertAdjacentElement("afterend", loanForm);
  }
}

function openNewLoan() {
  delete $("#loanForm").dataset.editLoan;
  $("#loanForm").dataset.disbursedOn = todayIso();
  $("#loanFirstRecoveryDate").value = "";
  $("#loanSanctionDate").value = todayIso();
  $("#loanGroup").disabled = false;
  $("#loanFormTitle").textContent = "Create group loan";
  $("#saveLoan").textContent = "Disburse group loans";
  const available = groups.filter(
    (group) => approvedMembers(group).length >= 5 && !loanForGroup(group)
  );
  const notice = $("#loanNotice");
  if (!available.length) {
    const pendingGroups = groups.filter((group) => !loanForGroup(group));
    const details = pendingGroups
      .map((group) => `<li><b>${escapeHtml(group.name)}</b>: ${approvedMembers(group).length} approved customers</li>`)
      .join("");
    notice.innerHTML = pendingGroups.length
      ? `<b>No group is ready for disbursement.</b><p>Approve at least 5 customers in Verification and save the group.</p><ul>${details}</ul>`
      : `<b>No group is ready for disbursement.</b><p>All verified groups have been processed. Create or approve a new Verification group for the next loan.</p>`;
    notice.classList.remove("hidden");
    return;
  }
  notice.classList.add("hidden");
  $("#loanGroup").innerHTML = available
    .map(
      (group) =>
        `<option value="${groups.indexOf(group)}">${escapeHtml(group.name)} — ${approvedMembers(group).length} approved customers</option>`
    )
    .join("");
  const setup = () => {
    const groupIndex = Number($("#loanGroup").value);
    const group = groups[groupIndex];
    if (!group) return;
    $("#loanGroupNumber").value = group.number || nextGroupNumber();
    populateStaffSelects();
    $("#loanStaff").value = group.recoveryStaff || $("#loanStaff").options[0]?.value || "";
    $("#loanDay").value = group.day || "Monday";
    $("#loanRecoveryStart").value = "next";
    renderIndividualLoanInputs(groupIndex);
    updateLoanFirstRecoveryPreview();
  };
  $("#loanGroup").onchange = setup;
  setup();
  placeLoanFormBelowPageHeader();
  $("#loanForm").classList.remove("hidden");
}

function editLoanRecord(loanIndex) {
  if (!canManageProcessedLoans()) {
    toast("Only the Director can edit a processed loan record.");
    return;
  }
  const loan = loans[loanIndex];
  const groupIndex = groups.findIndex(
    (group) => group.code === loan?.groupCode || group.code === loan?.code || group.number === loan?.groupNumber
  );
  const group = groups[groupIndex];
  if (!loan || !group) {
    toast("The group linked to this loan record could not be found.");
    return;
  }
  $("#loanNotice").classList.add("hidden");
  $("#loanForm").dataset.editLoan = String(loanIndex);
  $("#loanGroup").innerHTML = `<option value="${groupIndex}">${escapeHtml(group.name)} — processed loan</option>`;
  $("#loanGroup").disabled = true;
  $("#loanGroup").onchange = null;
  $("#loanGroupNumber").value = loan.groupNumber || group.number || "";
  populateStaffSelects();
  if (loan.staff && ![...$("#loanStaff").options].some((option) => option.value === loan.staff)) {
    $("#loanStaff").insertAdjacentHTML("beforeend", `<option value="${escapeHtml(loan.staff)}">${escapeHtml(loan.staff)}</option>`);
  }
  $("#loanStaff").value = loan.staff || "";
  $("#loanDay").value = loan.day || group.day || "Monday";
  $("#loanRecoveryStart").value = recoveryStartSelectionForEdit(loan);
  $("#loanFirstRecoveryDate").value = String(loan.firstRecoveryDate || "").slice(0, 10);
  $("#loanForm").dataset.disbursedOn = String(loan.disbursedOn || todayIso()).slice(0, 10);
  $("#loanSanctionDate").value = loanSanctionDate(loan) || todayIso();
  renderIndividualLoanInputs(groupIndex, loan);
  updateLoanFirstRecoveryPreview();
  $("#loanFormTitle").textContent = `Edit loan record · ${loan.groupNumber || group.name}`;
  $("#saveLoan").textContent = "Update loan record";
  $("#loanForm").classList.remove("hidden");
}

function saveLoan() {
  const groupIndex = Number($("#loanGroup").value);
  const group = groups[groupIndex];
  const editValue = $("#loanForm").dataset.editLoan;
  const isEdit = editValue !== undefined;
  const editLoanIndex = isEdit ? Number(editValue) : -1;
  const previousLoan = isEdit ? loans[editLoanIndex] : null;
  if (!group) {
    toast("Select an approved verification group.");
    return;
  }
  if (isEdit && !canManageProcessedLoans()) {
    toast("Only the Director can edit a processed loan record.");
    return;
  }
  if (isEdit && (!previousLoan || (previousLoan.groupCode || previousLoan.code) !== group.code)) {
    toast("This processed loan record could not be matched to its group.");
    return;
  }
  if (!isEdit && loanForGroup(group)) {
    toast("This group loan has already been disbursed.");
    return;
  }
  const recoveryStartChoice = $("#loanRecoveryStart").value;
  const selectedFirstRecoveryDate = String($("#loanFirstRecoveryDate").value || "").slice(0, 10);
  const selectedSanctionDate = String($("#loanSanctionDate").value || "").slice(0, 10);
  if (recoveryStartChoice === "custom") {
    if (!canBackdateOperationalEntries()) {
      toast("Only the Director can choose a previous first recovery date.");
      return;
    }
    if (!isValidIsoDate(selectedFirstRecoveryDate) || selectedFirstRecoveryDate > todayIso()) {
      toast("Select a valid previous or today's first recovery date.");
      return;
    }
    const recoveryWeekday = weekdayForIsoDate(selectedFirstRecoveryDate);
    if (!DAYS.includes(recoveryWeekday)) {
      toast("Recovery cannot start on Sunday. Select Monday to Saturday.");
      return;
    }
    if (recoveryWeekday !== $("#loanDay").value) {
      toast(`First recovery date must be a ${$("#loanDay").value}.`);
      return;
    }
    if (!isValidIsoDate(selectedSanctionDate) || selectedSanctionDate > selectedFirstRecoveryDate) {
      toast("Loan sanction date must be valid and cannot be after the first recovery date.");
      return;
    }
  }
  const rows = $$("#individualLoanInputs .individual-loan");
  if (rows.length < 5) {
    toast("At least 5 approved customers are required.");
    return;
  }
  const enteredLoans = rows.map((row) => {
    const memberIndex = Number(row.dataset.memberIndex);
    const amount = Number(row.querySelector(".i-amount").value || 0);
    const term = Number(row.querySelector(".i-term").value || 0);
    const emi = Number(row.querySelector(".i-emi").value || 0);
    const processing = processingFeeDetails(
      group.members[memberIndex],
      amount,
      selectedSanctionDate || previousLoan?.disbursedOn || todayIso()
    );
    return {
      memberIndex,
      amount,
      term,
      emi,
      processingFee: processing.fee,
      processingFeeReason: processing.reason,
      processingHigherFee: processing.higherFee,
      customerAgeAtProcessing: processing.customerAge,
      guarantorAgeAtProcessing: processing.guarantorAge,
      processingConfigured: processing.configured,
      processingComplete: processing.complete,
    };
  });
  const invalid = enteredLoans.find((loan) => loan.amount <= 0 || loan.term <= 0 || loan.emi <= 0);
  if (invalid) {
    toast(`Complete loan amount, weeks, and EMI for ${group.members[invalid.memberIndex]?.name || "every customer"}.`);
    return;
  }
  const missingProcessingDetails = enteredLoans.find((item) => !item.processingComplete);
  if (missingProcessingDetails) {
    toast(`Complete customer DOB, guarantor name, and guarantor DOB for ${group.members[missingProcessingDetails.memberIndex]?.name || "every customer"} before processing the loan.`);
    return;
  }
  const unsupportedProcessingSlab = enteredLoans.find((item) => !item.processingConfigured);
  if (unsupportedProcessingSlab) {
    toast(`${fmt(unsupportedProcessingSlab.amount)} does not have an automatic processing-fee slab. Select a configured loan amount.`);
    return;
  }
  let individualLoans;
  if (isEdit) {
    for (const entered of enteredLoans) {
      const previous = previousLoan.individualLoans?.find((item) => item.memberIndex === entered.memberIndex);
      const recovered = previous ? customerRecoveredAmount(previous) : 0;
      if (entered.amount < recovered) {
        toast(`${group.members[entered.memberIndex]?.name || "Customer"} has already repaid ${fmt(recovered)}. Loan amount cannot be lower than recovered amount.`);
        return;
      }
      const holdTransactions = (previous?.holdTransactions || []).map((entry) => ({ ...entry }));
      const releasedHold = holdTransactions.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const holdAmount = holdForAmount(entered.amount);
      if (releasedHold > holdAmount) {
        toast(`${group.members[entered.memberIndex]?.name || "Customer"} already has ${fmt(releasedHold)} released from hold. Select a loan slab with sufficient hold amount.`);
        return;
      }
    }
    individualLoans = enteredLoans.map((entered) => {
      const previous = previousLoan.individualLoans?.find((item) => item.memberIndex === entered.memberIndex);
      const recovered = previous ? customerRecoveredAmount(previous) : 0;
      const holdTransactions = (previous?.holdTransactions || []).map((entry) => ({ ...entry }));
      const releasedHold = holdTransactions.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const holdAmount = holdForAmount(entered.amount);
      return {
        ...previous,
        ...entered,
        balance: previous?.closedAt ? 0 : Math.max(0, entered.amount - recovered),
        closingAdjustment: previous?.closedAt ? Math.max(0, entered.amount - recovered) : Number(previous?.closingAdjustment || 0),
        holdAmount,
        holdBalance: Math.max(0, holdAmount - releasedHold),
        holdTransactions,
      };
    });
  } else {
    individualLoans = enteredLoans.map((entered) => {
      const holdAmount = holdForAmount(entered.amount);
      return {
        ...entered,
        balance: entered.amount,
        holdAmount,
        holdBalance: holdAmount,
        holdTransactions: [],
      };
    });
  }
  const number = $("#loanGroupNumber").value || nextGroupNumber();
  if (!isEdit && loans.some((loan) => loan.groupNumber === number)) {
    toast("This group number is already assigned.");
    return;
  }
  const previousNumber = group.number;
  const previousRecoveryStaff = group.recoveryStaff;
  const previousDay = group.day;
  const selectedRecoveryStaffName = $("#loanStaff").value;
  const selectedRecoveryAccount = recoveryStaffAccount(selectedRecoveryStaffName);
  const recoveryAssignment = selectedRecoveryAccount
    ? recoveryStaffAssignmentFields(selectedRecoveryAccount)
    : {
        recoveryStaffLoginId: previousLoan?.recoveryStaffLoginId || "",
        recoveryManagerLoginId: previousLoan?.recoveryManagerLoginId || "",
        recoveryManagerName: previousLoan?.recoveryManagerName || "",
        recoveryAssistantManagerLoginId: previousLoan?.recoveryAssistantManagerLoginId || "",
        recoveryAssistantManagerName: previousLoan?.recoveryAssistantManagerName || "",
      };
  group.number = number;
  group.recoveryStaff = selectedRecoveryStaffName;
  group.day = $("#loanDay").value;
  const amount = individualLoans.reduce((sum, loan) => sum + loan.amount, 0);
  const emi = individualLoans.reduce((sum, loan) => sum + loan.emi, 0);
  const processingFees = individualLoans.reduce((sum, item) => sum + Number(item.processingFee || 0), 0);
  const firstRecoveryChanged = selectedFirstRecoveryDate !== String(previousLoan?.firstRecoveryDate || "").slice(0, 10);
  const startsInPast = recoveryStartChoice === "custom" && selectedFirstRecoveryDate < todayIso();
  const historyImportPending = Boolean(previousLoan?.historyImportPending) || (startsInPast && (!isEdit || firstRecoveryChanged));
  const loan = {
    ...(previousLoan || {}),
    id: previousLoan?.id || `LOAN-${Date.now()}`,
    groupName: group.name,
    groupNumber: number,
    groupCode: group.code,
    code: group.code,
    head1: group.members[0]?.name || "",
    head2: group.members[1]?.name || "",
    members: individualLoans.length,
    amount,
    term: Math.max(...individualLoans.map((item) => item.term)),
    emi,
    processingFees,
    balance: individualLoans.reduce((sum, item) => sum + customerTotalBalance(item), 0),
    individualLoans,
    customerBalances: group.members.map(
      (_, index) => {
        const item = individualLoans.find((record) => record.memberIndex === index);
        return item ? customerTotalBalance(item) : 0;
      }
    ),
    loanStaff: group.loanStaff || "",
    staff: selectedRecoveryStaffName,
    ...recoveryAssignment,
    day: $("#loanDay").value,
    recoveryStartWeek: recoveryStartChoice === "custom" ? "custom" : recoveryStartChoice === "current" ? "current" : "next",
    firstRecoveryDate: selectedFirstRecoveryDate,
    historyImportPending,
    sanctionDate: selectedSanctionDate || previousLoan?.sanctionDate || String(previousLoan?.disbursedOn || todayIso()).slice(0, 10),
    disbursedOn: selectedSanctionDate ? `${selectedSanctionDate}T12:00:00` : previousLoan?.disbursedOn || new Date().toISOString(),
    recoveries: previousLoan?.recoveries || [],
    ...(isEdit ? { updatedAt: new Date().toISOString(), updatedBy: currentUser?.loginId || "Director" } : {}),
  };
  if (isEdit) loans[editLoanIndex] = loan;
  else loans.push(loan);
  if (!persistAll()) {
    if (isEdit) loans[editLoanIndex] = previousLoan;
    else loans.pop();
    group.number = previousNumber;
    group.recoveryStaff = previousRecoveryStaff;
    group.day = previousDay;
    return;
  }
  $("#loanForm").classList.add("hidden");
  renderAll();
  addActivity(isEdit ? `Loan record updated for ${group.name} · ${number}` : `Loan disbursed to ${group.name} · ${number}`);
  toast(isEdit ? "Loan record updated successfully." : `Loan disbursed successfully. ${number} is ready in Loan Record.`);
}

function customerRecoveredAmount(individual) {
  const original = Number(individual?.amount || 0);
  const balance = Number(individual?.balance || 0);
  const waivedAtClosing = Number(individual?.closingAdjustment || 0);
  return Math.max(0, original - balance - waivedAtClosing);
}

function customerPenaltyBalance(individual) {
  return Math.max(0, Number(individual?.penaltyBalance || 0));
}

function customerTotalBalance(individual) {
  return Math.max(0, Number(individual?.balance || 0)) + customerPenaltyBalance(individual);
}

function calendarDaysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return 0;
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.floor((to - from) / 86400000));
}

function addCalendarDays(iso, days) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return localIsoDate(date);
}

function memberOverdueInfo(loan, individual, asOf = todayIso()) {
  if (!loan || loan.historyImportPending || !individual || Number(individual.balance || 0) <= 0 || individual.closedAt) {
    return { overdue: false, days: 0, dueDate: "", npa: false };
  }
  const emi = Math.max(0, Number(individual.emi || 0));
  if (!emi) return { overdue: false, days: 0, dueDate: "", npa: false };
  const schedule = installmentRowsForCustomer(loan, individual);
  const recovered = customerRecoveredAmount(individual);
  const unpaidIndex = Math.min(schedule.length, Math.floor(recovered / emi));
  const unpaid = schedule[unpaidIndex];
  if (!unpaid || unpaid.date >= asOf) return { overdue: false, days: 0, dueDate: unpaid?.date || "", npa: false };
  const days = calendarDaysBetween(unpaid.date, asOf);
  return { overdue: days > 0, days, dueDate: unpaid.date, npa: days >= 30 };
}

function syncLoanOutstanding(loan, group = null) {
  if (!loan?.individualLoans) return;
  loan.balance = loan.individualLoans.reduce((sum, item) => sum + customerTotalBalance(item), 0);
  const memberCount = group?.members?.length || loan.individualLoans.length;
  loan.customerBalances = Array.from({ length: memberCount }, (_, index) => {
    const item = loan.individualLoans.find((record) => record.memberIndex === index);
    return item ? customerTotalBalance(item) : 0;
  });
}

function assessOverduePenalties(asOf = todayIso()) {
  let changed = false;
  loans.forEach((loan) => {
    const group = groups.find(
      (record) => record.code === loan.groupCode || record.code === loan.code || record.number === loan.groupNumber
    );
    (loan.individualLoans || []).forEach((individual) => {
      const overdue = memberOverdueInfo(loan, individual, asOf);
      if (overdue.npa && registerNpaCustomer(loan, individual, group, asOf)) changed = true;
      if (!overdue.npa) return;
      individual.penaltyHistory = Array.isArray(individual.penaltyHistory) ? individual.penaltyHistory : [];
      const existingDates = new Set(
        individual.penaltyHistory
          .filter((entry) => entry.source === "npa-auto" || (!entry.source && entry.status === "Accrued"))
          .map((entry) => entry.date)
      );
      let penaltyDate = addCalendarDays(overdue.dueDate, 30);
      while (penaltyDate <= asOf) {
        if (!existingDates.has(penaltyDate)) {
          individual.penaltyHistory.push({
            id: `PEN-NPA-${loan.id || loan.groupCode}-${individual.memberIndex}-${penaltyDate}`,
            date: penaltyDate,
            dueDate: overdue.dueDate,
            amount: 50,
            status: "NPA auto debit",
            source: "npa-auto",
          });
          individual.penaltyBalance = customerPenaltyBalance(individual) + 50;
          individual.penaltyAccrued = Number(individual.penaltyAccrued || 0) + 50;
          existingDates.add(penaltyDate);
          changed = true;
        }
        penaltyDate = addCalendarDays(penaltyDate, 1);
      }
    });
    syncLoanOutstanding(loan, group);
  });
  if (changed) persistAll();
  return changed;
}

function installmentRowsForCustomer(loan, individual) {
  return scheduleRows(individual?.term || loan?.term, loan?.disbursedOn, loan?.day, loanRecoveryStartMode(loan))
    .filter((row) => row.type === "installment");
}

function recoveryDemandDate(loan) {
  return nextRecoveryDate(loan?.day || selectedDay);
}

function activeRecoveryDemandDate(loan) {
  return canProposeRecovery() || overdueMembersForLoan(loan).length ? todayIso() : recoveryDemandDate(loan);
}

function recoveryViewDemand(loan) {
  return currentLoanDemand(loan, activeRecoveryDemandDate(loan));
}

function memberDemandSnapshot(loan, individual, demandDate = recoveryDemandDate(loan)) {
  const principalBalance = Math.max(0, Number(individual?.balance || 0));
  const penaltyBalance = customerPenaltyBalance(individual);
  const balance = principalBalance + penaltyBalance;
  const emi = Math.max(0, Number(individual?.emi || 0));
  const amount = Math.max(0, Number(individual?.amount || principalBalance));
  const schedule = installmentRowsForCustomer(loan, individual);
  const dueCount = schedule.filter((row) => row.date <= demandDate).length;
  const recovered = customerRecoveredAmount(individual);
  const scheduledDue = Math.min(amount, dueCount * emi);
  const closed = Boolean(individual?.closedAt) || balance <= 0;
  const principalDemand = closed ? 0 : Math.min(principalBalance, Math.max(0, scheduledDue - recovered));
  const demand = closed ? 0 : Math.min(principalBalance, principalDemand);
  const pendingEmiCount = closed || emi <= 0 ? 0 : Math.ceil(principalDemand / emi);
  const fullyCoveredInstallments = emi > 0 ? Math.min(schedule.length, Math.floor(recovered / emi)) : 0;
  const futureCoveredWeeks = Math.max(0, fullyCoveredInstallments - dueCount);
  const prepaidUntil = futureCoveredWeeks
    ? schedule[fullyCoveredInstallments - 1]?.date || ""
    : "";
  const overdue = memberOverdueInfo(loan, individual, todayIso());
  return {
    balance,
    principalBalance,
    penaltyBalance,
    emi,
    recovered,
    demand,
    principalDemand,
    pendingEmiCount,
    dueCount,
    futureCoveredWeeks,
    prepaidUntil,
    advanceCredit: Math.max(0, recovered - scheduledDue),
    overdueDays: overdue.days,
    overdueDate: overdue.dueDate,
    npa: overdue.npa,
    closed,
  };
}

function applyCustomerRecoveryPayment(individual, amount, entryType, actor) {
  const received = Math.max(0, Number(amount || 0));
  const penaltyBefore = customerPenaltyBalance(individual);
  const principalBefore = Math.max(0, Number(individual.balance || 0));
  const collectsPenalty = entryType === "closing";
  const penaltyPaid = collectsPenalty ? Math.min(penaltyBefore, received) : 0;
  const remainingForPrincipal = collectsPenalty ? Math.max(0, received - penaltyPaid) : received;
  const principalPaid = Math.min(principalBefore, remainingForPrincipal);
  const closingAdjustment = entryType === "closing"
    ? Math.max(0, principalBefore - principalPaid)
    : 0;

  individual.penaltyBalance = collectsPenalty ? Math.max(0, penaltyBefore - penaltyPaid) : penaltyBefore;
  individual.penaltyPaid = Number(individual.penaltyPaid || 0) + penaltyPaid;
  individual.balance = entryType === "closing"
    ? 0
    : Math.max(0, principalBefore - principalPaid);
  if (entryType === "closing") {
    individual.closingAmount = received;
    individual.closingAdjustment = Number(individual.closingAdjustment || 0) + closingAdjustment;
  }
  if (customerTotalBalance(individual) === 0) {
    individual.closedAt = new Date().toISOString();
    individual.closedBy = actor;
  } else {
    delete individual.closedAt;
    delete individual.closedBy;
  }
  return { penaltyPaid, principalPaid, closingAdjustment, penaltyBefore, principalBefore };
}

function setManualPenaltyForRecovery(individual, recovery, amount, actor = "Employee") {
  const correctedAmount = Math.max(0, Number(amount || 0));
  individual.penaltyHistory = Array.isArray(individual.penaltyHistory) ? individual.penaltyHistory : [];
  const sourceRecoveryId = String(recovery?.id || "");
  const existingIndex = individual.penaltyHistory.findIndex(
    (entry) => entry.source === "manual-recovery-entry" && String(entry.sourceRecoveryId || "") === sourceRecoveryId
  );
  const existing = existingIndex >= 0 ? individual.penaltyHistory[existingIndex] : null;
  const previousAmount = Math.max(0, Number(existing?.amount || 0));
  if (correctedAmount <= 0 && existingIndex >= 0) {
    individual.penaltyHistory.splice(existingIndex, 1);
  } else if (correctedAmount > 0) {
    const record = {
      id: existing?.id || `PEN-MANUAL-${sourceRecoveryId || Date.now()}`,
      date: cashbookDate(recovery?.date || todayIso()),
      amount: correctedAmount,
      status: "Manual penalty",
      source: "manual-recovery-entry",
      sourceRecoveryId,
      appliedBeforePayment: recovery?.type === "closing",
      enteredBy: actor,
      createdAt: existing?.createdAt || new Date().toISOString(),
      ...(existing ? { editedAt: new Date().toISOString() } : {}),
    };
    if (existingIndex >= 0) individual.penaltyHistory[existingIndex] = record;
    else individual.penaltyHistory.push(record);
  }
  const delta = correctedAmount - previousAmount;
  individual.penaltyAccrued = Math.max(0, Number(individual.penaltyAccrued || 0) + delta);
  return delta;
}

function assessManualPenalty(individual, recovery, amount, actor = "Employee") {
  const delta = setManualPenaltyForRecovery(individual, recovery, amount, actor);
  individual.penaltyBalance = Math.max(0, customerPenaltyBalance(individual) + delta);
  if (customerTotalBalance(individual) > 0) {
    delete individual.closedAt;
    delete individual.closedBy;
  }
  return Math.max(0, Number(amount || 0));
}

function currentLoanDemand(loan, demandDate = recoveryDemandDate(loan)) {
  if (Array.isArray(loan.individualLoans) && loan.individualLoans.length) {
    return loan.individualLoans.reduce(
      (sum, item) => sum + memberDemandSnapshot(loan, item, demandDate).demand,
      0
    );
  }
  return Math.min(Number(loan.emi || 0), Number(loan.balance || 0));
}

function matchesGroupSearch(query, groupNumber, textValues = []) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  if (/^(?:g)?\d+$/.test(compactQuery)) {
    const requestedGroup = compactQuery.startsWith("g") ? compactQuery : `g${compactQuery}`;
    return String(groupNumber || "").trim().toLowerCase().replace(/\s+/g, "") === requestedGroup;
  }

  return [groupNumber, ...textValues].some((value) =>
    String(value || "").toLowerCase().includes(normalizedQuery)
  );
}

function groupForLoanSearch(loan) {
  return groups.find(
    (group) => group.code === loan?.groupCode || group.code === loan?.code || group.number === loan?.groupNumber
  );
}

function loanCustomerSearchValues(loan) {
  const group = groupForLoanSearch(loan);
  return [
    loan?.groupName,
    loan?.head1,
    loan?.head2,
    ...(group?.members || []).map((member) => member.name),
    ...(loan?.individualLoans || []).map((individual) => individual.customerName),
  ];
}

function renderLoans() {
  const query = $("#loanSearch").value || "";
  const list = loans.filter((loan) =>
    matchesGroupSearch(query, loan.groupNumber, loanCustomerSearchValues(loan))
  );
  $("#loanList").innerHTML = list.length
    ? list
        .map(
          (loan) => `<article class="loan-card">
            <div><h3>${escapeHtml(loan.groupNumber || "Group")} · ${escapeHtml(loan.groupName)}</h3>
            <small>Head 1: ${escapeHtml(loan.head1 || "—")} · Head 2: ${escapeHtml(loan.head2 || "—")}</small>${loan.historyImportPending ? '<span class="status history-import-status">Old entries pending · penalty/NPA paused</span>' : ""}</div>
            <div><span>Disbursed amount</span><b>${fmt(loan.amount)}</b></div>
            <div><span>Weekly demand</span><b>${fmt(currentLoanDemand(loan))}</b></div>
            <div><span>Balance amount</span><b>${fmt(loan.balance)}</b></div>
            <div><span>Processing fees</span><b>${fmt(loan.processingFees ?? (loan.individualLoans || []).reduce((sum, item) => sum + Number(item.processingFee || 0), 0))}</b></div>
            <div><span>Recovery officer</span><b>${escapeHtml(loan.staff || "—")}</b></div>
            <div class="loan-actions"><button class="collection-btn" type="button" onclick="openLoanFolder(${loans.indexOf(loan)})">Open folder</button>
            ${canManageProcessedLoans() ? `${loan.historyImportPending ? `<button class="collection-btn history-complete-action" type="button" onclick="completeHistoricalLoanEntries(${loans.indexOf(loan)})">Finish old entries</button>` : ""}<button class="collection-btn" type="button" onclick="editLoanRecord(${loans.indexOf(loan)})">Edit loan</button><button class="collection-btn danger-action" type="button" onclick="deleteLoanRecord(${loans.indexOf(loan)})">Delete loan</button>` : ""}</div>
          </article>`
        )
        .join("")
    : '<div class="empty panel">No loan records found.</div>';
}

function completeHistoricalLoanEntries(loanIndex) {
  if (!canBackdateOperationalEntries()) {
    toast("Only the Director can finish old loan entries.");
    return;
  }
  const loan = loans[loanIndex];
  if (!loan?.historyImportPending) return;
  if (!window.confirm(`Finish previous Recovery and Hold entries for ${loan.groupNumber || loan.groupName}? Normal penalty and NPA calculation will start immediately.`)) return;
  loan.historyImportPending = false;
  loan.historyImportCompletedAt = new Date().toISOString();
  loan.historyImportCompletedBy = currentUser?.loginId || currentUser?.name || "Director";
  if (!persistAll()) {
    loan.historyImportPending = true;
    delete loan.historyImportCompletedAt;
    delete loan.historyImportCompletedBy;
    return;
  }
  renderAll();
  if ($("#loanHistoryRecoveryPanel")) renderLoanHistoryRecoveryPanel(loanIndex);
  addActivity(`Previous loan entries completed for ${loan.groupNumber || loan.groupName}`);
  toast("Old entries completed. Normal recovery, penalty, and NPA calculation is now active.");
}

function openLoanFolder(loanIndex) {
  const loan = loans[loanIndex];
  const groupIndex = groups.findIndex((group) => group.code === loan?.groupCode);
  if (groupIndex < 0) {
    toast("The verification group for this loan could not be found.");
    return;
  }
  showPage("loans");
  $("#loanForm")?.classList.add("hidden");
  $("#loanNotice")?.classList.add("hidden");
  viewGroup(groupIndex);
}

function deleteLoanRecord(loanIndex) {
  if (!canManageProcessedLoans()) {
    toast("Only the Director can delete a processed loan record.");
    return;
  }
  const loan = loans[loanIndex];
  if (!loan) return;
  const group = groups.find(
    (record) => record.code === loan.groupCode || record.code === loan.code || record.number === loan.groupNumber
  );
  const confirmed = window.confirm(
    `Delete loan record ${loan.groupNumber || loan.groupName}? Recovery entries and hold-loan history linked to this loan will also be deleted. This action cannot be undone.`
  );
  if (!confirmed) return;
  const previousGroupNumber = group?.number;
  const removed = loans.splice(loanIndex, 1)[0];
  if (group && group.number === removed.groupNumber) delete group.number;
  if (!persistAll()) {
    loans.splice(loanIndex, 0, removed);
    if (group) group.number = previousGroupNumber;
    return;
  }
  delete $("#loanForm").dataset.editLoan;
  $("#loanForm").classList.add("hidden");
  $("#recoveryEntry").classList.add("hidden");
  closeGroupFolder();
  renderAll();
  addActivity(`Loan record deleted for ${removed.groupName} · ${removed.groupNumber}`);
  toast("Loan record deleted. The group is available for loan processing again.");
}

function scheduleRows(term, disbursedOn, recoveryDay, recoveryStartWeek = "legacy") {
  const rows = [];
  let installment = 1;
  const exactStart = /^date:(\d{4}-\d{2}-\d{2})$/.exec(String(recoveryStartWeek || ""));
  let cursor = exactStart
    ? new Date(`${exactStart[1]}T00:00:00`)
    : new Date(disbursedOn || new Date().toISOString());
  cursor.setHours(0, 0, 0, 0);
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const targetDay = weekdays.indexOf(recoveryDay);
  if (exactStart) {
    // Director-selected first recovery date is used exactly for historical records.
  } else if (targetDay >= 0) {
    let daysUntilRecovery = (targetDay - cursor.getDay() + 7) % 7;
    if (recoveryStartWeek === "next") daysUntilRecovery += 7;
    else if (recoveryStartWeek !== "current" && daysUntilRecovery === 0) daysUntilRecovery = 7;
    cursor.setDate(cursor.getDate() + daysUntilRecovery);
  } else {
    cursor.setDate(cursor.getDate() + 7);
  }
  while (installment <= Number(term || 0)) {
    const iso = localIsoDate(cursor);
    const holiday = bankHolidays.find((item) => item.date === iso);
    if (holiday) rows.push({ type: "holiday", date: iso, name: holiday.name });
    else {
      rows.push({ type: "installment", number: installment, date: iso });
      installment += 1;
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return rows;
}

function recoveryPaymentForMember(recovery, memberIndex) {
  if (Array.isArray(recovery.allocations)) {
    return Number(recovery.allocations.find((item) => item.memberIndex === memberIndex)?.amount || 0);
  }
  return recovery.member === memberIndex ? Number(recovery.amount || 0) : 0;
}

function recoveryPenaltyPaymentForMember(recovery, memberIndex) {
  if (!memberHasRecovery(recovery, memberIndex)) return 0;
  return Math.max(0, Number(recovery.penaltyPaid || 0));
}

function recoveryPrincipalPaymentForMember(recovery, memberIndex) {
  const total = recoveryPaymentForMember(recovery, memberIndex);
  if (Number.isFinite(Number(recovery.principalPaid))) return Math.max(0, Number(recovery.principalPaid));
  return Math.max(0, total - recoveryPenaltyPaymentForMember(recovery, memberIndex));
}

function customerSchedulePaymentRows(loan, individual, memberIndex, asOfDate = "") {
  const states = installmentRowsForCustomer(loan, individual).map((row) => ({
    ...row,
    received: 0,
    receipts: [],
    reviews: [],
    penalty: 0,
  }));
  const recoveries = (loan.recoveries || [])
    .filter((recovery) => !asOfDate || String(recovery.date || "").slice(0, 10) <= asOfDate)
    .map((recovery, order) => ({ recovery, order }))
    .sort((a, b) => String(a.recovery.date || "").localeCompare(String(b.recovery.date || "")) || a.order - b.order);

  recoveries.forEach(({ recovery }) => {
    let remaining = recoveryPrincipalPaymentForMember(recovery, memberIndex);
    let penaltyForEntry = Math.max(0, Number(recovery.penaltyAssessed ?? recovery.penalty ?? 0));
    let lastState = null;
    states.forEach((state) => {
      if (remaining <= 0) return;
      const room = Math.max(0, Number(individual.emi || 0) - state.received);
      if (!room) return;
      const applied = Math.min(room, remaining);
      state.received += applied;
      remaining -= applied;
      lastState = state;
      if (recovery.receipt && !state.receipts.includes(recovery.receipt)) state.receipts.push(recovery.receipt);
      if (penaltyForEntry > 0) {
        state.penalty += penaltyForEntry;
        penaltyForEntry = 0;
      }
      if (recovery.type === "advance" && state.date > recovery.date) state.reviews.push("ADVANCE RECOVERY");
      else if (recovery.review) state.reviews.push(recovery.review);
    });
    if (recovery.type === "closing") {
      const closingState = lastState || states.find((state) => state.received < Number(individual.emi || 0)) || states.at(-1);
      if (closingState) {
        const concession = Number(recovery.closingAdjustment || 0);
        closingState.reviews.push(concession > 0 ? `LOAN CLOSED · ${fmt(concession)} CONCESSION` : "LOAN CLOSED");
      }
    }
    if (penaltyForEntry > 0 && states.length) {
      const penaltyState = lastState || states.find((state) => state.received < Number(individual.emi || 0)) || states.at(-1);
      if (penaltyState) penaltyState.penalty += penaltyForEntry;
    }
  });
  return new Map(states.map((state) => [state.date, state]));
}

function recoveryUpdateTimestamp(recovery) {
  return recovery?.enteredAt || recovery?.proposedAt || recovery?.approvedAt || recovery?.editedAt || "";
}

function recoveryUpdateTime(recovery) {
  const timestamp = recoveryUpdateTimestamp(recovery);
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function groupScheduleRecoveryRows(loan) {
  if (!loan) return [];
  const rows = scheduleRows(loan.term, loan.disbursedOn, loan.day, loanRecoveryStartMode(loan));
  const installmentDates = rows.filter((row) => row.type !== "holiday").map((row) => row.date);
  const summaries = new Map(
    installmentDates.map((date) => [
      date,
      { emi: 0, advance: 0, closing: 0, recoveries: [], attendance: [], reviews: [] },
    ])
  );

  const matchingScheduleDate = (recovery) => {
    const demandDate = String(recovery?.demandDate || "").slice(0, 10);
    const entryDate = String(recovery?.date || "").slice(0, 10);
    if (summaries.has(demandDate)) return demandDate;
    if (summaries.has(entryDate)) return entryDate;
    if (!entryDate) return installmentDates[0] || "";
    return installmentDates.filter((date) => date <= entryDate).at(-1) || installmentDates[0] || "";
  };

  (loan.recoveries || []).forEach((recovery) => {
    const scheduleDate = matchingScheduleDate(recovery);
    const summary = summaries.get(scheduleDate);
    if (!summary) return;
    const amount = Math.max(0, Number(recovery.amount || 0));
    if (recovery.type === "advance") summary.advance += amount;
    else if (recovery.type === "closing") summary.closing += amount;
    else summary.emi += amount;
    summary.recoveries.push(recovery);
    if (recovery.attendance && !summary.attendance.includes(recovery.attendance)) summary.attendance.push(recovery.attendance);
    if (recovery.review && !summary.reviews.includes(recovery.review)) summary.reviews.push(recovery.review);
  });

  return rows.map((row) => {
    if (row.type === "holiday") return row;
    const summary = summaries.get(row.date);
    const latestRecovery = [...(summary?.recoveries || [])]
      .filter((recovery) => recoveryUpdateTimestamp(recovery))
      .sort((a, b) => recoveryUpdateTimestamp(a).localeCompare(recoveryUpdateTimestamp(b)))
      .at(-1);
    return {
      ...row,
      groupEmi: Number(loan.emi || 0),
      emi: Number(summary?.emi || 0),
      advance: Number(summary?.advance || 0),
      closing: Number(summary?.closing || 0),
      updateTime: recoveryUpdateTime(latestRecovery),
      attendance: summary?.attendance.join(", ") || "",
      review: summary?.reviews.join(" · ") || "",
    };
  });
}

function groupScheduleHtml(loan) {
  if (!loan) return '<p class="empty">The weekly schedule will appear after loan disbursement.</p>';
  const rows = groupScheduleRecoveryRows(loan);
  return `<div class="table-panel"><table>
    <thead><tr><th>Sr. no.</th><th>Date</th><th>Update time</th><th>Group EMI</th><th>EMI</th><th>Advance</th><th>Closing</th><th>Attend</th><th>Review</th></tr></thead>
    <tbody>${rows
      .map((row) => {
        if (row.type === "holiday")
          return `<tr class="holiday-row"><td>Holiday</td><td>${dateText(row.date)}</td><td colspan="7">${escapeHtml(row.name)}</td></tr>`;
        return `<tr><td>${row.number}</td><td>${dateText(row.date)}</td><td>${escapeHtml(row.updateTime)}</td><td>${fmt(row.groupEmi)}</td><td>${row.emi ? fmt(row.emi) : ""}</td><td>${row.advance ? fmt(row.advance) : ""}</td><td>${row.closing ? fmt(row.closing) : ""}</td><td>${escapeHtml(row.attendance)}</td><td>${escapeHtml(row.review)}</td></tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

function customerScheduleHtml(loan, individual, memberIndex) {
  if (!loan || !individual) return '<p class="empty">The customer schedule will appear after loan disbursement.</p>';
  const rows = scheduleRows(individual.term, loan.disbursedOn, loan.day, loanRecoveryStartMode(loan));
  const paymentsByDate = customerSchedulePaymentRows(loan, individual, memberIndex);
  return `<div class="table-panel"><table>
    <thead><tr><th>Sr. no.</th><th>Date</th><th>Receipt no.</th><th>EMI</th><th>Received</th><th>Penalty</th><th>Review</th></tr></thead>
    <tbody>${rows
      .map((row) => {
        if (row.type === "holiday")
          return `<tr class="holiday-row"><td>Holiday</td><td>${dateText(row.date)}</td><td colspan="5">${escapeHtml(row.name)}</td></tr>`;
        const payment = paymentsByDate.get(row.date);
        return `<tr><td>${row.number}</td><td>${dateText(row.date)}</td><td>${escapeHtml(payment?.receipts.join(", ") || "")}</td><td>${fmt(individual.emi)}</td><td>${payment?.received ? fmt(payment.received) : ""}</td><td>${payment?.penalty ? fmt(payment.penalty) : ""}</td><td>${escapeHtml([...new Set(payment?.reviews || [])].join(" · "))}</td></tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

function viewCustomer(groupIndex, memberIndex) {
  const group = groups[groupIndex];
  const member = group?.members[memberIndex];
  if (!group || !member) return;
  const loan = loanForGroup(group);
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  const photo = member.photoData
    ? `<img src="${member.photoData}" alt="${escapeHtml(member.name)} customer photo">`
    : `<div class="photo-placeholder">${escapeHtml((member.name || "C")[0].toUpperCase())}</div>`;
  $("#groupFolder").innerHTML = `
    <div class="panel-head">
      <div class="customer-photo-top">${photo}<span>${member.photoData ? "Customer photo" : "Photo not uploaded"}</span></div>
      <div><p class="eyebrow">CUSTOMER FOLDER · ${escapeHtml(loan?.groupNumber || "Not assigned")} A${String(memberIndex + 1).padStart(2, "0")}</p>
      <h3>${escapeHtml(member.name)}</h3></div>
      <button class="outline" type="button" onclick="viewGroup(${groupIndex})">← Back to group</button>
    </div>
    <div class="details-grid">
      <div><span>Loan ID</span><b>${escapeHtml(loan?.groupNumber || "Not assigned")} (A1-A${String(group.members.length).padStart(2, "0")})</b></div>
      <div><span>Centre name</span><b>${escapeHtml(group.name)}</b></div>
      <div><span>Centre address</span><b>${escapeHtml(group.centreAddress || "—")}</b></div>
      <div><span>Centre day / time</span><b>${escapeHtml(group.day || "—")} · ${escapeHtml(group.recoveryTime || "10:00")}</b></div>
      <div><span>Customer name</span><b>${escapeHtml(member.name)}</b></div>
      <div><span>Guarantor name</span><b>${escapeHtml(member.guarantor || "—")}</b></div>
      <div><span>Mobile no.</span><b>${escapeHtml(member.mobile || "—")}</b></div>
      <div class="detail-wide"><span>Customer address</span><b>${escapeHtml(member.address || "—")}</b></div>
      <div><span>Loan amount</span><b>${individual ? fmt(individual.amount) : "Not disbursed"}</b></div>
      <div><span>Processing fee</span><b>${individual ? fmt(individual.processingFee || 0) : "—"}</b><small>${escapeHtml(individual?.processingFeeReason || "")}</small></div>
      <div><span>Customer closing balance</span><b>${individual ? fmt(customerTotalBalance(individual)) : "—"}</b></div>
      <div><span>Penalty balance</span><b>${individual ? fmt(customerPenaltyBalance(individual)) : "—"}</b></div>
      <div><span>Disbursement date</span><b>${loan ? dateText(loan.disbursedOn) : "—"}</b></div>
      <div><span>Recovery starts</span><b>${loan ? (recoveryStartSelectionForEdit(loan) === "next" ? "Next week" : "Current week") : "—"}</b></div>
      <div><span>1st EMI date</span><b>${loan ? dateText(scheduleRows(1, loan.disbursedOn, loan.day, loanRecoveryStartMode(loan)).find((row) => row.type === "installment")?.date) : "—"}</b></div>
      <div><span>No. of instalments</span><b>${individual ? `${individual.term} weeks` : "—"}</b></div>
      <div><span>Purpose of loan</span><b>${escapeHtml(member.purpose || "—")}</b></div>
      <div><span>Executive name</span><b>${escapeHtml(group.loanStaff || group.officer || "—")}</b></div>
    </div>
    <div class="member-bar">
      <div><h3>Customer repayment schedule</h3><p>Weekly instalments, holidays, and receipts.</p></div>
      ${
        individual
          ? `<div><button class="outline" type="button" onclick="downloadCustomerSchedule(${groupIndex},${memberIndex})">⇩ Download Excel</button></div>`
          : ""
      }
    </div>
    ${customerScheduleHtml(loan, individual, memberIndex)}
  `;
  $("#groupFolder").classList.remove("hidden");
}

function recoveryPhotoKey(loanIndex, memberIndex) {
  return `${loanIndex}:${memberIndex}`;
}

function setRecoveryEntryPhoto(photoData = "") {
  const form = $("#recoveryEntry");
  form.dataset.photoData = photoData;
  $("#entryPhotoPreview").innerHTML = photoData
    ? `<img src="${photoData}" alt="Collection proof preview"><span>Photo ready</span>`
    : "No photo selected";
}

function stageRecoveryPhoto(loanIndex, memberIndex) {
  if (!canProposeRecovery()) return;
  const input = $("#quickRecoveryPhoto");
  input.dataset.loan = String(loanIndex);
  input.dataset.member = String(memberIndex);
  input.value = "";
  input.click();
}

function proposalTypeLabel(type) {
  return type === "advance" ? "Advance recovery" : type === "closing" ? "Closing" : type === "penalty" ? "Penalty" : "Recovery";
}

function proposalDisplayAmount(proposal) {
  return proposal?.type === "penalty"
    ? Math.max(0, Number(proposal.penaltyAssessed ?? proposal.penalty ?? proposal.amount ?? 0))
    : Math.max(0, Number(proposal?.amount || 0));
}

function proposalRecord(loanIndex, proposalId) {
  const loan = loans[loanIndex];
  const proposal = loan?.recoveryProposals?.find((item) => item.id === proposalId);
  return { loan, proposal };
}

function proposalStaffKey(proposal) {
  return String(proposal?.proposedByLogin || proposal?.proposedBy || "Staff");
}

function renderRecoveryApprovals() {
  const queue = $("#recoveryApprovalQueue");
  const emptyState = $("#recoveryApprovalEmpty");
  if (!queue) return;
  renderStaffCollectionApprovalRegister();
  const rows = [];
  loans.forEach((loan, loanIndex) => {
    const group = groups.find(
      (item) => item.code === loan.groupCode || item.code === loan.code || item.number === loan.groupNumber
    );
    (loan.recoveryProposals || []).forEach((proposal) => {
      const isOwnStaffEntry = canProposeRecovery() &&
        (proposal.proposedByLogin === currentUser?.loginId || proposal.proposedBy === currentUser?.name);
      const visible = isOwnStaffEntry ||
        (canApproveRecoveryProposal() && proposal.status === "Pending") ||
        (canEditRecoveryProposal() && ["Pending", "Approved"].includes(proposal.status));
      if (!visible) return;
      rows.push({ loan, loanIndex, group, proposal });
    });
  });
  if (!rows.length || !(canProposeRecovery() || canApproveRecoveryProposal() || canEditRecoveryProposal())) {
    queue.classList.add("hidden");
    emptyState?.classList.remove("hidden");
    return;
  }
  emptyState?.classList.add("hidden");
  $("#recoveryApprovalTitle").textContent = canProposeRecovery() ? "My group-wise recovery entries" : "Staff-wise group approvals";
  $("#recoveryApprovalHelp").textContent = canProposeRecovery()
    ? "Your member entries are grouped by centre and affect the loan record only after approval."
    : canApproveRecoveryProposal()
      ? "Review each group's member entries and approve the complete group together."
      : "Director can review or correct individual entries inside each staff and group section.";
  const visibleRows = rows
    .sort((a, b) => String(b.proposal.proposedAt || "").localeCompare(String(a.proposal.proposedAt || "")));
  const staffSections = new Map();
  visibleRows.forEach((row) => {
    const staffKey = proposalStaffKey(row.proposal);
    if (!staffSections.has(staffKey)) {
      staffSections.set(staffKey, {
        staffKey,
        staffName: row.proposal.proposedBy || row.proposal.proposedByLogin || "Staff",
        groups: new Map(),
      });
    }
    const staffSection = staffSections.get(staffKey);
    const groupKey = String(row.loanIndex);
    if (!staffSection.groups.has(groupKey)) {
      staffSection.groups.set(groupKey, { loan: row.loan, loanIndex: row.loanIndex, group: row.group, entries: [] });
    }
    staffSection.groups.get(groupKey).entries.push(row);
  });
  $("#recoveryProposalRows").innerHTML = [...staffSections.values()].map((staffSection) => {
    const groupSections = [...staffSection.groups.values()];
    const staffEntryCount = groupSections.reduce((sum, section) => sum + section.entries.length, 0);
    return `<section class="proposal-staff-section">
      <div class="proposal-staff-head"><div><span>STAFF</span><h4>${escapeHtml(staffSection.staffName)}</h4><small>${groupSections.length} ${groupSections.length === 1 ? "group" : "groups"} · ${staffEntryCount} member ${staffEntryCount === 1 ? "entry" : "entries"}</small></div></div>
      <div class="proposal-staff-groups">${groupSections.map(({ loan, loanIndex, group, entries }) => {
        const pendingEntries = entries.filter(({ proposal }) => proposal.status === "Pending");
        const groupTotal = entries.reduce((sum, { proposal }) => sum + proposalDisplayAmount(proposal), 0);
        return `<article class="proposal-group-card">
          <div class="proposal-group-head"><div><span>GROUP</span><h4>${escapeHtml(loan.groupNumber || "Group")} · ${escapeHtml(loan.groupName || group?.name || "Centre")}</h4><small>${entries.length} member ${entries.length === 1 ? "entry" : "entries"} · Total ${fmt(groupTotal)}</small></div>${canApproveRecoveryProposal() && pendingEntries.length ? `<button class="collection-btn approve-group-action" type="button" onclick="approveRecoveryProposalGroup(${loanIndex},'${encodeURIComponent(staffSection.staffKey)}')">Approve Group · ${pendingEntries.length}</button>` : ""}</div>
          <div class="proposal-group-members">${entries.map(({ proposal }) => {
            const member = group?.members?.[proposal.memberIndex] || {};
            const statusClass = String(proposal.status || "Pending").toLowerCase();
            return `<article class="proposal-card">
              <div class="proposal-photo">${proposal.photoData ? `<img src="${proposal.photoData}" alt="Recovery proof for ${escapeHtml(member.name || "customer")}">` : "No photo"}</div>
              <div><b>${escapeHtml(member.name || "Customer")}</b><small>A${String(Number(proposal.memberIndex) + 1).padStart(2, "0")}</small></div>
              <div><span>Entry</span><b>${proposalTypeLabel(proposal.type)} · ${fmt(proposalDisplayAmount(proposal))}</b><small>${proposal.type === "penalty" ? "Closing balance only · recovery unchanged · " : Number(proposal.penaltyAssessed ?? proposal.penalty ?? 0) > 0 ? `Manual penalty ${fmt(proposal.penaltyAssessed ?? proposal.penalty)} · ` : ""}${dateText(proposal.date)}</small></div>
              <span class="proposal-status ${statusClass}">${escapeHtml(proposal.status || "Pending")}</span>
              <div class="proposal-actions">${canEditRecoveryProposal() && proposal.status === "Pending" ? `<button class="collection-btn advance-action" type="button" onclick="editRecoveryProposal(${loanIndex},'${proposal.id}')">Edit entry</button>` : ""}${canEditRecoveryProposal() && proposal.status === "Approved" ? `<button class="collection-btn closing-action" type="button" onclick="directorEditApprovedRecovery(${loanIndex},'${proposal.id}')">Edit approved entry</button>` : ""}</div>
            </article>`;
          }).join("")}</div>
        </article>`;
      }).join("")}</div>
    </section>`;
  }).join("");
  const totalTypes = [
    { type: "recovery", label: "Recovery total" },
    { type: "advance", label: "Advance recovery total" },
    { type: "closing", label: "Closing total" },
    { type: "penalty", label: "Penalty updated" },
  ];
  $("#recoveryProposalTotals").innerHTML = `<div class="proposal-total-heading"><span>${canProposeRecovery() ? "My entry totals" : "Visible entry totals"}</span><small>Pending and approved staff entries are shown separately by type.</small></div>${totalTypes.map(({ type, label }) => {
    const entries = visibleRows.filter(({ proposal }) => proposal.type === type);
    const amount = entries.reduce((sum, { proposal }) => sum + proposalDisplayAmount(proposal), 0);
    return `<article class="proposal-total ${type}"><span>${label}</span><b>${fmt(amount)}</b><small>${entries.length} ${entries.length === 1 ? "entry" : "entries"}</small></article>`;
  }).join("")}`;
  queue.classList.remove("hidden");
}

function updateClosingAuthorization() {
  const form = $("#recoveryEntry");
  const note = $("#closingAuthorization");
  if (form.dataset.type !== "closing") return;
  const loan = loans[Number(form.dataset.loan)];
  const memberIndex = Number(form.dataset.member);
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  if (!individual) return;
  const received = Math.max(0, Number($("#entryAmount").value || 0));
  const manualPenalty = Math.max(0, Number($("#entryPenalty").value || 0));
  const totalBalance = customerTotalBalance(individual) + manualPenalty;
  const penaltyBalance = customerPenaltyBalance(individual) + manualPenalty;
  const concession = Math.max(0, Number(individual.balance || 0) - Math.max(0, received - penaltyBalance));
  note.innerHTML = role() === "Director"
    ? `<b>Director closing authority</b><span>Penalty ${fmt(penaltyBalance)} (including manual ${fmt(manualPenalty)}) is included. ${concession > 0 ? `${fmt(concession)} principal concession will be recorded.` : "Full outstanding balance will be collected."}</span>`
    : `<b>Full-balance closing only</b><span>Manual penalty is added to closing. Closing amount is ${fmt(totalBalance)}.</span>`;
}

function openRecoveryEntry(loanIndex, memberIndex, entryType = "recovery", allowPaidRecovery = false) {
  if (!canEnterRecovery() && !canProposeRecovery()) {
    toast("Your login cannot create a recovery entry.");
    return;
  }
  const loan = loans[loanIndex];
  const group = groups.find(
    (item) => item.code === loan?.groupCode || item.code === loan?.code || item.number === loan?.groupNumber
  );
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  const member = group?.members?.[memberIndex];
  if (!loan || !individual || !member) {
    toast("The customer loan record could not be found.");
    return;
  }
  const demandDate = canBackdateOperationalEntries() ? directorRecoveryEntryDate(loanIndex) : activeRecoveryDemandDate(loan);
  const snapshot = memberDemandSnapshot(loan, individual, demandDate);
  if (snapshot.closed) {
    toast("This customer loan is already closed.");
    return;
  }
  if (entryType === "recovery" && snapshot.demand <= 0 && !allowPaidRecovery) {
    toast("This customer's current recovery is already received. Use Advance Recovery for future weeks.");
    return;
  }

  const form = $("#recoveryEntry");
  delete form.dataset.editProposal;
  form.dataset.loan = String(loanIndex);
  form.dataset.member = String(memberIndex);
  form.dataset.type = entryType;
  form.dataset.demandDate = demandDate;
  const typeLabels = {
    recovery: "RECOVERY ENTRY",
    advance: "ADVANCE RECOVERY",
    closing: "LOAN CLOSING",
  };
  $("#recoveryEntryType").textContent = `${canProposeRecovery() ? "PROPOSED " : ""}${typeLabels[entryType] || typeLabels.recovery}`;
  $("#recoveryEntryTitle").textContent = `${member.name} · ${loan.groupNumber || loan.groupName}`;
  $("#recoveryEntrySummary").innerHTML = `<div><span>Current demand</span><b>${fmt(snapshot.demand)}</b></div><div><span>Weekly EMI</span><b>${fmt(snapshot.emi)}</b></div><div><span>Closing before new penalty</span><b>${fmt(snapshot.balance)}</b></div><div><span>Demand date</span><b>${dateText(demandDate)}</b></div>${snapshot.futureCoveredWeeks > 0 ? `<div><span>Advance already paid</span><b>${snapshot.futureCoveredWeeks} weeks · through ${dateText(snapshot.prepaidUntil)}</b></div>` : ""}`;
  $("#entryDate").value = canBackdateOperationalEntries() ? directorRecoveryEntryDate(loanIndex) : todayIso();
  $("#entryDate").readOnly = !canBackdateOperationalEntries();
  $("#entryDate").max = todayIso();
  $("#entryReceipt").value = "";
  $("#entryPenalty").value = "0";
  $("#entryTimeIn").value = "";
  $("#entryTimeOut").value = "";
  $("#entryAttendance").value = "";
  $("#entryReview").value = "";
  $("#closingAuthorization").classList.toggle("hidden", entryType !== "closing");
  $("#entryAmount").readOnly = entryType === "closing" && role() !== "Director";
  $("#entryAmount").min = entryType === "closing" ? "0" : "1";
  $("#entryPhotoRequirement").textContent = canProposeRecovery()
    ? "Photo is optional. The entry remains pending until Executive or Cashier approval."
    : "Photo is optional for a direct office entry.";
  $("#entryPhotoInput").value = "";
  setRecoveryEntryPhoto(stagedRecoveryPhotos.get(recoveryPhotoKey(loanIndex, memberIndex)) || "");

  if (entryType === "advance") $("#entryAmount").value = "0";
  else if (entryType === "closing") $("#entryAmount").value = snapshot.balance;
  else $("#entryAmount").value = snapshot.demand;
  $("#saveRecoveryEntry").textContent = canProposeRecovery()
    ? `Submit ${proposalTypeLabel(entryType).toLowerCase()} proposal`
    : entryType === "closing" ? "Close customer loan" : entryType === "advance" ? "Save advance recovery" : "Save recovery";
  updateClosingAuthorization();
  selectedRecoveryLoanIndex = loanIndex;
  showPage("recovery");
  const inlineEntryHost = $("#recoveryInlineEntryHost");
  if (inlineEntryHost) inlineEntryHost.appendChild(form);
  form.classList.remove("hidden");
}

function pendingMemberProposals(loan, memberIndex, excludeProposalId = "") {
  return (loan?.recoveryProposals || []).filter(
    (proposal) =>
      proposal.status === "Pending" &&
      Number(proposal.memberIndex) === Number(memberIndex) &&
      String(proposal.id || "") !== String(excludeProposalId || "")
  );
}

function saveRecoveryEntry() {
  const form = $("#recoveryEntry");
  const loanIndex = Number(form.dataset.loan);
  const memberIndex = Number(form.dataset.member);
  const entryType = form.dataset.type || "recovery";
  const loan = loans[loanIndex];
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  const group = groups.find(
    (item) => item.code === loan?.groupCode || item.code === loan?.code || item.number === loan?.groupNumber
  );
  const member = group?.members?.[memberIndex];
  const amount = Number($("#entryAmount").value || 0);
  const manualPenalty = Number($("#entryPenalty").value || 0);
  const requestedEntryDate = String($("#entryDate").value || "").slice(0, 10);
  const entryDate = canBackdateOperationalEntries() ? requestedEntryDate : todayIso();
  if (!isValidIsoDate(entryDate) || entryDate > todayIso()) {
    toast("Director can select today or a previous recovery date only.");
    return;
  }
  $("#entryDate").value = entryDate;
  if (entryDate === todayIso()) assessOverduePenalties();
  if (!loan || !individual || !member || amount < 0 || (entryType !== "closing" && amount <= 0)) {
    toast("Enter a valid received amount.");
    return;
  }
  if (!Number.isFinite(manualPenalty) || manualPenalty < 0) {
    toast("Enter a valid manual penalty amount.");
    return;
  }
  const demandDate = canBackdateOperationalEntries() ? entryDate : form.dataset.demandDate || recoveryDemandDate(loan);
  form.dataset.demandDate = demandDate;
  const snapshot = memberDemandSnapshot(loan, individual, demandDate);
  if (snapshot.closed) {
    toast("This customer loan is already closed.");
    return;
  }
  const editProposalId = form.dataset.editProposal || "";
  const proposalMode = canProposeRecovery() || Boolean(editProposalId);
  const otherPendingProposals = proposalMode
    ? pendingMemberProposals(loan, memberIndex, editProposalId)
    : [];
  const pendingPrincipalPayment = otherPendingProposals
    .filter((proposal) => ["recovery", "advance"].includes(proposal.type))
    .reduce((sum, proposal) => sum + Math.max(0, Number(proposal.amount || 0)), 0);
  const pendingRecoveryPayment = otherPendingProposals
    .filter((proposal) => proposal.type === "recovery")
    .reduce((sum, proposal) => sum + Math.max(0, Number(proposal.amount || 0)), 0);
  const projectedPrincipalBalance = proposalMode
    ? Math.max(0, snapshot.principalBalance - pendingPrincipalPayment)
    : snapshot.principalBalance;
  const effectiveDemand = proposalMode
    ? Math.max(0, snapshot.demand - pendingRecoveryPayment)
    : snapshot.demand;
  const balanceWithManualPenalty = projectedPrincipalBalance + snapshot.penaltyBalance + manualPenalty;
  const penaltyWithManualEntry = snapshot.penaltyBalance + manualPenalty;
  const maximumPayment = entryType === "closing" ? balanceWithManualPenalty : projectedPrincipalBalance;
  if (amount > maximumPayment) {
    toast(entryType === "closing"
      ? `The customer closing balance including manual penalty is ${fmt(balanceWithManualPenalty)}.`
      : `The available outstanding loan principal is ${fmt(projectedPrincipalBalance)}. Penalty is collected only at closing.`);
    return;
  }
  if (entryType === "recovery" && amount > effectiveDemand) {
    toast(`Current available demand is ${fmt(effectiveDemand)}. Use Advance Recovery for any extra amount.`);
    return;
  }
  if (entryType === "advance" && amount <= effectiveDemand) {
    toast(`Enter more than the current available demand of ${fmt(effectiveDemand)}, or use the normal Recovery option.`);
    return;
  }
  if (entryType === "closing" && amount < balanceWithManualPenalty && role() !== "Director") {
    toast("Only the Director can approve a reduced loan closing amount.");
    return;
  }
  if (entryType === "closing" && amount < penaltyWithManualEntry) {
    toast(`Penalty balance of ${fmt(penaltyWithManualEntry)} must be paid before this loan can close.`);
    return;
  }

  const photoData = form.dataset.photoData || "";
  if (canProposeRecovery() || editProposalId) {
    loan.recoveryProposals = loan.recoveryProposals || [];
    if (!editProposalId && loan.recoveryProposals.some(
      (proposal) => proposal.status === "Pending" && Number(proposal.memberIndex) === memberIndex && proposal.type === entryType
    )) {
      toast(`${proposalTypeLabel(entryType)} proposal is already awaiting approval for this customer.`);
      return;
    }
    if (editProposalId) {
      if (!canEditRecoveryProposal()) {
        toast("Only the Director can edit a proposed recovery entry.");
        return;
      }
      const proposal = loan.recoveryProposals.find((item) => item.id === editProposalId && item.status === "Pending");
      if (!proposal) {
        toast("This pending proposal could not be found.");
        return;
      }
      Object.assign(proposal, {
        type: entryType,
        date: entryDate,
        demandDate: form.dataset.demandDate || "",
        receipt: $("#entryReceipt").value.trim(),
        amount,
        penalty: manualPenalty,
        penaltyAssessed: manualPenalty,
        timeIn: $("#entryTimeIn").value,
        timeOut: $("#entryTimeOut").value,
        attendance: $("#entryAttendance").value,
        review: $("#entryReview").value.trim(),
        photoData,
        directorAuthorizedReduction: entryType === "closing" && amount < balanceWithManualPenalty,
        editedBy: currentUser?.loginId || currentUser?.name || "Director",
        editedAt: new Date().toISOString(),
      });
      if (!persistAll()) return;
      form.classList.add("hidden");
      delete form.dataset.editProposal;
      renderAll();
      toast("Pending staff proposal corrected by Director. It is ready for approval.");
      return;
    }

    const reportingProfile = currentStaffReportingProfile();
    const assignedManager = workingAccount(reportingProfile.managerLoginId);
    const assignedAssistantManager = workingAccount(reportingProfile.assistantManagerLoginId);
    const proposal = {
      id: `PROP-${Date.now()}-${memberIndex}`,
      status: "Pending",
      type: entryType,
      date: entryDate,
      demandDate: form.dataset.demandDate || "",
      receipt: $("#entryReceipt").value.trim(),
      amount,
      penalty: manualPenalty,
      penaltyAssessed: manualPenalty,
      timeIn: $("#entryTimeIn").value,
      timeOut: $("#entryTimeOut").value,
      attendance: $("#entryAttendance").value,
      review: $("#entryReview").value.trim(),
      memberIndex,
      photoData,
      proposedBy: currentUser?.name || "Staff",
      proposedByLogin: currentUser?.loginId || "",
      proposedByRole: role() || "Staff",
      incentiveRate: role() === "Staff" ? currentStaffIncentiveRate() : 0,
      managerLoginId: reportingProfile.managerLoginId,
      assistantManagerLoginId: reportingProfile.assistantManagerLoginId,
      managerIncentiveRate: recoveryIncentiveRate(assignedManager),
      assistantManagerIncentiveRate: recoveryIncentiveRate(assignedAssistantManager),
      proposedAt: new Date().toISOString(),
    };
    loan.recoveryProposals.push(proposal);
    if (!persistAll()) {
      loan.recoveryProposals.pop();
      return;
    }
    stagedRecoveryPhotos.delete(recoveryPhotoKey(loanIndex, memberIndex));
    form.classList.add("hidden");
    selectedRecoveryLoanIndex = loanIndex;
    renderAll();
    addActivity(`${proposalTypeLabel(entryType)} proposed for ${member.name} · ${loan.groupNumber || loan.groupName}`);
    toast(`Proposal submitted${photoData ? " with photo" : ""}. Loan record will update after Executive or Cashier approval.`);
    return;
  }

  const individualPosition = loan.individualLoans.indexOf(individual);
  const previousIndividual = JSON.parse(JSON.stringify(individual));
  const previousBalance = loan.balance;
  const previousCustomerBalances = Array.isArray(loan.customerBalances) ? [...loan.customerBalances] : [];
  const previousRecoveries = Array.isArray(loan.recoveries) ? [...loan.recoveries] : [];
  const recoveryId = `REC-${Date.now()}`;
  const recoveryDraft = { id: recoveryId, type: entryType, date: entryDate };
  if (entryType === "closing") {
    assessManualPenalty(individual, recoveryDraft, manualPenalty, currentUser?.loginId || currentUser?.name || role());
  }
  const paymentBreakdown = applyCustomerRecoveryPayment(
    individual,
    amount,
    entryType,
    currentUser?.loginId || currentUser?.name || role()
  );
  if (entryType !== "closing") {
    assessManualPenalty(individual, recoveryDraft, manualPenalty, currentUser?.loginId || currentUser?.name || role());
  }
  if (customerTotalBalance(individual) === 0 && entryDate < todayIso()) {
    individual.closedAt = `${entryDate}T12:00:00`;
  }
  const closingAdjustment = paymentBreakdown.closingAdjustment;

  const recovery = {
    id: recoveryId,
    type: entryType,
    date: entryDate,
    demandDate: form.dataset.demandDate || "",
    receipt: $("#entryReceipt").value.trim(),
    amount,
    principalPaid: paymentBreakdown.principalPaid,
    penaltyPaid: paymentBreakdown.penaltyPaid,
    balanceBefore: balanceWithManualPenalty,
    closingAdjustment,
    penalty: manualPenalty,
    penaltyAssessed: manualPenalty,
    timeIn: $("#entryTimeIn").value,
    timeOut: $("#entryTimeOut").value,
    attendance: $("#entryAttendance").value,
    review: $("#entryReview").value.trim() || (entryType === "advance" ? "Advance recovery" : entryType === "closing" ? "Loan closed" : "Recovery"),
    member: memberIndex,
    allocations: [{ memberIndex, amount }],
    photoData,
    enteredBy: currentUser?.loginId || currentUser?.name || role(),
    enteredByName: currentUser?.name || currentUser?.loginId || role(),
    enteredByRole: role() || "Employee",
    enteredAt: new Date().toISOString(),
  };
  loan.recoveries = [...previousRecoveries, recovery];
  syncLoanOutstanding(loan, group);
  if (!persistAll()) {
    loan.individualLoans[individualPosition] = previousIndividual;
    loan.balance = previousBalance;
    loan.customerBalances = previousCustomerBalances;
    loan.recoveries = previousRecoveries;
    return;
  }

  form.classList.add("hidden");
  selectedRecoveryLoanIndex = loanIndex;
  renderAll();
  const actionText = entryType === "closing" ? "loan closing" : entryType === "advance" ? "advance recovery" : "recovery";
  addActivity(`${fmt(amount)} ${actionText} entered for ${member.name} · ${loan.groupNumber || loan.groupName}`);
  toast(entryType === "closing"
    ? `Loan closed for ${member.name}${closingAdjustment ? ` with ${fmt(closingAdjustment)} Director-approved concession` : ""}.`
    : `${entryType === "advance" ? "Advance recovery" : "Recovery"} saved. Future demand has been recalculated.`);
}

function saveInlineRecovery(loanIndex, memberIndex, entryType) {
  if (!canEnterRecovery() && !canProposeRecovery()) {
    toast("Your login cannot create a recovery entry.");
    return;
  }
  const input = document.querySelector(
    `[data-inline-loan="${loanIndex}"][data-inline-member="${memberIndex}"][data-inline-type="${entryType}"]`
  );
  const amount = Number(input?.value || 0);
  if (!input || !Number.isFinite(amount) || amount < 0 || (entryType !== "closing" && amount <= 0)) {
    toast("Enter a valid amount in the customer row.");
    input?.focus();
    return;
  }
  const loan = loans[loanIndex];
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  if (!loan || !individual) {
    toast("The customer loan record could not be found.");
    return;
  }
  const demandDate = canBackdateOperationalEntries() ? directorRecoveryEntryDate(loanIndex) : activeRecoveryDemandDate(loan);
  const snapshot = memberDemandSnapshot(loan, individual, demandDate);
  if (snapshot.closed) {
    toast("This customer loan is already closed.");
    return;
  }

  const form = $("#recoveryEntry");
  delete form.dataset.editProposal;
  form.dataset.loan = String(loanIndex);
  form.dataset.member = String(memberIndex);
  form.dataset.type = entryType;
  form.dataset.demandDate = demandDate;
  form.dataset.photoData = stagedRecoveryPhotos.get(recoveryPhotoKey(loanIndex, memberIndex)) || "";
  $("#entryDate").value = canBackdateOperationalEntries() ? demandDate : todayIso();
  $("#entryReceipt").value = "";
  $("#entryAmount").value = String(amount);
  $("#entryPenalty").value = "0";
  $("#entryTimeIn").value = "";
  $("#entryTimeOut").value = "";
  $("#entryAttendance").value = "";
  $("#entryReview").value = "";
  form.classList.add("hidden");
  saveRecoveryEntry();
}

function saveInlinePenalty(loanIndex, memberIndex) {
  if (!canEnterRecovery() && !canProposeRecovery()) {
    toast("Your login cannot update a penalty.");
    return;
  }
  const input = document.querySelector(
    `[data-inline-penalty][data-inline-loan="${loanIndex}"][data-inline-member="${memberIndex}"]`
  );
  const penaltyAmount = Number(input?.value || 0);
  if (!input || !Number.isFinite(penaltyAmount) || penaltyAmount <= 0) {
    toast("Enter a valid penalty amount.");
    input?.focus();
    return;
  }

  const loan = loans[loanIndex];
  const group = groups.find(
    (item) => item.code === loan?.groupCode || item.code === loan?.code || item.number === loan?.groupNumber
  );
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  const member = group?.members?.[memberIndex];
  if (!loan || !individual || !member) {
    toast("The customer loan record could not be found.");
    return;
  }
  if (memberDemandSnapshot(loan, individual, activeRecoveryDemandDate(loan)).closed) {
    toast("This customer loan is already closed.");
    return;
  }

  const entryDate = canBackdateOperationalEntries() ? directorRecoveryEntryDate(loanIndex) : todayIso();
  const actorLogin = currentUser?.loginId || currentUser?.name || role() || "Employee";
  const actorName = currentUser?.name || currentUser?.loginId || role() || "Employee";
  const photoData = stagedRecoveryPhotos.get(recoveryPhotoKey(loanIndex, memberIndex)) || "";

  if (canProposeRecovery()) {
    if (!photoData) {
      toast("Collection photo is mandatory for a staff penalty proposal.");
      return;
    }
    loan.recoveryProposals = loan.recoveryProposals || [];
    if (loan.recoveryProposals.some((proposal) => proposal.memberIndex === memberIndex && proposal.status === "Pending")) {
      toast("A proposal for this customer is already awaiting approval.");
      return;
    }
    const proposal = {
      id: `PROP-PEN-${Date.now()}-${memberIndex}`,
      status: "Pending",
      type: "penalty",
      date: entryDate,
      demandDate: activeRecoveryDemandDate(loan),
      receipt: "",
      amount: penaltyAmount,
      penalty: penaltyAmount,
      penaltyAssessed: penaltyAmount,
      review: "Penalty update · closing balance only",
      memberIndex,
      photoData,
      proposedBy: actorName,
      proposedByLogin: currentUser?.loginId || "",
      proposedByRole: role() || "Staff",
      proposedAt: new Date().toISOString(),
    };
    loan.recoveryProposals.push(proposal);
    if (!persistAll()) {
      loan.recoveryProposals.pop();
      return;
    }
    stagedRecoveryPhotos.delete(recoveryPhotoKey(loanIndex, memberIndex));
    selectedRecoveryLoanIndex = loanIndex;
    renderAll();
    addActivity(`Penalty ${fmt(penaltyAmount)} proposed for ${member.name} · ${loan.groupNumber || loan.groupName}`);
    toast("Penalty proposal submitted. It will increase closing only after Executive or Cashier approval.");
    return;
  }

  const individualPosition = loan.individualLoans.indexOf(individual);
  const previousIndividual = JSON.parse(JSON.stringify(individual));
  const previousBalance = loan.balance;
  const previousCustomerBalances = Array.isArray(loan.customerBalances) ? [...loan.customerBalances] : [];
  const previousRecoveries = Array.isArray(loan.recoveries) ? [...loan.recoveries] : [];
  const penaltyEntry = {
    id: `PEN-${Date.now()}-${memberIndex}`,
    type: "penalty",
    date: entryDate,
    demandDate: activeRecoveryDemandDate(loan),
    amount: 0,
    principalPaid: 0,
    penaltyPaid: 0,
    penalty: penaltyAmount,
    penaltyAssessed: penaltyAmount,
    balanceBefore: customerTotalBalance(individual),
    review: "Penalty updated · closing balance only",
    member: memberIndex,
    allocations: [{ memberIndex, amount: 0 }],
    enteredBy: actorLogin,
    enteredByName: actorName,
    enteredByRole: role() || "Employee",
    enteredAt: new Date().toISOString(),
  };
  assessManualPenalty(individual, penaltyEntry, penaltyAmount, actorLogin);
  loan.recoveries = [...previousRecoveries, penaltyEntry];
  syncLoanOutstanding(loan, group);
  if (!persistAll()) {
    loan.individualLoans[individualPosition] = previousIndividual;
    loan.balance = previousBalance;
    loan.customerBalances = previousCustomerBalances;
    loan.recoveries = previousRecoveries;
    return;
  }
  selectedRecoveryLoanIndex = loanIndex;
  renderAll();
  addActivity(`Penalty ${fmt(penaltyAmount)} updated for ${member.name} · ${loan.groupNumber || loan.groupName}`);
  toast(`Penalty updated. Closing is now ${fmt(customerTotalBalance(individual))}; EMI recovery is unchanged.`);
}

function editRecoveryProposal(loanIndex, proposalId) {
  if (!canEditRecoveryProposal()) {
    toast("Only the Director can edit a proposed recovery entry.");
    return;
  }
  const { loan, proposal } = proposalRecord(loanIndex, proposalId);
  if (!loan || !proposal || proposal.status !== "Pending") {
    toast("This pending proposal could not be found.");
    return;
  }
  const individual = loan.individualLoans?.find((item) => item.memberIndex === proposal.memberIndex);
  const group = groups.find(
    (item) => item.code === loan.groupCode || item.code === loan.code || item.number === loan.groupNumber
  );
  const member = group?.members?.[proposal.memberIndex];
  if (!individual || !member) {
    toast("The customer loan record could not be found.");
    return;
  }
  const correctedType = String(window.prompt("Correct entry type: recovery, advance, closing, or penalty", proposal.type || "recovery") || "").trim().toLowerCase();
  if (!correctedType) return;
  if (!["recovery", "advance", "closing", "penalty"].includes(correctedType)) {
    toast("Entry type must be recovery, advance, closing, or penalty.");
    return;
  }
  const amountText = window.prompt(
    correctedType === "penalty" ? "Correct penalty amount" : "Correct received amount",
    String(correctedType === "penalty" ? proposalDisplayAmount(proposal) : proposal.amount || 0)
  );
  if (amountText === null) return;
  const correctedAmount = Number(amountText);
  let correctedPenalty = correctedType === "penalty" ? correctedAmount : 0;
  if (correctedType !== "penalty") {
    const penaltyText = window.prompt("Correct manual penalty added to closing", String(proposal.penaltyAssessed ?? proposal.penalty ?? 0));
    if (penaltyText === null) return;
    correctedPenalty = Number(penaltyText);
  }
  const snapshot = memberDemandSnapshot(loan, individual, proposal.demandDate || recoveryDemandDate(loan));
  if (!Number.isFinite(correctedAmount) || correctedAmount < 0 || (correctedType !== "closing" && correctedAmount <= 0)) {
    toast("Enter a valid corrected amount.");
    return;
  }
  if (!Number.isFinite(correctedPenalty) || correctedPenalty < 0) {
    toast("Enter a valid corrected manual penalty.");
    return;
  }
  const balanceWithManualPenalty = snapshot.balance + correctedPenalty;
  const penaltyWithManualEntry = snapshot.penaltyBalance + correctedPenalty;
  const maximumPayment = correctedType === "closing" ? balanceWithManualPenalty : snapshot.principalBalance;
  if (correctedType !== "penalty" && correctedAmount > maximumPayment) {
    toast(correctedType === "closing"
      ? `The customer closing balance including manual penalty is ${fmt(balanceWithManualPenalty)}.`
      : `The outstanding loan principal is ${fmt(snapshot.principalBalance)}. Penalty is collected only at closing.`);
    return;
  }
  if (correctedType === "recovery" && correctedAmount > snapshot.demand) {
    toast(`Current demand is ${fmt(snapshot.demand)}. Use Advance Recovery for any extra amount.`);
    return;
  }
  if (correctedType === "advance" && correctedAmount <= snapshot.demand) {
    toast(`Advance recovery must be more than the current demand of ${fmt(snapshot.demand)}.`);
    return;
  }
  if (correctedType === "closing" && correctedAmount < penaltyWithManualEntry) {
    toast(`Penalty balance of ${fmt(penaltyWithManualEntry)} must be paid before closing.`);
    return;
  }
  const correctedReview = window.prompt("Correct review / note", proposal.review || "");
  if (correctedReview === null) return;
  if (!window.confirm(`Update ${member.name}'s pending entry to ${proposalTypeLabel(correctedType)} ${fmt(correctedAmount)}?`)) return;
  Object.assign(proposal, {
    type: correctedType,
    amount: correctedAmount,
    penalty: correctedPenalty,
    penaltyAssessed: correctedPenalty,
    review: String(correctedReview).trim(),
    directorAuthorizedReduction: correctedType === "closing" && correctedAmount < balanceWithManualPenalty,
    editedBy: currentUser?.loginId || currentUser?.name || "Director",
    editedAt: new Date().toISOString(),
  });
  if (!persistAll()) return;
  selectedRecoveryLoanIndex = loanIndex;
  renderAll();
  toast("Pending staff proposal corrected by Director. Entry date remains unchanged.");
}

function approveRecoveryProposal(loanIndex, proposalId, batchMode = false) {
  assessOverduePenalties();
  if (!canApproveRecoveryProposal()) {
    toast("Only Executive or Cashier can approve a staff recovery proposal.");
    return;
  }
  const { loan, proposal } = proposalRecord(loanIndex, proposalId);
  const group = groups.find(
    (item) => item.code === loan?.groupCode || item.code === loan?.code || item.number === loan?.groupNumber
  );
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === proposal?.memberIndex);
  const member = group?.members?.[proposal?.memberIndex];
  if (!loan || !proposal || proposal.status !== "Pending" || !individual || !member) {
    toast("This pending proposal could not be found.");
    return;
  }
  if (proposal.type === "penalty" && !proposal.photoData) {
    toast("This penalty proposal has no collection photo and cannot be approved.");
    return;
  }
  const amount = Number(proposal.amount || 0);
  const manualPenalty = Math.max(0, Number(proposal.penaltyAssessed ?? proposal.penalty ?? 0));
  const snapshot = memberDemandSnapshot(loan, individual, proposal.demandDate || recoveryDemandDate(loan));
  if (snapshot.closed) {
    toast("This customer loan is already closed. The proposal cannot be approved.");
    return;
  }
  if (proposal.type === "penalty") {
    const penaltyAmount = Math.max(0, Number(proposal.penaltyAssessed ?? proposal.penalty ?? proposal.amount ?? 0));
    if (penaltyAmount <= 0) {
      toast("Enter a valid penalty amount before approval.");
      return;
    }
    const individualPosition = loan.individualLoans.indexOf(individual);
    const previousIndividual = JSON.parse(JSON.stringify(individual));
    const previousBalance = loan.balance;
    const previousCustomerBalances = Array.isArray(loan.customerBalances) ? [...loan.customerBalances] : [];
    const previousRecoveries = Array.isArray(loan.recoveries) ? [...loan.recoveries] : [];
    const previousProposal = { ...proposal };
    const recovery = {
      id: `PEN-${Date.now()}-${proposal.memberIndex}`,
      type: "penalty",
      date: proposal.date,
      demandDate: proposal.demandDate || "",
      amount: 0,
      principalPaid: 0,
      penaltyPaid: 0,
      penalty: penaltyAmount,
      penaltyAssessed: penaltyAmount,
      balanceBefore: customerTotalBalance(individual),
      review: proposal.review || "Penalty updated · closing balance only",
      member: proposal.memberIndex,
      allocations: [{ memberIndex: proposal.memberIndex, amount: 0 }],
      photoData: proposal.photoData,
      enteredBy: proposal.proposedByLogin || proposal.proposedBy || "Staff",
      enteredByName: proposal.proposedBy || proposal.proposedByLogin || "Staff",
      enteredByRole: proposal.proposedByRole || "Staff",
      enteredAt: proposal.proposedAt,
      incentiveRate: Math.max(0, Number(proposal.incentiveRate || 0)),
      managerIncentiveRate: Math.max(0, Number(proposal.managerIncentiveRate ?? DEFAULT_TEAM_RECOVERY_INCENTIVE_RATE)),
      assistantManagerIncentiveRate: Math.max(0, Number(proposal.assistantManagerIncentiveRate ?? DEFAULT_TEAM_RECOVERY_INCENTIVE_RATE)),
      approvedBy: currentUser?.loginId || currentUser?.name || role(),
      approvedByName: currentUser?.name || currentUser?.loginId || role(),
      approvedByRole: role() || "Employee",
      approvedAt: new Date().toISOString(),
      sourceProposalId: proposal.id,
    };
    assessManualPenalty(individual, recovery, penaltyAmount, recovery.enteredBy);
    loan.recoveries = [...previousRecoveries, recovery];
    proposal.status = "Approved";
    proposal.approvedBy = recovery.approvedBy;
    proposal.approvedAt = recovery.approvedAt;
    proposal.recoveryId = recovery.id;
    syncLoanOutstanding(loan, group);
    if (!persistAll()) {
      loan.individualLoans[individualPosition] = previousIndividual;
      loan.balance = previousBalance;
      loan.customerBalances = previousCustomerBalances;
      loan.recoveries = previousRecoveries;
      Object.assign(proposal, previousProposal);
      return;
    }
    if (!batchMode) {
      selectedRecoveryLoanIndex = loanIndex;
      renderAll();
      addActivity(`Penalty ${fmt(penaltyAmount)} approved for ${member.name} · ${loan.groupNumber || loan.groupName}`);
      toast(`Penalty approved. Closing increased to ${fmt(customerTotalBalance(individual))}; EMI recovery is unchanged.`);
    }
    return true;
  }
  const balanceWithManualPenalty = snapshot.balance + manualPenalty;
  const penaltyWithManualEntry = snapshot.penaltyBalance + manualPenalty;
  const maximumPayment = proposal.type === "closing" ? balanceWithManualPenalty : snapshot.principalBalance;
  if (amount < 0 || (proposal.type !== "closing" && amount <= 0) || amount > maximumPayment) {
    toast(proposal.type === "closing"
      ? `Proposal amount must be between zero and the closing balance of ${fmt(balanceWithManualPenalty)}.`
      : `Proposal cannot exceed the outstanding loan principal of ${fmt(snapshot.principalBalance)}; penalty is separate.`);
    return;
  }
  if (proposal.type === "recovery" && amount > snapshot.demand) {
    toast(`Current demand is ${fmt(snapshot.demand)}. Ask the Director to correct this proposal.`);
    return;
  }
  if (proposal.type === "advance" && amount <= snapshot.demand) {
    toast(`Advance recovery must be more than the current demand of ${fmt(snapshot.demand)}.`);
    return;
  }
  if (proposal.type === "closing" && amount < balanceWithManualPenalty && !proposal.directorAuthorizedReduction) {
    toast("Reduced closing requires Director correction and authorization before approval.");
    return;
  }
  if (proposal.type === "closing" && amount < penaltyWithManualEntry) {
    toast(`Penalty balance of ${fmt(penaltyWithManualEntry)} must be paid before this loan can close.`);
    return;
  }

  const individualPosition = loan.individualLoans.indexOf(individual);
  const previousIndividual = JSON.parse(JSON.stringify(individual));
  const previousBalance = loan.balance;
  const previousCustomerBalances = Array.isArray(loan.customerBalances) ? [...loan.customerBalances] : [];
  const previousRecoveries = Array.isArray(loan.recoveries) ? [...loan.recoveries] : [];
  const previousProposal = { ...proposal };
  const recoveryId = `REC-${Date.now()}`;
  const recoveryDraft = { id: recoveryId, type: proposal.type, date: proposal.date };
  if (proposal.type === "closing") {
    assessManualPenalty(individual, recoveryDraft, manualPenalty, proposal.proposedByLogin || proposal.proposedBy || "Staff");
  }
  const paymentBreakdown = applyCustomerRecoveryPayment(
    individual,
    amount,
    proposal.type,
    currentUser?.loginId || currentUser?.name || role()
  );
  if (proposal.type !== "closing") {
    assessManualPenalty(individual, recoveryDraft, manualPenalty, proposal.proposedByLogin || proposal.proposedBy || "Staff");
  }
  const closingAdjustment = paymentBreakdown.closingAdjustment;
  const recovery = {
    id: recoveryId,
    type: proposal.type,
    date: proposal.date,
    demandDate: proposal.demandDate || "",
    receipt: proposal.receipt || "",
    amount,
    principalPaid: paymentBreakdown.principalPaid,
    penaltyPaid: paymentBreakdown.penaltyPaid,
    balanceBefore: balanceWithManualPenalty,
    closingAdjustment,
    penalty: manualPenalty,
    penaltyAssessed: manualPenalty,
    timeIn: proposal.timeIn || "",
    timeOut: proposal.timeOut || "",
    attendance: proposal.attendance || "",
    review: proposal.review || `${proposalTypeLabel(proposal.type)} approved`,
    member: proposal.memberIndex,
    allocations: [{ memberIndex: proposal.memberIndex, amount }],
    photoData: proposal.photoData,
    enteredBy: proposal.proposedByLogin || proposal.proposedBy || "Staff",
    enteredByName: proposal.proposedBy || proposal.proposedByLogin || "Staff",
    enteredByRole: proposal.proposedByRole || "Staff",
    enteredAt: proposal.proposedAt,
    incentiveRate: Math.max(0, Number(proposal.incentiveRate || 0)),
    managerLoginId: proposal.managerLoginId || "",
    assistantManagerLoginId: proposal.assistantManagerLoginId || "",
    managerIncentiveRate: Math.max(0, Number(proposal.managerIncentiveRate ?? DEFAULT_TEAM_RECOVERY_INCENTIVE_RATE)),
    assistantManagerIncentiveRate: Math.max(0, Number(proposal.assistantManagerIncentiveRate ?? DEFAULT_TEAM_RECOVERY_INCENTIVE_RATE)),
    approvedBy: currentUser?.loginId || currentUser?.name || role(),
    approvedByName: currentUser?.name || currentUser?.loginId || role(),
    approvedByRole: role() || "Employee",
    approvedAt: new Date().toISOString(),
    sourceProposalId: proposal.id,
  };
  loan.recoveries = [...previousRecoveries, recovery];
  proposal.status = "Approved";
  proposal.approvedBy = recovery.approvedBy;
  proposal.approvedAt = recovery.approvedAt;
  proposal.recoveryId = recovery.id;
  syncLoanOutstanding(loan, group);
  if (!persistAll()) {
    loan.individualLoans[individualPosition] = previousIndividual;
    loan.balance = previousBalance;
    loan.customerBalances = previousCustomerBalances;
    loan.recoveries = previousRecoveries;
    Object.assign(proposal, previousProposal);
    return;
  }
  if (!batchMode) {
    selectedRecoveryLoanIndex = loanIndex;
    renderAll();
    addActivity(`${proposalTypeLabel(proposal.type)} approved for ${member.name} · ${loan.groupNumber || loan.groupName}`);
    toast("Staff proposal approved. Customer demand and loan record are now updated.");
  }
  return true;
}

function approveRecoveryProposalGroup(loanIndex, encodedStaffKey) {
  if (!canApproveRecoveryProposal()) {
    toast("Only Executive or Cashier can approve staff recovery groups.");
    return;
  }
  const loan = loans[loanIndex];
  if (!loan) {
    toast("This group loan record could not be found.");
    return;
  }
  let staffKey = "";
  try {
    staffKey = decodeURIComponent(String(encodedStaffKey || ""));
  } catch {
    staffKey = String(encodedStaffKey || "");
  }
  const pending = (loan.recoveryProposals || [])
    .filter((proposal) => proposal.status === "Pending" && proposalStaffKey(proposal) === staffKey)
    .sort((a, b) => {
      const priority = { recovery: 1, advance: 2, penalty: 3, closing: 4 };
      return (priority[a.type] || 9) - (priority[b.type] || 9) || Number(a.memberIndex) - Number(b.memberIndex);
    });
  if (!pending.length) {
    toast("No pending entries remain for this staff and group.");
    renderAll();
    return;
  }

  const loanBackup = JSON.parse(JSON.stringify(loan));
  let approvedCount = 0;
  for (const proposal of pending) {
    if (!approveRecoveryProposal(loanIndex, proposal.id, true)) {
      loans[loanIndex] = loanBackup;
      persistAll();
      selectedRecoveryLoanIndex = loanIndex;
      renderAll();
      toast("Group approval was stopped. No member entry was approved; correct the highlighted entry and try again.");
      return;
    }
    approvedCount += 1;
  }
  selectedRecoveryLoanIndex = loanIndex;
  renderAll();
  const staffName = pending[0]?.proposedBy || pending[0]?.proposedByLogin || "Staff";
  addActivity(`${loan.groupNumber || loan.groupName} · ${approvedCount} entries approved together for ${staffName}`);
  toast(`${loan.groupNumber || loan.groupName} approved: all ${approvedCount} member entries are updated.`);
}

function memberHasRecovery(recovery, memberIndex) {
  return recovery?.member === memberIndex ||
    recovery?.allocations?.some((item) => item.memberIndex === memberIndex);
}

function recalculateMemberBalanceFromRecoveries(loan, memberIndex, unrecordedRecovered = 0) {
  const individual = loan.individualLoans?.find((item) => item.memberIndex === memberIndex);
  if (!individual) return;
  let remaining = Math.max(0, Number(individual.amount || 0) - Number(unrecordedRecovered || 0));
  const penaltyHistory = Array.isArray(individual.penaltyHistory) ? individual.penaltyHistory : [];
  const totalPenaltyAccrued = Math.max(
    0,
    Number(individual.penaltyAccrued || penaltyHistory.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
  );
  let penaltyPaidSoFar = 0;
  let penaltyRemaining = totalPenaltyAccrued;
  individual.penaltyPaid = 0;
  delete individual.closedAt;
  delete individual.closedBy;
  delete individual.closingAmount;
  individual.closingAdjustment = 0;
  const memberRecoveries = loan.recoveries || [];
  memberRecoveries.forEach((recovery, recoveryIndex) => {
    if (!memberHasRecovery(recovery, memberIndex)) return;
    const payment = Math.max(0, recoveryPaymentForMember(recovery, memberIndex));
    const accruedByEntryDate = penaltyHistory
      .filter((entry) => {
        if (!recovery.date) return true;
        if (entry.date < recovery.date) return true;
        if (entry.date > recovery.date) return false;
        if (entry.source !== "manual-recovery-entry" || !entry.sourceRecoveryId) return true;
        const sourceRecoveryIndex = memberRecoveries.findIndex(
          (item) => String(item.id || "") === String(entry.sourceRecoveryId || "")
        );
        if (sourceRecoveryIndex < 0) return true;
        if (sourceRecoveryIndex < recoveryIndex) return true;
        return sourceRecoveryIndex === recoveryIndex && Boolean(entry.appliedBeforePayment);
      })
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const availablePenalty = Math.max(0, accruedByEntryDate - penaltyPaidSoFar);
    const recordedPenalty = recovery.type === "closing"
      ? Number.isFinite(Number(recovery.penaltyPaid))
        ? Math.max(0, Number(recovery.penaltyPaid))
        : availablePenalty
      : 0;
    const penaltyPaid = Math.min(availablePenalty, recordedPenalty, payment);
    const principalPaid = Math.min(
      remaining,
      recovery.type === "closing" ? Math.max(0, payment - penaltyPaid) : payment
    );
    penaltyPaidSoFar += penaltyPaid;
    penaltyRemaining = Math.max(0, totalPenaltyAccrued - penaltyPaidSoFar);
    individual.penaltyPaid = penaltyPaidSoFar;
    recovery.penaltyPaid = penaltyPaid;
    recovery.principalPaid = principalPaid;
    if (recovery.type === "closing") {
      const totalBefore = remaining + penaltyRemaining + penaltyPaid;
      recovery.balanceBefore = totalBefore;
      recovery.allocations = [{ memberIndex, amount: payment }];
      recovery.closingAdjustment = Math.max(0, remaining - principalPaid);
      if (penaltyRemaining === 0) {
        remaining = 0;
        individual.closedAt = recovery.approvedAt || recovery.enteredAt || recovery.date;
        individual.closedBy = recovery.approvedBy || recovery.enteredBy || "Director";
        individual.closingAmount = payment;
        individual.closingAdjustment = recovery.closingAdjustment;
      }
      return;
    }
    remaining = Math.max(0, remaining - principalPaid);
    if (remaining === 0 && penaltyRemaining === 0) {
      individual.closedAt = recovery.approvedAt || recovery.enteredAt || recovery.date;
      individual.closedBy = recovery.approvedBy || recovery.enteredBy || "Recovery";
    }
  });
  individual.balance = remaining;
  individual.penaltyBalance = penaltyRemaining;
}

function directorEditApprovedRecovery(loanIndex, proposalId) {
  if (!canEditRecoveryProposal()) {
    toast("Only the Director can edit an approved recovery entry.");
    return;
  }
  const { loan, proposal } = proposalRecord(loanIndex, proposalId);
  const recovery = loan?.recoveries?.find((item) => item.id === proposal?.recoveryId);
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === proposal?.memberIndex);
  const group = groups.find(
    (item) => item.code === loan?.groupCode || item.code === loan?.code || item.number === loan?.groupNumber
  );
  const member = group?.members?.[proposal?.memberIndex];
  if (!loan || !proposal || proposal.status !== "Approved" || !recovery || !individual || !member) {
    toast("The approved recovery entry could not be found.");
    return;
  }
  if (recovery.type === "penalty") {
    const correctedText = window.prompt(
      "Correct penalty amount (closing only; EMI recovery stays unchanged)",
      String(proposalDisplayAmount(recovery))
    );
    if (correctedText === null) return;
    const correctedPenalty = Number(correctedText);
    if (!Number.isFinite(correctedPenalty) || correctedPenalty < 0) {
      toast("Enter a valid corrected penalty amount.");
      return;
    }
    if (!window.confirm(`Update ${member.name}'s penalty to ${fmt(correctedPenalty)}?`)) return;
    const previousLoan = JSON.parse(JSON.stringify(loan));
    const actor = currentUser?.loginId || currentUser?.name || "Director";
    const delta = setManualPenaltyForRecovery(individual, recovery, correctedPenalty, actor);
    individual.penaltyBalance = Math.max(0, customerPenaltyBalance(individual) + delta);
    recovery.penalty = correctedPenalty;
    recovery.penaltyAssessed = correctedPenalty;
    recovery.editedBy = actor;
    recovery.editedAt = new Date().toISOString();
    proposal.amount = correctedPenalty;
    proposal.penalty = correctedPenalty;
    proposal.penaltyAssessed = correctedPenalty;
    proposal.editedBy = actor;
    proposal.editedAt = recovery.editedAt;
    syncLoanOutstanding(loan, group);
    if (!persistAll()) {
      loans[loanIndex] = previousLoan;
      return;
    }
    selectedRecoveryLoanIndex = loanIndex;
    renderAll();
    addActivity(`Director corrected penalty for ${member.name} · ${loan.groupNumber || loan.groupName}`);
    toast(`Penalty corrected. Closing is ${fmt(customerTotalBalance(individual))}; EMI recovery is unchanged.`);
    return;
  }
  const correctedType = String(window.prompt("Correct entry type: recovery, advance, or closing", recovery.type || "recovery") || "").trim().toLowerCase();
  if (!correctedType) return;
  if (!["recovery", "advance", "closing"].includes(correctedType)) {
    toast("Entry type must be recovery, advance, or closing.");
    return;
  }
  const amountText = window.prompt("Correct received amount", String(recovery.amount || 0));
  if (amountText === null) return;
  const correctedAmount = Number(amountText);
  const manualPenaltyText = window.prompt("Correct manual penalty added to closing", String(recovery.penaltyAssessed ?? recovery.penalty ?? 0));
  if (manualPenaltyText === null) return;
  const correctedManualPenalty = Number(manualPenaltyText);
  if (!Number.isFinite(correctedAmount) || correctedAmount < 0 || (correctedType !== "closing" && correctedAmount <= 0)) {
    toast("Enter a valid corrected amount.");
    return;
  }
  if (!Number.isFinite(correctedManualPenalty) || correctedManualPenalty < 0) {
    toast("Enter a valid corrected manual penalty.");
    return;
  }
  const previousManualPenalty = Math.max(0, Number(recovery.penaltyAssessed ?? recovery.penalty ?? 0));
  const correctedPenaltyAccrued = Math.max(
    0,
    Number(individual.penaltyAccrued || 0) - previousManualPenalty + correctedManualPenalty
  );
  const maximumCorrectedAmount = correctedType === "closing"
    ? Number(individual.amount || 0) + correctedPenaltyAccrued
    : Number(individual.amount || 0);
  if (correctedAmount > maximumCorrectedAmount) {
    toast(`Corrected amount cannot exceed loan plus accrued penalty of ${fmt(maximumCorrectedAmount)}.`);
    return;
  }
  const correctedPenaltyBalance = Math.max(
    0,
    customerPenaltyBalance(individual) - previousManualPenalty + correctedManualPenalty
  );
  if (correctedType === "closing" && correctedAmount < correctedPenaltyBalance) {
    toast(`Penalty balance of ${fmt(correctedPenaltyBalance)} must be paid before closing.`);
    return;
  }
  const correctedDate = recovery.date || proposal.date || todayIso();
  const correctedReceipt = window.prompt("Correct receipt number", recovery.receipt || "");
  if (correctedReceipt === null) return;
  const correctedReview = window.prompt("Correct review / note", recovery.review || "");
  if (correctedReview === null) return;
  if (!window.confirm(`Update ${member.name}'s approved entry to ${proposalTypeLabel(correctedType)} ${fmt(correctedAmount)}?`)) return;

  const recordedBefore = (loan.recoveries || []).reduce(
    (sum, item) => sum + recoveryPrincipalPaymentForMember(item, proposal.memberIndex),
    0
  );
  const unrecordedRecovered = Math.max(0, customerRecoveredAmount(individual) - recordedBefore);
  const previousLoan = JSON.parse(JSON.stringify(loan));
  recovery.type = correctedType;
  recovery.date = correctedDate;
  recovery.receipt = String(correctedReceipt).trim();
  recovery.amount = correctedAmount;
  recovery.penalty = correctedManualPenalty;
  recovery.penaltyAssessed = correctedManualPenalty;
  recovery.review = String(correctedReview).trim();
  recovery.member = proposal.memberIndex;
  recovery.allocations = [{ memberIndex: proposal.memberIndex, amount: correctedAmount }];
  recovery.editedBy = currentUser?.loginId || currentUser?.name || "Director";
  recovery.editedAt = new Date().toISOString();
  setManualPenaltyForRecovery(individual, recovery, correctedManualPenalty, recovery.editedBy);
  delete recovery.penaltyPaid;
  proposal.type = correctedType;
  proposal.date = correctedDate;
  proposal.receipt = recovery.receipt;
  proposal.amount = correctedAmount;
  proposal.penalty = correctedManualPenalty;
  proposal.penaltyAssessed = correctedManualPenalty;
  proposal.review = recovery.review;
  proposal.editedBy = recovery.editedBy;
  proposal.editedAt = recovery.editedAt;
  proposal.directorAuthorizedReduction = correctedType === "closing";
  recalculateMemberBalanceFromRecoveries(loan, proposal.memberIndex, unrecordedRecovered);
  proposal.amount = recovery.amount;
  syncLoanOutstanding(loan, group);
  if (!persistAll()) {
    loans[loanIndex] = previousLoan;
    return;
  }
  selectedRecoveryLoanIndex = loanIndex;
  renderAll();
  addActivity(`Director corrected approved recovery for ${member.name} · ${loan.groupNumber || loan.groupName}`);
  toast("Approved recovery entry corrected by Director and loan balance recalculated.");
}

function overdueMembersForLoan(loan, asOf = todayIso()) {
  return (loan?.individualLoans || [])
    .map((individual) => ({ individual, overdue: memberOverdueInfo(loan, individual, asOf) }))
    .filter(({ overdue }) => overdue.overdue);
}

function loanMatchesRecoveryView(loan) {
  if (!canViewRecoveryLoan(loan)) return false;
  if (loan.day === selectedDay) return true;
  return recoveryUsesTeamScope() && overdueMembersForLoan(loan).length > 0;
}

function recoveryOverdueDayCounts() {
  const chosenStaff = canProposeRecovery() ? currentUser?.name : selectedRecoveryStaff;
  return loans.reduce((counts, loan) => {
    if (chosenStaff && chosenStaff !== "all" && loan.staff !== chosenStaff) return counts;
    const overdueCount = overdueMembersForLoan(loan).length;
    if (overdueCount) counts[loan.day] = Number(counts[loan.day] || 0) + overdueCount;
    return counts;
  }, {});
}

function recoveryFolderAccounts(type) {
  const chosenStaff = canProposeRecovery() ? currentUser?.name : selectedRecoveryStaff;
  const accounts = [];
  loans.forEach((loan, loanIndex) => {
    if (!canViewRecoveryLoan(loan)) return;
    if (chosenStaff && chosenStaff !== "all" && loan.staff !== chosenStaff) return;
    const group = groups.find(
      (record) => record.code === loan.groupCode || record.code === loan.code || record.number === loan.groupNumber
    );
    (loan.individualLoans || []).forEach((individual) => {
      const snapshot = memberDemandSnapshot(loan, individual, todayIso());
      if (type === "npa" && !snapshot.npa) return;
      if (type === "balance" && (!snapshot.overdueDays || snapshot.npa || snapshot.demand <= 0)) return;
      accounts.push({
        loan,
        loanIndex,
        individual,
        member: group?.members?.[individual.memberIndex] || {},
        snapshot,
      });
    });
  });
  return accounts;
}

function recoveryFolderAccountRows(accounts, type) {
  return accounts
    .map(({ loan, loanIndex, individual, member, snapshot }) => `<article class="npa-account recovery-folder-account">
      <div><b>${escapeHtml(member.name || "Customer")}</b><small>${escapeHtml(loan.groupNumber || "")} · ${escapeHtml(loan.groupName || "")}</small><small>${escapeHtml(loan.staff || "Unassigned staff")} · ${escapeHtml(loan.day || "")}</small>${type === "npa" ? `<small class="npa-aadhaar">Customer ${escapeHtml(maskedAadhaar(member.uuid))} · Permanently blocked</small><small class="npa-aadhaar">Guarantor ${escapeHtml(member.guarantor || "Not entered")} · ${escapeHtml(maskedAadhaar(member.guarantorAadhaar))}${normalizeAadhaar(member.guarantorAadhaar).length === 12 ? " · Permanently blocked" : " · Enter Aadhaar in original record to block"}</small>` : ""}</div>
      <div><span>Overdue</span><b>${snapshot.overdueDays} days</b><small>Since ${dateText(snapshot.overdueDate)}</small></div>
      <div><span>EMI recovery demand</span><b>${fmt(snapshot.demand)}</b><small>${snapshot.pendingEmiCount || 0} EMI pending · penalty shown separately</small></div>
      <div><span>Penalty balance</span><b>${fmt(snapshot.penaltyBalance)}</b><small>${type === "npa" ? "Automatic ₹50/day after NPA, plus manual entries" : "Manual entries only before NPA"}</small></div>
      <div><span>Loan closing balance</span><b>${fmt(customerTotalBalance(individual))}</b></div>
      <button class="collection-btn" type="button" onclick="openRecoveryFolderAccount(${loanIndex})">Open account</button>
    </article>`)
    .join("");
}

function renderNpaFolder() {
  const folder = $("#npaFolder");
  if (!folder) return;
  const accounts = recoveryFolderAccounts("npa");
  const totalDemand = accounts.reduce((sum, account) => sum + Number(account.snapshot.demand || 0), 0);
  const totalPenalty = accounts.reduce((sum, account) => sum + Number(account.snapshot.penaltyBalance || 0), 0);
  const open = recoveryFolderState.npa;
  folder.innerHTML = `<button class="recovery-folder-toggle npa-toggle" type="button" data-recovery-folder-toggle="npa" aria-expanded="${open}"><span class="recovery-folder-icon">NPA</span><span><b>NPA Folder</b><small>30+ days overdue · automatic ₹50/day penalty starts here</small></span><span class="recovery-folder-total"><b>${fmt(totalDemand)}</b><small>${accounts.length} customers · ${fmt(totalPenalty)} penalty</small></span><span class="folder-chevron">${open ? "−" : "+"}</span></button>
    <div class="recovery-folder-body ${open ? "" : "hidden"}">${accounts.length ? `<div class="npa-account-list">${recoveryFolderAccountRows(accounts, "npa")}</div>` : '<div class="npa-empty">No customer account is currently in NPA.</div>'}</div>`;
}

function renderBalanceRecoveryFolder() {
  const folder = $("#balanceRecoveryFolder");
  if (!folder) return;
  const accounts = recoveryFolderAccounts("balance");
  const total = accounts.reduce((sum, account) => sum + Number(account.snapshot.demand || 0), 0);
  const open = recoveryFolderState.balance;
  folder.innerHTML = `<button class="recovery-folder-toggle balance-toggle" type="button" data-recovery-folder-toggle="balance" aria-expanded="${open}"><span class="recovery-folder-icon">₹</span><span><b>Balance Recovery Folder</b><small>1–29 days overdue · automatic penalty is off</small></span><span class="recovery-folder-total"><b>${fmt(total)}</b><small>${accounts.length} customers · EMI recovery only</small></span><span class="folder-chevron">${open ? "−" : "+"}</span></button>
    <div class="recovery-folder-body ${open ? "" : "hidden"}">${accounts.length ? `<div class="npa-account-list">${recoveryFolderAccountRows(accounts, "balance")}</div>` : '<div class="npa-empty">No balance recovery is currently pending.</div>'}</div>`;
}

function toggleRecoveryFolder(type) {
  if (!Object.hasOwn(recoveryFolderState, type)) return;
  recoveryFolderState[type] = !recoveryFolderState[type];
  if (type === "npa") renderNpaFolder();
  else renderBalanceRecoveryFolder();
}

function openRecoveryFolderAccount(loanIndex) {
  const loan = loans[Number(loanIndex)];
  if (!loan || !canViewRecoveryLoan(loan)) return;
  selectedDay = loan.day || selectedDay;
  openRecoveryCentre(Number(loanIndex));
}

function renderRecoveryStaffLine() {
  const allNames = recoveryStaffNames();
  const names = canProposeRecovery()
    ? allNames.filter((name) => name === currentUser?.name)
    : isAssistantManagerTeamViewer()
      ? allNames.filter((name) => assistantManagerRecoveryStaffNames().includes(name))
      : allNames;
  if (canProposeRecovery()) selectedRecoveryStaff = currentUser?.name || "Unassigned Staff";
  if (!canProposeRecovery() && selectedRecoveryStaff !== "all" && !names.includes(selectedRecoveryStaff)) {
    selectedRecoveryStaff = "all";
  }
  const activeForDay = loans.filter(
    (loan) => loanMatchesRecoveryView(loan) && Number(loan.balance) > 0
  );
  const staffOptions = canProposeRecovery()
    ? names.map((name) => ({ value: name, label: name }))
    : [{ value: "all", label: "All staff" }, ...names.map((name) => ({ value: name, label: name }))];
  $("#recoveryStaffList").innerHTML = names.length
    ? staffOptions
        .map(({ value, label }) => {
          const staffLoans = activeForDay.filter((loan) => value === "all" || loan.staff === value);
          const staffDemand = staffLoans.reduce((sum, loan) => sum + recoveryViewDemand(loan), 0);
          const active = selectedRecoveryStaff === value;
          return `<div class="recovery-staff-item ${active ? "active" : ""}"><button type="button" class="recovery-staff-select" data-recovery-staff="${escapeHtml(value)}" aria-pressed="${active}"><span>${escapeHtml(label)}</span><small>${staffLoans.length} groups · ${fmt(staffDemand)} EMI recovery demand</small></button>${value !== "all" ? `<button class="staff-excel-download" type="button" data-download-recovery-staff="${escapeHtml(value)}" title="Download ${escapeHtml(label)} recovery demand">⇩ Excel</button>` : ""}</div>`;
        })
        .join("")
    : '<div class="empty staff-empty">No active recovery staff. Add an employee from Employee Access.</div>';
  $("#selectedRecoveryStaffName").textContent = selectedRecoveryStaff === "all" ? "All assigned staff" : selectedRecoveryStaff;
}

function recoveryStaffAssignmentMarkup(loan, loanIndex) {
  const activeAccounts = activeRecoveryStaffAccounts();
  const latestChange = (loan.staffAssignmentHistory || []).at(-1);
  const controls = canReassignRecoveryStaff()
    ? `<div class="recovery-assignment-controls">
        <select data-recovery-staff-select="${loanIndex}" aria-label="Select replacement recovery staff">
          <option value="">Select replacement</option>
          ${activeAccounts.map((account) => `<option value="${escapeHtml(account.loginId)}"${account.loginId === loan.recoveryStaffLoginId || account.name === loan.staff ? " disabled" : ""}>${escapeHtml(account.name)}${account.assistantManagerName ? ` · ${escapeHtml(account.assistantManagerName)}` : ""}</option>`).join("")}
        </select>
        <button class="collection-btn compact-btn" type="button" data-reassign-recovery-staff="${loanIndex}"${activeAccounts.length ? "" : " disabled"}>Assign</button>
      </div>`
    : "";
  return `<div class="recovery-assignment-cell"><b>${escapeHtml(loan.staff || "Unassigned")}</b>${latestChange ? `<small>Last changed ${dateText(latestChange.changedAt)} by ${escapeHtml(latestChange.changedBy || latestChange.changedByRole || "—")}</small>` : ""}${controls}</div>`;
}

function renderRecoveryAssignmentRegister() {
  let host = $("#recoveryAssignmentRegister");
  if (!host) {
    host = document.createElement("section");
    host.id = "recoveryAssignmentRegister";
    host.className = "recovery-assignment-register";
    $("#recoveryRiskFolders")?.insertAdjacentElement("beforebegin", host);
  }
  if (!canReassignRecoveryStaff()) {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  const activeAccounts = activeRecoveryStaffAccounts();
  const records = loans
    .map((loan, loanIndex) => ({ loan, loanIndex }))
    .filter(({ loan }) => Number(loan.balance || 0) > 0)
    .sort((left, right) => String(left.loan.groupNumber || left.loan.groupName).localeCompare(String(right.loan.groupNumber || right.loan.groupName), "en", { numeric: true }));
  const staffOptions = (loan) => `<option value="">Select replacement</option>${activeAccounts.map((account) => `<option value="${escapeHtml(account.loginId)}"${account.loginId === loan.recoveryStaffLoginId || account.name === loan.staff ? " disabled" : ""}>${escapeHtml(account.name)}${account.assistantManagerName ? ` · ${escapeHtml(account.assistantManagerName)}` : ""}</option>`).join("")}`;
  host.innerHTML = `<details class="panel recovery-assignment-book"><summary><span><b>Recovery Staff Assignment</b><small>Director, Cashier and Assistant Manager can transfer any active centre to any active Staff.</small></span><strong>${records.length} centres</strong></summary><div class="table-panel"><table><thead><tr><th>Centre</th><th>Recovery day</th><th>Current staff</th><th>Replacement staff</th><th>Action</th></tr></thead><tbody>${records.length ? records.map(({ loan, loanIndex }) => `<tr><td><b>${escapeHtml(loan.groupNumber || "—")}</b><small>${escapeHtml(loan.groupName || "Centre")}</small></td><td>${escapeHtml(loan.day || "—")}</td><td><b>${escapeHtml(loan.staff || "Unassigned")}</b></td><td><select data-global-recovery-staff-select="${loanIndex}">${staffOptions(loan)}</select></td><td><button class="collection-btn" type="button" onclick="assignRecoveryStaffFromRegister(${loanIndex})"${activeAccounts.length ? "" : " disabled"}>Assign</button></td></tr>`).join("") : '<tr><td colspan="5" class="empty">No active centre recovery is available.</td></tr>'}</tbody></table></div></details>`;
  host.classList.remove("hidden");
}

function assignRecoveryStaffFromRegister(loanIndex) {
  const select = document.querySelector(`[data-global-recovery-staff-select="${Number(loanIndex)}"]`);
  return reassignRecoveryStaff(Number(loanIndex), select?.value || "");
}

async function reassignRecoveryStaff(loanIndex, targetLoginId) {
  if (!canReassignRecoveryStaff()) {
    toast("Only the Director, Cashier, or Assistant Manager can change recovery staff.");
    return;
  }
  const loan = loans[Number(loanIndex)];
  const target = activeRecoveryStaffAccounts().find(
    (account) => String(account.loginId || "").toLowerCase() === String(targetLoginId || "").toLowerCase()
  );
  if (!loan || !target) {
    toast("Select an active replacement staff member.");
    return;
  }
  if (String(loan.recoveryStaffLoginId || "").toLowerCase() === String(target.loginId || "").toLowerCase() || loan.staff === target.name) {
    toast(`${target.name} is already assigned to this centre.`);
    return;
  }

  const previousStaff = loan.staff || "Unassigned";
  if (backendMode) {
    try {
      await window.NeelavatiApi.reassignRecoveryStaff(loan.id, target.loginId);
      const state = await window.NeelavatiApi.loadState();
      applyBackendState(state);
      const refreshed = loans.find((item) => item.id === loan.id);
      if (refreshed && !canViewRecoveryLoan(refreshed)) selectedRecoveryLoanIndex = null;
      renderAll();
      addActivity(`${loan.groupNumber || loan.groupName} recovery moved from ${previousStaff} to ${target.name}`);
      toast(`Recovery assigned to ${target.name}.`);
    } catch (error) {
      toast(error?.message || "Recovery staff could not be changed.");
    }
    return;
  }

  const previousLoan = structuredClone(loan);
  const group = groups.find(
    (item) => item.code === loan.groupCode || item.code === loan.code || item.number === loan.groupNumber
  );
  const previousGroupStaff = group?.recoveryStaff;
  loan.staff = target.name;
  Object.assign(loan, recoveryStaffAssignmentFields(target));
  loan.staffAssignmentHistory = [
    ...(loan.staffAssignmentHistory || []),
    {
      from: previousStaff,
      fromLoginId: previousLoan.recoveryStaffLoginId || "",
      to: target.name,
      toLoginId: target.loginId,
      changedAt: new Date().toISOString(),
      changedBy: currentUser?.name || currentUser?.loginId || role(),
      changedByRole: role(),
    },
  ];
  if (group) group.recoveryStaff = target.name;
  if (!persistAll()) {
    loans[Number(loanIndex)] = previousLoan;
    if (group) group.recoveryStaff = previousGroupStaff;
    return;
  }
  if (!canViewRecoveryLoan(loan)) selectedRecoveryLoanIndex = null;
  renderAll();
  addActivity(`${loan.groupNumber || loan.groupName} recovery moved from ${previousStaff} to ${target.name}`);
  toast(`Recovery assigned to ${target.name}.`);
}

function recoveryMemberStatusHtml(snapshot, individual) {
  if (snapshot.closed) {
    const concession = Number(individual.closingAdjustment || 0);
    return `<span class="recovery-state closed">CLOSED</span><small>${individual.closedAt ? dateText(individual.closedAt) : "Loan fully repaid"}${concession ? ` · ${fmt(concession)} concession` : ""}</small>`;
  }
  if (snapshot.npa) {
    return `<span class="recovery-state npa">NPA · ${snapshot.overdueDays} DAYS</span><small>${snapshot.pendingEmiCount || 0} EMI pending · ${fmt(snapshot.demand)} recovery · penalty ${fmt(snapshot.penaltyBalance)} added to closing</small>`;
  }
  if (snapshot.overdueDays > 0) {
    return `<span class="recovery-state overdue">${snapshot.pendingEmiCount || 1} EMI PENDING · ${snapshot.overdueDays} DAY${snapshot.overdueDays === 1 ? "" : "S"}</span><small>${fmt(snapshot.demand)} recovery demand${snapshot.penaltyBalance ? ` · penalty ${fmt(snapshot.penaltyBalance)} added to closing` : " · no automatic penalty before NPA"}</small>`;
  }
  if (snapshot.demand > 0) {
    return `<span class="recovery-state pending">${fmt(snapshot.demand)} TO COLLECT</span><small>${snapshot.demand < snapshot.emi ? `${fmt(snapshot.emi - snapshot.demand)} received against this EMI` : "Recovery is pending"}</small>`;
  }
  if (snapshot.futureCoveredWeeks > 0) {
    return `<span class="recovery-state advance">RECOVERY RECEIVED</span><small>Advance covers next ${snapshot.futureCoveredWeeks} week${snapshot.futureCoveredWeeks === 1 ? "" : "s"}${snapshot.prepaidUntil ? ` · through ${dateText(snapshot.prepaidUntil)}` : ""}</small>`;
  }
  return '<span class="recovery-state paid">RECOVERY RECEIVED</span><small>Current demand is fully paid</small>';
}

function memberRecoveryHistoryHtml(loan, memberIndex) {
  const proposalEntries = (loan.recoveryProposals || []).
    filter((proposal) => proposal.memberIndex === memberIndex)
    .map((proposal) => ({
      id: proposal.id,
      type: proposal.type,
      amount: Number(proposal.amount || 0),
      penaltyAssessed: Math.max(0, Number(proposal.penaltyAssessed ?? proposal.penalty ?? 0)),
      date: proposal.date,
      status: proposal.status || "Pending",
      timestamp: proposal.proposedAt || proposal.date || "",
    }));
  const directEntries = (loan.recoveries || [])
    .filter((recovery) => memberHasRecovery(recovery, memberIndex) && !recovery.sourceProposalId)
    .map((recovery) => ({
      id: recovery.id,
      type: recovery.type || "recovery",
      amount: recoveryPaymentForMember(recovery, memberIndex),
      penaltyAssessed: Math.max(0, Number(recovery.penaltyAssessed ?? recovery.penalty ?? 0)),
      date: recovery.date,
      status: "Updated",
      timestamp: recovery.enteredAt || recovery.date || "",
    }));
  const entries = [...proposalEntries, ...directEntries]
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 4);
  if (!entries.length) return '<div class="recovery-entry-history empty-history">No recovery entry updated yet.</div>';
  return `<div class="recovery-entry-history"><span class="history-label">Updated entries</span>${entries.map((entry) => `<span class="history-chip ${String(entry.status).toLowerCase()}"><b>${proposalTypeLabel(entry.type)}</b> ${fmt(proposalDisplayAmount(entry))}${entry.type !== "penalty" && entry.penaltyAssessed ? ` · Penalty +${fmt(entry.penaltyAssessed)}` : ""} · ${dateText(entry.date)} · ${escapeHtml(entry.status)}</span>`).join("")}</div>`;
}

function inlineRecoveryDefaultAmount(entryType, snapshot) {
  if (entryType === "advance") return 0;
  const balance = Math.max(0, Number(snapshot?.balance || 0));
  if (entryType === "closing") return balance;
  return Math.min(balance, Math.max(0, Number(snapshot?.demand || 0)));
}

function renderRecoveryCentre(loanIndex) {
  const panel = $("#recoveryCentreInlineHost") || $("#recoveryCentrePanel");
  if (!panel) return;
  const loan = loans[loanIndex];
  const group = groups.find(
    (item) => item.code === loan?.groupCode || item.code === loan?.code || item.number === loan?.groupNumber
  );
  if (!loan || !group || !Array.isArray(loan.individualLoans)) {
    panel.classList.add("hidden");
    return;
  }
  const demandDate = canBackdateOperationalEntries() ? directorRecoveryEntryDate(loanIndex) : activeRecoveryDemandDate(loan);
  const readOnly = !canEnterRecovery() && !canProposeRecovery();
  panel.innerHTML = `
    <div class="panel-head recovery-centre-head">
      <div><p class="eyebrow">CENTRE RECOVERY · ${dateText(demandDate)}</p><h3>${escapeHtml(loan.groupNumber || "Group")} · ${escapeHtml(loan.groupName || group.name)}</h3><p>${escapeHtml(loan.staff || "Unassigned staff")} · ${escapeHtml(loan.day || group.day || "")} · ${canBackdateOperationalEntries() ? "Director previous-entry mode" : `Entry date ${dateText(todayIso())} (fixed by system)`}</p></div>
      <div class="recovery-centre-head-actions">${canBackdateOperationalEntries() ? `<label class="director-entry-date">Recovery entry date<input type="date" value="${demandDate}" max="${todayIso()}" onchange="setDirectorRecoveryEntryDate(${loanIndex},this.value)"></label>` : ""}<button class="icon-close" type="button" onclick="closeRecoveryCentre()" aria-label="Close centre recovery">×</button></div>
    </div>
    <div class="recovery-member-list">
      ${loan.individualLoans.map((individual, position) => {
        const memberIndex = Number.isFinite(Number(individual.memberIndex)) ? Number(individual.memberIndex) : position;
        const member = group.members?.[memberIndex] || {};
        const snapshot = memberDemandSnapshot(loan, individual, demandDate);
        const pendingProposals = pendingMemberProposals(loan, memberIndex);
        const pendingTypes = new Set(pendingProposals.map((proposal) => proposal.type));
        const closingPending = pendingTypes.has("closing");
        const recoveryDisabled = readOnly || closingPending || pendingTypes.has("recovery") || snapshot.demand <= 0 ? " disabled" : "";
        const advanceDisabled = readOnly || closingPending || pendingTypes.has("advance") ? " disabled" : "";
        const closingDisabled = readOnly || closingPending ? " disabled" : "";
        const penaltyDisabled = readOnly || closingPending || pendingTypes.has("penalty") ? " disabled" : "";
        const photoDisabled = readOnly || closingPending ? " disabled" : "";
        const recoveryLabel = snapshot.demand <= 0 ? "1. Recovery paid" : "1. Recovery";
        const recoveryAmount = inlineRecoveryDefaultAmount("recovery", snapshot);
        const pendingPrincipalPayment = pendingProposals
          .filter((proposal) => ["recovery", "advance"].includes(proposal.type))
          .reduce((sum, proposal) => sum + Math.max(0, Number(proposal.amount || 0)), 0);
        const closingAmount = Math.max(0, snapshot.balance - pendingPrincipalPayment);
        const inlineInput = (type, value, isDisabled) => `<input class="inline-entry-amount" type="number" min="${type === "closing" ? "0" : "1"}" step="1" value="${Math.round(value)}" aria-label="${proposalTypeLabel(type)} amount for ${escapeHtml(member.name || `Customer ${position + 1}`)}" data-inline-loan="${loanIndex}" data-inline-member="${memberIndex}" data-inline-type="${type}"${isDisabled}>`;
        const photoReady = stagedRecoveryPhotos.has(recoveryPhotoKey(loanIndex, memberIndex));
        const statusHtml = pendingProposals.length
          ? `<span class="recovery-state proposal-pending">${pendingProposals.length > 1 ? `${pendingProposals.length} PROPOSALS PENDING` : "PROPOSAL PENDING"}</span><small>${pendingProposals.map((proposal) => `${proposalTypeLabel(proposal.type)} ${fmt(proposal.amount)}`).join(" · ")} · awaiting Executive/Cashier</small>`
          : recoveryMemberStatusHtml(snapshot, individual);
        return `<article class="recovery-member ${snapshot.closed ? "is-closed" : ""}">
          <div class="recovery-member-name"><span>A${String(memberIndex + 1).padStart(2, "0")}</span><div><b>${escapeHtml(member.name || `Customer ${position + 1}`)}</b><small>${escapeHtml(member.mobile || "No mobile number")}</small></div></div>
          <div class="recovery-member-figures"><div><span>Weekly EMI</span><b>${fmt(snapshot.emi)}</b></div><div><span>EMIs in demand</span><b>${snapshot.pendingEmiCount || (snapshot.demand > 0 ? 1 : 0)} EMI</b></div><div><span>Penalty due · manual/NPA</span><b>${fmt(snapshot.penaltyBalance)}</b></div><div><span>Total recovery demand</span><b>${fmt(snapshot.demand)}</b></div></div>
          <div class="recovery-member-status">${statusHtml}</div>
          <div class="recovery-member-actions inline-amount-actions">
            ${snapshot.closed
              ? '<span class="closed-label">CLOSED</span>'
              : `<div class="inline-entry-option"><label>${recoveryLabel}${inlineInput("recovery", recoveryAmount, recoveryDisabled)}</label><button class="collection-btn" type="button" onclick="saveInlineRecovery(${loanIndex},${memberIndex},'recovery')"${recoveryDisabled}>Update</button></div><div class="inline-entry-option advance-option"><label>2. Advance recovery${inlineInput("advance", inlineRecoveryDefaultAmount("advance", snapshot), advanceDisabled)}</label><button class="collection-btn advance-action" type="button" onclick="saveInlineRecovery(${loanIndex},${memberIndex},'advance')"${advanceDisabled}>Update</button></div><div class="inline-entry-option closing-option"><label>3. Closing${inlineInput("closing", closingAmount, closingDisabled)}</label><button class="collection-btn closing-action" type="button" onclick="saveInlineRecovery(${loanIndex},${memberIndex},'closing')"${closingDisabled}>Update</button></div><div class="inline-entry-option penalty-option"><label>4. Penalty<input class="inline-entry-amount" type="number" min="1" step="1" value="0" aria-label="Manual penalty for ${escapeHtml(member.name || `Customer ${position + 1}`)}" data-inline-penalty data-inline-loan="${loanIndex}" data-inline-member="${memberIndex}"${penaltyDisabled}></label><button class="collection-btn penalty-action" type="button" onclick="saveInlinePenalty(${loanIndex},${memberIndex})"${penaltyDisabled}>Update</button><small>Closing increases · EMI recovery unchanged</small></div>${canProposeRecovery() ? `<div class="inline-photo-option" data-photo-loan="${loanIndex}" data-photo-member="${memberIndex}"><button class="collection-btn photo-action" type="button" onclick="stageRecoveryPhoto(${loanIndex},${memberIndex})"${photoDisabled}>5. ${photoReady ? "Photo ready" : "Photo upload (optional)"}</button><small>${photoReady ? "Photo attached for this entry" : "Optional for Recovery / Advance / Closing · required for Penalty"}</small></div>` : ""}`}
          </div>
          ${memberRecoveryHistoryHtml(loan, memberIndex)}
        </article>`;
      }).join("")}
    </div>
    ${readOnly ? '<div class="view-only-note">Your login can view customer demand, but cannot enter or change recovery.</div>' : ""}
  `;
  panel.classList.remove("hidden");
}

function openRecoveryCentre(loanIndex) {
  if (!canViewRecoveryLoan(loans[Number(loanIndex)])) {
    toast("This recovery demand is outside your assigned team.");
    return;
  }
  selectedRecoveryLoanIndex = loanIndex;
  $("#recoveryEntry").classList.add("hidden");
  renderRecovery();
}

function closeRecoveryCentre() {
  selectedRecoveryLoanIndex = null;
  $("#recoveryEntry").classList.add("hidden");
  renderRecovery();
}

function toggleRecoveryCentre(loanIndex) {
  if (selectedRecoveryLoanIndex === loanIndex) closeRecoveryCentre();
  else openRecoveryCentre(loanIndex);
}

function renderRecovery() {
  const staffTodayOnly = canProposeRecovery();
  const currentDay = todayWeekday();
  if (staffTodayOnly) selectedDay = currentDay;
  const overdueCounts = recoveryOverdueDayCounts();
  $$("#dayTabs button").forEach((button) => {
    const overdueCount = Number(overdueCounts[button.textContent] || 0);
    button.style.display = staffTodayOnly && button.textContent !== currentDay && !overdueCount ? "none" : "";
    button.disabled = staffTodayOnly && button.textContent !== currentDay;
    button.classList.toggle("active", button.textContent === selectedDay);
    button.classList.toggle("has-overdue", overdueCount > 0);
    button.dataset.overdueCount = overdueCount ? `${overdueCount} overdue` : "";
    button.title = overdueCount ? `${overdueCount} customer recovery account${overdueCount === 1 ? " is" : "s are"} overdue` : "";
  });
  let todayNotice = $("#staffTodayNotice");
  if (!todayNotice) {
    todayNotice = document.createElement("div");
    todayNotice.id = "staffTodayNotice";
    todayNotice.className = "today-demand-notice hidden";
    $("#dayTabs")?.insertAdjacentElement("afterend", todayNotice);
  }
  if (staffTodayOnly) {
    todayNotice.textContent = DAYS.includes(currentDay)
      ? `Today only · ${currentDay}, ${dateText(todayIso())}. Highlighted earlier days are carried into today's demand.`
      : `Today is ${currentDay}. No new recovery is scheduled; overdue highlighted accounts remain visible.`;
    todayNotice.classList.remove("hidden");
  } else {
    todayNotice.classList.add("hidden");
  }
  const entryForm = $("#recoveryEntry");
  const entryHome = $("#recoveryEntryHome");
  if (entryForm && entryHome && entryForm.parentElement !== entryHome) entryHome.appendChild(entryForm);
  renderRecoveryStaffLine();
  renderRecoveryAssignmentRegister();
  renderNpaFolder();
  renderBalanceRecoveryFolder();
  const chosenStaff = selectedRecoveryStaff;
  const list = loans.filter(
    (loan) => loanMatchesRecoveryView(loan) && (chosenStaff === "all" || loan.staff === chosenStaff) &&
      (Number(loan.balance) > 0 || loans.indexOf(loan) === selectedRecoveryLoanIndex)
  );
  $("#recoveryRows").innerHTML = list.length
    ? list
        .map((loan) => {
          const loanIndex = loans.indexOf(loan);
          const expanded = selectedRecoveryLoanIndex === loanIndex;
          return `<tr class="recovery-group-row ${expanded ? "expanded" : ""}">
            <td><button class="group-id-button" type="button" onclick="toggleRecoveryCentre(${loanIndex})" aria-expanded="${expanded}"><b>${escapeHtml(loan.groupNumber || "")} · ${escapeHtml(loan.groupName)}</b><small>${loan.members} members · click Group ID to ${expanded ? "close" : "open"}</small></button></td>
            <td>Head 1: ${escapeHtml(loan.head1 || "—")}<small>Head 2: ${escapeHtml(loan.head2 || "—")}</small></td>
            <td>${recoveryStaffAssignmentMarkup(loan, loanIndex)}</td>
            <td>${fmt(recoveryViewDemand(loan))}${overdueMembersForLoan(loan).length ? `<small class="overdue-table-note">${overdueMembersForLoan(loan).length} customer overdue</small>` : ""}</td>
            <td>${fmt(loan.balance)}</td>
            <td><button class="collection-btn" type="button" onclick="toggleRecoveryCentre(${loanIndex})">${expanded ? "Close centre" : "Open centre"}</button></td>
          </tr>${expanded ? '<tr class="recovery-inline-row"><td colspan="6"><div id="recoveryCentreInlineHost" class="panel inline-centre-panel"></div></td></tr>' : ""}`;
        })
        .join("")
    : '<tr><td colspan="6" class="empty">No active recovery demand for this day and staff selection.</td></tr>';
  $("#demandTotal b").textContent = fmt(list.reduce((sum, loan) => sum + recoveryViewDemand(loan), 0));
  if (selectedRecoveryLoanIndex !== null) renderRecoveryCentre(selectedRecoveryLoanIndex);
  else $("#recoveryCentrePanel").classList.add("hidden");
}

function holdReleasePartAmount(individual) {
  return Math.max(0, Number(individual?.holdAmount || 0) / 2);
}

function holdReleaseMilestoneDate(loan, weekNumber) {
  return scheduleRows(
    Math.max(20, Number(loan?.term || 0)),
    loan?.disbursedOn,
    loan?.day,
    loanRecoveryStartMode(loan)
  ).find((row) => row.type === "installment" && Number(row.number) === Number(weekNumber))?.date || "";
}

function holdReleasePlan(loan, individual, asOf = todayIso(), designation = role()) {
  const holdAmount = Math.max(0, Number(individual?.holdAmount || 0));
  const released = (individual?.holdTransactions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const balance = Math.max(0, holdAmount - released);
  const partAmount = holdReleasePartAmount(individual);
  const week12Date = holdReleaseMilestoneDate(loan, 12);
  const week20Date = holdReleaseMilestoneDate(loan, 20);
  const isDirector = designation === "Director";
  let earnedAmount = 0;
  let reachedWeek = 0;
  if (week20Date && asOf >= week20Date) {
    earnedAmount = holdAmount;
    reachedWeek = 20;
  } else if (week12Date && asOf >= week12Date) {
    earnedAmount = partAmount;
    reachedWeek = 12;
  }
  const earnedBalance = Math.max(0, earnedAmount - released);
  const availableNow = isDirector ? balance : Math.min(balance, earnedBalance);
  const entryLimit = isDirector ? balance : Math.min(partAmount, availableNow);
  const nextWeek = released < partAmount ? 12 : released < holdAmount ? 20 : 0;
  const nextDate = nextWeek === 12 ? week12Date : nextWeek === 20 ? week20Date : "";
  return {
    holdAmount,
    partAmount,
    released,
    balance,
    week12Date,
    week20Date,
    reachedWeek,
    earnedAmount,
    availableNow,
    entryLimit,
    nextWeek,
    nextDate,
    isDirector,
    eligible: balance > 0 && (isDirector || entryLimit > 0),
  };
}

function holdReleaseStatusHtml(loan, individual) {
  const plan = holdReleasePlan(loan, individual);
  if (plan.balance <= 0) return '<span class="status">Complete</span>';
  if (plan.isDirector) {
    return `<span class="hold-release-status director-release">Director emergency release · ${fmt(plan.balance)} available anytime</span>`;
  }
  if (plan.entryLimit > 0) {
    return `<span class="hold-release-status eligible-release">Week ${plan.reachedWeek} eligible · release up to ${fmt(plan.entryLimit)}</span>`;
  }
  if (plan.nextDate) {
    return `<span class="hold-release-status locked-release">Locked · Part ${plan.nextWeek === 12 ? "1" : "2"} after week ${plan.nextWeek} (${dateText(plan.nextDate)})</span>`;
  }
  return '<span class="hold-release-status locked-release">Release schedule unavailable</span>';
}

function renderHoldLoans() {
  const query = $("#holdSearch")?.value || "";
  const records = loans
    .map((loan) => ({
      loan,
      items: (loan.individualLoans || []).filter((item) => Number(item.holdAmount || 0) > 0),
    }))
    .filter(({ items }) => items.length)
    .filter(({ loan }) =>
      matchesGroupSearch(query, loan.groupNumber, [
        ...loanCustomerSearchValues(loan),
        loan.groupCode,
        loan.code,
      ])
    );
  $("#holdList").innerHTML = records.length
    ? records
        .map(({ loan, items }) => {
          const group = groups.find((item) => item.code === loan.groupCode);
          return `<section class="panel">
            <div class="panel-head"><div><p class="eyebrow">${escapeHtml(loan.groupNumber || "GROUP")} · HOLD LOAN</p>
            <h3>${escapeHtml(loan.groupName)}</h3><p>${escapeHtml(group?.centreAddress || "")}</p></div>
            <b>${items.length} customer holds</b></div>
            <div class="hold-release-policy"><b>2-part release rule</b><span>First half after week 12 · second half after week 20 · Director may release earlier for an emergency.</span></div>
            <div class="table-panel"><table><thead><tr><th>Customer</th><th>Loan amount</th><th>Hold amount</th><th>Part amount</th><th>Released</th><th>Balance hold</th><th>Release status</th><th>Action</th></tr></thead>
            <tbody>${items
              .map((item) => {
                const member = group?.members[item.memberIndex];
                const balance = Number(item.holdBalance ?? item.holdAmount);
                const releasePlan = holdReleasePlan(loan, item);
                return `<tr><td><b>${escapeHtml(member?.name || "Customer")}</b><small>${memberRoleLabel(item.memberIndex)}</small></td>
                <td>${fmt(item.amount)}</td><td>${fmt(item.holdAmount)}</td><td>${fmt(releasePlan.partAmount)} × 2</td><td>${fmt(Number(item.holdAmount) - balance)}</td>
                <td>${fmt(balance)}</td><td>${holdReleaseStatusHtml(loan, item)}</td><td>${balance > 0 && canEnterHoldLoan() && releasePlan.eligible ? `<button class="collection-btn" type="button" onclick="openHoldEntry(${loans.indexOf(loan)},${item.memberIndex})">${releasePlan.isDirector ? "Release anytime" : `Release ${fmt(releasePlan.entryLimit)}`}</button>` : balance <= 0 ? '<span class="status">Complete</span>' : canEnterHoldLoan() ? '<span class="muted">Not eligible yet</span>' : '<span class="muted">View only</span>'}</td></tr>`;
              })
              .join("")}</tbody></table></div>
            ${items
              .map((item) => {
                const transactions = item.holdTransactions || [];
                if (!transactions.length) return "";
                const member = group?.members[item.memberIndex];
                return `<div class="activity hold-entry-list"><b>${escapeHtml(member?.name || "Customer")} entries</b>${transactions
                  .map((entry, transactionIndex) => `<li><span>${dateText(entry.date)} · ${fmt(entry.amount)} · ${entry.emergencyOverride ? '<b class="emergency-hold-label">Director emergency release</b>' : entry.releasePart ? `Part ${entry.releasePart} · week ${entry.scheduledReleaseWeek || (entry.releasePart === 1 ? 12 : 20)}` : "Previous hold release"} · Released by ${escapeHtml(holdReleaseEmployeeName(entry))}${entry.releasedByRole ? ` (${escapeHtml(entry.releasedByRole)})` : ""} · ${escapeHtml(entry.note || "Hold release")}${entry.editedAt ? ` · Corrected by ${escapeHtml(entry.editedBy || "Director")}` : ""}</span>${canEditHoldEntries() ? `<button class="collection-btn" type="button" onclick="editHoldTransaction(${loans.indexOf(loan)},${item.memberIndex},${transactionIndex})">Edit</button>` : ""}</li>`)
                  .join("")}</div>`;
              })
              .join("")}
          </section>`;
        })
        .join("")
    : query
      ? `<div class="empty panel">No hold loan found for “${escapeHtml($("#holdSearch").value.trim())}”. Search using a Group ID, centre, or customer name.</div>`
      : '<div class="empty panel">Hold records appear automatically after eligible customer loans are disbursed.</div>';
}

function openHoldEntry(loanIndex, memberIndex) {
  if (!canEnterHoldLoan()) {
    toast("Your login does not have permission to release a hold amount.");
    return;
  }
  const loan = loans[loanIndex];
  const group = groups.find((item) => item.code === loan?.groupCode);
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  if (!individual) return;
  const releasePlan = holdReleasePlan(loan, individual);
  if (!releasePlan.eligible) {
    toast(releasePlan.nextDate
      ? `Staff can release the next hold part only after week ${releasePlan.nextWeek} (${dateText(releasePlan.nextDate)}). Director can release earlier in an emergency.`
      : "No hold amount is currently available for release.");
    return;
  }
  $("#holdEntryForm").dataset.loan = String(loanIndex);
  $("#holdEntryForm").dataset.member = String(memberIndex);
  delete $("#holdEntryForm").dataset.transaction;
  $("#holdEntryTitle").textContent = `Release hold · ${group?.members[memberIndex]?.name || "Customer"}`;
  $("#holdDate").value = todayIso();
  $("#holdDate").readOnly = !canBackdateOperationalEntries();
  $("#holdDate").max = todayIso();
  $("#holdDateHelp").textContent = canBackdateOperationalEntries()
    ? "Director emergency override: release can be entered on today or any previous date."
    : `Today's date is fixed. Week ${releasePlan.reachedWeek} release limit is ${fmt(releasePlan.entryLimit)}.`;
  $("#holdAmountEntry").value = String(Math.round(releasePlan.entryLimit));
  $("#holdAmountEntry").max = releasePlan.entryLimit;
  $("#holdNote").value = "";
  $("#holdReleaseRule").innerHTML = `<b>${fmt(releasePlan.partAmount)} × 2 release schedule</b><span>Part 1: week 12 · ${dateText(releasePlan.week12Date)} &nbsp;|&nbsp; Part 2: week 20 · ${dateText(releasePlan.week20Date)}</span>${releasePlan.isDirector ? '<small>Director emergency override is active.</small>' : `<small>This entry cannot exceed ${fmt(releasePlan.entryLimit)}.</small>`}`;
  $("#saveHoldEntry").textContent = "Save hold entry";
  $("#holdEntryForm").classList.add("hold-entry-dialog");
  $("#holdEntryForm").classList.remove("hidden");
}

function editHoldTransaction(loanIndex, memberIndex, transactionIndex) {
  if (!canEditHoldEntries()) {
    toast("Only the Director can correct a hold loan entry.");
    return;
  }
  const loan = loans[loanIndex];
  const group = groups.find((item) => item.code === loan?.groupCode);
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  const transaction = individual?.holdTransactions?.[transactionIndex];
  if (!individual || !transaction) {
    toast("This hold entry could not be found.");
    return;
  }
  const releasedByOtherEntries = individual.holdTransactions.reduce(
    (sum, entry, index) => sum + (index === transactionIndex ? 0 : Number(entry.amount || 0)),
    0
  );
  $("#holdEntryForm").dataset.loan = String(loanIndex);
  $("#holdEntryForm").dataset.member = String(memberIndex);
  $("#holdEntryForm").dataset.transaction = String(transactionIndex);
  $("#holdEntryTitle").textContent = `Correct hold entry · ${group?.members[memberIndex]?.name || "Customer"}`;
  $("#holdDate").value = transaction.date || todayIso();
  $("#holdDate").readOnly = false;
  $("#holdDate").max = todayIso();
  $("#holdDateHelp").textContent = "Director can correct the previous hold-release date.";
  $("#holdAmountEntry").value = transaction.amount || "";
  $("#holdAmountEntry").max = Math.max(0, Number(individual.holdAmount || 0) - releasedByOtherEntries);
  $("#holdNote").value = transaction.note || "";
  $("#holdReleaseRule").innerHTML = '<b>Director correction mode</b><span>The saved date and amount can be corrected within the remaining hold balance.</span>';
  $("#saveHoldEntry").textContent = "Update hold entry";
  $("#holdEntryForm").classList.add("hold-entry-dialog");
  $("#holdEntryForm").classList.remove("hidden");
}

function saveHoldEntry() {
  if (!canEnterHoldLoan()) {
    toast("Your login does not have permission to save a hold release.");
    return;
  }
  const loan = loans[Number($("#holdEntryForm").dataset.loan)];
  const memberIndex = Number($("#holdEntryForm").dataset.member);
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  const transactionValue = $("#holdEntryForm").dataset.transaction;
  const isEdit = transactionValue !== undefined;
  const transactionIndex = isEdit ? Number(transactionValue) : -1;
  const amount = Number($("#holdAmountEntry").value || 0);
  const requestedHoldDate = String($("#holdDate").value || "").slice(0, 10);
  const holdEntryDate = canBackdateOperationalEntries() ? requestedHoldDate : todayIso();
  $("#holdDate").value = holdEntryDate;
  if (!individual || !isValidIsoDate(holdEntryDate) || holdEntryDate > todayIso() || amount <= 0) {
    toast("Enter a valid date and hold release amount.");
    return;
  }
  if (isEdit && !canEditHoldEntries()) {
    toast("Only the Director can correct a hold loan entry.");
    return;
  }
  individual.holdTransactions = individual.holdTransactions || [];
  const existingTransaction = isEdit ? individual.holdTransactions[transactionIndex] : null;
  if (isEdit && !existingTransaction) {
    toast("This hold entry could not be found.");
    return;
  }
  const releasePlan = holdReleasePlan(loan, individual, holdEntryDate, role());
  if (!isEdit && role() !== "Director" && !releasePlan.eligible) {
    toast(releasePlan.nextDate
      ? `This hold part is locked until week ${releasePlan.nextWeek} (${dateText(releasePlan.nextDate)}).`
      : "No scheduled hold amount is available for release.");
    return;
  }
  if (!isEdit && role() !== "Director" && amount > releasePlan.entryLimit) {
    toast(`Only ${fmt(releasePlan.entryLimit)} can be released in this scheduled part.`);
    return;
  }
  const releasedByOtherEntries = individual.holdTransactions.reduce(
    (sum, entry, index) => sum + (isEdit && index === transactionIndex ? 0 : Number(entry.amount || 0)),
    0
  );
  const available = Math.max(0, Number(individual.holdAmount || 0) - releasedByOtherEntries);
  if (amount > available) {
    toast(`Available hold balance for this entry is ${fmt(available)}.`);
    return;
  }
  const partAmount = holdReleasePartAmount(individual);
  const releasePart = releasedByOtherEntries < partAmount ? 1 : 2;
  const scheduledReleaseWeek = releasePart === 1 ? 12 : 20;
  const employeePlanAtEntryDate = holdReleasePlan(loan, individual, holdEntryDate, "Staff");
  const emergencyOverride = !isEdit && role() === "Director" && amount > employeePlanAtEntryDate.entryLimit;
  const previousBalance = individual.holdBalance;
  const previousTransactions = individual.holdTransactions.map((entry) => ({ ...entry }));
  const transaction = {
    id: existingTransaction?.id || `HOLD-${Date.now()}`,
    date: holdEntryDate,
    amount,
    note: $("#holdNote").value.trim() || (emergencyOverride ? "Director emergency hold release" : `Part ${releasePart} hold release after week ${scheduledReleaseWeek}`),
    createdAt: existingTransaction?.createdAt || new Date().toISOString(),
    releasedByName: existingTransaction?.releasedByName || existingTransaction?.releasedBy || currentUser?.name || currentUser?.loginId || role() || "Employee",
    releasedByLoginId: existingTransaction?.releasedByLoginId || currentUser?.loginId || "",
    releasedByRole: existingTransaction?.releasedByRole || role() || "Employee",
    releasePart: existingTransaction?.releasePart || releasePart,
    scheduledReleaseWeek: existingTransaction?.scheduledReleaseWeek || scheduledReleaseWeek,
    emergencyOverride: existingTransaction?.emergencyOverride || emergencyOverride,
    ...(isEdit ? { editedAt: new Date().toISOString(), editedBy: currentUser?.loginId || "Director" } : {}),
  };
  if (isEdit) individual.holdTransactions[transactionIndex] = transaction;
  else individual.holdTransactions.push(transaction);
  individual.holdBalance = Math.max(
    0,
    Number(individual.holdAmount || 0) - individual.holdTransactions.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  );
  if (!persistAll()) {
    individual.holdBalance = previousBalance;
    individual.holdTransactions = previousTransactions;
    return;
  }
  $("#holdEntryForm").classList.add("hidden");
  renderHoldLoans();
  toast(isEdit ? "Hold entry corrected successfully." : "Hold release entry saved.");
}

const AUTOMATIC_CASHBOOK_SOURCES = new Set([
  "loan-disbursement",
  "loan-processing-fee",
  "hold-release",
  "recovery",
  "advance-recovery",
  "loan-closing",
  "penalty-recovery",
  "missed-recovery",
]);

function cashbookDate(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? todayIso() : localIsoDate(parsed);
}

function cashbookSourceLabel(source) {
  return {
    "cash-intake": "Cash intake",
    recovery: "Recovery",
    "advance-recovery": "Advance recovery",
    "loan-closing": "Closing",
    "penalty-recovery": "Penalty received",
    "loan-disbursement": "Loan disbursement",
    "loan-processing-fee": "Processing fee",
    "hold-release": "Hold release",
    "missed-recovery": "Recovery not received",
    "debit-voucher": "Debit voucher",
  }[source] || "Cashbook entry";
}

function cashbookRecoveryNames(group, recovery) {
  const indexes = Array.isArray(recovery?.allocations)
    ? recovery.allocations.map((item) => Number(item.memberIndex))
    : [Number(recovery?.member)];
  return [...new Set(indexes)]
    .map((index) => group?.members?.[index]?.name)
    .filter(Boolean)
    .join(", ") || "Customer";
}

function recoveryCollectionEmployee(recovery) {
  const recordedLogin = String(recovery?.enteredBy || recovery?.proposedByLogin || "").trim();
  const account = employeeAccounts.find(
    (item) => recordedLogin && String(item.loginId || "").toLowerCase() === recordedLogin.toLowerCase()
  );
  return {
    name: String(
      recovery?.enteredByName ||
      recovery?.proposedBy ||
      account?.name ||
      recordedLogin ||
      "Employee unavailable (old entry)"
    ),
    loginId: String(recovery?.enteredByLoginId || account?.loginId || recordedLogin || ""),
    role: String(recovery?.enteredByRole || recovery?.proposedByRole || account?.designation || (recovery?.sourceProposalId ? "Staff" : "Employee")),
  };
}

function recoveryPaysEarlierMissedInstallment(loan, recovery, recoveryIndex) {
  const recoveryDate = cashbookDate(recovery?.date);
  const memberIndexes = Array.isArray(recovery?.allocations)
    ? recovery.allocations.map((item) => Number(item.memberIndex))
    : [Number(recovery?.member)];
  const loanBeforeRecovery = {
    ...loan,
    recoveries: (loan.recoveries || []).slice(0, recoveryIndex),
  };
  return [...new Set(memberIndexes)].some((memberIndex) => {
    const individual = (loan.individualLoans || []).find((item) => Number(item.memberIndex) === memberIndex);
    if (!individual) return false;
    const paymentsBeforeRecovery = customerSchedulePaymentRows(
      loanBeforeRecovery,
      individual,
      memberIndex,
      recoveryDate
    );
    const originalAmount = Math.max(0, Number(individual.amount || 0));
    const emi = Math.max(0, Number(individual.emi || 0));
    return installmentRowsForCustomer(loan, individual).some((row, index) => {
      if (row.date >= recoveryDate) return false;
      const scheduledAmount = Math.min(emi, Math.max(0, originalAmount - index * emi));
      const received = Math.min(scheduledAmount, Number(paymentsBeforeRecovery.get(row.date)?.received || 0));
      return scheduledAmount - received > 0;
    });
  });
}

function automaticCashbookEntries(asOf = todayIso()) {
  const entries = [];
  const add = (entry) => {
    const amount = Number(entry.amount || 0);
    if (!entry.autoKey || !Number.isFinite(amount) || amount <= 0) return;
    entries.push({
      ...entry,
      amount,
      date: cashbookDate(entry.date),
      sourceId: entry.sourceId || entry.autoKey,
      systemGenerated: true,
    });
  };

  loans.forEach((loan) => {
    const group = groups.find(
      (record) => record.code === loan.groupCode || record.code === loan.code || record.number === loan.groupNumber
    );
    const groupReference = loan.groupNumber || group?.number || loan.groupName || "Group";
    const loanKey = String(loan.id || loan.groupCode || loan.groupNumber || loan.groupName);
    const totalHold = (loan.individualLoans || []).reduce((sum, item) => sum + Number(item.holdAmount || 0), 0);
    const processingTotal = loanProcessingTotal(loan);
    const netDisbursement = Math.max(0, Number(loan.amount || 0) - totalHold);
    add({
      autoKey: `loan-disbursement:${loanKey}`,
      sourceId: loanKey,
      source: "loan-disbursement",
      daybookCategory: "disbursement",
      type: "debit",
      date: loan.disbursedOn,
      description: `Net loan disbursement · ${groupReference}`,
      reference: `${group?.name || loan.groupName || groupReference} · Loan ${fmt(loan.amount || 0)} less hold ${fmt(totalHold)}`,
      amount: netDisbursement,
      createdBy: loan.loanStaff || group?.loanStaff || "System",
    });
    add({
      autoKey: `loan-processing-fee:${loanKey}:group`,
      sourceId: `${loanKey}:group`,
      source: "loan-processing-fee",
      daybookCategory: "processing",
      type: "credit",
      date: loan.disbursedOn,
      description: `Group processing received · ${groupReference}`,
      reference: `${group?.name || loan.groupName || "Centre"} · ${(loan.individualLoans || []).length || loan.members || 0} customers`,
      amount: processingTotal,
      createdBy: loan.loanStaff || group?.loanStaff || "System",
    });

    (loan.individualLoans || []).forEach((individual) => {
      const memberIndex = Number(individual.memberIndex);
      const memberName = group?.members?.[memberIndex]?.name || `Customer A${String(memberIndex + 1).padStart(2, "0")}`;
      (individual.holdTransactions || []).forEach((transaction) => {
        const transactionKey = `${loanKey}:${transaction.id || `${memberIndex}:${transaction.date}`}`;
        const releasedByName = holdReleaseEmployeeName(transaction);
        add({
          autoKey: `hold-release:${transactionKey}`,
          sourceId: transactionKey,
          source: "hold-release",
          daybookCategory: "hold-loan-deduction",
          type: "debit",
          date: transaction.date,
          description: `Hold amount released · ${groupReference} · ${memberName} · By ${releasedByName}`,
          reference: `${transaction.releasedByRole || "Employee"}${transaction.note ? ` · ${transaction.note}` : ""}`,
          amount: transaction.amount,
          createdBy: releasedByName,
          createdByRole: transaction.releasedByRole || "",
          holdReleasedBy: releasedByName,
          holdReleasedByLoginId: transaction.releasedByLoginId || "",
          holdReleaseAmount: Number(transaction.amount || 0),
        });
      });

      const closedDate = individual.closedAt ? cashbookDate(individual.closedAt) : "";
      const schedule = installmentRowsForCustomer(loan, individual);
      const originalAmount = Math.max(0, Number(individual.amount || 0));
      const emi = Math.max(0, Number(individual.emi || 0));
      schedule.forEach((row, index) => {
        if (row.date > asOf) return;
        if (closedDate && row.date > closedDate) return;
        const paymentsOnDueDate = customerSchedulePaymentRows(loan, individual, memberIndex, row.date);
        const scheduledAmount = Math.min(emi, Math.max(0, originalAmount - index * emi));
        const received = Math.min(scheduledAmount, Number(paymentsOnDueDate.get(row.date)?.received || 0));
        const missed = Math.max(0, scheduledAmount - received);
        add({
          autoKey: `missed-recovery:${loanKey}:${memberIndex}:${row.date}`,
          sourceId: `${loanKey}:${memberIndex}:${row.date}`,
          source: "missed-recovery",
          daybookCategory: "balance-recovery",
          type: "debit",
          date: row.date,
          description: `Recovery not received · ${groupReference} · ${memberName}`,
          reference: `Week ${row.number} · Scheduled ${fmt(scheduledAmount)}`,
          amount: missed,
          createdBy: "System",
          historicalSnapshot: true,
          snapshotDate: row.date,
          lockedAfterDate: row.date,
        });
      });
    });

    (loan.recoveries || []).forEach((recovery, recoveryIndex) => {
      const recoveryKey = `${loanKey}:${recovery.id || `${recovery.date}:${recovery.member}:${recoveryIndex}`}`;
      const penaltyAmount = Math.max(0, Number(recovery.penaltyPaid || 0));
      const receivedAmount = Math.max(0, Number(recovery.amount || 0));
      const nonPenaltyAmount = Math.max(0, receivedAmount - penaltyAmount);
      const names = cashbookRecoveryNames(group, recovery);
      const recoverySource = recovery.type === "closing"
        ? "loan-closing"
        : recovery.type === "advance" ? "advance-recovery" : "recovery";
      const recoveryDate = cashbookDate(recovery.date);
      const statedDemandDate = recovery.demandDate ? cashbookDate(recovery.demandDate) : "";
      const receivedWeekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        new Date(`${recoveryDate}T12:00:00`).getDay()
      ];
      const paysEarlierMissedInstallment = recoveryPaysEarlierMissedInstallment(loan, recovery, recoveryIndex);
      const scheduledRecoveryDay = String(loan.day || group?.day || "");
      const isScheduledRecoveryDay = String(receivedWeekday || "").toLowerCase() === scheduledRecoveryDay.toLowerCase();
      // A normal collection received on the centre's scheduled weekday belongs to
      // that day's Total Recovery, even when it also clears an older shortfall.
      // Collections received on any other weekday remain visible as Late Recovery.
      const isLaterRecovery = recoverySource === "recovery" && !isScheduledRecoveryDay;
      const recoveryCategory = recoverySource === "loan-closing"
        ? "closing"
        : recoverySource === "advance-recovery" ? "advance" : isLaterRecovery ? "later-recovery" : "total-recovery";
      const collectionEmployee = recoveryCollectionEmployee(recovery);
      add({
        autoKey: `${recoverySource}:${recoveryKey}`,
        sourceId: `${recoveryKey}:received`,
        source: recoverySource,
        daybookCategory: recoveryCategory,
        type: "credit",
        date: recovery.date,
        description: `${cashbookSourceLabel(recoverySource)} received · ${groupReference} · ${names} · By ${collectionEmployee.name}`,
        reference: recovery.receipt ? `Receipt ${recovery.receipt}` : group?.name || loan.groupName || "",
        amount: nonPenaltyAmount,
        createdBy: collectionEmployee.name,
        createdByRole: collectionEmployee.role,
        collectionStaffName: collectionEmployee.name,
        collectionStaffLoginId: collectionEmployee.loginId,
        collectionStaffRole: collectionEmployee.role,
        collectionGroup: groupReference,
        collectionCentre: group?.name || loan.groupName || groupReference,
        collectionCustomers: names,
        collectionWeekday: receivedWeekday,
        scheduledRecoveryDay,
        coversEarlierMissedInstallment: paysEarlierMissedInstallment,
        statedDemandDate,
        approvedBy: recovery.approvedByName || recovery.approvedBy || "",
      });
      add({
        autoKey: `penalty-recovery:${recoveryKey}`,
        sourceId: `${recoveryKey}:penalty`,
        source: "penalty-recovery",
        daybookCategory: "penalty",
        type: "credit",
        date: recovery.date,
        description: `Penalty received · ${groupReference} · ${names} · By ${collectionEmployee.name}`,
        reference: recovery.receipt ? `Receipt ${recovery.receipt}` : group?.name || loan.groupName || "",
        amount: penaltyAmount,
        createdBy: collectionEmployee.name,
        createdByRole: collectionEmployee.role,
        collectionStaffName: collectionEmployee.name,
        collectionStaffLoginId: collectionEmployee.loginId,
        collectionStaffRole: collectionEmployee.role,
        collectionGroup: groupReference,
        collectionCentre: group?.name || loan.groupName || groupReference,
        collectionCustomers: names,
        approvedBy: recovery.approvedByName || recovery.approvedBy || "",
      });
    });
  });

  return entries;
}

function syncAutomaticCashbookEntries(asOf = todayIso()) {
  const desired = automaticCashbookEntries(asOf);
  const desiredKeys = new Set(desired.map((entry) => entry.autoKey));
  let changed = false;
  desired.forEach((entry) => {
    let existing = cashEntries.find((item) => item.autoKey === entry.autoKey);
    if (!existing) {
      existing = cashEntries.find(
        (item) => item.source === entry.source && String(item.sourceId || "") === String(entry.sourceId || "")
      );
    }
    if (!existing) {
      cashEntries.push({
        id: `CASH-AUTO-${Date.now()}-${cashEntries.length}`,
        ...entry,
        createdAt: new Date().toISOString(),
      });
      changed = true;
      return;
    }
    Object.entries(entry).forEach(([key, value]) => {
      if (existing.directorOverride && ["amount", "description", "reference"].includes(key)) return;
      if (existing[key] !== value) {
        existing[key] = value;
        changed = true;
      }
    });
  });
  for (let index = cashEntries.length - 1; index >= 0; index -= 1) {
    const entry = cashEntries[index];
    if (!AUTOMATIC_CASHBOOK_SOURCES.has(entry.source) || !entry.systemGenerated) continue;
    if (entry.directorOverride) continue;
    if (!desiredKeys.has(entry.autoKey)) {
      cashEntries.splice(index, 1);
      changed = true;
    }
  }
  if (changed) persistAll();
  return changed;
}

function renderCashbookLegacy() {
  let balance = 0;
  let cashIn = 0;
  let cashOut = 0;
  const voucherButton = $("#newDebitVoucher");
  if (voucherButton) voucherButton.style.display = canCreateDebitVoucher() ? "" : "none";
  $("#cashRows").innerHTML = cashEntries.length
    ? cashEntries
        .map((entry, index) => {
          const amount = Number(entry.amount || 0);
          if (entry.type === "credit") {
            balance += amount;
            cashIn += amount;
          } else {
            balance -= amount;
            cashOut += amount;
          }
          const voucherReference = entry.source === "debit-voucher"
            ? `<small class="voucher-reference">${escapeHtml(entry.voucherNo || "Debit voucher")} · Paid to ${escapeHtml(entry.payee || "—")}</small>`
            : "";
          return `<tr><td>${index + 1}</td><td>${dateText(entry.date)}</td><td><b>${escapeHtml(entry.description)}</b>${voucherReference}</td>
            <td>${entry.type === "debit" ? fmt(amount) : "—"}</td><td>${entry.type === "credit" ? fmt(amount) : "—"}</td><td><b>${fmt(balance)}</b></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6" class="empty">No cashbook entries recorded.</td></tr>';
  $("#cashIn").textContent = fmt(cashIn);
  $("#cashOut").textContent = fmt(cashOut);
  $("#cashBalance").textContent = fmt(balance);

  const vouchers = cashEntries.filter((entry) => entry.source === "debit-voucher");
  const voucherRows = $("#debitVoucherRows");
  if (voucherRows) {
    voucherRows.innerHTML = vouchers.length
      ? vouchers
          .map(
            (entry, index) => `<tr><td>${index + 1}</td><td class="voucher-number-cell">${escapeHtml(entry.voucherNo || "—")}</td>
              <td>${dateText(entry.date)}</td><td><b>${escapeHtml(entry.payee || "—")}</b></td>
              <td>${escapeHtml(entry.expenseDescription || entry.description || "—")}</td><td class="voucher-amount">${fmt(entry.amount)}</td>
              <td>${escapeHtml(entry.createdBy || "—")}<small>${escapeHtml(entry.createdByRole || "")}</small></td></tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="empty">No debit vouchers recorded.</td></tr>';
  }
}

function renderCashbookLedger() {
  syncAutomaticCashbookEntries();
  const voucherButton = $("#newDebitVoucher");
  if (voucherButton) voucherButton.style.display = canCreateDebitVoucher() ? "" : "none";
  const sortedEntries = [...cashEntries].sort(
    (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  const inwardEntries = sortedEntries.filter((entry) => entry.type === "credit");
  const outwardEntries = sortedEntries.filter((entry) => entry.type !== "credit");
  const cashIn = inwardEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const cashOut = outwardEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const balance = cashIn - cashOut;
  const ledgerRows = (entries, direction) => entries.length
    ? entries
        .map((entry, index) => {
          const voucherReference = entry.source === "debit-voucher"
            ? `${entry.voucherNo || "Debit voucher"} · Paid to ${entry.payee || "—"}`
            : entry.reference || "";
          return `<tr><td>${index + 1}</td><td>${dateText(entry.date)}</td><td><b>${escapeHtml(entry.description || cashbookSourceLabel(entry.source))}</b>${voucherReference ? `<small class="ledger-reference">${escapeHtml(voucherReference)}</small>` : ""}</td><td><span class="ledger-source">${escapeHtml(cashbookSourceLabel(entry.source))}</span></td><td class="ledger-amount">${direction === "inward" ? "+ " : "− "}${fmt(entry.amount)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="empty">No ${direction} entries recorded.</td></tr>`;
  $("#inwardRows").innerHTML = ledgerRows(inwardEntries, "inward");
  $("#outwardRows").innerHTML = ledgerRows(outwardEntries, "outward");
  $("#cashIn").textContent = fmt(cashIn);
  $("#cashOut").textContent = fmt(cashOut);
  $("#cashBalance").textContent = fmt(balance);
  $("#inwardRegisterTotal").textContent = fmt(cashIn);
  $("#outwardRegisterTotal").textContent = fmt(cashOut);

  const vouchers = cashEntries.filter((entry) => entry.source === "debit-voucher");
  const voucherRows = $("#debitVoucherRows");
  if (voucherRows) {
    voucherRows.innerHTML = vouchers.length
      ? vouchers
          .map(
            (entry, index) => `<tr><td>${index + 1}</td><td class="voucher-number-cell">${escapeHtml(entry.voucherNo || "—")}</td>
              <td>${dateText(entry.date)}</td><td><b>${escapeHtml(entry.payee || "—")}</b></td>
              <td>${escapeHtml(entry.expenseDescription || entry.description || "—")}</td><td class="voucher-amount">${fmt(entry.amount)}</td>
              <td>${escapeHtml(entry.createdBy || "—")}<small>${escapeHtml(entry.createdByRole || "")}</small></td></tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="empty">No debit vouchers recorded.</td></tr>';
  }
}

function daybookCategoryForEntry(entry) {
  if (entry.source === "penalty-recovery") return "penalty";
  if (entry.daybookCategory) {
    if (entry.daybookCategory === "pending-disbursement") return "hold-loan-deduction";
    if (entry.daybookCategory === "pending-recovery") return "balance-recovery";
    return entry.daybookCategory;
  }
  return {
    "cash-intake": "cash-intake",
    recovery: "total-recovery",
    "advance-recovery": "advance",
    "loan-closing": "closing",
    "penalty-recovery": "penalty",
    "loan-disbursement": "disbursement",
    "loan-processing-fee": "processing",
    "hold-release": "hold-loan-deduction",
    "missed-recovery": "balance-recovery",
    "debit-voucher": "debit-voucher",
  }[entry.source] || (entry.type === "credit" ? "other-inward" : "other-outward");
}

function daybookEntryReference(entry) {
  if (entry.source === "debit-voucher") {
    return `Paid to ${entry.payee || "—"}`;
  }
  return entry.reference || cashbookSourceLabel(entry.source);
}

function daybookEntryEditActionHtml(entry) {
  const isPastDay = cashbookDate(entry.date) < todayIso();
  const isSingleEntry = !entry.entryCount || Number(entry.entryCount) === 1;
  if (role() !== "Director" || !isPastDay || !entry.id || !isSingleEntry) return "";
  return `<button class="daybook-edit-action" type="button" data-edit-daybook-entry="${escapeHtml(entry.id)}">Edit</button>`;
}

function directorEditDaybookEntry(entryId) {
  if (role() !== "Director") {
    toast("Past Daybooks are locked. Only the Director can make a correction.");
    return;
  }
  const entryIndex = cashEntries.findIndex((item) => String(item.id) === String(entryId));
  const entry = cashEntries[entryIndex];
  if (!entry) {
    toast("This Daybook entry could not be found.");
    return;
  }
  if (cashbookDate(entry.date) >= todayIso()) {
    toast("Director correction is available after the Daybook date has closed.");
    return;
  }
  const amountText = window.prompt("Correct Daybook amount", String(Number(entry.amount || 0)));
  if (amountText === null) return;
  const correctedAmount = Number(amountText);
  if (!Number.isFinite(correctedAmount) || correctedAmount < 0) {
    toast("Enter a valid corrected amount.");
    return;
  }
  const noteText = window.prompt("Correction note (required)", entry.correctionNote || "");
  if (noteText === null) return;
  const correctionNote = String(noteText).trim();
  if (!correctionNote) {
    toast("Enter a correction note for the audit record.");
    return;
  }
  if (!window.confirm(`Correct this past Daybook entry to ${fmt(correctedAmount)}?`)) return;
  const previousEntry = { ...entry };
  if (entry.originalAmount === undefined) entry.originalAmount = Number(entry.amount || 0);
  entry.amount = correctedAmount;
  entry.correctionNote = correctionNote;
  entry.directorOverride = true;
  entry.editedBy = currentUser?.name || currentUser?.loginId || "Director";
  entry.editedAt = new Date().toISOString();
  if (!persistAll()) {
    cashEntries[entryIndex] = previousEntry;
    return;
  }
  renderCashbook();
  addActivity(`Director corrected ${cashbookSourceLabel(entry.source)} in the ${dateText(entry.date)} Daybook`);
  toast("Past Daybook entry corrected by Director. The audit note has been saved.");
}

const STAFF_COLLECTION_SOURCES = new Set(["recovery", "advance-recovery", "loan-closing", "penalty-recovery"]);

function staffCollectionRegisterHtml(entries) {
  const collectionEntries = entries.filter(
    (entry) => STAFF_COLLECTION_SOURCES.has(entry.source) && Number(entry.amount || 0) > 0
  );
  const staffGroups = new Map();
  collectionEntries.forEach((entry) => {
    const name = String(entry.collectionStaffName || entry.createdBy || "Employee unavailable (old entry)");
    const key = String(entry.collectionStaffLoginId || name).toLowerCase();
    if (!staffGroups.has(key)) {
      staffGroups.set(key, {
        name,
        role: entry.collectionStaffRole || entry.createdByRole || "Employee",
        entries: [],
      });
    }
    staffGroups.get(key).entries.push(entry);
  });
  const overallTotal = collectionEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return `<section class="staff-collection-register">
    <div class="staff-collection-register-head"><div><span>STAFF COLLECTION</span><b>Cash to receive from employees</b></div><strong>${fmt(overallTotal)}</strong></div>
    <div class="staff-collection-groups">${staffGroups.size
      ? [...staffGroups.values()].map((staff) => {
          const staffTotal = staff.entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
          const centreGroups = new Map();
          staff.entries.forEach((entry) => {
            const groupName = String(entry.collectionGroup || "Group");
            const centreName = String(entry.collectionCentre || "Centre");
            const centreKey = `${groupName.toLowerCase()}|${centreName.toLowerCase()}`;
            if (!centreGroups.has(centreKey)) {
              centreGroups.set(centreKey, { groupName, centreName, total: 0, entryCount: 0, typeTotals: new Map() });
            }
            const centre = centreGroups.get(centreKey);
            const amount = Number(entry.amount || 0);
            const typeLabel = cashbookSourceLabel(entry.source);
            centre.total += amount;
            centre.entryCount += 1;
            centre.typeTotals.set(typeLabel, Number(centre.typeTotals.get(typeLabel) || 0) + amount);
          });
          return `<details class="staff-collection-card"><summary class="staff-collection-name"><div><b>${escapeHtml(staff.name)}</b><small>${escapeHtml(staff.role)} · ${centreGroups.size} ${centreGroups.size === 1 ? "centre" : "centres"}</small></div><strong>${fmt(staffTotal)}</strong></summary><div class="staff-collection-centres">${[...centreGroups.values()].map((centre) => `<div class="staff-collection-row"><div><b>${escapeHtml(centre.groupName)} · ${escapeHtml(centre.centreName)}</b><small>${[...centre.typeTotals.entries()].map(([label, amount]) => `${escapeHtml(label)} ${fmt(amount)}`).join(" · ")} · ${centre.entryCount} ${centre.entryCount === 1 ? "entry" : "entries"}</small></div><strong>${fmt(centre.total)}</strong></div>`).join("")}</div></details>`;
        }).join("")
      : '<p class="staff-collection-empty">No approved staff collection entry for this day.</p>'}</div>
  </section>`;
}

function renderStaffCollectionApprovalRegister() {
  const host = $("#staffCollectionApprovalRegister");
  if (!host) return;
  syncAutomaticCashbookEntries();
  const today = todayIso();
  const ownLoginId = String(currentUser?.loginId || "").toLowerCase();
  const ownName = String(currentUser?.name || "").toLowerCase();
  const entries = cashEntries.filter((entry) => {
    if (cashbookDate(entry.date) !== today || !STAFF_COLLECTION_SOURCES.has(entry.source)) return false;
    if (!canProposeRecovery()) return true;
    const entryLoginId = String(entry.collectionStaffLoginId || "").toLowerCase();
    const entryName = String(entry.collectionStaffName || entry.createdBy || "").toLowerCase();
    return (ownLoginId && entryLoginId === ownLoginId) || (ownName && entryName === ownName);
  });
  host.innerHTML = staffCollectionRegisterHtml(entries);
}

function customerPrincipalReceivedBeforeDate(loan, memberIndex, date) {
  return (loan?.recoveries || []).reduce((sum, recovery) => {
    const recoveryDate = String(recovery?.date || "").slice(0, 10);
    if (!recoveryDate || recoveryDate >= date || recovery.type === "penalty") return sum;
    return sum + recoveryPrincipalPaymentForMember(recovery, memberIndex);
  }, 0);
}

function customerPrincipalReceivedOnDate(loan, memberIndex, date) {
  return (loan?.recoveries || []).reduce((sum, recovery) => {
    const recoveryDate = String(recovery?.date || "").slice(0, 10);
    if (recoveryDate !== date || recovery.type === "penalty") return sum;
    return sum + recoveryPrincipalPaymentForMember(recovery, memberIndex);
  }, 0);
}

function customerOpeningDemandForDate(loan, individual, date) {
  const closedDate = individual?.closedAt ? cashbookDate(individual.closedAt) : "";
  if (closedDate && closedDate < date) return 0;
  const originalAmount = Math.max(0, Number(individual?.amount || 0));
  const emi = Math.max(0, Number(individual?.emi || 0));
  if (!originalAmount || !emi) return 0;
  const dueCount = installmentRowsForCustomer(loan, individual).filter((row) => row.date <= date).length;
  const scheduledDue = Math.min(originalAmount, dueCount * emi);
  const recoveredBefore = Math.min(originalAmount, customerPrincipalReceivedBeforeDate(loan, Number(individual.memberIndex), date));
  const openingBalance = Math.max(0, originalAmount - recoveredBefore);
  return Math.min(openingBalance, Math.max(0, scheduledDue - recoveredBefore));
}

function todayRecoveryDaybookSnapshot(date = todayIso()) {
  const recoveryDay = weekdayForIsoDate(date);
  const staffDemand = new Map();
  const centreBalances = [];
  loans.forEach((loan) => {
    const group = groups.find(
      (record) => record.code === loan.groupCode || record.code === loan.code || record.number === loan.groupNumber
    );
    if (String(loan.day || group?.day || "").toLowerCase() !== recoveryDay.toLowerCase()) return;
    const staffName = String(loan.staff || group?.recoveryStaff || "Unassigned recovery staff");
    const groupReference = String(loan.groupNumber || group?.number || loan.groupName || "Group");
    const centreName = String(group?.name || loan.groupName || groupReference);
    let demand = 0;
    let approvedAgainstDemand = 0;
    (loan.individualLoans || []).forEach((individual) => {
      const memberIndex = Number(individual.memberIndex);
      const openingDemand = customerOpeningDemandForDate(loan, individual, date);
      demand += openingDemand;
      const closedDate = individual?.closedAt ? cashbookDate(individual.closedAt) : "";
      const approvedToday = closedDate === date
        ? openingDemand
        : Math.min(openingDemand, customerPrincipalReceivedOnDate(loan, memberIndex, date));
      approvedAgainstDemand += approvedToday;
    });
    if (demand <= 0) return;
    const staffKey = staffName.toLowerCase();
    if (!staffDemand.has(staffKey)) {
      staffDemand.set(staffKey, { staffName, amount: 0, centres: new Set() });
    }
    const staff = staffDemand.get(staffKey);
    staff.amount += demand;
    staff.centres.add(`${groupReference}|${centreName}`);
    const balance = Math.max(0, demand - approvedAgainstDemand);
    if (balance > 0) {
      centreBalances.push({
        groupReference,
        centreName,
        staffName,
        demand,
        approved: approvedAgainstDemand,
        balance,
      });
    }
  });
  const inward = [...staffDemand.values()]
    .sort((a, b) => a.staffName.localeCompare(b.staffName))
    .map((staff, index) => ({
      id: `TODAY-DEMAND-${date}-${index}`,
      date,
      type: "credit",
      source: "today-recovery-demand",
      daybookCategory: "total-recovery",
      description: staff.staffName,
      reference: `${recoveryDay} demand · ${staff.centres.size} ${staff.centres.size === 1 ? "centre" : "centres"}`,
      amount: staff.amount,
      todayDemandSnapshot: true,
    }));
  const outward = centreBalances
    .sort((a, b) => a.groupReference.localeCompare(b.groupReference, undefined, { numeric: true }))
    .map((centre, index) => ({
      id: `TODAY-BALANCE-${date}-${index}`,
      date,
      type: "debit",
      source: "today-balance-recovery",
      daybookCategory: "balance-recovery",
      description: `${centre.groupReference} · ${centre.centreName}`,
      reference: `${centre.staffName} · Demand ${fmt(centre.demand)} · Approved ${fmt(centre.approved)}`,
      amount: centre.balance,
      todayBalanceSnapshot: true,
    }));
  return { recoveryDay, inward, outward };
}

function compactCashbookCategoryEntries(entries, definition) {
  if (definition.key === "total-recovery" && entries.every((entry) => entry.todayDemandSnapshot)) {
    return entries;
  }
  if (!["total-recovery", "later-recovery", "advance", "closing", "penalty"].includes(definition.key)) {
    return entries;
  }
  const grouped = new Map();
  entries.forEach((entry) => {
    const groupName = String(entry.collectionGroup || "Group");
    const centreName = String(entry.collectionCentre || "Centre");
    const staffName = String(entry.collectionStaffName || entry.createdBy || "Employee unavailable (old entry)");
    const key = `${groupName.toLowerCase()}|${centreName.toLowerCase()}|${staffName.toLowerCase()}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...entry,
        amount: 0,
        entryCount: 0,
        description: `${groupName} · ${centreName}`,
        reference: `Collected by ${staffName}`,
      });
    }
    const record = grouped.get(key);
    record.amount += Number(entry.amount || 0);
    record.entryCount += 1;
  });
  return [...grouped.values()].map((entry) => ({
    ...entry,
    reference: `${entry.reference} · ${entry.entryCount} ${entry.entryCount === 1 ? "customer entry" : "customer entries"}`,
  }));
}

function daybookCategoryHtml(entries, definition) {
  const categoryEntries = entries.filter((entry) => daybookCategoryForEntry(entry) === definition.key);
  if (!definition.always && !categoryEntries.length) return "";
  const total = categoryEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const displayEntries = compactCashbookCategoryEntries(categoryEntries, definition);
  return `<section class="daybook-category" data-daybook-category="${definition.key}">
    <div class="daybook-category-head"><h4>${definition.label}</h4><b>${fmt(total)}</b></div>
    <div class="daybook-entries">${displayEntries.length
      ? displayEntries.map((entry) => `<div class="daybook-entry"><div><b>${escapeHtml(entry.description || cashbookSourceLabel(entry.source))}</b><small>${escapeHtml(daybookEntryReference(entry))}</small>${entry.editedAt ? `<small class="director-corrected-note">Director corrected · ${escapeHtml(entry.correctionNote || "Audit correction")}</small>` : ""}</div><div class="daybook-entry-value"><strong>${fmt(entry.amount)}</strong>${daybookEntryEditActionHtml(entry)}</div></div>`).join("")
      : '<p class="daybook-empty">No entry</p>'}</div>
  </section>`;
}

function daybookColumnHtml(entries, direction, isToday = false) {
  const inwardDefinitions = [
    { key: "cash-intake", label: "Cash Intake", always: true },
    { key: "processing", label: "Processing", always: true },
    { key: "total-recovery", label: isToday ? "Today's Total Recovery" : "Total Recovery", always: true },
    { key: "closing", label: "Closing", always: true },
    { key: "advance", label: "Advance Recovery", always: true },
    { key: "later-recovery", label: "Late Recovery", always: true },
    { key: "penalty", label: "Penalty", always: true },
    { key: "other-inward", label: "Other Inward", always: false },
  ];
  const outwardDefinitions = [
    { key: "disbursement", label: "Disbursement", always: true },
    { key: "hold-loan-deduction", label: "Hold Loan Deduction", always: true },
    { key: "balance-recovery", label: isToday ? "Today's Balance Recovery" : "Balance Recovery", always: isToday },
    { key: "debit-voucher", label: "Debit Voucher", always: false },
    { key: "other-outward", label: "Other Outward", always: false },
  ];
  const definitions = direction === "inward" ? inwardDefinitions : outwardDefinitions;
  const total = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const action = isToday && canCreateDebitVoucher()
    ? direction === "inward"
      ? '<button class="daybook-action" type="button" data-open-cash-intake>+ Cash intake</button>'
      : '<button class="daybook-action" type="button" data-open-debit-voucher>+ Debit voucher</button>'
    : "";
  return `<section class="daybook-column daybook-${direction}">
    <div class="daybook-column-title"><h3>${direction === "inward" ? "INWARD" : "OUTWARD"}</h3><div class="daybook-title-side">${action}<b>${fmt(total)}</b></div></div>
    ${definitions.map((definition) => daybookCategoryHtml(entries, definition)).join("")}
  </section>`;
}

function renderCashbook() {
  syncAutomaticCashbookEntries();
  const voucherButton = $("#newDebitVoucher");
  if (voucherButton) voucherButton.style.display = canCreateDebitVoucher() ? "" : "none";
  const today = todayIso();
  const todayDate = new Date(`${today}T12:00:00`);
  $("#currentDaybookDate").textContent = todayDate.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const dates = [...new Set([today, ...cashEntries.map((entry) => cashbookDate(entry.date))])]
    .sort((a, b) => b.localeCompare(a));
  $("#daybookSheets").innerHTML = dates
    .map((date) => {
      const storedEntries = cashEntries.filter((entry) => cashbookDate(entry.date) === date);
      const todaySnapshot = date === today ? todayRecoveryDaybookSnapshot(date) : { inward: [], outward: [] };
      const entries = date === today
        ? [
            ...storedEntries.filter((entry) =>
              !(entry.source === "recovery" && daybookCategoryForEntry(entry) === "total-recovery") &&
              entry.source !== "missed-recovery"
            ),
            ...todaySnapshot.inward,
            ...todaySnapshot.outward,
          ]
        : storedEntries;
      const inward = entries.filter((entry) => entry.type === "credit");
      const outward = entries.filter((entry) => entry.type !== "credit");
      const inwardTotal = inward.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const outwardTotal = outward.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const closingBalance = inwardTotal - outwardTotal;
      const parsedDate = new Date(`${date}T12:00:00`);
      const weekday = parsedDate.toLocaleDateString("en-IN", { weekday: "long" });
      const longDate = parsedDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
      const lockStatus = date < today
        ? role() === "Director"
          ? '<span class="daybook-lock-status director-unlocked">Past day · Director correction enabled</span>'
          : '<span class="daybook-lock-status">Past day locked</span>'
        : "";
      return `<details class="daybook-sheet"${date === today ? " open" : ""}>
        <summary><div class="daybook-date"><span>${date === today ? "Today's daybook" : weekday}</span><b>${longDate}</b>${lockStatus}</div>
        <div class="daybook-summary-totals"><div class="summary-in"><span>Inward</span><b>${fmt(inwardTotal)}</b></div><div class="summary-out"><span>Outward</span><b>${fmt(outwardTotal)}</b></div></div></summary>
        <div class="daybook-body">${daybookColumnHtml(inward, "inward", date === today)}${daybookColumnHtml(outward, "outward", date === today)}</div>
        <div class="daybook-closing"><span>Day closing balance</span><b>${fmt(closingBalance)}</b></div>
      </details>`;
    })
    .join("");
}

function nextDebitVoucherNumber(date = todayIso()) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : todayIso();
  const prefix = `DV-${safeDate.replaceAll("-", "")}-`;
  const highest = cashEntries.reduce((maximum, entry) => {
    const voucherNo = String(entry.voucherNo || "");
    if (entry.source !== "debit-voucher" || !voucherNo.startsWith(prefix)) return maximum;
    const sequence = Number(voucherNo.slice(prefix.length));
    return Number.isFinite(sequence) ? Math.max(maximum, sequence) : maximum;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

function openCashIntake() {
  if (!canCreateDebitVoucher()) {
    toast("Only Director, Manager, or Cashier can record cash intake.");
    return;
  }
  $("#cashDescription").value = "";
  $("#cashAmount").value = "";
  $("#debitVoucherForm").classList.add("hidden");
  $("#cashForm").classList.remove("hidden");
}

function openDebitVoucher() {
  if (!canCreateDebitVoucher()) {
    toast("Only Director, Manager, or Cashier can create a debit voucher.");
    return;
  }
  $("#voucherPayee").value = "";
  $("#voucherDescription").value = "";
  $("#voucherAmount").value = "";
  $("#cashForm").classList.add("hidden");
  $("#debitVoucherForm").classList.remove("hidden");
}

function saveDebitVoucher() {
  if (!canCreateDebitVoucher()) {
    toast("Only Director, Manager, or Cashier can create a debit voucher.");
    return;
  }
  const date = todayIso();
  const payee = $("#voucherPayee").value.trim();
  const expenseDescription = $("#voucherDescription").value.trim();
  const amount = Number($("#voucherAmount").value || 0);
  if (!payee || !expenseDescription || amount <= 0) {
    toast("Enter person name, expense details, and a valid amount.");
    return;
  }
  const entry = {
    id: `CASH-DV-${Date.now()}`,
    date,
    payee,
    description: expenseDescription,
    expenseDescription,
    amount,
    type: "debit",
    source: "debit-voucher",
    daybookCategory: "debit-voucher",
    createdBy: currentUser?.name || "User",
    createdByLogin: currentUser?.loginId || "",
    createdByRole: role(),
    createdAt: new Date().toISOString(),
  };
  cashEntries.push(entry);
  if (!persistAll()) {
    cashEntries.pop();
    return;
  }
  $("#debitVoucherForm").classList.add("hidden");
  renderCashbook();
  addActivity(`Debit voucher created for ${payee}: ${fmt(amount)}`);
  toast("Debit voucher saved in Outward.");
}

function saveCashEntry() {
  if (!canCreateDebitVoucher()) {
    toast("Only Director, Manager, or Cashier can record cash intake.");
    return;
  }
  const date = todayIso();
  const note = $("#cashDescription").value.trim();
  const description = note || "Cash intake";
  const amount = Number($("#cashAmount").value || 0);
  if (amount <= 0) {
    toast("Enter a valid cash intake amount.");
    return;
  }
  cashEntries.push({
    id: `CASH-IN-${Date.now()}`,
    date,
    description,
    amount,
    type: "credit",
    source: "cash-intake",
    daybookCategory: "cash-intake",
    createdBy: currentUser?.name || "User",
    createdByLogin: currentUser?.loginId || "",
    createdByRole: role(),
    createdAt: new Date().toISOString(),
  });
  if (!persistAll()) {
    cashEntries.pop();
    return;
  }
  $("#cashForm").classList.add("hidden");
  renderCashbook();
  addActivity(`Cash intake recorded: ${description} · ${fmt(amount)}`);
  toast("Cash intake saved in the Inward register.");
}

function renderCalendar() {
  const sorted = [...bankHolidays].sort((a, b) => a.date.localeCompare(b.date));
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const selectedDate = $("#holidayDate").value;
  const today = todayIso();
  $("#calendarMonthTitle").textContent = calendarViewDate.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const dateCells = Array.from({ length: firstDayOffset }, () => '<span class="calendar-day empty-day" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = localIsoDate(new Date(year, month, day));
    const holiday = bankHolidays.find((item) => item.date === date);
    const classes = [
      "calendar-day",
      date === today ? "today" : "",
      date === selectedDate ? "selected" : "",
      holiday ? "holiday" : "",
    ]
      .filter(Boolean)
      .join(" ");
    dateCells.push(
      `<button type="button" class="${classes}" data-calendar-date="${date}" aria-label="${dateText(date)}${holiday ? `, ${escapeHtml(holiday.name)}` : ""}">
        <span>${day}</span>${holiday ? `<small>${escapeHtml(holiday.name)}</small>` : ""}
      </button>`
    );
  }
  $("#calendarGrid").innerHTML = dateCells.join("");
  $("#selectedDateNote").textContent = selectedDate
    ? `Selected date: ${dateText(selectedDate)}`
    : "Select a date from the calendar.";
  $("#holidayRows").innerHTML = sorted.length
    ? sorted
        .map(
          (holiday) => `<tr><td>${dateText(holiday.date)}</td><td><b>${escapeHtml(holiday.name)}</b></td><td>Loan schedules extend by one week when affected</td>
          <td>${canManageCalendar() ? `<button class="collection-btn" type="button" onclick="removeHoliday('${holiday.date}')">Remove</button>` : "—"}</td></tr>`
        )
        .join("")
    : '<tr><td colspan="4" class="empty">No bank holidays added.</td></tr>';
  $("#saveHoliday").style.display = canManageCalendar() ? "" : "none";
  $("#holidayDate").disabled = !canManageCalendar();
  $("#holidayName").disabled = !canManageCalendar();
}

function changeCalendarMonth(offset) {
  calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + offset, 1);
  renderCalendar();
}

function selectCalendarDate(date) {
  if (!date) return;
  $("#holidayDate").value = date;
  const parsed = new Date(`${date}T00:00:00`);
  if (!Number.isNaN(parsed.getTime())) calendarViewDate = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  renderCalendar();
  $("#holidayName").focus();
}

function saveHoliday() {
  if (!canManageCalendar()) {
    toast("Only Director and Manager can manage bank holidays.");
    return;
  }
  const date = $("#holidayDate").value;
  const name = $("#holidayName").value.trim();
  if (!date || !name) {
    toast("Enter the holiday date and name.");
    return;
  }
  if (bankHolidays.some((holiday) => holiday.date === date)) {
    toast("A holiday already exists on this date.");
    return;
  }
  bankHolidays.push({ date, name });
  if (!persistAll()) {
    bankHolidays.pop();
    return;
  }
  $("#holidayDate").value = "";
  $("#holidayName").value = "";
  renderCalendar();
  toast("Bank holiday added. Affected schedules will extend automatically.");
}

function removeHoliday(date) {
  if (!canManageCalendar()) return;
  const previous = bankHolidays;
  bankHolidays = bankHolidays.filter((holiday) => holiday.date !== date);
  if (!persistAll()) {
    bankHolidays = previous;
    return;
  }
  renderCalendar();
  toast("Holiday removed.");
}

function activeRecoveryStaffAccounts() {
  return employeeAccounts
    .filter((account) => account.active !== false && account.designation === "Staff" && account.name && account.loginId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function recoveryStaffNames() {
  return [...new Set(activeRecoveryStaffAccounts().map((account) => account.name))];
}

function loaningStaffNames() {
  return [...new Set(employeeAccounts
    .filter((account) => account.active !== false && ["Assistant Manager", "Executive", "Staff"].includes(account.designation))
    .map((account) => account.name)
    .filter(Boolean))];
}

function setSelectOptions(select, values, includeAll = false) {
  if (!select) return;
  const previous = select.value;
  if (!includeAll && values.length === 0) {
    select.innerHTML = '<option value="">No active staff — add from Employee Management</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = `${includeAll ? '<option value="all">All assigned staff</option>' : ""}${values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("")}`;
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function populateStaffSelects() {
  setSelectOptions($("#groupLoanStaff"), loaningStaffNames());
  setSelectOptions($("#groupRecoveryStaff"), recoveryStaffNames());
  setSelectOptions($("#loanStaff"), recoveryStaffNames());
}

function activeManagers() {
  return employeeAccounts.filter((account) => account.active !== false && account.designation === "Manager");
}

function activeAssistantManagers() {
  return employeeAccounts.filter((account) => account.active !== false && account.designation === "Assistant Manager");
}

const DEFAULT_TEAM_RECOVERY_INCENTIVE_RATE = 15;
const VERIFICATION_ALLOWANCE_PER_STAFF = 2000;

function currentStaffAccount(account = currentUser) {
  if (!account || account.designation !== "Staff") return null;
  return employeeAccounts.find((item) =>
    String(item.loginId || "").toLowerCase() === String(account.loginId || "").toLowerCase()
  ) || account;
}

function currentStaffReportingProfile(account = currentUser) {
  const staff = currentStaffAccount(account);
  return {
    managerLoginId: String(staff?.managerLoginId || "").trim(),
    assistantManagerLoginId: String(staff?.assistantManagerLoginId || "").trim(),
  };
}

function currentStaffIncentiveRate(account = currentUser) {
  const staff = currentStaffAccount(account);
  return Math.max(0, Number(staff?.incentive || 0));
}

function recoveryIncentiveRate(account) {
  if (["Manager", "Assistant Manager"].includes(account?.designation)) {
    const savedRate = Number(account?.incentive);
    return Number.isFinite(savedRate) ? Math.max(0, savedRate) : DEFAULT_TEAM_RECOVERY_INCENTIVE_RATE;
  }
  return currentStaffIncentiveRate(account);
}

function approvedStaffRecoveryRows() {
  const rows = [];
  loans.forEach((loan, loanIndex) => {
    const centreKey = String(
      loan.groupNumber || loan.groupCode || loan.code || loan.id || loan.groupName || `loan-${loanIndex}`
    ).trim().toLowerCase();
    (loan.recoveries || []).forEach((recovery) => {
      if (!["recovery", "advance", "closing"].includes(String(recovery.type || "").toLowerCase())) return;
      if (String(recovery.enteredByRole || "") !== "Staff" || !recovery.approvedAt) return;
      const date = String(recovery.date || recovery.approvedAt || "").slice(0, 10);
      if (!isValidIsoDate(date)) return;
      rows.push({
        date,
        centreKey,
        centreName: loan.groupName || loan.groupNumber || "Centre",
        recovery,
      });
    });
  });
  return rows;
}

function staffAccountForRecovery(recovery) {
  const recoveryLogin = String(recovery?.enteredBy || "").trim().toLowerCase();
  const recoveryName = String(recovery?.enteredByName || "").trim().toLowerCase();
  return employeeAccounts.find((account) => account.designation === "Staff" && (
    (recoveryLogin && String(account.loginId || "").trim().toLowerCase() === recoveryLogin) ||
    (recoveryName && String(account.name || "").trim().toLowerCase() === recoveryName)
  ));
}

function staffIncentiveEvents(account) {
  if (!account || account.designation !== "Staff") return [];
  const loginKey = String(account.loginId || "").trim().toLowerCase();
  const nameKey = String(account.name || "").trim().toLowerCase();
  const fallbackRate = currentStaffIncentiveRate(account);
  const centreDays = new Map();
  approvedStaffRecoveryRows().forEach(({ date, centreKey, centreName, recovery }) => {
    const recoveryLogin = String(recovery.enteredBy || "").trim().toLowerCase();
    const recoveryName = String(recovery.enteredByName || "").trim().toLowerCase();
    const belongsToStaff = (loginKey && recoveryLogin === loginKey) || (nameKey && recoveryName === nameKey);
    if (!belongsToStaff) return;
    const recordedRate = Math.max(0, Number(recovery.incentiveRate || 0));
    const rate = recordedRate || fallbackRate;
    const key = `${date}|${centreKey}`;
    const previous = centreDays.get(key);
    if (!previous || rate > previous.rate) {
      centreDays.set(key, { date, centreKey, centreName, rate, amount: rate });
    }
  });
  return [...centreDays.values()].sort((a, b) => a.date.localeCompare(b.date) || a.centreKey.localeCompare(b.centreKey));
}

function assignedTeamStaff(account) {
  if (!account || !["Manager", "Assistant Manager"].includes(account.designation)) return [];
  const loginKey = String(account.loginId || "").trim().toLowerCase();
  const nameKey = String(account.name || "").trim().toLowerCase();
  const loginField = account.designation === "Manager" ? "managerLoginId" : "assistantManagerLoginId";
  const nameField = account.designation === "Manager" ? "managerName" : "assistantManagerName";
  return employeeAccounts.filter((staff) => staff.active !== false && staff.designation === "Staff" && (
    (loginKey && String(staff[loginField] || "").trim().toLowerCase() === loginKey) ||
    (nameKey && String(staff[nameField] || "").trim().toLowerCase() === nameKey)
  ));
}

function teamIncentiveEvents(account) {
  if (!account || !["Manager", "Assistant Manager"].includes(account.designation)) return [];
  const loginKey = String(account.loginId || "").trim().toLowerCase();
  const nameKey = String(account.name || "").trim().toLowerCase();
  const recoveryLoginField = account.designation === "Manager" ? "managerLoginId" : "assistantManagerLoginId";
  const staffLoginField = recoveryLoginField;
  const staffNameField = account.designation === "Manager" ? "managerName" : "assistantManagerName";
  const fallbackRate = recoveryIncentiveRate(account);
  const centreDays = new Map();
  approvedStaffRecoveryRows().forEach(({ date, centreKey, centreName, recovery }) => {
    const recordedLogin = String(recovery[recoveryLoginField] || "").trim().toLowerCase();
    const staff = staffAccountForRecovery(recovery);
    const assignedNow = (loginKey && String(staff?.[staffLoginField] || "").trim().toLowerCase() === loginKey) ||
      (nameKey && String(staff?.[staffNameField] || "").trim().toLowerCase() === nameKey);
    if (recordedLogin ? recordedLogin !== loginKey : !assignedNow) return;
    const key = `${date}|${centreKey}`;
    if (!centreDays.has(key)) {
      centreDays.set(key, {
        date,
        centreKey,
        centreName,
        staffName: recovery.enteredByName || staff?.name || recovery.enteredBy || "Staff",
        rate: Math.max(0, Number(recovery[account.designation === "Manager" ? "managerIncentiveRate" : "assistantManagerIncentiveRate"] ?? fallbackRate)),
        amount: Math.max(0, Number(recovery[account.designation === "Manager" ? "managerIncentiveRate" : "assistantManagerIncentiveRate"] ?? fallbackRate)),
      });
    }
  });
  return [...centreDays.values()].sort((a, b) => a.date.localeCompare(b.date) || a.centreKey.localeCompare(b.centreKey));
}

function employeeRecoveryIncentiveEvents(account) {
  return account?.designation === "Staff" ? staffIncentiveEvents(account) : teamIncentiveEvents(account);
}

function incentiveWeekBounds(asOf = todayIso()) {
  const date = new Date(`${asOf}T00:00:00`);
  const mondayOffset = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: localIsoDate(start), end: localIsoDate(end) };
}

function employeeRecoveryIncentiveAmount(account, fromDate = "", toDate = "") {
  return employeeRecoveryIncentiveEvents(account)
    .filter((event) => (!fromDate || event.date >= fromDate) && (!toDate || event.date <= toDate))
    .reduce((sum, event) => sum + Number(event.amount || 0), 0);
}

function employeeCurrentMonthIncentive(account, asOf = todayIso()) {
  const month = String(asOf).slice(0, 7);
  return employeeRecoveryIncentiveAmount(account, `${month}-01`, `${month}-31`);
}

function renderEmployeeIncentiveDashboard(panelSelector, expectedRole) {
  const panel = $(panelSelector);
  if (!panel) return;
  if (role() !== expectedRole) {
    panel.classList.add("hidden");
    return;
  }
  const events = employeeRecoveryIncentiveEvents(currentUser);
  const today = todayIso();
  const week = incentiveWeekBounds(today);
  const todayEvents = events.filter((event) => event.date === today);
  const weekEvents = events.filter((event) => event.date >= week.start && event.date <= week.end);
  const total = (items) => items.reduce((sum, event) => sum + Number(event.amount || 0), 0);
  const isStaff = expectedRole === "Staff";
  const isManager = expectedRole === "Manager";
  const prefix = isStaff ? "staff" : expectedRole === "Manager" ? "manager" : "assistantManager";
  const assignedCount = isStaff ? 0 : assignedTeamStaff(currentUser).filter((staff) => staff.active !== false).length;
  panel.innerHTML = `<div class="staff-incentive-head"><div><h3>${isStaff ? "My recovery incentive" : isManager ? "My file incentive" : "My team recovery incentive"}</h3><p>${isStaff
    ? "One incentive is credited once per centre and recovery date after Executive or Cashier approval."
    : isManager
      ? `${assignedCount} assigned staff · one incentive is credited for each approved recovery file.`
      : `${assignedCount} assigned staff · incentive is credited from their approved centre recoveries.`}</p></div><b id="${prefix}IncentiveRate" class="staff-incentive-rate">${fmt(recoveryIncentiveRate(currentUser))} / ${isManager ? "file" : "centre"}</b></div><div class="staff-incentive-stats"><div><span>${isManager ? "Files" : "Centres"} today</span><b id="${prefix}IncentiveTodayCentres">${todayEvents.length}</b><small>approved ${isManager ? "recovery files" : "centre recoveries"}</small></div><div><span>Today earned</span><b id="${prefix}IncentiveToday">${fmt(total(todayEvents))}</b><small>today's approved incentive</small></div><div><span>This week earned</span><b id="${prefix}IncentiveWeek">${fmt(total(weekEvents))}</b><small>Monday to Sunday</small></div><div><span>Total earned</span><b id="${prefix}IncentiveTotal">${fmt(total(events))}</b><small>all approved ${isManager ? "recovery files" : "centre recoveries"}</small></div></div>`;
  panel.classList.remove("hidden");
}

const WORKING_ATTENDANCE_STATUSES = ["Present", "Half Day", "Late", "Absent"];
const ATTENDANCE_SALARY_ROLES = ["Manager", "Assistant Manager", "Cashier", "Executive", "Staff"];
const RECURRING_DEPOSIT_ROLES = ["Manager", "Assistant Manager", "Staff"];
const RECURRING_DEPOSIT_ANNUAL_RATE = 0.12;
const ASSISTANT_PERFORMANCE_FILE_TARGET = 12;
const ASSISTANT_PERFORMANCE_PER_QUALIFIED_STAFF = 2000;
const STAFF_PERFORMANCE_TIERS = Object.freeze([
  { files: 16, amount: 5000 },
  { files: 14, amount: 4000 },
  { files: 12, amount: 3000 },
]);

function workingEligibleEmployees() {
  const order = ATTENDANCE_SALARY_ROLES;
  return employeeAccounts
    .filter((account) => account.active !== false && order.includes(account.designation))
    .sort((a, b) => order.indexOf(a.designation) - order.indexOf(b.designation) || String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
}

function usesAttendanceSalary(designation) {
  return ATTENDANCE_SALARY_ROLES.includes(designation);
}

function workingAccount(loginId) {
  const key = String(loginId || "").trim().toLowerCase();
  return employeeAccounts.find((account) => String(account.loginId || "").trim().toLowerCase() === key) || null;
}

function attendanceRecord(loginId, date) {
  const key = String(loginId || "").trim().toLowerCase();
  return workingRecords.find((record) => record.kind === "attendance" &&
    String(record.employeeLoginId || "").trim().toLowerCase() === key && record.date === date) || null;
}

function staffMonthlyDisbursedFiles(account, month) {
  if (account?.designation !== "Staff") return 0;
  const nameKey = String(account.name || "").trim().toLowerCase();
  const loginKey = String(account.loginId || "").trim().toLowerCase();
  return loans.filter((loan) => {
    if (String(loan.disbursedOn || "").slice(0, 7) !== month) return false;
    const group = groups.find((item) => item.code === loan.groupCode || item.code === loan.code || item.number === loan.groupNumber);
    const assignedName = String(loan.loanStaff || group?.loanStaff || "").trim().toLowerCase();
    const assignedLogin = String(loan.loanStaffLoginId || group?.loanStaffLoginId || "").trim().toLowerCase();
    return (nameKey && assignedName === nameKey) || (loginKey && assignedLogin === loginKey);
  }).length;
}

function staffPerformanceDetails(account, month) {
  const files = staffMonthlyDisbursedFiles(account, month);
  const tier = STAFF_PERFORMANCE_TIERS.find((item) => files >= item.files);
  return { files, amount: staffPerformanceAmount(files), tierFiles: tier?.files || 0 };
}

function staffPerformanceAmount(files) {
  const completedFiles = Math.max(0, Number(files || 0));
  return STAFF_PERFORMANCE_TIERS.find((item) => completedFiles >= item.files)?.amount || 0;
}

function assistantManagerPerformanceDetails(account, month) {
  if (account?.designation !== "Assistant Manager") return { amount: 0, qualifiedStaff: 0, staff: [] };
  const staff = assignedTeamStaff(account).map((member) => {
    const files = staffMonthlyDisbursedFiles(member, month);
    return { name: member.name, loginId: member.loginId, files, qualified: files >= ASSISTANT_PERFORMANCE_FILE_TARGET };
  });
  const qualifiedStaff = staff.filter((member) => member.qualified).length;
  return {
    amount: qualifiedStaff * ASSISTANT_PERFORMANCE_PER_QUALIFIED_STAFF,
    qualifiedStaff,
    staff,
  };
}

function recurringDepositEligible(account) {
  return RECURRING_DEPOSIT_ROLES.includes(account?.designation);
}

function monthSerial(month) {
  if (!validYearMonth(month)) return 0;
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber - 1;
}

function recurringDepositStatement(account, month = todayIso().slice(0, 7)) {
  const monthly = recurringDepositEligible(account) ? Math.max(0, Number(account?.recurringDeposit || 0)) : 0;
  const savedStartMonth = String(account?.recurringDepositStartedAt || "").slice(0, 7);
  const legacyCreatedMonth = String(account?.createdAt || "").slice(0, 7);
  const startMonth = validYearMonth(savedStartMonth)
    ? savedStartMonth
    : validYearMonth(legacyCreatedMonth) ? legacyCreatedMonth : month;
  const months = monthly > 0 ? Math.max(0, monthSerial(month) - monthSerial(startMonth) + 1) : 0;
  const monthlyRate = RECURRING_DEPOSIT_ANNUAL_RATE / 12;
  let balance = 0;
  for (let index = 0; index < months; index += 1) balance = (balance + monthly) * (1 + monthlyRate);
  const principal = monthly * months;
  return { monthly, startMonth: monthly > 0 ? startMonth : "", months, principal, interest: Math.max(0, balance - principal), balance };
}

function workingMonthLabel(month) {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? month : date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function changeWorkingCalendarMonth(offset) {
  const current = new Date(`${workingCalendarMonth}-01T00:00:00`);
  current.setMonth(current.getMonth() + Number(offset || 0));
  workingCalendarMonth = localIsoDate(current).slice(0, 7);
  if (role() === "Director" && selectedEmployeeManagementView === "attendance") renderDirectorTeamAttendance();
  else if (role() === "Director" && selectedEmployeeManagementView === "working") renderDirectorTeamWorking();
  else renderMyWorking();
}

function renderAttendanceCalendar(statement) {
  const [year, month] = statement.month.split("-").map(Number);
  const firstDate = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const mondayOffset = (firstDate.getDay() + 6) % 7;
  const attendanceByDate = new Map(statement.attendance.map((record) => [record.date, record]));
  const cells = Array.from({ length: mondayOffset }, () => '<div class="working-calendar-day is-empty" aria-hidden="true"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${statement.month}-${String(day).padStart(2, "0")}`;
    const record = attendanceByDate.get(date);
    const statusKey = record ? String(record.status).toLowerCase().replace(/\s/g, "-") : "unmarked";
    const isToday = date === todayIso();
    cells.push(`<div class="working-calendar-day status-${statusKey} ${isToday ? "is-today" : ""}" aria-label="${escapeHtml(dateText(date))}: ${escapeHtml(record?.status || "Not marked")}"><span>${day}</span><b>${escapeHtml(record?.status || "—")}</b></div>`);
  }
  return `<section class="working-attendance-calendar" aria-label="Attendance calendar for ${escapeHtml(workingMonthLabel(statement.month))}">
    <div class="working-calendar-head"><div><h3>Attendance calendar</h3><p>Cashier-marked attendance for ${escapeHtml(workingMonthLabel(statement.month))}.</p></div><div class="working-calendar-nav"><button type="button" class="outline" onclick="changeWorkingCalendarMonth(-1)" aria-label="Previous month">‹</button><b>${escapeHtml(workingMonthLabel(statement.month))}</b><button type="button" class="outline" onclick="changeWorkingCalendarMonth(1)" aria-label="Next month">›</button></div></div>
    <div class="working-calendar-legend"><span><i class="status-present"></i>Present</span><span><i class="status-absent"></i>Absent</span><span><i class="status-half-day"></i>Half Day</span><span><i class="status-late"></i>Late</span><span><i class="status-unmarked"></i>Not marked</span></div>
    <div class="working-calendar-weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
    <div class="working-calendar-grid">${cells.join("")}</div>
  </section>`;
}

function employeeWorkingStatement(account, month = todayIso().slice(0, 7)) {
  const loginKey = String(account?.loginId || "").trim().toLowerCase();
  const attendance = workingRecords.filter((record) => record.kind === "attendance" &&
    String(record.employeeLoginId || "").trim().toLowerCase() === loginKey && String(record.date || "").startsWith(month));
  const counts = Object.fromEntries(WORKING_ATTENDANCE_STATUSES.map((status) => [status, 0]));
  attendance.forEach((record) => {
    if (record.status in counts) counts[record.status] += 1;
  });
  const creditedDays = counts.Present + counts["Half Day"] + counts.Late;
  const deductionDays = Math.floor(counts["Half Day"] / 2) + Math.floor(counts.Late / 3);
  const payableDays = Math.max(0, creditedDays - deductionDays);
  const component = (monthlyAmount) => {
    const monthly = Math.max(0, Number(monthlyAmount || 0));
    const daily = monthly / 30;
    return {
      monthly,
      daily,
      accrued: daily * creditedDays,
      deduction: daily * deductionDays,
      net: daily * payableDays,
    };
  };
  const assistantPerformance = assistantManagerPerformanceDetails(account, month);
  const staffPerformance = staffPerformanceDetails(account, month);
  const performance = account?.designation === "Assistant Manager"
    ? assistantPerformance.amount
    : staffPerformance.amount;
  const incentive = employeeRecoveryIncentiveAmount(account, `${month}-01`, `${month}-31`);
  const basic = component(account?.salary);
  const isManager = account?.designation === "Manager";
  const isAssistantManager = account?.designation === "Assistant Manager";
  const assignedStaffCount = isAssistantManager ? assignedTeamStaff(account).length : 0;
  const recovery = component(isManager || isAssistantManager ? 0 : account?.petrolAllowance);
  const business = component(isManager || isAssistantManager ? 0 : account?.businessAllowance);
  const verification = component(isAssistantManager ? assignedStaffCount * VERIFICATION_ALLOWANCE_PER_STAFF : 0);
  const salaryBeforeDeposit = basic.net + recovery.net + business.net + verification.net + performance;
  const recurringDeposit = recurringDepositStatement(account, month);
  const recurringDepositDeduction = recurringDeposit.months > 0
    ? Math.min(salaryBeforeDeposit, recurringDeposit.monthly)
    : 0;
  const netSalary = Math.max(0, salaryBeforeDeposit - recurringDepositDeduction);
  return {
    month,
    attendance,
    counts,
    creditedDays,
    deductionDays,
    payableDays,
    basic,
    recovery,
    business,
    verification,
    assignedStaffCount,
    performance,
    assistantPerformance,
    staffPerformance,
    incentive,
    salaryBeforeDeposit,
    recurringDeposit,
    recurringDepositDeduction,
    netSalary,
    total: netSalary,
  };
}

function validYearMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function salaryBookLeaveStatement(account, month = salaryBookMonth) {
  const selectedMonth = validYearMonth(month) ? month : todayIso().slice(0, 7);
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  const createdMonth = String(account?.createdAt || "").slice(0, 7);
  const startMonth = validYearMonth(createdMonth) ? createdMonth : selectedMonth;
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const selectedSerial = selectedYear * 12 + selectedMonthNumber;
  const startSerial = startYear * 12 + startMonthNumber;
  if (startSerial > selectedSerial) {
    return { credited: 0, used: 0, balance: 0, startMonth: "" };
  }
  const credited = Math.max(0, selectedSerial - startSerial + 1);
  const loginKey = String(account?.loginId || "").trim().toLowerCase();
  const absentDates = new Set(workingRecords
    .filter((record) => record.kind === "attendance" && record.status === "Absent" &&
      String(record.employeeLoginId || "").trim().toLowerCase() === loginKey &&
      String(record.date || "").slice(0, 7) >= startMonth &&
      String(record.date || "").slice(0, 7) <= selectedMonth)
    .map((record) => record.date));
  const used = absentDates.size;
  return { credited, used, balance: Math.max(0, credited - used), startMonth };
}

function renderSalaryBook() {
  ensureEmployeeManagementViews();
  const rows = $("#salaryBookRows");
  if (!rows) return;
  const monthInput = $("#salaryBookMonth");
  if (monthInput) {
    monthInput.max = todayIso().slice(0, 7);
    monthInput.value = salaryBookMonth;
  }
  if (role() !== "Director") {
    rows.innerHTML = "";
    ["salaryBookEmployeeCount", "salaryBookPayrollTotal", "salaryBookLeaveUsed", "salaryBookLeaveBalance"].forEach((id) => {
      const item = $(`#${id}`);
      if (item) item.textContent = id === "salaryBookEmployeeCount" ? "0" : id.includes("Payroll") ? fmt(0) : "0";
    });
    return;
  }
  const accounts = workingEligibleEmployees().filter((account) => {
    const createdMonth = String(account.createdAt || "").slice(0, 7);
    return !validYearMonth(createdMonth) || createdMonth <= salaryBookMonth;
  });
  const register = accounts.map((account) => {
    const statement = employeeWorkingStatement(account, salaryBookMonth);
    const leave = salaryBookLeaveStatement(account, salaryBookMonth);
    const allowances = statement.recovery.net + statement.business.net + statement.verification.net + statement.performance;
    return { account, statement, leave, allowances };
  });
  $("#salaryBookEmployeeCount").textContent = String(register.length);
  $("#salaryBookPayrollTotal").textContent = fmt(register.reduce((sum, item) => sum + item.statement.total, 0));
  $("#salaryBookLeaveUsed").textContent = String(register.reduce((sum, item) => sum + item.leave.used, 0));
  $("#salaryBookLeaveBalance").textContent = String(register.reduce((sum, item) => sum + item.leave.balance, 0));
  rows.innerHTML = register.length ? register.map(({ account, statement, leave, allowances }) => `<tr>
    <td class="salary-staff-name"><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.loginId)}</small></td>
    <td><b>${escapeHtml(account.designation)}</b></td>
    <td><b>${statement.counts.Present} P · ${statement.counts["Half Day"]} H · ${statement.counts.Late} L · ${statement.counts.Absent} A</b><small>${statement.payableDays} payable days</small></td>
    <td><b>${fmt(statement.basic.net)}</b><small>${fmt(statement.basic.monthly)} monthly</small></td>
    <td><b>${fmt(allowances)}</b><small>allowances and performance</small></td>
    <td><b>${fmt(statement.incentive)}</b><small>separate from salary</small></td>
    <td><b>${fmt(statement.recurringDepositDeduction)}</b><small>monthly RD deduction</small></td>
    <td><b class="salary-total">${fmt(statement.netSalary)}</b><small>incentive excluded</small></td>
    <td><b>${leave.credited}</b><small>1 credited each month</small></td>
    <td><b>${leave.used}</b><small>Absent days</small></td>
    <td><span class="salary-book-leave-balance">${leave.balance}</span></td>
  </tr>`).join("") : '<tr><td colspan="11" class="empty">No eligible employee salary records are available for this month.</td></tr>';
}

function renderRecurringDeposits() {
  ensureEmployeeManagementViews();
  const rows = $("#recurringDepositRows");
  if (!rows) return;
  const monthInput = $("#recurringDepositMonth");
  if (monthInput) {
    monthInput.max = todayIso().slice(0, 7);
    monthInput.value = recurringDepositMonth;
  }
  if (role() !== "Director") {
    rows.innerHTML = "";
    return;
  }
  const accounts = employeeAccounts
    .filter((account) => account.active !== false && recurringDepositEligible(account))
    .sort((left, right) => String(left.name).localeCompare(String(right.name), "en", { sensitivity: "base" }));
  const register = accounts.map((account) => ({ account, deposit: recurringDepositStatement(account, recurringDepositMonth) }));
  $("#rdEmployeeCount").textContent = String(register.length);
  $("#rdPrincipalTotal").textContent = fmt(register.reduce((sum, item) => sum + item.deposit.principal, 0));
  $("#rdInterestTotal").textContent = fmt(register.reduce((sum, item) => sum + item.deposit.interest, 0));
  $("#rdBalanceTotal").textContent = fmt(register.reduce((sum, item) => sum + item.deposit.balance, 0));
  rows.innerHTML = register.length ? register.map(({ account, deposit }) => `<tr>
    <td class="salary-staff-name"><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.loginId)}</small></td>
    <td>${escapeHtml(account.designation)}</td>
    <td><input class="rd-monthly-input" type="number" min="0" step="1" value="${deposit.monthly}" data-rd-login="${escapeHtml(account.loginId)}" aria-label="Monthly recurring deposit for ${escapeHtml(account.name)}"><small>${deposit.startMonth ? `Auto every month from ${escapeHtml(workingMonthLabel(deposit.startMonth))}` : "Enter once to start automatic monthly deduction"}</small></td>
    <td><b>${deposit.months}</b></td>
    <td><b>${fmt(deposit.principal)}</b></td>
    <td><b>${fmt(deposit.interest)}</b><small>estimated monthly compounding</small></td>
    <td><b class="salary-total">${fmt(deposit.balance)}</b></td>
    <td><button class="collection-btn" type="button" onclick="saveRecurringDeposit('${encodeURIComponent(account.loginId)}')">Update RD</button></td>
  </tr>`).join("") : '<tr><td colspan="8" class="empty">No active Manager, Assistant Manager, or Staff account is available.</td></tr>';
}

async function saveRecurringDeposit(encodedLoginId) {
  if (role() !== "Director") {
    toast("Only the Director can update recurring deposits.");
    return;
  }
  const loginId = decodeURIComponent(encodedLoginId);
  const account = workingAccount(loginId);
  const input = $$('[data-rd-login]').find((element) => element.dataset.rdLogin === loginId);
  const amount = Number(input?.value || 0);
  if (!account || !recurringDepositEligible(account) || !Number.isFinite(amount) || amount < 0) {
    toast("Enter a valid recurring deposit amount.");
    return;
  }
  const previous = Number(account.recurringDeposit || 0);
  const previousStartMonth = String(account.recurringDepositStartedAt || "");
  const roundedAmount = Math.round(amount);
  try {
    if (backendMode) {
      await window.NeelavatiApi.updateRecurringDeposit(account.id, roundedAmount);
      employeeAccounts = await window.NeelavatiApi.listUsers();
    } else {
      account.recurringDeposit = roundedAmount;
      account.recurringDepositStartedAt = roundedAmount > 0
        ? (validYearMonth(previousStartMonth) ? previousStartMonth : todayIso().slice(0, 7))
        : "";
      if (!persistAll()) throw new Error("Recurring deposit could not be saved.");
    }
    renderRecurringDeposits();
    renderSalaryBook();
    renderSalaryManagement();
    renderMyWorking();
    toast(`${account.name}: ${roundedAmount > 0 ? `${fmt(roundedAmount)} will deduct automatically every month` : "monthly RD deduction stopped"}.`);
  } catch (error) {
    account.recurringDeposit = previous;
    account.recurringDepositStartedAt = previousStartMonth;
    toast(error?.message || "Recurring deposit could not be updated.");
  }
}

function upsertWorkingRecord(record, predicate) {
  const index = workingRecords.findIndex(predicate);
  if (index >= 0) workingRecords[index] = record;
  else workingRecords.push(record);
}

function saveAttendance(encodedLoginId) {
  if (role() !== "Cashier") {
    toast("Only the Cashier can update attendance.");
    return;
  }
  const loginId = decodeURIComponent(encodedLoginId);
  const account = workingAccount(loginId);
  const select = $$('[data-attendance-login]').find((element) => element.dataset.attendanceLogin === loginId);
  const status = String(select?.value || "");
  if (!account || !WORKING_ATTENDANCE_STATUSES.includes(status)) {
    toast("Select a valid attendance status.");
    return;
  }
  const date = todayIso();
  const loginKey = loginId.toLowerCase();
  upsertWorkingRecord({
    id: `ATT-${loginId}-${date}`,
    kind: "attendance",
    employeeLoginId: loginId,
    employeeName: account.name,
    designation: account.designation,
    date,
    status,
    updatedBy: currentUser?.loginId || "",
    updatedAt: new Date().toISOString(),
  }, (record) => record.kind === "attendance" && String(record.employeeLoginId || "").toLowerCase() === loginKey && record.date === date);
  if (!persistAll()) return;
  renderMyWorking();
  renderSalaryManagement();
  renderSalaryBook();
  renderRecurringDeposits();
  toast(`${account.name}: ${status} saved for today.`);
}

function renderCashierAttendance(host) {
  const date = todayIso();
  const employees = workingEligibleEmployees();
  host.innerHTML = `<div class="working-toolbar"><div><p class="eyebrow">TODAY'S ATTENDANCE</p><h3>${escapeHtml(dateText(date))}</h3><p>Attendance date is fixed to today. Cashier can update it any time today.</p></div><span class="working-role-badge">Cashier update</span></div><div class="table-panel working-register"><table><thead><tr><th>Employee</th><th>Designation</th><th>Attendance</th><th>Saved status</th><th>Action</th></tr></thead><tbody>${employees.length ? employees.map((account) => {
    const record = attendanceRecord(account.loginId, date);
    const options = WORKING_ATTENDANCE_STATUSES.map((status) => `<option value="${status}" ${record?.status === status ? "selected" : ""}>${status}</option>`).join("");
    return `<tr><td><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.loginId)}</small></td><td>${escapeHtml(account.designation)}</td><td><select class="working-attendance-select" data-attendance-login="${escapeHtml(account.loginId)}"><option value="">Select attendance</option>${options}</select></td><td><span class="working-status ${record ? `is-${String(record.status).toLowerCase().replace(/\s/g, "-")}` : "is-pending"}">${escapeHtml(record?.status || "Not marked")}</span></td><td><button class="collection-btn" type="button" onclick="saveAttendance('${encodeURIComponent(account.loginId)}')">${record ? "Update" : "Save"}</button></td></tr>`;
  }).join("") : '<tr><td colspan="5" class="empty">No active attendance-enabled employee accounts are available.</td></tr>'}</tbody></table></div>`;
  const ownAccount = workingAccount(currentUser?.loginId) || currentUser;
  if (ownAccount?.designation === "Cashier") {
    const ownSalary = document.createElement("section");
    ownSalary.className = "cashier-live-salary";
    host.appendChild(ownSalary);
    renderEmployeeWorking(ownSalary, ownAccount);
  }
}

function employeeWorkingMarkup(account, eyebrow = "MY WORKING") {
  const statement = employeeWorkingStatement(account, workingCalendarMonth);
  const monthLabel = workingMonthLabel(statement.month);
  const componentRow = (label, component) => `<tr><td><b>${label}</b></td><td>${fmt(component.monthly)}</td><td>${fmt(component.daily)}</td><td>${statement.creditedDays}</td><td>− ${fmt(component.deduction)}</td><td><b>${fmt(component.net)}</b></td></tr>`;
  const extended = usesExtendedCompensation(account.designation);
  const isManager = account.designation === "Manager";
  const isAssistantManager = account.designation === "Assistant Manager";
  const earningDescription = extended
    ? isManager
      ? "Only attendance-based basic salary and approved recovery file incentive apply to a Manager."
      : isAssistantManager
      ? `Verification allowance is ${fmt(VERIFICATION_ALLOWANCE_PER_STAFF)} per assigned staff. Performance is ${fmt(ASSISTANT_PERFORMANCE_PER_QUALIFIED_STAFF)} for each team Staff completing ${ASSISTANT_PERFORMANCE_FILE_TARGET} disbursed files in the month.`
      : "Salary and allowances are accrued per marked working day. Performance is automatic: 12 files ₹3,000, 14 files ₹4,000, and 16 files ₹5,000."
    : "Basic salary is divided by 30 and accrued per marked working day. Two half days or three late marks deduct one day's salary.";
  const allowanceRows = isManager
    ? ""
    : isAssistantManager
    ? `${componentRow("Verification allowance", statement.verification)}`
    : `${componentRow("Recovery allowance", statement.recovery)}${componentRow("Business allowance", statement.business)}`;
  const performanceRow = account.designation === "Assistant Manager"
    ? `<tr><td><b>Performance allowance</b><small>Automatic team-file target</small></td><td colspan="3">${statement.assistantPerformance.qualifiedStaff}/${statement.assignedStaffCount} staff completed ${ASSISTANT_PERFORMANCE_FILE_TARGET} disbursed files</td><td>—</td><td><b>${fmt(statement.performance)}</b></td></tr>`
    : account.designation === "Staff"
      ? `<tr><td><b>Performance allowance</b><small>Automatic monthly file target</small></td><td colspan="3">${statement.staffPerformance.files} disbursed files · 12 files ₹3,000 · 14 files ₹4,000 · 16 files ₹5,000</td><td>—</td><td><b>${fmt(statement.performance)}</b></td></tr>`
      : "";
  const recurringDepositRow = recurringDepositEligible(account)
    ? `<tr><td><b>Recurring Deposit</b><small>12% p.a. · monthly compounding estimate</small></td><td>${fmt(statement.recurringDeposit.monthly)}</td><td colspan="2">${statement.recurringDeposit.months} monthly deposit${statement.recurringDeposit.months === 1 ? "" : "s"}</td><td>− ${fmt(statement.recurringDepositDeduction)}</td><td><b>${fmt(statement.recurringDeposit.balance)}</b><small>deposit balance with interest</small></td></tr>`
    : "";
  const extendedRows = extended
    ? `${allowanceRows}${performanceRow}<tr><td><b>${isManager ? "File incentive" : "Recovery incentive"}</b><small>Shown separately; not included in net salary</small></td><td colspan="4">${employeeRecoveryIncentiveEvents(account).filter((event) => String(event.date || "").startsWith(statement.month)).length} approved ${isManager ? "files" : "centres"} this month · ${fmt(recoveryIncentiveRate(account))} each</td><td><b>${fmt(statement.incentive)}</b></td></tr>${recurringDepositRow}`
    : "";
  return `<div class="employee-working-sheet"><div class="working-toolbar"><div><p class="eyebrow">${escapeHtml(eyebrow)} · ${escapeHtml(monthLabel.toUpperCase())}</p><h3>${escapeHtml(account.name)}</h3><p>${escapeHtml(earningDescription)}</p></div><span class="working-role-badge">${escapeHtml(account.designation)}</span></div>
    <div class="working-summary"><article><span>Full present</span><b>${statement.counts.Present}</b><small>marked working days</small></article><article><span>Half days</span><b>${statement.counts["Half Day"]}</b><small>2 half days = 1 deduction</small></article><article><span>Late present</span><b>${statement.counts.Late}</b><small>3 late marks = 1 deduction</small></article><article><span>Absent</span><b>${statement.counts.Absent}</b><small>no daily accrual</small></article><article><span>Payable days</span><b>${statement.payableDays}</b><small>${statement.deductionDays} deducted day(s)</small></article></div>
    <div class="table-panel working-pay-table"><table><thead><tr><th>Component</th><th>Monthly amount</th><th>Per day ÷ 30</th><th>Credited days</th><th>Deduction</th><th>Earned / balance</th></tr></thead><tbody>${componentRow("Basic salary", statement.basic)}${extendedRows}</tbody><tfoot><tr><td colspan="5"><b>Net salary in ${escapeHtml(monthLabel)} <small>incentive is separate</small></b></td><td><strong>${fmt(statement.netSalary)}</strong></td></tr></tfoot></table></div>
    ${renderAttendanceCalendar(statement)}</div>`;
}

function renderEmployeeWorking(host, account) {
  host.innerHTML = employeeWorkingMarkup(account);
}

function assistantManagerTeamWorkingMarkup(assistantAccount) {
  const staff = assignedTeamStaff(assistantAccount)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
  return `<section class="assistant-team-working"><div class="employee-team-panel-head"><div><p class="eyebrow">MY STAFF WORKING</p><h3>${escapeHtml(assistantAccount.name)}'s team</h3><p>Only Staff assigned to this Assistant Manager are shown.</p></div><b>${staff.length} staff</b></div><div class="employee-attendance-team">${staff.length ? staff.map((account, index) => {
    const statement = employeeWorkingStatement(account, workingCalendarMonth);
    const todayStatus = attendanceRecord(account.loginId, todayIso())?.status || "Not marked";
    return `<details class="panel employee-attendance-person assistant-staff-working" ${index === 0 ? "open" : ""}><summary><span><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.loginId)} · Staff</small></span><span class="working-status is-${String(todayStatus).toLowerCase().replace(/\s/g, "-")}">${escapeHtml(todayStatus)}</span><strong>${statement.counts.Present} P · ${statement.counts["Half Day"]} H · ${statement.counts.Late} L · ${statement.counts.Absent} A · ${fmt(statement.total)} earned</strong></summary>${employeeWorkingMarkup(account, "STAFF WORKING")}</details>`;
  }).join("") : '<div class="empty panel">No Staff is assigned to you yet.</div>'}</div></section>`;
}

function renderMyWorking() {
  ["#staffIncentiveDashboard", "#managerIncentiveDashboard", "#assistantManagerIncentiveDashboard"].forEach((selector) => {
    $(selector)?.remove();
  });
  const host = $("#myWorkingContent");
  if (!host) return;
  if (role() === "Cashier") renderCashierAttendance(host);
  else if (["Staff", "Manager", "Assistant Manager", "Executive"].includes(role())) {
    const account = workingAccount(currentUser?.loginId) || currentUser;
    renderEmployeeWorking(host, account);
    if (role() === "Assistant Manager") {
      host.insertAdjacentHTML("beforeend", assistantManagerTeamWorkingMarkup(account));
    }
  } else host.innerHTML = '<div class="empty">My Working is not available for this designation.</div>';
}

function groupTargetActivityDate(group) {
  const loan = loanForGroup(group);
  return String(group?.createdAt || group?.updatedAt || loan?.disbursedOn || "").slice(0, 10);
}

function teamTargetFileStatus(group) {
  const loan = loanForGroup(group);
  if (loan) return { key: "disbursed", label: "Disbursed", note: loan.groupNumber || "Loan processed" };
  if (approvedMembers(group).length >= 5) return { key: "verified", label: "Verified", note: "Ready for disbursement" };
  return { key: "unverified", label: "Not verified", note: "Verification incomplete" };
}

function renderTeamMonthlyTarget() {
  const host = $("#teamTargetStaffList");
  if (!host) return;
  const monthInput = $("#teamTargetMonth");
  if (monthInput && monthInput.value !== teamTargetMonth) monthInput.value = teamTargetMonth;
  if (!isAssistantManagerTeamViewer()) {
    host.innerHTML = '<div class="empty panel">Team Monthly Target is available only to an Assistant Manager.</div>';
    return;
  }
  const assistant = workingAccount(currentUser?.loginId) || currentUser;
  const staff = assignedTeamStaff(assistant)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
  const staffRows = staff.map((account) => {
    const staffName = String(account.name || "").trim().toLowerCase();
    const files = groups
      .filter((group) => String(group.loanStaff || "").trim().toLowerCase() === staffName)
      .filter((group) => groupTargetActivityDate(group).slice(0, 7) === teamTargetMonth)
      .sort((a, b) => groupTargetActivityDate(b).localeCompare(groupTargetActivityDate(a)));
    return { account, files };
  });
  const allFiles = staffRows.flatMap((row) => row.files);
  const disbursed = allFiles.filter((group) => teamTargetFileStatus(group).key === "disbursed").length;
  const verified = allFiles.filter((group) => teamTargetFileStatus(group).key === "verified").length;
  const unverified = allFiles.filter((group) => teamTargetFileStatus(group).key === "unverified").length;
  $("#teamTargetStaffCount").textContent = String(staff.length);
  $("#teamTargetFileCount").textContent = String(allFiles.length);
  $("#teamTargetDisbursedCount").textContent = String(disbursed);
  $("#teamTargetPendingCount").textContent = String(verified + unverified);
  $("#teamTargetMonthLabel").textContent = workingMonthLabel(teamTargetMonth);
  host.innerHTML = staffRows.length ? staffRows.map(({ account, files }) => {
    const staffDisbursed = files.filter((group) => teamTargetFileStatus(group).key === "disbursed").length;
    return `<section class="panel team-target-staff"><div class="team-target-staff-head"><div><p class="eyebrow">STAFF MONTHLY FILES</p><h3>${escapeHtml(account.name)}</h3><p>${escapeHtml(account.loginId)} · ${files.length} verification file${files.length === 1 ? "" : "s"}</p></div><strong>${staffDisbursed}/${files.length} disbursed</strong></div><div class="team-target-files">${files.length ? files.map((group) => {
      const status = teamTargetFileStatus(group);
      const approved = approvedMembers(group).length;
      const total = (group.members || []).length;
      return `<article class="team-target-file is-${status.key}"><span class="team-target-file-status">${escapeHtml(status.label)}</span><div><b>${escapeHtml(group.number || group.name || "Verification file")}</b><small>${escapeHtml(group.name || "Centre")}</small></div><div><span>Members</span><b>${approved}/${total} approved</b></div><div><span>File date</span><b>${dateText(groupTargetActivityDate(group))}</b></div><div><span>Status</span><b>${escapeHtml(status.note)}</b></div></article>`;
    }).join("") : '<div class="team-target-empty">No verification file is recorded for this Staff in the selected month.</div>'}</div></section>`;
  }).join("") : '<div class="empty panel">No Staff is assigned to you. Ask the Director to assign your team first.</div>';
}

function usesExtendedCompensation(designation) {
  return ["Manager", "Assistant Manager", "Staff"].includes(designation);
}

function reportingOptions(select, accounts, emptyLabel, selectedValue = "") {
  if (!select) return;
  select.innerHTML = accounts.length
    ? `<option value="">${emptyLabel}</option>${accounts.map((account) => `<option value="${escapeHtml(account.loginId)}">${escapeHtml(account.name)} · ${escapeHtml(account.loginId)}</option>`).join("")}`
    : `<option value="">${emptyLabel}</option>`;
  select.disabled = accounts.length === 0;
  if (accounts.some((account) => account.loginId === selectedValue)) select.value = selectedValue;
}

function populateEmployeeManagerOptions() {
  reportingOptions($("#employeeManager"), activeManagers(), "No manager assigned (optional)", $("#employeeManager")?.value || "");
  reportingOptions($("#employeeAssistantManager"), activeAssistantManagers(), "No assistant manager assigned (optional)", $("#employeeAssistantManager")?.value || "");
}

function updateEmployeeEmploymentFields() {
  const designation = $("#employeeDesignation")?.value || "Staff";
  const isStaff = designation === "Staff";
  const isManager = designation === "Manager";
  const isAssistantManager = designation === "Assistant Manager";
  const isTeamLeader = ["Manager", "Assistant Manager"].includes(designation);
  const extended = usesExtendedCompensation(designation);
  $$(".extended-pay-field").forEach((field) => field.classList.toggle("hidden", !extended));
  $("#employeeManagerField")?.classList.toggle("hidden", !isStaff);
  $("#employeeAssistantManagerField")?.classList.toggle("hidden", !isStaff);
  if ($("#employeeManagerField")?.firstChild) $("#employeeManagerField").firstChild.textContent = "Manager (optional)";
  if ($("#employeeAssistantManagerField")?.firstChild) $("#employeeAssistantManagerField").firstChild.textContent = "Assistant Manager (optional)";
  if (isStaff) populateEmployeeManagerOptions();
  const incentiveLabel = $("#employeeIncentive")?.closest("label");
  if (incentiveLabel?.firstChild) {
    incentiveLabel.firstChild.textContent = isStaff
      ? "Incentive per approved centre (₹)"
      : isManager
        ? "Incentive per approved recovery file (₹)"
        : isTeamLeader
        ? "Team incentive per staff recovery centre (₹)"
        : "Incentive (₹)";
  }
  if ($("#employeeIncentive")) {
    $("#employeeIncentive").readOnly = false;
    if (isTeamLeader) $("#employeeIncentive").value = String(DEFAULT_TEAM_RECOVERY_INCENTIVE_RATE);
  }
  const performanceLabel = $("#employeePerformanceAllowance")?.closest("label");
  if (performanceLabel?.firstChild) performanceLabel.firstChild.textContent = "Performance allowance (automatic)";
  if ($("#employeePerformanceAllowance")) {
    $("#employeePerformanceAllowance").readOnly = true;
    $("#employeePerformanceAllowance").value = "0";
  }
  performanceLabel?.classList.add("hidden");
  const recoveryLabel = $("#employeePetrolAllowance")?.closest("label");
  if (recoveryLabel?.firstChild) recoveryLabel.firstChild.textContent = "Recovery allowance (₹)";
  const businessLabel = $("#employeeBusinessAllowance")?.closest("label");
  recoveryLabel?.classList.toggle("hidden", !isStaff);
  businessLabel?.classList.toggle("hidden", !isStaff);
  $("#employeeCompensationTitle").textContent = isManager
    ? "Basic salary and per-file incentive"
    : extended ? "Salary, allowances and incentive" : "Basic salary";
  $("#employeeCompensationHelp").textContent = extended
    ? isManager
      ? "Enter only the monthly basic salary and incentive paid for each approved recovery file."
      : isStaff
      ? "Enter monthly salary, recovery and business allowances, plus the incentive rate paid for each approved centre recovery. Performance is calculated automatically from monthly disbursed files."
      : isTeamLeader
        ? isAssistantManager
          ? `Enter monthly salary, team incentive and recurring deposit. Performance is automatic: ₹${ASSISTANT_PERFORMANCE_PER_QUALIFIED_STAFF.toLocaleString("en-IN")} per Staff who completes ${ASSISTANT_PERFORMANCE_FILE_TARGET} disbursed files.`
          : "Enter monthly salary, recovery and business allowances, plus the editable team incentive rate per approved staff centre recovery."
        : "Enter monthly basic salary, allowances and incentive."
    : "Only monthly basic salary is applicable for this designation.";
  $("#employeeRoleNote").textContent = isStaff
    ? "Manager and Assistant Manager are optional. Staff can be created without either assignment."
    : isManager
      ? "Manager compensation contains only attendance-based basic salary and per-file incentive."
    : extended
      ? isAssistantManager
        ? `Assistant Manager performance has no star rating or fixed amount: each team Staff completing ${ASSISTANT_PERFORMANCE_FILE_TARGET} disbursed files earns ₹${ASSISTANT_PERFORMANCE_PER_QUALIFIED_STAFF.toLocaleString("en-IN")}.`
        : `${designation} uses the full salary and allowance format.`
      : `${designation} uses basic salary only.`;
}

function employeeBenefitsTotal(account) {
  if (usesRecoveryIncentive(account.designation)) {
    const statement = employeeWorkingStatement(account);
    return statement.recovery.net + statement.business.net + statement.verification.net + statement.performance;
  }
  return Number(account.performanceAllowance || 0) + Number(account.petrolAllowance || 0) +
    Number(account.businessAllowance || 0);
}

function usesRecoveryIncentive(designation) {
  return ["Manager", "Assistant Manager", "Staff"].includes(designation);
}

function employeeMonthlyPayroll(account) {
  return usesAttendanceSalary(account.designation)
    ? employeeWorkingStatement(account).netSalary
    : Number(account.salary || 0) + employeeBenefitsTotal(account);
}

function employeeReportingText(account) {
  if (account.designation !== "Staff") return "—";
  return `Manager: ${account.managerName || "Not assigned"} · Assistant Manager: ${account.assistantManagerName || "Not assigned"}`;
}

function ensureEmployeeManagementViews() {
  const tabs = $("#employees .employee-management-tabs");
  if (!tabs) return;
  if (!$("#employeeRecurringDeposit")) {
    const incentiveField = $("#employeeIncentive")?.closest("label");
    incentiveField?.insertAdjacentHTML("afterend", '<label class="extended-pay-field hidden">Recurring deposit per month (₹)<input id="employeeRecurringDeposit" type="number" min="0" step="1" value="0" inputmode="numeric"></label>');
  }
  const benefitsNote = $("#salaryBenefitsTotal")?.closest("article")?.querySelector("small");
  const payrollNote = $("#salaryPayrollTotal")?.closest("article")?.querySelector("small");
  if (benefitsNote) benefitsNote.textContent = "allowances; incentive separate";
  if (payrollNote) payrollNote.textContent = "after RD; incentive separate";
  if (!$("#employeeWorkingTab")) {
    tabs.insertAdjacentHTML("beforeend", '<button id="employeeWorkingTab" class="employee-management-tab" type="button" data-employee-view="working"><div><span>My Working</span><small>Team-wise attendance earnings</small></div><b>◷</b></button><button id="employeeAttendanceTab" class="employee-management-tab" type="button" data-employee-view="attendance"><div><span>Staff Attendance</span><small>Assistant Manager-wise attendance</small></div><b>▦</b></button>');
  }
  if (!$("#employeeSalaryBookTab")) {
    tabs.insertAdjacentHTML("beforeend", '<button id="employeeSalaryBookTab" class="employee-management-tab" type="button" data-employee-view="salary-book"><div><span>Salary Book</span><small>Monthly salary and leave balance</small></div><b>▤</b></button>');
  }
  if (!$("#employeeRecurringDepositTab")) {
    tabs.insertAdjacentHTML("beforeend", '<button id="employeeRecurringDepositTab" class="employee-management-tab" type="button" data-employee-view="recurring-deposit"><div><span>Recurring Deposit</span><small>Monthly deductions and 12% interest</small></div><b>RD</b></button>');
  }
  const employeePage = $("#employees");
  if (!$("#employeeWorkingView")) {
    employeePage.insertAdjacentHTML("beforeend", '<div id="employeeWorkingView" class="hidden"><div class="page-intro"><div><h1>My Working</h1><p>Assistant Manager-wise live salary, allowances, incentive and automatic file-based performance.</p></div></div><div id="employeeWorkingTeamFolders" class="employee-team-folder-host"></div><div id="employeeWorkingTeamDetail" class="employee-team-detail"></div></div><div id="employeeAttendanceView" class="hidden"><div class="page-intro"><div><h1>Staff attendance</h1><p>Open an Assistant Manager folder to review the monthly attendance of the complete personal team.</p></div></div><div id="employeeAttendanceTeamFolders" class="employee-team-folder-host"></div><div id="employeeAttendanceTeamDetail" class="employee-team-detail"></div></div>');
  }
  if (!$("#employeeSalaryBookView")) {
    employeePage.insertAdjacentHTML("beforeend", '<div id="employeeSalaryBookView" class="hidden"><div class="page-intro salary-book-intro"><div><p class="eyebrow">DIRECTOR REGISTER</p><h1>Salary Book</h1><p>Every employee receives 1 leave per month. Unused leave carries forward month by month.</p></div><label class="salary-book-month">Salary month<input id="salaryBookMonth" type="month"></label></div><div class="stats salary-summary salary-book-summary"><article><span>Employees</span><b id="salaryBookEmployeeCount">0</b><small>eligible salary records</small></article><article><span>Net salary total</span><b id="salaryBookPayrollTotal">₹0</b><small>after recurring deposit</small></article><article><span>Leaves used</span><b id="salaryBookLeaveUsed">0</b><small>used from monthly leave balance</small></article><article><span>Leave balance</span><b id="salaryBookLeaveBalance">0</b><small>unused leaves carried forward</small></article></div><div class="panel table-panel salary-register salary-book-register"><table><thead><tr><th>Employee</th><th>Designation</th><th>Attendance</th><th>Earned basic</th><th>Allowances</th><th>Incentive (separate)</th><th>RD deduction</th><th>Net salary</th><th>Leave credited</th><th>Leave used</th><th>Leave balance</th></tr></thead><tbody id="salaryBookRows"></tbody></table></div></div>');
  }
  if (!$("#employeeRecurringDepositView")) {
    employeePage.insertAdjacentHTML("beforeend", '<div id="employeeRecurringDepositView" class="hidden"><div class="page-intro salary-book-intro"><div><p class="eyebrow">DIRECTOR REGISTER</p><h1>Recurring Deposit</h1><p>Manager, Assistant Manager and Staff monthly salary deductions with estimated 12% annual interest.</p></div><label class="salary-book-month">Deposit month<input id="recurringDepositMonth" type="month"></label></div><div class="stats salary-summary salary-book-summary"><article><span>Employees</span><b id="rdEmployeeCount">0</b><small>active RD accounts</small></article><article><span>Total principal</span><b id="rdPrincipalTotal">₹0</b><small>deposited amount</small></article><article><span>Estimated interest</span><b id="rdInterestTotal">₹0</b><small>12% p.a.</small></article><article><span>Balance with interest</span><b id="rdBalanceTotal">₹0</b><small>selected month</small></article></div><div class="panel table-panel salary-register recurring-deposit-register"><table><thead><tr><th>Employee</th><th>Designation</th><th>Monthly deduction</th><th>Months</th><th>Principal</th><th>12% interest</th><th>Balance</th><th>Action</th></tr></thead><tbody id="recurringDepositRows"></tbody></table></div></div>');
    $("#recurringDepositMonth")?.addEventListener("change", (event) => {
      const nextMonth = String(event.target.value || "");
      const currentMonth = todayIso().slice(0, 7);
      recurringDepositMonth = validYearMonth(nextMonth) && nextMonth <= currentMonth ? nextMonth : currentMonth;
      renderRecurringDeposits();
    });
  }
  const salaryView = $("#employeeSalaryView");
  if (salaryView && !$("#employeeSalaryTeamFolders")) {
    const host = document.createElement("div");
    host.id = "employeeSalaryTeamFolders";
    host.className = "employee-team-folder-host";
    salaryView.insertBefore(host, $("#employeeSalaryView .salary-summary"));
    const setup = document.createElement("div");
    setup.id = "employeeSalaryTeamSetup";
    salaryView.insertBefore(setup, $("#employeeSalaryView .salary-summary"));
  }
}

function employeeTeamFolders() {
  const active = employeeAccounts.filter((account) => account.active !== false);
  const assistants = active
    .filter((account) => account.designation === "Assistant Manager")
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
  const assignedStaff = new Set();
  const folders = assistants.map((assistant) => {
    const loginKey = String(assistant.loginId || "").toLowerCase();
    const nameKey = String(assistant.name || "").toLowerCase();
    const staff = active.filter((account) => account.designation === "Staff" && (
      (loginKey && String(account.assistantManagerLoginId || "").toLowerCase() === loginKey) ||
      (nameKey && String(account.assistantManagerName || "").toLowerCase() === nameKey)
    )).sort((a, b) => String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
    staff.forEach((account) => assignedStaff.add(String(account.loginId || "").toLowerCase()));
    return {
      key: assistant.loginId,
      name: assistant.name,
      subtitle: `${staff.length} team member${staff.length === 1 ? "" : "s"}`,
      assistant,
      accounts: [assistant, ...staff],
    };
  });
  const otherAccounts = active.filter((account) =>
    ["Cashier", "Executive"].includes(account.designation) ||
    (account.designation === "Staff" && !assignedStaff.has(String(account.loginId || "").toLowerCase()))
  );
  if (otherAccounts.length) {
    folders.push({
      key: "__other__",
      name: "Other employees",
      subtitle: `${otherAccounts.length} Cashier, Executive or unassigned Staff`,
      assistant: null,
      accounts: otherAccounts,
    });
  }
  return folders;
}

function renderEmployeeTeamFolders(view, host) {
  if (!host) return null;
  const allFolders = employeeTeamFolders();
  const folders = view === "salary"
    ? allFolders.filter((folder) => Boolean(folder.assistant))
    : allFolders;
  if (!folders.length) {
    host.innerHTML = `<div class="empty panel">${view === "salary"
      ? "No active Assistant Manager salary folders are available."
      : "No active Assistant Manager or employee folders are available."}</div>`;
    return null;
  }
  if (!folders.some((folder) => folder.key === selectedEmployeeTeamFolders[view])) {
    selectedEmployeeTeamFolders[view] = folders[0].key;
  }
  host.innerHTML = `<div class="employee-team-folder-list">${folders.map((folder) => `<button type="button" class="employee-team-folder ${selectedEmployeeTeamFolders[view] === folder.key ? "active" : ""}" onclick="selectEmployeeTeamFolder('${view}','${encodeURIComponent(folder.key)}')"><span class="employee-team-folder-icon">${folder.assistant ? "AM" : "•••"}</span><span><b>${escapeHtml(folder.name)}</b><small>${escapeHtml(folder.subtitle)}</small></span><strong>Open</strong></button>`).join("")}</div>`;
  return folders.find((folder) => folder.key === selectedEmployeeTeamFolders[view]) || folders[0];
}

function assistantManagerTeamSetupMarkup(view, folder) {
  if (!folder?.assistant) return "";
  const assistant = folder.assistant;
  const assistantLoginKey = String(assistant.loginId || "").toLowerCase();
  const teamStaff = assignedTeamStaff(assistant);
  const candidates = employeeAccounts
    .filter((account) => account.active !== false && account.designation === "Staff" &&
      String(account.assistantManagerLoginId || "").toLowerCase() !== assistantLoginKey)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
  const candidateOptions = candidates.map((staff) => `<option value="${escapeHtml(staff.loginId)}">${escapeHtml(staff.name)} · currently ${escapeHtml(staff.assistantManagerName || "unassigned")}</option>`).join("");
  const roster = teamStaff.length
    ? teamStaff.map((staff) => `<span><b>${escapeHtml(staff.name)}</b><small>${escapeHtml(staff.loginId)}</small></span>`).join("")
    : '<em>No staff assigned yet.</em>';
  return `<section class="panel assistant-team-setup"><div class="assistant-team-setup-head"><div><p class="eyebrow">PERSONAL TEAM</p><h3>${escapeHtml(assistant.name)}</h3><p>Each staff member can belong to exactly one Assistant Manager. Reassigning moves the staff from the previous team.</p></div><strong>${teamStaff.length} staff · ${fmt(teamStaff.length * VERIFICATION_ALLOWANCE_PER_STAFF)} verification allowance</strong></div><div class="assistant-team-controls"><label>Assign or move staff<select id="employeeTeamStaff-${view}" ${candidates.length ? "" : "disabled"}><option value="">${candidates.length ? "Select staff" : "All staff are already in this team"}</option>${candidateOptions}</select></label><button class="primary" type="button" ${candidates.length ? "" : "disabled"} onclick="assignStaffToAssistantManager('${view}','${encodeURIComponent(assistant.loginId)}')">Assign staff</button><label>Team incentive per approved staff centre (₹)<input id="employeeTeamIncentive-${view}" type="number" min="0" step="1" value="${recoveryIncentiveRate(assistant)}" inputmode="numeric"></label><button class="outline" type="button" onclick="saveTeamIncentive('${view}','${encodeURIComponent(assistant.loginId)}')">Update incentive</button></div><div class="assistant-team-roster">${roster}</div></section>`;
}

function refreshEmployeeTeamManagement() {
  renderEmployees();
  renderSalaryManagement();
  renderSalaryBook();
  renderRecurringDeposits();
  if (role() === "Director" && selectedEmployeeManagementView === "working") renderDirectorTeamWorking();
  if (role() === "Director" && selectedEmployeeManagementView === "attendance") renderDirectorTeamAttendance();
}

async function assignStaffToAssistantManager(view, encodedAssistantLoginId) {
  if (role() !== "Director") {
    toast("Only the Director can assign staff to an Assistant Manager.");
    return;
  }
  const assistantLoginId = decodeURIComponent(encodedAssistantLoginId);
  const assistant = activeAssistantManagers().find((account) => account.loginId === assistantLoginId);
  const staffLoginId = $(`#employeeTeamStaff-${view}`)?.value || "";
  const staff = employeeAccounts.find((account) => account.active !== false && account.designation === "Staff" && account.loginId === staffLoginId);
  if (!assistant || !staff) {
    toast("Select a staff member to assign.");
    return;
  }
  if (backendMode) {
    try {
      await window.NeelavatiApi.assignStaffAssistantManager(staff.id, assistant.loginId);
      employeeAccounts = await window.NeelavatiApi.listUsers();
    } catch (error) {
      toast(error?.message || "Staff assignment could not be updated.");
      return;
    }
  } else {
    staff.assistantManagerLoginId = assistant.loginId;
    staff.assistantManagerName = assistant.name;
    if (!persistAll()) return;
  }
  refreshEmployeeTeamManagement();
  toast(`${staff.name} is now assigned only to ${assistant.name}.`);
}

async function updateTeamIncentiveAccount(account, amount) {
  if (backendMode) {
    await window.NeelavatiApi.updateTeamIncentive(account.id, amount);
    employeeAccounts = await window.NeelavatiApi.listUsers();
  } else {
    account.incentive = amount;
    if (!persistAll()) throw new Error("Team incentive could not be saved.");
  }
}

async function saveTeamIncentive(view, encodedLoginId) {
  if (role() !== "Director") {
    toast("Only the Director can update team incentive rates.");
    return;
  }
  const loginId = decodeURIComponent(encodedLoginId);
  const account = employeeAccounts.find((item) => item.loginId === loginId && ["Manager", "Assistant Manager"].includes(item.designation));
  const amount = Number($(`#employeeTeamIncentive-${view}`)?.value);
  if (!account || !Number.isFinite(amount) || amount < 0) {
    toast("Enter a valid team incentive amount.");
    return;
  }
  try {
    await updateTeamIncentiveAccount(account, amount);
    refreshEmployeeTeamManagement();
    toast(`${account.name}: team incentive updated to ${fmt(amount)} per approved centre.`);
  } catch (error) {
    toast(error?.message || "Team incentive could not be updated.");
  }
}

async function editTeamIncentive(encodedLoginId) {
  if (role() !== "Director") return;
  const loginId = decodeURIComponent(encodedLoginId);
  const account = employeeAccounts.find((item) => item.loginId === loginId && ["Manager", "Assistant Manager"].includes(item.designation));
  if (!account) return;
  const isManager = account.designation === "Manager";
  const value = window.prompt(`${isManager ? "File incentive per approved recovery file" : "Team incentive per approved staff centre"} for ${account.name}:`, String(recoveryIncentiveRate(account)));
  if (value === null) return;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    toast("Enter a valid team incentive amount.");
    return;
  }
  try {
    await updateTeamIncentiveAccount(account, amount);
    refreshEmployeeTeamManagement();
    toast(`${account.name}: ${isManager ? "file" : "team"} incentive updated to ${fmt(amount)} per approved ${isManager ? "recovery file" : "centre"}.`);
  } catch (error) {
    toast(error?.message || "Team incentive could not be updated.");
  }
}

function selectEmployeeTeamFolder(view, encodedKey) {
  if (role() !== "Director" || !["salary", "working", "attendance"].includes(view)) return;
  selectedEmployeeTeamFolders[view] = decodeURIComponent(encodedKey);
  if (view === "salary") renderSalaryManagement();
  else if (view === "working") renderDirectorTeamWorking();
  else renderDirectorTeamAttendance();
}

function renderDirectorTeamWorking() {
  ensureEmployeeManagementViews();
  const detail = $("#employeeWorkingTeamDetail");
  if (!detail) return;
  if (role() !== "Director") {
    detail.innerHTML = "";
    return;
  }
  const folder = renderEmployeeTeamFolders("working", $("#employeeWorkingTeamFolders"));
  const accounts = (folder?.accounts || []).filter((account) => usesAttendanceSalary(account.designation));
  const month = workingCalendarMonth;
  detail.innerHTML = folder ? `${assistantManagerTeamSetupMarkup("working", folder)}<section class="panel employee-team-panel"><div class="employee-team-panel-head"><div><p class="eyebrow">${folder.assistant ? "ASSISTANT MANAGER TEAM" : "OTHER EMPLOYEES"}</p><h3>${escapeHtml(folder.name)}</h3><p>${escapeHtml(workingMonthLabel(month))} live working statement</p></div><b>${accounts.length} records</b></div><div class="table-panel"><table><thead><tr><th>Employee</th><th>Attendance</th><th>Live basic salary</th><th>Allowances</th><th>Performance</th><th>Incentive (separate)</th><th>RD deduction</th><th>Net salary</th></tr></thead><tbody>${accounts.length ? accounts.map((account) => {
    const statement = employeeWorkingStatement(account, month);
    const rating = account.designation === "Assistant Manager"
      ? `<b>${fmt(statement.performance)}</b><small>${statement.assistantPerformance.qualifiedStaff} staff met ${ASSISTANT_PERFORMANCE_FILE_TARGET}-file target</small>`
      : account.designation === "Staff"
      ? `<b>${fmt(statement.performance)}</b><small>${statement.staffPerformance.files} disbursed files · automatic</small>`
      : "—";
    const allowances = account.designation === "Assistant Manager"
      ? `<b>${fmt(statement.verification.net)}</b><small>Verification · ${statement.assignedStaffCount} staff</small>`
      : account.designation === "Staff" ? `<b>${fmt(statement.recovery.net)} / ${fmt(statement.business.net)}</b><small>Recovery / Business</small>` : "—";
    return `<tr><td><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.designation)} · ${escapeHtml(account.loginId)}</small></td><td><b>${statement.counts.Present} P · ${statement.counts["Half Day"]} H · ${statement.counts.Late} L</b><small>${statement.payableDays} payable days</small></td><td><b>${fmt(statement.basic.net)}</b><small>${fmt(statement.basic.daily)} per day</small></td><td>${allowances}</td><td>${rating}</td><td>${usesRecoveryIncentive(account.designation) ? fmt(statement.incentive) : "—"}</td><td>${recurringDepositEligible(account) ? fmt(statement.recurringDepositDeduction) : "—"}</td><td><b class="salary-total">${fmt(statement.netSalary)}</b></td></tr>`;
  }).join("") : '<tr><td colspan="8" class="empty">This folder has no attendance-enabled employees.</td></tr>'}</tbody></table></div></section>` : "";
}

function renderDirectorTeamAttendance() {
  ensureEmployeeManagementViews();
  const detail = $("#employeeAttendanceTeamDetail");
  if (!detail) return;
  if (role() !== "Director") {
    detail.innerHTML = "";
    return;
  }
  const folder = renderEmployeeTeamFolders("attendance", $("#employeeAttendanceTeamFolders"));
  const accounts = (folder?.accounts || []).filter((account) => usesAttendanceSalary(account.designation));
  detail.innerHTML = folder ? `${assistantManagerTeamSetupMarkup("attendance", folder)}<section class="employee-attendance-team"><div class="employee-team-panel-head panel"><div><p class="eyebrow">TEAM ATTENDANCE</p><h3>${escapeHtml(folder.name)}</h3><p>${escapeHtml(workingMonthLabel(workingCalendarMonth))}</p></div><b>${accounts.length} employees</b></div>${accounts.length ? accounts.map((account, index) => {
    const statement = employeeWorkingStatement(account, workingCalendarMonth);
    const todayStatus = attendanceRecord(account.loginId, todayIso())?.status || "Not marked";
    return `<details class="panel employee-attendance-person" ${index === 0 ? "open" : ""}><summary><span><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.designation)} · ${escapeHtml(account.loginId)}</small></span><span class="working-status is-${String(todayStatus).toLowerCase().replace(/\s/g, "-")}">${escapeHtml(todayStatus)}</span><strong>${statement.counts.Present} Present · ${statement.counts["Half Day"]} Half · ${statement.counts.Late} Late · ${statement.counts.Absent} Absent</strong></summary>${renderAttendanceCalendar(statement)}</details>`;
  }).join("") : '<div class="empty panel">This folder has no attendance-enabled employees.</div>'}</section>` : "";
}

function updateEmployeeManagementView() {
  ensureEmployeeManagementViews();
  const directorOnlyAllowed = role() === "Director";
  if (!directorOnlyAllowed && ["salary", "working", "attendance", "salary-book", "recurring-deposit"].includes(selectedEmployeeManagementView)) selectedEmployeeManagementView = "login";
  ["employeeSalaryTab", "employeeWorkingTab", "employeeAttendanceTab", "employeeSalaryBookTab", "employeeRecurringDepositTab"].forEach((id) => $(`#${id}`)?.classList.toggle("hidden", !directorOnlyAllowed));
  $("#employeeLoginView")?.classList.toggle("hidden", selectedEmployeeManagementView !== "login");
  $("#employeeSalaryView")?.classList.toggle("hidden", selectedEmployeeManagementView !== "salary" || !directorOnlyAllowed);
  $("#employeeWorkingView")?.classList.toggle("hidden", selectedEmployeeManagementView !== "working" || !directorOnlyAllowed);
  $("#employeeAttendanceView")?.classList.toggle("hidden", selectedEmployeeManagementView !== "attendance" || !directorOnlyAllowed);
  $("#employeeSalaryBookView")?.classList.toggle("hidden", selectedEmployeeManagementView !== "salary-book" || !directorOnlyAllowed);
  $("#employeeRecurringDepositView")?.classList.toggle("hidden", selectedEmployeeManagementView !== "recurring-deposit" || !directorOnlyAllowed);
  $$("[data-employee-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.employeeView === selectedEmployeeManagementView);
  });
}

function setEmployeeManagementView(view) {
  const validViews = ["login", "salary", "working", "attendance", "salary-book", "recurring-deposit"];
  const nextView = validViews.includes(view) ? view : "login";
  if (nextView !== "login" && role() !== "Director") {
    toast("Only the Director can open salary, working, attendance and Salary Book records.");
    return;
  }
  selectedEmployeeManagementView = nextView;
  updateEmployeeManagementView();
  if (selectedEmployeeManagementView === "salary") renderSalaryManagement();
  if (selectedEmployeeManagementView === "working") renderDirectorTeamWorking();
  if (selectedEmployeeManagementView === "attendance") renderDirectorTeamAttendance();
  if (selectedEmployeeManagementView === "salary-book") renderSalaryBook();
  if (selectedEmployeeManagementView === "recurring-deposit") renderRecurringDeposits();
}

function renderSalaryManagement() {
  ensureEmployeeManagementViews();
  const rows = $("#salaryRows");
  if (!rows) return;
  const salaryHeaders = $$("#employeeSalaryView thead th");
  if (salaryHeaders[4]) salaryHeaders[4].textContent = "Performance";
  if (salaryHeaders[5]) salaryHeaders[5].textContent = "Recovery / Verification allowance";
  if (salaryHeaders[8]) salaryHeaders[8].textContent = "Net salary";
  if (role() !== "Director") {
    if ($("#employeeSalaryTeamFolders")) $("#employeeSalaryTeamFolders").innerHTML = "";
    if ($("#employeeSalaryTeamSetup")) $("#employeeSalaryTeamSetup").innerHTML = "";
    rows.innerHTML = "";
    ["salaryEmployeeCount", "salaryBaseTotal", "salaryBenefitsTotal", "salaryPayrollTotal"].forEach((id) => {
      $(`#${id}`).textContent = id === "salaryEmployeeCount" ? "0" : fmt(0);
    });
    return;
  }
  const folder = renderEmployeeTeamFolders("salary", $("#employeeSalaryTeamFolders"));
  if ($("#employeeSalaryTeamSetup")) $("#employeeSalaryTeamSetup").innerHTML = assistantManagerTeamSetupMarkup("salary", folder);
  const roleOrder = ["Director", "Manager", "Assistant Manager", "Cashier", "Executive", "Staff"];
  const salaryAccounts = (folder?.accounts || [])
    .sort((a, b) => roleOrder.indexOf(a.designation) - roleOrder.indexOf(b.designation) || String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
  const baseTotal = salaryAccounts.reduce((sum, account) => sum + (usesAttendanceSalary(account.designation)
    ? employeeWorkingStatement(account).basic.net
    : Number(account.salary || 0)), 0);
  const benefitsTotal = salaryAccounts.reduce((sum, account) => sum + employeeBenefitsTotal(account), 0);
  $("#salaryEmployeeCount").textContent = String(salaryAccounts.length);
  $("#salaryBaseTotal").textContent = fmt(baseTotal);
  $("#salaryBenefitsTotal").textContent = fmt(benefitsTotal);
  $("#salaryPayrollTotal").textContent = fmt(salaryAccounts.reduce((sum, account) => sum + employeeMonthlyPayroll(account), 0));
  rows.innerHTML = salaryAccounts.length
    ? salaryAccounts.map((account) => {
      const extended = usesExtendedCompensation(account.designation);
      const attendanceSalary = usesAttendanceSalary(account.designation);
      const statement = attendanceSalary ? employeeWorkingStatement(account) : null;
      return `<tr>
        <td class="salary-staff-name"><b>${escapeHtml(account.name)}</b><small>${escapeHtml(account.loginId)}</small></td>
        <td><b>${escapeHtml(account.designation)}</b></td>
        <td class="salary-manager-name"><small>${escapeHtml(employeeReportingText(account))}</small></td>
        <td>${attendanceSalary ? `<b>${fmt(statement.basic.net)}</b><small>${fmt(account.salary || 0)} monthly · ${statement.payableDays} payable days</small>` : fmt(account.salary || 0)}</td>
        <td>${account.designation === "Assistant Manager"
          ? `<b>${fmt(statement.performance)}</b><small>${statement.assistantPerformance.qualifiedStaff} staff met ${ASSISTANT_PERFORMANCE_FILE_TARGET}-file target</small>`
          : account.designation === "Staff" ? `<b>${fmt(statement.performance)}</b><small>${statement.staffPerformance.files} disbursed files · automatic</small>` : "—"}</td>
        <td>${extended ? account.designation === "Assistant Manager"
          ? `<b>${fmt(statement.verification.net)}</b><small>${fmt(statement.verification.monthly)} monthly · ${statement.assignedStaffCount} staff</small>`
          : account.designation === "Staff" ? `<b>${fmt(statement.recovery.net)}</b><small>${fmt(account.petrolAllowance || 0)} monthly</small>` : "—" : "—"}</td>
        <td>${account.designation === "Staff" ? `<b>${fmt(statement.business.net)}</b><small>${fmt(account.businessAllowance || 0)} monthly</small>` : "—"}</td>
        <td>${extended ? usesRecoveryIncentive(account.designation)
          ? `<b>${fmt(recoveryIncentiveRate(account))} / ${account.designation === "Manager" ? "file" : "centre"}</b><small>${fmt(employeeCurrentMonthIncentive(account))} earned this month</small>`
          : fmt(account.incentive || 0) : "—"}</td>
        <td><b class="salary-total">${fmt(employeeMonthlyPayroll(account))}</b><small>${recurringDepositEligible(account) ? `${fmt(statement.recurringDepositDeduction)} RD deducted · incentive separate` : "incentive separate"}</small></td>
      </tr>`;
    }).join("")
    : '<tr><td colspan="9" class="empty">No active employee salary records are available. Add an employee from Employee Login.</td></tr>';
}

function renderEmployees() {
  const manageable = canManageEmployees();
  $("#addEmployee").style.display = manageable ? "" : "none";
  $("#employeeRows").innerHTML = employeeAccounts.length
    ? employeeAccounts
        .map(
          (account, index) => `<tr>
            <td><div class="employee-row-actions">${manageable && account.loginId.toLowerCase() !== "shubham" && account.loginId.toLowerCase() !== String(currentUser?.loginId || "").toLowerCase() ? `<button class="collection-btn" type="button" onclick="removeEmployee(${index})">Remove</button>` : ""}${role() === "Director" && ["Manager", "Assistant Manager"].includes(account.designation) ? `<button class="collection-btn" type="button" onclick="editTeamIncentive('${encodeURIComponent(account.loginId)}')">${account.designation === "Manager" ? "File" : "Team"} incentive ${fmt(recoveryIncentiveRate(account))}</button>` : ""}${(!manageable || account.loginId.toLowerCase() === "shubham" || account.loginId.toLowerCase() === String(currentUser?.loginId || "").toLowerCase()) && !(role() === "Director" && ["Manager", "Assistant Manager"].includes(account.designation)) ? "—" : ""}</div></td>
            <td><b>${escapeHtml(account.name)}</b></td><td>${escapeHtml(account.loginId)}</td><td>${escapeHtml(account.designation)}</td>
            <td>${escapeHtml(employeeReportingText(account))}</td>
            <td><span class="status">${account.active === false ? "Inactive" : "Active"}</span></td><td>${escapeHtml(account.lastActive || "Never")}</td>
          </tr>`
        )
        .join("")
    : '<tr><td colspan="7" class="empty">No employee accounts have been created.</td></tr>';
}

function openEmployeeForm() {
  if (!canManageEmployees()) {
    toast("Only Director and Manager can add employees.");
    return;
  }
  $("#employeeName").value = "";
  $("#employeeLoginId").value = "";
  $("#employeePassword").value = "";
  $("#employeeDesignation").value = "Staff";
  ["employeeSalary", "employeePerformanceAllowance", "employeePetrolAllowance", "employeeBusinessAllowance", "employeeIncentive", "employeeRecurringDeposit"].forEach((id) => {
    $(`#${id}`).value = "0";
  });
  populateEmployeeManagerOptions();
  $("#employeeManager").value = "";
  $("#employeeAssistantManager").value = "";
  updateEmployeeEmploymentFields();
  $("#employeeForm").classList.remove("hidden");
}

async function saveEmployee() {
  if (!canManageEmployees()) return;
  const name = $("#employeeName").value.trim();
  const loginId = $("#employeeLoginId").value.trim();
  const password = $("#employeePassword").value;
  const designation = $("#employeeDesignation").value;
  const isStaff = designation === "Staff";
  const isManager = designation === "Manager";
  const isAssistantManager = designation === "Assistant Manager";
  const extended = usesExtendedCompensation(designation);
  const managerLoginId = isStaff ? $("#employeeManager").value : "";
  const assistantManagerLoginId = isStaff ? $("#employeeAssistantManager").value : "";
  const manager = activeManagers().find((account) => account.loginId === managerLoginId);
  const assistantManager = activeAssistantManagers().find((account) => account.loginId === assistantManagerLoginId);
  const salary = Number($("#employeeSalary").value || 0);
  const performanceAllowance = isStaff ? Number($("#employeePerformanceAllowance").value || 0) : 0;
  const petrolAllowance = isStaff ? Number($("#employeePetrolAllowance").value || 0) : 0;
  const businessAllowance = isStaff ? Number($("#employeeBusinessAllowance").value || 0) : 0;
  const incentive = extended ? Number($("#employeeIncentive").value || 0) : 0;
  const recurringDeposit = extended ? Number($("#employeeRecurringDeposit")?.value || 0) : 0;
  if (!name || !loginId || !password) {
    toast("Enter employee name, Login ID, and password.");
    return;
  }
  if (password.length < 10) {
    toast("Password must contain at least 10 characters.");
    return;
  }
  if (employeeAccounts.some((account) => account.loginId.toLowerCase() === loginId.toLowerCase())) {
    toast("This Login ID is already assigned.");
    return;
  }
  const amountFields = [salary, performanceAllowance, petrolAllowance, businessAllowance, incentive, recurringDeposit];
  if (amountFields.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    toast("Salary and allowance amounts must be zero or more.");
    return;
  }
  const employmentDetails = {
    managerLoginId,
    managerName: manager?.name || "",
    assistantManagerLoginId,
    assistantManagerName: assistantManager?.name || "",
    salary,
    performanceAllowance,
    petrolAllowance,
    businessAllowance,
    incentive,
    recurringDeposit,
    recurringDepositStartedAt: recurringDeposit > 0 ? todayIso().slice(0, 7) : "",
  };
  if (backendMode) {
    try {
      await window.NeelavatiApi.createUser({ name, loginId, password, designation, ...employmentDetails });
      employeeAccounts = await window.NeelavatiApi.listUsers();
      $("#employeeForm").classList.add("hidden");
      populateStaffSelects();
      renderEmployees();
      renderSalaryManagement();
      toast(`Employee login created for ${name}.`);
    } catch (error) {
      toast(error?.message || "Employee login could not be created.");
    }
    return;
  }
  employeeAccounts.push({ name, loginId, password, designation, ...employmentDetails, createdAt: new Date().toISOString(), lastActive: "Never", active: true });
  if (!persistAll()) {
    employeeAccounts.pop();
    return;
  }
  $("#employeeForm").classList.add("hidden");
  populateStaffSelects();
  renderEmployees();
  renderSalaryManagement();
  toast(`Employee login created for ${name}.`);
}

async function removeEmployee(index) {
  if (!canManageEmployees()) return;
  const account = employeeAccounts[index];
  if (!account) return;
  if (account.loginId.toLowerCase() === "shubham") {
    toast("Shubham Director login is protected.");
    return;
  }
  if (account === currentUser) {
    toast("You cannot remove your own active login.");
    return;
  }
  if (backendMode) {
    try {
      await window.NeelavatiApi.removeUser(account.id);
      employeeAccounts = await window.NeelavatiApi.listUsers();
      populateStaffSelects();
      renderEmployees();
      renderSalaryManagement();
      toast(`Login removed for ${account.name}.`);
    } catch (error) {
      toast(error?.message || "Employee login could not be removed.");
    }
    return;
  }
  const affectedLoans = account.designation === "Staff"
    ? loans.filter((loan) => loan.staff === account.name || loan.recoveryStaffLoginId === account.loginId)
    : [];
  const previousAssignments = affectedLoans.map((loan) => ({
    loan,
    fields: {
      recoveryStaffLoginId: loan.recoveryStaffLoginId,
      recoveryManagerLoginId: loan.recoveryManagerLoginId,
      recoveryManagerName: loan.recoveryManagerName,
      recoveryAssistantManagerLoginId: loan.recoveryAssistantManagerLoginId,
      recoveryAssistantManagerName: loan.recoveryAssistantManagerName,
    },
  }));
  affectedLoans.forEach((loan) => Object.assign(loan, recoveryStaffAssignmentFields(account)));
  employeeAccounts.splice(index, 1);
  if (!persistAll()) {
    employeeAccounts.splice(index, 0, account);
    previousAssignments.forEach(({ loan, fields }) => Object.assign(loan, fields));
    return;
  }
  populateStaffSelects();
  renderEmployees();
  renderSalaryManagement();
  toast(`Login removed for ${account.name}.`);
}

function csvDownload(rows, fileName) {
  const csv = `\uFEFF${rows
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function weeklyRecoveryFileCode(groupNumber) {
  const match = /^g-?0*(\d+)$/i.exec(String(groupNumber || "").trim());
  return match ? `G-${String(Number(match[1])).padStart(2, "0")}` : String(groupNumber || "GROUP").replace(/[^a-z0-9_-]+/gi, "_");
}

async function downloadGroupSchedule(groupIndex) {
  const group = groups[groupIndex];
  const loan = loanForGroup(group);
  if (!loan) return;
  if (!window.NMCRecoveryXlsx?.buildGroupRecoveryWorkbook) {
    toast("The Excel download engine did not load. Refresh the application and try again.");
    return;
  }
  const schedule = groupScheduleRecoveryRows(loan).map((row) => {
    if (row.type === "holiday") {
      return { type: "holiday", date: row.date, holidayName: row.name || "Bank holiday" };
    }
    return {
      type: row.closing > 0 ? "closing" : "installment",
      number: row.number,
      date: row.date,
      updateTime: row.updateTime,
      groupEmi: "",
      emi: row.emi || "",
      advance: row.advance || "",
      closing: row.closing || "",
      attendance: row.attendance || "",
      review: row.review || "",
    };
  });
  try {
    const memberCount = group.members.length;
    const workbookBlob = await window.NMCRecoveryXlsx.buildGroupRecoveryWorkbook({
      sheetName: loan.groupNumber,
      groupNumber: loan.groupNumber,
      centreId: `${loan.groupNumber}(A1-A${String(memberCount).padStart(2, "0")})`,
      centreName: group.name,
      recoveryDay: group.day,
      recoveryTime: group.recoveryTime || "10:00",
      recoveryAmount: currentLoanDemand(loan),
      memberCount,
      centreAddress: group.centreAddress || "",
      groupLoanAmount: Number(loan.amount || 0),
      leader1: group.members[0]?.name || "",
      leader2: group.members[1]?.name || "",
      executiveName: group.loanStaff || group.officer || "",
      schedule,
    });
    const url = URL.createObjectURL(workbookBlob);
    const link = document.createElement("a");
    const memberCode = `A01-A${String(memberCount).padStart(2, "0")}`;
    link.href = url;
    link.download = `${weeklyRecoveryFileCode(loan.groupNumber)} (${memberCode}).xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Weekly group recovery Excel downloaded in the uploaded reference design.");
  } catch (error) {
    console.error("Unable to build weekly group recovery workbook", error);
    toast("Weekly group recovery Excel could not be created. Refresh and try again.");
  }
}

async function downloadCustomerSchedule(groupIndex, memberIndex) {
  const group = groups[groupIndex];
  const member = group?.members[memberIndex];
  const loan = loanForGroup(group);
  const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
  if (!loan || !individual) return;
  if (!window.NMCRecoveryXlsx?.buildCustomerRepaymentWorkbook) {
    toast("The Excel download engine did not load. Refresh the application and try again.");
    return;
  }
  const paymentsByDate = customerSchedulePaymentRows(loan, individual, memberIndex);
  const rawSchedule = scheduleRows(individual.term, loan.disbursedOn, loan.day, loanRecoveryStartMode(loan));
  const installments = rawSchedule.filter((row) => row.type === "installment");
  const schedule = rawSchedule.map((row) => {
    if (row.type === "holiday") {
      return { type: "holiday", date: row.date, holidayName: row.name || "Bank holiday" };
    }
    const payment = paymentsByDate.get(row.date);
    const review = [...new Set(payment?.reviews || [])].join(" · ");
    return {
      type: /close/i.test(review) ? "closing" : "installment",
      number: row.number,
      date: row.date,
      receipt: payment?.receipts.join(", ") || "",
      emi: Number(individual.emi || 0),
      received: payment?.received || "",
      penalty: payment?.penalty || "",
      review,
    };
  });
  try {
    const memberCount = group.members.length;
    const customerCode = `A-${String(memberIndex + 1).padStart(2, "0")}`;
    const workbookBlob = await window.NMCRecoveryXlsx.buildCustomerRepaymentWorkbook({
      sheetName: customerCode,
      customerCode,
      loanId: `${loan.groupNumber} (A01-A${String(memberCount).padStart(2, "0")})`,
      centreName: group.name,
      centreAddress: group.centreAddress || "",
      recoveryDay: group.day,
      recoveryTime: group.recoveryTime || "10:00",
      customerName: member.name || "",
      guarantorName: member.guarantor || "",
      mobile: member.mobile || "",
      customerAddress: member.address || "",
      loanAmount: Number(individual.amount || 0),
      disbursementDate: String(loan.disbursedOn || "").slice(0, 10),
      firstEmiDate: installments[0]?.date || "",
      lastEmiDate: installments.at(-1)?.date || "",
      installments: Number(individual.term || 0),
      loanPurpose: member.purpose || "",
      executiveName: group.loanStaff || group.officer || "",
      schedule,
    });
    const url = URL.createObjectURL(workbookBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${customerCode}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Customer repayment Excel downloaded in the uploaded A-05 design.");
  } catch (error) {
    console.error("Unable to build customer repayment workbook", error);
    toast("Customer repayment Excel could not be created. Refresh and try again.");
  }
}

function paddedDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function nextRecoveryDate(dayName) {
  const dayIndex = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(dayName);
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (dayIndex >= 0) date.setDate(date.getDate() + ((dayIndex - date.getDay() + 7) % 7));
  return localIsoDate(date);
}

function recoveryDemandExportGroup(loan) {
  const group = groups.find(
    (record) =>
      record.code === loan.groupCode ||
      record.code === loan.code ||
      record.number === loan.groupNumber
  );
  const legacyMembers = group?.members || [];
  const legacyMemberCount = Math.max(1, Number(loan.members || legacyMembers.length || 1));
  const individualLoans = Array.isArray(loan.individualLoans) && loan.individualLoans.length
    ? loan.individualLoans
    : legacyMembers.map((_, memberIndex) => ({
        memberIndex,
        emi: Math.round(Number(loan.emi || 0) / legacyMemberCount),
        balance: Array.isArray(loan.customerBalances)
          ? Number(loan.customerBalances[memberIndex] || 0)
          : Math.ceil(Number(loan.balance || 0) / legacyMemberCount),
      }));
  const firstEmi = scheduleRows(1, loan.disbursedOn, loan.day, loanRecoveryStartMode(loan)).find(
    (row) => row.type === "installment"
  );

  return {
    groupNumber: loan.groupNumber || group?.number || "GROUP",
    centreName: loan.groupName || group?.name || "",
    firstEmi: paddedDate(firstEmi?.date),
    loaningStaff: loan.loanStaff || group?.loanStaff || loan.staff || "",
    recoveryStaff: loan.staff || group?.recoveryStaff || "",
    members: individualLoans.map((item, position) => {
      const memberIndex = Number.isFinite(Number(item.memberIndex))
        ? Number(item.memberIndex)
        : position;
      const member = group?.members?.[memberIndex] || {};
      const balance = Number(item.balance || 0);
      const emi = Number(item.emi || 0);
      const snapshot = memberDemandSnapshot(loan, item, activeRecoveryDemandDate(loan));
      return {
        loanId:
          member.uuid ||
          `${loan.groupNumber || group?.number || "G"}-A${String(position + 1).padStart(2, "0")}`,
        name: member.name || `Customer ${position + 1}`,
        mobile: member.mobile || "",
        emi,
        demand: snapshot.demand,
        penalty: snapshot.penaltyBalance,
        pendingEmiCount: snapshot.pendingEmiCount,
        closed: snapshot.closed,
      };
    }),
  };
}

async function downloadRecoveryDemand(staffName = "", triggerButton = null) {
  if (canProposeRecovery()) selectedDay = todayWeekday();
  const chosen = canProposeRecovery() ? currentUser?.name || staffName : staffName || selectedRecoveryStaff;
  const list = loans.filter(
    (loan) =>
      loanMatchesRecoveryView(loan) &&
      (chosen === "all" || loan.staff === chosen) &&
      Number(loan.balance) > 0
  );
  if (!list.length) {
    toast("No active recovery demand is available for this day and staff selection.");
    return;
  }
  if (!window.NMCRecoveryXlsx?.buildRecoveryDemandWorkbook) {
    toast("The Excel download engine did not load. Refresh the application and try again.");
    return;
  }

  const demandDate = nextRecoveryDate(selectedDay);
  const staffBuckets = new Map();
  list.forEach((loan) => {
    const staffName = loan.staff || "Unassigned Staff";
    if (!staffBuckets.has(staffName)) staffBuckets.set(staffName, []);
    staffBuckets.get(staffName).push(recoveryDemandExportGroup(loan));
  });
  const sheets = [...staffBuckets.entries()].map(([staffName, demandGroups]) => ({
    name: chosen === "all" ? staffName : `${selectedDay} Demand`,
    title: `${selectedDay.toUpperCase()} (${paddedDate(demandDate)}) ${staffName.toUpperCase()}`,
    groups: demandGroups,
  }));

  const button = triggerButton;
  const originalLabel = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing…";
  }
  try {
    const workbookBlob = await window.NMCRecoveryXlsx.buildRecoveryDemandWorkbook({ sheets });
    const url = URL.createObjectURL(workbookBlob);
    const link = document.createElement("a");
    const staffPart = (chosen === "all" ? "All_Staff" : chosen).replace(/[^a-z0-9_-]+/gi, "_");
    link.href = url;
    link.download = `NEELAVATI_${staffPart}_${selectedDay}_Recovery_Demand_${demandDate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Staff recovery demand downloaded in the approved Excel design.");
  } catch (error) {
    console.error("Unable to build recovery demand workbook", error);
    toast("Excel demand could not be created. Refresh the application and try again.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function cloneImportValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeImportHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseOldDataCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeImportHeader);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function importDate(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(text);
  if (match) return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : localIsoDate(parsed);
}

function importAmount(value, fallback = 0) {
  const normalized = String(value ?? "").replace(/[₹,\s]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : fallback;
}

function importGroupNumber(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!text) return "";
  return /^\d+$/.test(text) ? `G${Number(text)}` : text;
}

function findImportGroup(groupNumber, code = "") {
  const number = importGroupNumber(groupNumber);
  return groups.find((group) =>
    (number && importGroupNumber(group.number) === number) || (code && String(group.code) === String(code))
  );
}

function findImportLoan(groupNumber, code = "") {
  const number = importGroupNumber(groupNumber);
  return loans.find((loan) =>
    (number && importGroupNumber(loan.groupNumber) === number) ||
    (code && [loan.groupCode, loan.code].some((value) => String(value || "") === String(code)))
  );
}

function recoveryImportSignature(recovery) {
  return recovery?.id
    ? `id:${recovery.id}`
    : [recovery?.date, recovery?.type || "recovery", recovery?.member, Number(recovery?.amount || 0), recovery?.receipt || ""].join("|").toLowerCase();
}

const OLD_DATA_REQUIRED_COLUMNS = {
  verification: ["group_number", "centre_name", "customer_name"],
  loan: ["group_number", "customer_name", "loan_amount", "weeks", "weekly_emi", "disbursement_date"],
  recovery: ["group_number", "customer_name", "date", "type", "amount", "staff_name"],
};

function prepareOldDataImport(kind, text, fileName = "old-data") {
  const errors = [];
  const warnings = [];
  if (kind === "auto") {
    let payload;
    try {
      payload = JSON.parse(String(text || ""));
    } catch {
      return { kind, fileName, errors: ["The selected file is not valid JSON."], warnings, counts: {}, payload: null };
    }
    const importedGroups = Array.isArray(payload?.groups) ? payload.groups : [];
    const importedLoans = Array.isArray(payload?.loans) ? payload.loans : [];
    const recoveryCount = importedLoans.reduce((sum, loan) => sum + (Array.isArray(loan.recoveries) ? loan.recoveries.length : 0), 0) + (Array.isArray(payload?.recoveries) ? payload.recoveries.length : 0);
    if (!importedGroups.length && !importedLoans.length && !recoveryCount) errors.push("No verification, loan, or recovery records were found in this backup.");
    if (payload?.employees?.length) warnings.push("Employee accounts in the backup will be ignored for security.");
    return {
      kind,
      fileName,
      errors,
      warnings,
      counts: { groups: importedGroups.length, loans: importedLoans.length, recoveries: recoveryCount, rows: importedGroups.length + importedLoans.length + recoveryCount },
      payload,
    };
  }
  const rows = parseOldDataCsv(text);
  if (!rows.length) errors.push("The CSV is empty or does not contain a header row and data rows.");
  const headers = rows.length ? Object.keys(rows[0]) : [];
  (OLD_DATA_REQUIRED_COLUMNS[kind] || []).forEach((column) => {
    if (!headers.includes(column)) errors.push(`Required column is missing: ${column}`);
  });
  const groupCount = new Set(rows.map((row) => importGroupNumber(row.group_number)).filter(Boolean)).size;
  const customerCount = rows.filter((row) => String(row.customer_name || "").trim()).length;
  if (rows.some((row) => !importGroupNumber(row.group_number))) warnings.push("Rows without a Group Number will be skipped.");
  return {
    kind,
    fileName,
    errors,
    warnings,
    counts: {
      groups: kind === "verification" ? groupCount : 0,
      loans: kind === "loan" ? groupCount : 0,
      recoveries: kind === "recovery" ? rows.length : 0,
      customers: customerCount,
      rows: rows.length,
    },
    rows,
  };
}

function importVerificationRows(rows) {
  let groupsAdded = 0;
  let customersAdded = 0;
  let skipped = 0;
  rows.forEach((row, rowIndex) => {
    const number = importGroupNumber(row.group_number);
    const centreName = String(row.centre_name || "").trim();
    const customerName = String(row.customer_name || "").trim();
    if (!number || !centreName || !customerName) {
      skipped += 1;
      return;
    }
    let group = findImportGroup(number);
    if (!group) {
      group = {
        code: `OLD-${number}-${Date.now()}-${rowIndex}`,
        number,
        name: centreName,
        centreAddress: String(row.centre_address || "").trim(),
        recoveryTime: String(row.recovery_time || "10:00").trim() || "10:00",
        day: DAYS.includes(row.recovery_day) ? row.recovery_day : "Monday",
        loanStaff: String(row.loaning_staff || "").trim(),
        recoveryStaff: String(row.recovery_staff || "").trim(),
        officer: String(row.loaning_staff || "").trim(),
        members: [],
        importedAt: new Date().toISOString(),
        importedBy: currentUser?.loginId || "Director",
      };
      groups.push(group);
      groupsAdded += 1;
    }
    group.members = Array.isArray(group.members) ? group.members : [];
    const aadhaar = String(row.customer_aadhaar || "").replace(/\D/g, "");
    const duplicate = group.members.some((member) =>
      (aadhaar && String(member.uuid || "").replace(/\D/g, "") === aadhaar) ||
      String(member.name || "").trim().toLowerCase() === customerName.toLowerCase()
    );
    if (duplicate) {
      skipped += 1;
      return;
    }
    const statusText = String(row.status || "Approved").trim().toLowerCase();
    group.members.push({
      name: customerName,
      uuid: aadhaar,
      address: String(row.address || "").trim(),
      dob: importDate(row.date_of_birth),
      mobile: String(row.mobile || "").trim(),
      occupation: String(row.occupation || "").trim(),
      income: importAmount(row.income),
      guarantor: String(row.guarantor_name || "").trim(),
      guarantorAadhaar: String(row.guarantor_aadhaar || "").replace(/\D/g, ""),
      gdob: importDate(row.guarantor_date_of_birth),
      purpose: String(row.loan_purpose || "").trim(),
      request: importAmount(row.requested_loan_amount),
      status: statusText === "cancelled" ? "Cancelled" : statusText.includes("npa") ? "NPA Customer" : "Approved",
      imported: true,
    });
    customersAdded += 1;
  });
  return { groupsAdded, loansAdded: 0, recoveriesAdded: 0, customersAdded, skipped };
}

function importLoanRows(rows) {
  let loansAdded = 0;
  let customersAdded = 0;
  let skipped = 0;
  const groupedRows = new Map();
  rows.forEach((row) => {
    const number = importGroupNumber(row.group_number);
    if (!number) {
      skipped += 1;
      return;
    }
    if (!groupedRows.has(number)) groupedRows.set(number, []);
    groupedRows.get(number).push(row);
  });
  groupedRows.forEach((loanRows, number) => {
    const group = findImportGroup(number);
    if (!group || findImportLoan(number)) {
      skipped += loanRows.length;
      return;
    }
    group.members = Array.isArray(group.members) ? group.members : [];
    const individualLoans = [];
    loanRows.forEach((row) => {
      const customerName = String(row.customer_name || "").trim();
      const amount = importAmount(row.loan_amount);
      const term = importAmount(row.weeks);
      const emi = importAmount(row.weekly_emi);
      if (!customerName || amount <= 0 || term <= 0 || emi <= 0) {
        skipped += 1;
        return;
      }
      let memberIndex = group.members.findIndex((member) => String(member.name || "").trim().toLowerCase() === customerName.toLowerCase());
      if (memberIndex < 0) {
        group.members.push({ name: customerName, status: "Approved", imported: true });
        memberIndex = group.members.length - 1;
      }
      const balanceText = String(row.balance ?? "").trim();
      const holdAmount = importAmount(row.hold_amount, holdForAmount(amount));
      individualLoans.push({
        memberIndex,
        amount,
        term,
        emi,
        balance: balanceText ? Math.max(0, importAmount(balanceText, amount)) : amount,
        legacyBalanceImported: Boolean(balanceText),
        processingFee: importAmount(row.processing_fee),
        processingFeeReason: "Imported old data",
        processingConfigured: true,
        processingComplete: true,
        holdAmount,
        holdBalance: Math.max(0, importAmount(row.hold_balance, holdAmount)),
        holdTransactions: [],
      });
      customersAdded += 1;
    });
    if (!individualLoans.length) return;
    const first = loanRows[0];
    const disbursementDate = importDate(first.disbursement_date, todayIso());
    const day = DAYS.includes(first.recovery_day) ? first.recovery_day : group.day || "Monday";
    const recoveryStartWeek = String(first.recovery_start_week || "next").toLowerCase().includes("current") ? "current" : "next";
    const loan = {
      id: `OLD-LOAN-${number}-${Date.now()}`,
      groupName: group.name,
      groupNumber: number,
      groupCode: group.code,
      code: group.code,
      head1: group.members[0]?.name || "",
      head2: group.members[1]?.name || "",
      members: individualLoans.length,
      amount: individualLoans.reduce((sum, item) => sum + item.amount, 0),
      term: Math.max(...individualLoans.map((item) => item.term)),
      emi: individualLoans.reduce((sum, item) => sum + item.emi, 0),
      processingFees: individualLoans.reduce((sum, item) => sum + item.processingFee, 0),
      balance: individualLoans.reduce((sum, item) => sum + item.balance, 0),
      individualLoans,
      customerBalances: group.members.map((_, index) => individualLoans.find((item) => item.memberIndex === index)?.balance || 0),
      loanStaff: group.loanStaff || "",
      staff: String(first.recovery_staff || group.recoveryStaff || "").trim(),
      day,
      recoveryStartWeek,
      sanctionDate: importDate(first.loan_sanction_date, disbursementDate),
      disbursedOn: `${disbursementDate}T12:00:00`,
      recoveries: [],
      importedAt: new Date().toISOString(),
      importedBy: currentUser?.loginId || "Director",
    };
    group.number = number;
    group.day = day;
    group.recoveryStaff = loan.staff;
    loans.push(loan);
    loansAdded += 1;
  });
  return { groupsAdded: 0, loansAdded, recoveriesAdded: 0, customersAdded, skipped };
}

function importRecoveryRows(rows) {
  let recoveriesAdded = 0;
  let skipped = 0;
  const affected = new Map();
  rows.forEach((row, rowIndex) => {
    const number = importGroupNumber(row.group_number);
    const loan = findImportLoan(number);
    const group = findImportGroup(number, loan?.groupCode);
    const customerName = String(row.customer_name || "").trim();
    const memberIndex = group?.members?.findIndex((member) => String(member.name || "").trim().toLowerCase() === customerName.toLowerCase()) ?? -1;
    const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
    const amount = importAmount(row.amount);
    const date = importDate(row.date);
    if (!loan || !group || memberIndex < 0 || !individual || !date || amount <= 0) {
      skipped += 1;
      return;
    }
    const typeText = String(row.type || "recovery").trim().toLowerCase();
    const type = typeText.includes("advance") ? "advance" : typeText.includes("clos") ? "closing" : "recovery";
    const penaltyPaid = Math.min(amount, Math.max(0, importAmount(row.penalty_paid)));
    const recovery = {
      id: String(row.recovery_id || `OLD-REC-${number}-${date}-${memberIndex}-${rowIndex}`),
      type,
      date,
      demandDate: importDate(row.demand_date),
      receipt: String(row.receipt || "").trim(),
      amount,
      principalPaid: Math.max(0, amount - penaltyPaid),
      penaltyPaid,
      member: memberIndex,
      allocations: [{ memberIndex, amount }],
      review: String(row.review || "Imported old recovery").trim(),
      enteredBy: String(row.staff_login || row.staff_name || "Old data").trim(),
      enteredByName: String(row.staff_name || row.staff_login || "Old data").trim(),
      enteredByRole: "Staff",
      enteredAt: `${date}T12:00:00`,
      approvedByName: String(row.approved_by || currentUser?.name || "Director").trim(),
      approvedBy: String(row.approved_by || currentUser?.loginId || "Director").trim(),
      imported: true,
    };
    loan.recoveries = Array.isArray(loan.recoveries) ? loan.recoveries : [];
    const signatures = new Set(loan.recoveries.map(recoveryImportSignature));
    if (signatures.has(recoveryImportSignature(recovery))) {
      skipped += 1;
      return;
    }
    loan.recoveries.push(recovery);
    if (!individual.legacyBalanceImported) {
      individual.balance = type === "closing" ? 0 : Math.max(0, Number(individual.balance || individual.amount || 0) - recovery.principalPaid);
      if (type === "closing") {
        individual.closedAt = recovery.enteredAt;
        individual.closedBy = recovery.enteredByName;
      }
    }
    affected.set(loan.id || loan.groupNumber, { loan, group });
    recoveriesAdded += 1;
  });
  affected.forEach(({ loan, group }) => syncLoanOutstanding(loan, group));
  return { groupsAdded: 0, loansAdded: 0, recoveriesAdded, customersAdded: 0, skipped };
}

function mergeBackupOldData(payload) {
  let groupsAdded = 0;
  let loansAdded = 0;
  let recoveriesAdded = 0;
  let skipped = 0;
  (Array.isArray(payload?.groups) ? payload.groups : []).forEach((sourceGroup, index) => {
    const number = importGroupNumber(sourceGroup.number);
    if (findImportGroup(number, sourceGroup.code)) {
      skipped += 1;
      return;
    }
    const imported = cloneImportValue(sourceGroup);
    imported.code = imported.code || `OLD-GROUP-${Date.now()}-${index}`;
    imported.number = number || imported.number;
    imported.members = Array.isArray(imported.members) ? imported.members : [];
    imported.importedAt = new Date().toISOString();
    imported.importedBy = currentUser?.loginId || "Director";
    groups.push(imported);
    groupsAdded += 1;
  });
  (Array.isArray(payload?.loans) ? payload.loans : []).forEach((sourceLoan, index) => {
    const targetGroup = findImportGroup(sourceLoan.groupNumber, sourceLoan.groupCode || sourceLoan.code);
    if (!targetGroup) {
      skipped += 1;
      return;
    }
    const existing = findImportLoan(targetGroup.number, targetGroup.code);
    const sourceRecoveries = Array.isArray(sourceLoan.recoveries) ? sourceLoan.recoveries : [];
    if (!existing) {
      const imported = cloneImportValue(sourceLoan);
      imported.id = imported.id || `OLD-LOAN-${Date.now()}-${index}`;
      imported.groupCode = targetGroup.code;
      imported.code = targetGroup.code;
      imported.groupNumber = targetGroup.number || importGroupNumber(sourceLoan.groupNumber);
      imported.groupName = targetGroup.name || sourceLoan.groupName;
      imported.individualLoans = Array.isArray(imported.individualLoans) ? imported.individualLoans : [];
      imported.recoveries = sourceRecoveries;
      imported.importedAt = new Date().toISOString();
      imported.importedBy = currentUser?.loginId || "Director";
      loans.push(imported);
      loansAdded += 1;
      recoveriesAdded += sourceRecoveries.length;
      return;
    }
    existing.recoveries = Array.isArray(existing.recoveries) ? existing.recoveries : [];
    const signatures = new Set(existing.recoveries.map(recoveryImportSignature));
    sourceRecoveries.forEach((recovery) => {
      if (signatures.has(recoveryImportSignature(recovery))) {
        skipped += 1;
        return;
      }
      existing.recoveries.push(cloneImportValue(recovery));
      signatures.add(recoveryImportSignature(recovery));
      recoveriesAdded += 1;
    });
  });
  if (Array.isArray(payload?.recoveries)) {
    const topLevel = importRecoveryRows(payload.recoveries);
    recoveriesAdded += topLevel.recoveriesAdded;
    skipped += topLevel.skipped;
  }
  return { groupsAdded, loansAdded, recoveriesAdded, customersAdded: 0, skipped };
}

function oldDataImportSummary(result) {
  return `${result.groupsAdded || 0} groups · ${result.loansAdded || 0} loans · ${result.recoveriesAdded || 0} recoveries · ${result.customersAdded || 0} customers${result.skipped ? ` · ${result.skipped} skipped` : ""}`;
}

function renderOldDataImportPreview() {
  const preview = $("#oldDataPreview");
  const commitButton = $("#commitOldData");
  if (!preview || !commitButton) return;
  if (!stagedOldDataImport) {
    preview.innerHTML = '<p class="empty">Select a file and preview it before importing.</p>';
    commitButton.disabled = true;
    return;
  }
  const staged = stagedOldDataImport;
  const labels = { auto: "NEELAVATI JSON backup", verification: "Verification CSV", loan: "Loan CSV", recovery: "Recovery CSV" };
  preview.innerHTML = `<div class="old-data-preview-head"><div><span>${escapeHtml(labels[staged.kind] || staged.kind)}</span><b>${escapeHtml(staged.fileName)}</b></div><strong>${staged.errors.length ? "Needs correction" : "Ready to import"}</strong></div><div class="old-data-preview-counts"><div><span>Rows</span><b>${Number(staged.counts.rows || 0)}</b></div><div><span>Groups</span><b>${Number(staged.counts.groups || 0)}</b></div><div><span>Loans</span><b>${Number(staged.counts.loans || 0)}</b></div><div><span>Recoveries</span><b>${Number(staged.counts.recoveries || 0)}</b></div><div><span>Customers</span><b>${Number(staged.counts.customers || 0)}</b></div></div>${staged.errors.length ? `<div class="import-messages error"><b>Cannot import</b>${staged.errors.map((message) => `<span>${escapeHtml(message)}</span>`).join("")}</div>` : ""}${staged.warnings.length ? `<div class="import-messages warning"><b>Notes</b>${staged.warnings.map((message) => `<span>${escapeHtml(message)}</span>`).join("")}</div>` : ""}`;
  commitButton.disabled = staged.errors.length > 0;
}

function renderOldDataImport() {
  if (!$("#oldDataCurrentGroups")) return;
  $("#oldDataCurrentGroups").textContent = String(groups.length);
  $("#oldDataCurrentLoans").textContent = String(loans.length);
  $("#oldDataCurrentRecoveries").textContent = String(loans.reduce((sum, loan) => sum + (loan.recoveries || []).length, 0));
  $("#oldDataHistoryRows").innerHTML = oldDataImportHistory.length
    ? oldDataImportHistory.slice(0, 25).map((entry) => `<tr><td>${escapeHtml(entry.date || "—")}</td><td><b>${escapeHtml(entry.fileName || "Old data")}</b></td><td>${escapeHtml(entry.kind || "—")}</td><td>${escapeHtml(entry.summary || "—")}</td><td>${escapeHtml(entry.importedBy || "Director")}</td></tr>`).join("")
    : '<tr><td colspan="5" class="empty">No old data imports recorded.</td></tr>';
  renderOldDataImportPreview();
}

async function previewOldDataFile() {
  if (!canImportOldData()) {
    toast("Only the Director can upload old data.");
    return;
  }
  const file = $("#oldDataFile").files?.[0];
  if (!file) {
    toast("Select a JSON or CSV file first.");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("The import file is larger than 25 MB. Split it into smaller files.");
    return;
  }
  let kind = $("#oldDataType").value;
  if (kind === "auto" && !file.name.toLowerCase().endsWith(".json")) {
    toast("Select the correct CSV data type before previewing this file.");
    return;
  }
  try {
    stagedOldDataImport = prepareOldDataImport(kind, await file.text(), file.name);
    renderOldDataImportPreview();
    toast(stagedOldDataImport.errors.length ? "File preview found errors. Correct the file and try again." : "File verified. Review the preview before importing.");
  } catch (error) {
    console.error("Unable to preview old data", error);
    stagedOldDataImport = null;
    renderOldDataImportPreview();
    toast("This old data file could not be read.");
  }
}

function clearOldDataPreview() {
  stagedOldDataImport = null;
  $("#oldDataFile").value = "";
  renderOldDataImportPreview();
}

function commitOldDataImport() {
  if (!canImportOldData()) {
    toast("Only the Director can upload old data.");
    return;
  }
  if (!stagedOldDataImport || stagedOldDataImport.errors.length) {
    toast("Preview and verify a valid import file first.");
    return;
  }
  if (!window.confirm(`Import ${stagedOldDataImport.fileName}? Existing group and loan details will not be overwritten.`)) return;
  const snapshot = {
    groups: cloneImportValue(groups),
    loans: cloneImportValue(loans),
    history: cloneImportValue(oldDataImportHistory),
  };
  try {
    const result = stagedOldDataImport.kind === "auto"
      ? mergeBackupOldData(stagedOldDataImport.payload)
      : stagedOldDataImport.kind === "verification"
        ? importVerificationRows(stagedOldDataImport.rows)
        : stagedOldDataImport.kind === "loan"
          ? importLoanRows(stagedOldDataImport.rows)
          : importRecoveryRows(stagedOldDataImport.rows);
    oldDataImportHistory.unshift({
      id: `IMPORT-${Date.now()}`,
      date: new Date().toLocaleString("en-IN"),
      fileName: stagedOldDataImport.fileName,
      kind: stagedOldDataImport.kind,
      summary: oldDataImportSummary(result),
      importedBy: currentUser?.name || currentUser?.loginId || "Director",
    });
    if (!persistAll()) throw new Error("Unable to persist imported records");
    const summary = oldDataImportSummary(result);
    stagedOldDataImport = null;
    $("#oldDataFile").value = "";
    renderAll();
    addActivity(`Old data imported · ${summary}`);
    toast(`Old data import complete: ${summary}.`);
  } catch (error) {
    console.error("Old data import failed", error);
    groups = snapshot.groups;
    loans = snapshot.loans;
    oldDataImportHistory = snapshot.history;
    persistAll();
    renderAll();
    toast("Import failed. Your existing records were restored safely.");
  }
}

const OLD_DATA_CSV_TEMPLATES = {
  verification: "group_number,centre_name,centre_address,recovery_day,recovery_time,loaning_staff,recovery_staff,customer_name,customer_aadhaar,address,date_of_birth,mobile,occupation,income,guarantor_name,guarantor_aadhaar,guarantor_date_of_birth,loan_purpose,requested_loan_amount,status\nG1,OLD CENTRE,Old centre address,Monday,10:00,Loan Staff,Recovery Staff,Customer Name,123412341234,Customer address,01/01/1985,9999999999,Business,15000,Guarantor Name,432143214321,01/01/1980,Business,12000,Approved",
  loan: "group_number,customer_name,loan_amount,weeks,weekly_emi,balance,hold_amount,hold_balance,processing_fee,loan_sanction_date,disbursement_date,recovery_day,recovery_start_week,recovery_staff\nG1,Customer Name,12000,26,600,9000,2000,0,600,01/04/2024,01/04/2024,Monday,next,Recovery Staff",
  recovery: "group_number,customer_name,date,demand_date,type,amount,penalty_paid,receipt,staff_name,staff_login,approved_by,review\nG1,Customer Name,08/04/2024,08/04/2024,recovery,600,0,R-001,Recovery Staff,staff-01,Director,Old recovery imported",
};

function downloadOldDataTemplate(kind) {
  if (!canImportOldData() || !OLD_DATA_CSV_TEMPLATES[kind]) return;
  const url = URL.createObjectURL(new Blob([OLD_DATA_CSV_TEMPLATES[kind]], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `NEELAVATI-Old-Data-${kind}-template.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderAll() {
  assessOverduePenalties();
  renderMyWorking();
  renderOverview();
  renderGroups();
  renderLoans();
  renderRecovery();
  renderTeamMonthlyTarget();
  renderRecoveryApprovals();
  renderHoldLoans();
  renderCashbook();
  renderCalendar();
  renderSalaryManagement();
  renderSalaryBook();
  renderEmployees();
  updateEmployeeManagementView();
  if (role() === "Director" && selectedEmployeeManagementView === "working") renderDirectorTeamWorking();
  if (role() === "Director" && selectedEmployeeManagementView === "attendance") renderDirectorTeamAttendance();
}

async function compressPhoto(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const item = new Image();
    item.onload = () => resolve(item);
    item.onerror = reject;
    item.src = dataUrl;
  });
  const max = 640;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const loginId = $("#loginId").value.trim().toLowerCase();
    const password = $("#password").value;
    const submit = $("#loginForm button[type='submit']");
    submit.disabled = true;
    let account = null;
    try {
      const secureServerAvailable = Boolean(window.NeelavatiApi) && await window.NeelavatiApi.isAvailable();
      if (secureServerAvailable) {
        const authenticated = await window.NeelavatiApi.login(loginId, password);
        const remoteState = await window.NeelavatiApi.loadState();
        backendMode = true;
        applyBackendState(remoteState);
        account = {
          ...authenticated.user,
          ...(remoteState.incentiveProfile?.loginId === authenticated.user.loginId
            ? { incentive: Math.max(0, Number(remoteState.incentiveProfile.incentive || 0)) }
            : {}),
          ...(remoteState.workingProfile?.loginId === authenticated.user.loginId
            ? {
                salary: Math.max(0, Number(remoteState.workingProfile.salary || 0)),
                petrolAllowance: Math.max(0, Number(remoteState.workingProfile.recoveryAllowance || 0)),
                businessAllowance: Math.max(0, Number(remoteState.workingProfile.businessAllowance || 0)),
                incentive: Math.max(0, Number(remoteState.workingProfile.incentive || 0)),
                recurringDeposit: Math.max(0, Number(remoteState.workingProfile.recurringDeposit || 0)),
                recurringDepositStartedAt: String(remoteState.workingProfile.recurringDepositStartedAt || ""),
              }
            : {}),
        };
      } else {
        if (!staticDemoLoginAllowed()) {
          toast("Secure server is unavailable. Login was blocked to protect banking data.");
          return;
        }
        account = employeeAccounts.find(
          (item) =>
            item.active !== false &&
            String(item.loginId || "").toLowerCase() === loginId &&
            String(item.password || "") === password
        );
        if (!account) {
          toast("Login ID or password is incorrect.");
          return;
        }
      }
    } catch (error) {
      toast(error?.message || "Secure login failed.");
      return;
    } finally {
      submit.disabled = false;
    }
    currentUser = account;
    if (account.designation === "Staff") selectedRecoveryStaff = account.name;
    if (account.designation === "Assistant Manager") selectedRecoveryStaff = "all";
    if (!backendMode) {
      account.lastActive = new Date().toLocaleString("en-IN");
      persistAll();
    }
    $("#userName").textContent = account.name;
    $("#userRole").textContent = account.designation;
    $("#avatar").textContent = account.name[0].toUpperCase();
    $("#loginView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    updateNavigation();
    populateStaffSelects();
    showPage(firstPageForRole(account.designation));
    toast(`Welcome, ${account.name}.`);
  });

  $("#showPassword").addEventListener("click", () => {
    $("#password").type = $("#password").type === "password" ? "text" : "password";
  });
  $("#logout").addEventListener("click", async () => {
    if (backendMode && window.NeelavatiApi) {
      try { await window.NeelavatiApi.logout(); } catch { /* The session still expires server-side. */ }
    }
    location.reload();
  });
  $$(".nav").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.go)));
  $("#monthlyProcessingCard").addEventListener("click", toggleMonthlyProcessingDetails);
  $("#monthlyProcessingCard").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    toggleMonthlyProcessingDetails();
  });
  $("#closeMonthlyProcessingDetails").addEventListener("click", () => setMonthlyProcessingDetailsOpen(false));
  $$("[data-close]").forEach((button) =>
    button.addEventListener("click", () => $(`#${button.dataset.close}`)?.classList.add("hidden"))
  );

  $("#newVerification").addEventListener("click", newVerification);
  $("#addMember").addEventListener("click", () => {
    if ($("#members").children.length >= 9) {
      toast("A group can contain a maximum of 9 customers.");
      return;
    }
    $("#members").append(memberNode());
    updateMemberLabels();
  });
  $("#members").addEventListener("click", (event) => {
    const member = event.target.closest(".member");
    if (!member) return;
    if (event.target.matches(".remove-member")) {
      if ($("#members").children.length <= 5) {
        toast("A group must keep at least 5 customer slots.");
        return;
      }
      member.remove();
      updateMemberLabels();
    }
    if (event.target.matches(".decision-btn")) {
      if (!canDecideVerification()) {
        toast("Only Director and Manager can approve or cancel customers.");
        return;
      }
      if (
        event.target.classList.contains("approve") &&
        !memberHasCompleteAadhaar({
          uuid: member.querySelector(".m-uuid")?.value,
          guarantorAadhaar: member.querySelector(".m-guarantor-aadhaar")?.value,
        })
      ) {
        toast("Customer and guarantor दोनों के valid 12-digit Aadhaar approval के लिए mandatory हैं.");
        return;
      }
      updateMemberNpaStatus(member);
      if (member.dataset.npaBlocked === "true") {
        toast("NPA blocked: customer or guarantor Aadhaar cannot be approved for a loan.");
        return;
      }
      member.querySelectorAll(".decision-btn").forEach((button) => button.classList.remove("selected"));
      event.target.classList.add("selected");
      member.dataset.status = event.target.classList.contains("approve") ? "Approved" : "Cancelled";
      member.querySelector(".decision-status").textContent = member.dataset.status;
    }
    if (event.target.matches(".location")) {
      const label = member.querySelector(".location-status");
      if (!navigator.geolocation) {
        label.textContent = "Location is unavailable";
        return;
      }
      label.textContent = "Capturing location…";
      navigator.geolocation.getCurrentPosition(
        (position) => {
          member.dataset.location = JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            capturedAt: new Date().toISOString(),
          });
          label.textContent = "Location captured ✓";
        },
        () => {
          label.textContent = "Location permission denied";
        }
      );
    }
  });
  $("#members").addEventListener("input", (event) => {
    if (!event.target.matches(".m-uuid, .m-guarantor-aadhaar")) return;
    updateMemberNpaStatus(event.target.closest(".member"), true);
    applyVerificationPermissions();
  });
  $("#members").addEventListener(
    "change",
    async (event) => {
      if (!event.target.matches(".m-photo")) return;
      event.stopImmediatePropagation();
      const file = event.target.files?.[0];
      if (!file) return;
      const member = event.target.closest(".member");
      try {
        member.dataset.photoData = await compressPhoto(file);
        renderVerificationPhoto(member);
        toast("Customer photo compressed and added.");
      } catch {
        toast("Unable to read this photo.");
      }
    },
    true
  );
  $("#saveGroup").addEventListener("click", saveGroup);
  $("#groupSearch").addEventListener("input", renderGroups);

  $("#newLoan").addEventListener("click", openNewLoan);
  $("#saveLoan").addEventListener("click", saveLoan);
  $("#loanDay").addEventListener("change", updateLoanFirstRecoveryPreview);
  $("#loanRecoveryStart").addEventListener("change", updateLoanFirstRecoveryPreview);
  $("#loanFirstRecoveryDate").addEventListener("change", () => {
    if (!canBackdateOperationalEntries() || $("#loanRecoveryStart").value !== "custom") return;
    const selectedDay = weekdayForIsoDate($("#loanFirstRecoveryDate").value);
    if (!DAYS.includes(selectedDay)) {
      toast("Recovery cannot start on Sunday. Select Monday to Saturday.");
      return;
    }
    $("#loanDay").value = selectedDay;
    $("#loanSanctionDate").max = $("#loanFirstRecoveryDate").value;
    if (!isValidIsoDate($("#loanSanctionDate").value) || $("#loanSanctionDate").value > $("#loanFirstRecoveryDate").value) {
      $("#loanSanctionDate").value = addCalendarDays($("#loanFirstRecoveryDate").value, -7);
    }
  });
  $("#loanSearch").addEventListener("input", renderLoans);
  $("#saveRecoveryEntry").addEventListener("click", saveRecoveryEntry);
  $("#entryAmount").addEventListener("input", updateClosingAuthorization);
  $("#entryPenalty").addEventListener("input", () => {
    const form = $("#recoveryEntry");
    if (form.dataset.type === "closing") {
      const loan = loans[Number(form.dataset.loan)];
      const individual = loan?.individualLoans?.find((item) => item.memberIndex === Number(form.dataset.member));
      if (individual) $("#entryAmount").value = String(customerTotalBalance(individual) + Math.max(0, Number($("#entryPenalty").value || 0)));
    }
    updateClosingAuthorization();
  });
  $("#recoveryRows").addEventListener("input", (event) => {
    const penaltyInput = event.target.closest("[data-inline-penalty]");
    if (!penaltyInput) return;
    const loanIndex = Number(penaltyInput.dataset.inlineLoan);
    const memberIndex = Number(penaltyInput.dataset.inlineMember);
    const loan = loans[loanIndex];
    const individual = loan?.individualLoans?.find((item) => item.memberIndex === memberIndex);
    const closingInput = document.querySelector(
      `[data-inline-loan="${loanIndex}"][data-inline-member="${memberIndex}"][data-inline-type="closing"]`
    );
    if (individual && closingInput) {
      closingInput.value = String(Math.round(customerTotalBalance(individual) + Math.max(0, Number(penaltyInput.value || 0))));
    }
  });
  $("#recoveryRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-reassign-recovery-staff]");
    if (!button) return;
    const loanIndex = Number(button.dataset.reassignRecoveryStaff);
    const select = document.querySelector(`[data-recovery-staff-select="${loanIndex}"]`);
    reassignRecoveryStaff(loanIndex, select?.value || "");
  });
  $("#quickRecoveryPhoto").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const loanIndex = Number(event.target.dataset.loan);
    const memberIndex = Number(event.target.dataset.member);
    if (!file || !Number.isFinite(loanIndex) || !Number.isFinite(memberIndex)) return;
    try {
      const photoData = await compressPhoto(file);
      stagedRecoveryPhotos.set(recoveryPhotoKey(loanIndex, memberIndex), photoData);
      const photoOption = document.querySelector(
        `[data-photo-loan="${loanIndex}"][data-photo-member="${memberIndex}"]`
      );
      if (photoOption) {
        const button = photoOption.querySelector("button");
        const note = photoOption.querySelector("small");
        if (button) button.textContent = "5. Photo ready";
        if (note) note.textContent = "Photo attached for this entry";
      }
      toast("Collection photo ready. Enter the amount in this customer row and select Update.");
    } catch {
      toast("Unable to read this collection photo.");
    }
  });
  $("#entryPhotoInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const photoData = await compressPhoto(file);
      setRecoveryEntryPhoto(photoData);
      const loanIndex = Number($("#recoveryEntry").dataset.loan);
      const memberIndex = Number($("#recoveryEntry").dataset.member);
      if (canProposeRecovery()) stagedRecoveryPhotos.set(recoveryPhotoKey(loanIndex, memberIndex), photoData);
      toast("Collection photo attached.");
    } catch {
      toast("Unable to read this collection photo.");
    }
  });

  $("#recoveryRiskFolders").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-recovery-folder-toggle]");
    if (toggle) toggleRecoveryFolder(toggle.dataset.recoveryFolderToggle);
  });

  DAYS.forEach((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = day;
    button.className = day === selectedDay ? "active" : "";
    button.addEventListener("click", () => {
      if (canProposeRecovery() && day !== todayWeekday()) {
        toast("Staff can view only today's recovery demand.");
        renderRecovery();
        return;
      }
      selectedDay = day;
      selectedRecoveryLoanIndex = null;
      $("#recoveryEntry").classList.add("hidden");
      $$("#dayTabs button").forEach((item) => item.classList.toggle("active", item.textContent === day));
      renderRecovery();
    });
    $("#dayTabs").append(button);
  });
  $("#recoveryStaffList").addEventListener("click", (event) => {
    const excelButton = event.target.closest("[data-download-recovery-staff]");
    if (excelButton) {
      downloadRecoveryDemand(excelButton.dataset.downloadRecoveryStaff, excelButton);
      return;
    }
    const button = event.target.closest("[data-recovery-staff]");
    if (!button) return;
    selectedRecoveryStaff = button.dataset.recoveryStaff || "all";
    selectedRecoveryLoanIndex = null;
    $("#recoveryEntry").classList.add("hidden");
    renderRecovery();
  });
  $("#holdSearch").addEventListener("input", renderHoldLoans);
  $("#saveHoldEntry").addEventListener("click", saveHoldEntry);
  $("#daybookSheets").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-daybook-entry]");
    if (editButton) {
      directorEditDaybookEntry(editButton.dataset.editDaybookEntry);
      return;
    }
    if (event.target.closest("[data-open-cash-intake]")) {
      openCashIntake();
      return;
    }
    if (event.target.closest("[data-open-debit-voucher]")) openDebitVoucher();
  });
  $("#saveCash").addEventListener("click", saveCashEntry);
  $("#saveDebitVoucher").addEventListener("click", saveDebitVoucher);
  $("#previousCalendarMonth").addEventListener("click", () => changeCalendarMonth(-1));
  $("#nextCalendarMonth").addEventListener("click", () => changeCalendarMonth(1));
  $("#calendarGrid").addEventListener("click", (event) => {
    const day = event.target.closest("[data-calendar-date]");
    if (day) selectCalendarDate(day.dataset.calendarDate);
  });
  $("#holidayDate").addEventListener("change", (event) => selectCalendarDate(event.target.value));
  $("#saveHoliday").addEventListener("click", saveHoliday);
  $("#teamTargetMonth").addEventListener("change", (event) => {
    teamTargetMonth = String(event.target.value || todayIso().slice(0, 7));
    renderTeamMonthlyTarget();
  });
  $("#addEmployee").addEventListener("click", openEmployeeForm);
  $("#employeeDesignation").addEventListener("change", updateEmployeeEmploymentFields);
  $("#saveEmployee").addEventListener("click", saveEmployee);
  $$("[data-employee-view]").forEach((button) => button.addEventListener("click", () => setEmployeeManagementView(button.dataset.employeeView)));
  $("#salaryBookMonth")?.addEventListener("change", (event) => {
    const nextMonth = String(event.target.value || "");
    const currentMonth = todayIso().slice(0, 7);
    salaryBookMonth = validYearMonth(nextMonth) && nextMonth <= currentMonth ? nextMonth : currentMonth;
    renderSalaryBook();
  });
}

window.editGroup = editGroup;
window.viewGroup = viewGroup;
window.closeGroupFolder = closeGroupFolder;
window.deleteVerificationGroup = deleteVerificationGroup;
window.viewCustomer = viewCustomer;
window.openLoanFolder = openLoanFolder;
window.editLoanRecord = editLoanRecord;
window.deleteLoanRecord = deleteLoanRecord;
window.completeHistoricalLoanEntries = completeHistoricalLoanEntries;
window.setLoanHistoryRecoveryDate = setLoanHistoryRecoveryDate;
window.saveHistoricalRecovery = saveHistoricalRecovery;
window.openRecoveryCentre = openRecoveryCentre;
window.openRecoveryFolderAccount = openRecoveryFolderAccount;
window.closeRecoveryCentre = closeRecoveryCentre;
window.toggleRecoveryCentre = toggleRecoveryCentre;
window.assignRecoveryStaffFromRegister = assignRecoveryStaffFromRegister;
window.saveInlineRecovery = saveInlineRecovery;
window.saveInlinePenalty = saveInlinePenalty;
window.stageRecoveryPhoto = stageRecoveryPhoto;
window.approveRecoveryProposal = approveRecoveryProposal;
window.approveRecoveryProposalGroup = approveRecoveryProposalGroup;
window.editRecoveryProposal = editRecoveryProposal;
window.directorEditApprovedRecovery = directorEditApprovedRecovery;
window.openHoldEntry = openHoldEntry;
window.editHoldTransaction = editHoldTransaction;
window.directorEditDaybookEntry = directorEditDaybookEntry;
window.setDirectorRecoveryEntryDate = setDirectorRecoveryEntryDate;
window.removeHoliday = removeHoliday;
window.removeEmployee = removeEmployee;
window.changeWorkingCalendarMonth = changeWorkingCalendarMonth;
window.saveAttendance = saveAttendance;
window.assignStaffToAssistantManager = assignStaffToAssistantManager;
window.saveTeamIncentive = saveTeamIncentive;
window.saveRecurringDeposit = saveRecurringDeposit;
window.editTeamIncentive = editTeamIncentive;
window.selectEmployeeTeamFolder = selectEmployeeTeamFolder;
window.downloadGroupSchedule = downloadGroupSchedule;
window.downloadCustomerSchedule = downloadCustomerSchedule;

ensureEmployeeManagementViews();
installCspSafeActions();
bindEvents();
populateStaffSelects();

