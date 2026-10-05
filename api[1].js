(function createNeelavatiApi(global) {
  let csrfToken = "";
  let currentUser = null;
  let availability;

  async function request(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (csrfToken && !["GET", "HEAD"].includes(String(options.method || "GET").toUpperCase())) {
      headers["X-CSRF-Token"] = csrfToken;
    }
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = payload.error || "request_failed";
      error.details = payload.details;
      throw error;
    }
    return payload;
  }

  async function isAvailable() {
    if (location.protocol === "file:") return false;
    if (!availability) {
      availability = Promise.race([
        request("/api/health").then((result) => result?.service === "neelavati-secure-backend").catch(() => false),
        new Promise((resolve) => setTimeout(() => resolve(false), 1800)),
      ]);
    }
    return availability;
  }

  async function login(loginId, password) {
    const result = await request("/api/auth/login", { method: "POST", body: { loginId, password } });
    csrfToken = result.csrfToken;
    currentUser = result.user;
    return result;
  }

  async function logout() {
    try { await request("/api/auth/logout", { method: "POST", body: {} }); } finally {
      csrfToken = "";
      currentUser = null;
    }
  }

  async function loadState() {
    return request("/api/state");
  }

  async function saveState(data, baseVersion) {
    return request("/api/state", { method: "PUT", body: { data, baseVersion } });
  }

  async function listUsers() {
    return (await request("/api/users")).users;
  }

  async function createUser(input) {
    return (await request("/api/users", { method: "POST", body: input })).user;
  }

  async function removeUser(id) {
    return request(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE", body: {} });
  }

  async function assignStaffAssistantManager(id, assistantManagerLoginId) {
    return request(`/api/users/${encodeURIComponent(id)}/assistant-manager`, {
      method: "PATCH",
      body: { assistantManagerLoginId },
    });
  }

  async function updateTeamIncentive(id, incentive) {
    return request(`/api/users/${encodeURIComponent(id)}/team-incentive`, {
      method: "PATCH",
      body: { incentive },
    });
  }

  async function updateRecurringDeposit(id, recurringDeposit) {
    return request(`/api/users/${encodeURIComponent(id)}/recurring-deposit`, {
      method: "PATCH",
      body: { recurringDeposit },
    });
  }

  async function reassignRecoveryStaff(loanId, staffLoginId) {
    return request(`/api/loans/${encodeURIComponent(loanId)}/recovery-staff`, {
      method: "PATCH",
      body: { staffLoginId },
    });
  }

  global.NeelavatiApi = {
    isAvailable,
    login,
    logout,
    loadState,
    saveState,
    listUsers,
    createUser,
    removeUser,
    assignStaffAssistantManager,
    updateTeamIncentive,
    updateRecurringDeposit,
    reassignRecoveryStaff,
    get currentUser() { return currentUser; },
  };
})(window);
