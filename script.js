/* =========================================================
   API HELPER
   Every page's data comes from here — no localStorage fallback.
   If the API call fails, the caller sees a real error instead
   of silently getting fake data.
========================================================= */

const API_BASE = "./api";

/* =========================================================
   STORAGE HELPERS
   Thin wrappers used by login.html and friends for the small
   pieces of state that still live client-side (session, sign-out
   reason) even though asset data itself now comes from the API.
========================================================= */
function displayLocation(location) {
    return location ? location : "Storage";
}


function storageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function storageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        /* nothing to clean up if storage isn't available */
    }
}

function warnIfStorageBlocked() {
    try {
        const key = "tracepointStorageCheck";
        localStorage.setItem(key, "ok");
        localStorage.removeItem(key);
    } catch (error) {
        const message = document.getElementById("loginError");
        if (message) {
            message.textContent = "Browser storage is blocked. Enable storage to sign in.";
            message.hidden = false;
        }
    }
}

async function apiFetch(path, options = {}) {

    const token = localStorage.getItem("token");

    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    });

    const body = await response.json().catch(() => ({}));

    if (response.status === 401) {
        storageRemove("token");
        storageRemove("tracepointCurrentUser");
        if (!window.location.pathname.endsWith("login.html") && path !== "/auth/login") {
            window.location.href = "login.html";
        }
        throw new Error(body.message || "Session expired. Please sign in again.");
    }

    if (!response.ok) {
        throw new Error(body.message || "Something went wrong.");
    }

    return body;
}


/* =========================================================
   SYSTEM ROLES
========================================================= */

const ROLES = {
    TECHNICIAN: "Field Technician",
    SUPERVISOR: "Maintenance Supervisor",
    ADMIN: "IT / Systems Administrator"
};

const ALL_ROLES = [ROLES.TECHNICIAN, ROLES.SUPERVISOR, ROLES.ADMIN];


/* =========================================================
   ROLE PERMISSIONS
========================================================= */

const PERMISSIONS = {

    [ROLES.TECHNICIAN]: [
        "dashboard",
        "kiosks",
        "kioskDetail",
        "components",
        "componentDetail",
        "moveComponent",
        "faults",
        "alerts"
    ],

    [ROLES.SUPERVISOR]: [
        "dashboard",
        "kiosks",
        "kioskDetail",
        "components",
        "componentDetail",
        "moveComponent",
        "faults",
        "alerts",
        "reports"
    ],

    [ROLES.ADMIN]: [
        "dashboard",
        "kiosks",
        "kioskDetail",
        "components",
        "componentDetail",
        "moveComponent",
        "faults",
        "alerts",
        "reports",
        "users",
        "auditLog"
    ]

};


/* =========================================================
   PAGE LABELS
    Human-readable names for the permission keys above.
========================================================= */

const PAGE_LABELS = {
    dashboard: "Dashboard",
    kiosks: "Kiosks",
    components: "Components",
    moveComponent: "Log an Event",
    faults: "Fault History",
    alerts: "Alerts",
    reports: "Reports",
    users: "Users",
    auditLog: "Audit Log"
};

const ROLE_SUMMARY = {
    [ROLES.TECHNICIAN]: "Record component events and faults, and review assigned kiosks and components.",
    [ROLES.SUPERVISOR]: "Review operational reports and audit activity in addition to technician workflows.",
    [ROLES.ADMIN]: "Manage user accounts and privileges, and access every operational page."
};

function permissionDiff(currentRole, nextRole) {
    const currentPages = new Set(PERMISSIONS[currentRole] || []);
    const nextPages = new Set(PERMISSIONS[nextRole] || []);
    return {
        gained: [...nextPages].filter(page => !currentPages.has(page)).map(page => PAGE_LABELS[page]),
        lost: [...currentPages].filter(page => !nextPages.has(page)).map(page => PAGE_LABELS[page])
    };
}


/* =========================================================
   ASSET DATA — all from the real API now. Every function here
   is async and returns a Promise; callers must await it.
   Nothing in this section touches localStorage.
========================================================= */

async function getKiosks(params = {}) {
    const query = new URLSearchParams(params);
    return apiFetch(`/kiosks?${query}`);
}

async function getKiosk(id, params = {}) {
    const query = new URLSearchParams(params);
    const suffix = query.toString();
    return apiFetch(`/kiosks/${id}${suffix ? `?${suffix}` : ""}`);
}

async function getComponents(params = {}) {
    const query = new URLSearchParams(params);
    return apiFetch(`/components?${query}`);
}

async function getComponent(id, params = {}) {
    const query = new URLSearchParams(params);
    const suffix = query.toString();
    return apiFetch(`/components/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ""}`);
}

async function componentsAtKiosk(kioskId) {
    const { components } = await getKiosk(kioskId);
    return components;
}

async function faultsFor({ componentId, kioskId }) {
    const query = new URLSearchParams(
        componentId ? { component_id: componentId } : { kiosk_id: kioskId }
    );
    return apiFetch(`/faults?${query}`);
}

async function logFault({ componentId, kioskId, severity, description }) {
    try {
        const fault = await apiFetch("/faults", {
            method: "POST",
            body: JSON.stringify({
                component_id: componentId || null,
                kiosk_id: kioskId || null,
                severity,
                description
            })
        });
        return { success: true, fault };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

async function getUsers() {
    const users = await apiFetch("/users");
    return users.map(user => ({
        ...user,
        role: user.role === "IT/Systems Administrator" ? ROLES.ADMIN : user.role
    }));
}

function apiRole(role) {
    return role === ROLES.ADMIN ? "IT/Systems Administrator" : role;
}

async function getAuditLogs(params = {}) {
    const query = new URLSearchParams(params);
    return apiFetch(`/audit-logs?${query}`);
}

async function getAllPages(path, params = {}) {
    const rows = [];
    let page = 1;
    let totalPages = 1;

    do {
        const query = new URLSearchParams({ ...params, page, limit: 100 });
        const result = await apiFetch(`${path}?${query}`);
        if (!Array.isArray(result.data)) {
            throw new Error("The server returned an unexpected list response.");
        }
        rows.push(...result.data);
        totalPages = result.totalPages;
        page += 1;
    } while (page <= totalPages);

    return rows;
}

function downloadCsv(filename, headers, rows) {
    const csvValue = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers, ...rows]
        .map(row => row.map(csvValue).join(","))
        .join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function activeAdminCount() {
    // Still reads the local demo user list — real admin-count checks
    // (e.g. "can't disable the last admin") move server-side once
    // /api/users is backed by real accounts instead of the stub.
    const users = JSON.parse(localStorage.getItem("tracepointUsers")) || [];
    return users.filter(user => user.role === ROLES.ADMIN && user.status === "Active").length;
}

function isAdmin() {
    const user = getCurrentUser();
    return Boolean(user && user.role === ROLES.ADMIN);
}

function initialsOf(name) {
    return String(name || "User")
        .trim()
        .split(/\s+/)
        .map(part => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function statusPill(status) {
    const value = String(status || "Unknown");
    const tone = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `<span class="pill pill-${tone}">${escapeHtml(value)}</span>`;
}

function severityPill(severity) {
    const value = String(severity || "Unknown");
    const tone = value.toLowerCase();
    return `<span class="pill pill-${tone}">${escapeHtml(value)}</span>`;
}

function warrantyDaysLeft(component) {
    const expiry = component?.warranty_expires_on || component?.warrantyEnds;
    if (!expiry) return null;
    return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
}

function expectedLifeDaysLeft(component) {
    const months = Number(component?.expected_life_months || component?.expectedLifeMonths);
    const startedAt = component?.service_life_started_at || component?.created_at || component?.createdAt;
    if (!Number.isFinite(months) || months <= 0 || !startedAt) return null;

    const end = new Date(startedAt);
    end.setMonth(end.getMonth() + months);
    return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

function warrantyLabel(component) {
    const days = warrantyDaysLeft(component);
    if (days === null) return "Not set";
    if (days < 0) return "Expired";
    return `${days} days left`;
}

function formatDate(value) {
    if (!value) return "Not set";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value) {
    if (!value) return "Not set";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value));
}

function timeAgo(value) {
    if (!value) return "Unknown";
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function openFaultCount() {
    return getFaults().filter(fault => fault.status !== "Resolved").length;
}

function computeAlerts() {
    return [];
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function locationLabel(location) {
    if (!location || location === STORAGE_LOCATION) return "Storage";

    const kiosk = getKiosks().find(item => item.id === location);
    return kiosk ? `${kiosk.id} — ${kiosk.location}` : location;
}

function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
}

function emptyRow(columnCount, message, action = "") {
    return `<tr><td colspan="${columnCount}" class="empty-state">${escapeHtml(message)} ${action}</td></tr>`;
}


/* =========================================================
   SESSION
========================================================= */

function getCurrentUser() {

    return JSON.parse(
        localStorage.getItem("tracepointCurrentUser")
    );
}


function requireLogin() {

    const user = getCurrentUser();

    if (!user) {
        window.location.href = "login.html";
        return null;
    }

    return user;
}


function checkPageAccess(page) {

    const user = requireLogin();

    if (!user) return false;

    const allowedPages = PERMISSIONS[user.role] || [];

    if (!allowedPages.includes(page)) {

        alert("You do not have permission to access this page.");
        window.location.href = "dashboard.html";
        return false;
    }

    return true;
}

function canAccess(page) {
    const user = getCurrentUser();
    return Boolean(user && (PERMISSIONS[user.role] || []).includes(page));
}

function canManageAssets() {
    return canAccess("components");
}

function canResolveFaults() {
    return canAccess("faults");
}


/* =========================================================
   AUDIT LOG
========================================================= */

function addAuditLog(action, description, actorName, actorRole) {

    const user = getCurrentUser();

    const logs =
        JSON.parse(localStorage.getItem("tracepointAuditLogs")) || [];

    logs.unshift({
        id: "AUD-" + Date.now(),
        action: action,
        description: description,
        performedBy: actorName || (user ? user.name : "System"),
        userRole: actorRole || (user ? user.role : "System"),
        timestamp: new Date().toISOString()
    });

    localStorage.setItem("tracepointAuditLogs", JSON.stringify(logs));
}


/* =========================================================
   LOGIN / LOGOUT
========================================================= */

async function loginUser(email, password) {
    try {
        const result = await apiFetch("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });
        storageSet("token", result.token);
        const role = result.user.role === "IT/Systems Administrator" ? ROLES.ADMIN : result.user.role;
        storageSet("tracepointCurrentUser", JSON.stringify({ ...result.user, role }));
        return { success: true, user: result.user };
    } catch (err) {
        return { success: false, message: err.message };
    }
}


async function logoutUser() {
    const token = storageGet("token");
    try {
        if (token) {
            await fetch(`${API_BASE}/auth/logout`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });
        }
    } finally {
        storageRemove("token");
        storageRemove("tracepointCurrentUser");
        window.location.href = "login.html";
    }
}


/* =========================================================
   SELF SIGN-UP (public, from the login page)

   The very first account created becomes the administrator.
   Later accounts default to Field Technician unless a system
   administrator changes their role afterwards.
========================================================= */

async function registerUser(name, email, password) {
    try {
        const user = await apiFetch("/auth/register", {
            method: "POST",
            body: JSON.stringify({ name, email, password })
        });
        return { success: true, user };
    } catch (err) {
        return { success: false, message: err.message };
    }
}


/* =========================================================
   DISPLAY CURRENT USER + NAV FILTERING
========================================================= */

function displayCurrentUser() {

    const user = getCurrentUser();

    if (!user) return;

    const nameElement = document.getElementById("currentUserName");
    const roleElement = document.getElementById("currentUserRole");

    if (nameElement) nameElement.textContent = user.name;
    if (roleElement) roleElement.textContent = user.role;
}


function setupNavigation() {

    const user = getCurrentUser();

    if (!user) return;

    const allowed = PERMISSIONS[user.role] || [];

    document.querySelectorAll("[data-page]").forEach(link => {

        const page = link.dataset.page;

        if (!allowed.includes(page)) {
            link.style.display = "none";
        }
    });
}


function initializePage(page) {

    if (!checkPageAccess(page)) return false;

    displayCurrentUser();
    setupNavigation();

    return true;
}


/* =========================================================
   USER MANAGEMENT (administrator only)
========================================================= */

function changeUserRole(userId, newRole) {

    const currentUser = getCurrentUser();

    if (!currentUser || currentUser.role !== ROLES.ADMIN) {
        return { success: false, message: "Only the IT / Systems Administrator can alter privileges." };
    }

    /* Nobody — not even an administrator — can change their own role. */
    if (userId === currentUser.id) {
        return { success: false, message: "You can't change your own role. Ask another administrator." };
    }

    const allowedRoles = [ROLES.TECHNICIAN, ROLES.SUPERVISOR, ROLES.ADMIN];

    if (!allowedRoles.includes(newRole)) {
        return { success: false, message: "Invalid role." };
    }

    const users =
        JSON.parse(localStorage.getItem("tracepointUsers")) || [];

    const user = users.find(item => item.id === userId);

    if (!user) {
        return { success: false, message: "User not found." };
    }

    const oldRole = user.role;
    user.role = newRole;

    localStorage.setItem("tracepointUsers", JSON.stringify(users));

    addAuditLog("Privilege Changed", `Changed ${user.name}'s role from ${oldRole} to ${newRole}`);

    return { success: true };
}


function changeUserStatus(userId) {

    const currentUser = getCurrentUser();

    if (!currentUser || currentUser.role !== ROLES.ADMIN) {
        return { success: false, message: "Only the IT / Systems Administrator can manage accounts." };
    }

    if (userId === currentUser.id) {
        return { success: false, message: "You can't disable your own account." };
    }

    const users =
        JSON.parse(localStorage.getItem("tracepointUsers")) || [];

    const user = users.find(item => item.id === userId);

    if (!user) {
        return { success: false, message: "User not found." };
    }

    user.status = user.status === "Active" ? "Disabled" : "Active";

    localStorage.setItem("tracepointUsers", JSON.stringify(users));

    addAuditLog(
        user.status === "Disabled" ? "Account Disabled" : "Account Enabled",
        `${user.name}'s account was ${user.status.toLowerCase()}`
    );

    return { success: true };
}


/* =========================================================
   FEEDBACK: TOASTS
   One consistent way to confirm every action worked (or didn't),
   instead of scattering native alert() calls around the app.
========================================================= */

function ensureToastRoot() {

    let root = document.getElementById("toastRoot");

    if (!root) {
        root = document.createElement("div");
        root.id = "toastRoot";
        root.className = "toast-root";
        document.body.appendChild(root);
    }

    return root;
}

function showToast(message, kind) {

    const root = ensureToastRoot();

    const toast = document.createElement("div");
    toast.className = "toast" + (kind ? " toast-" + kind : "");
    toast.textContent = message;

    root.appendChild(toast);

    /* Give the browser a frame to apply the entry state before animating in. */
    requestAnimationFrame(() => toast.classList.add("toast-in"));

    setTimeout(() => {
        toast.classList.remove("toast-in");
        toast.classList.add("toast-out");
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}


/* =========================================================
   FEEDBACK: MODAL
   A single reusable modal shell. Pages set its inner content
   and swap that content between a form, a processing state,
   and a success state without needing their own overlay markup.
========================================================= */

const MODAL_PROCESSING_MS = 4000; /* ~4s simulated processing before the success state shows */

function ensureModalRoot() {

    let overlay = document.getElementById("modalOverlay");

    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "modalOverlay";
        overlay.className = "modal-overlay";
        overlay.innerHTML = '<div class="modal-box" id="modalBox"></div>';
        overlay.addEventListener("click", event => {
            if (event.target === overlay) closeModal();
        });
        document.body.appendChild(overlay);
    }

    return overlay;
}

function openModal(html) {
    const overlay = ensureModalRoot();
    document.getElementById("modalBox").innerHTML = html;
    overlay.classList.add("open");
}

function openConfirm({ title, body, confirmLabel = "Confirm", onConfirm, danger = false }) {
    const overlay = ensureModalRoot();
    const box = document.getElementById("modalBox");
    box.innerHTML = `
        <div class="modal-header">
            <h3>${escapeHtml(title)}</h3>
        </div>
        <p class="modal-body-text">${escapeHtml(body)}</p>
        <div class="form-actions">
            <button type="button" class="btn" onclick="closeModal();">Cancel</button>
            <button type="button" class="btn ${danger ? "danger" : "primary"}" id="confirmActionButton">${escapeHtml(confirmLabel)}</button>
        </div>
    `;

    const confirmButton = document.getElementById("confirmActionButton");
    if (confirmButton) {
        confirmButton.addEventListener("click", () => {
            closeModal();
            if (typeof onConfirm === "function") onConfirm();
        });
    }

    overlay.classList.add("open");
}

function showSuccess(title, body, onClose) {
    const overlay = ensureModalRoot();
    const box = document.getElementById("modalBox");
    box.innerHTML = `
        <div class="modal-success">
            <div class="success-icon">✓</div>
            <h3>${escapeHtml(title)}</h3>
            <p class="modal-body-text">${escapeHtml(body)}</p>
            <div class="form-actions">
                <button type="button" class="btn primary" id="successActionButton">Continue</button>
            </div>
        </div>
    `;

    const successButton = document.getElementById("successActionButton");
    if (successButton) {
        successButton.addEventListener("click", () => {
            closeModal();
            if (typeof onClose === "function") onClose();
        });
    }

    overlay.classList.add("open");
}

function closeModal() {
    const overlay = document.getElementById("modalOverlay");
    if (overlay) overlay.classList.remove("open");
}


function setupSidebarToggle() {
    const sidebar = document.querySelector(".sidebar");
    const topbar = document.querySelector(".topbar");
    const heading = topbar && topbar.querySelector("h2");

    if (!sidebar || !topbar || !heading) return;

    if (!sidebar.id) sidebar.id = "app-sidebar";

    const start = document.createElement("div");
    start.className = "topbar-start";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "sidebar-toggle";
    button.setAttribute("aria-controls", sidebar.id);
    button.innerHTML = "<span></span><span></span><span></span>";

    topbar.insertBefore(start, heading);
    start.append(button, heading);

    function setSidebarHidden(hidden) {
        document.body.classList.toggle("sidebar-hidden", hidden);
        button.setAttribute("aria-expanded", String(!hidden));
        button.setAttribute("aria-label", hidden ? "Show navigation" : "Hide navigation");
        button.title = hidden ? "Show navigation" : "Hide navigation";
    }

    let isMobile = window.innerWidth <= 600;
    setSidebarHidden(isMobile);

    button.addEventListener("click", () => {
        setSidebarHidden(!document.body.classList.contains("sidebar-hidden"));
    });

    window.addEventListener("resize", () => {
        const nextIsMobile = window.innerWidth <= 600;
        if (nextIsMobile !== isMobile) {
            isMobile = nextIsMobile;
            setSidebarHidden(isMobile);
        }
    });
}

setupSidebarToggle();

async function getEvents(params = {}) {
    const query = new URLSearchParams(params);
    return apiFetch(`/events?${query}`);
}
