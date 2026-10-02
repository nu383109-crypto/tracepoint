/* =========================================================
   API HELPER
   Every page's data comes from here — no localStorage fallback.
   If the API call fails, the caller sees a real error instead
   of silently getting fake data.
========================================================= */

const API_BASE = "/api";
const STORAGE_LOCATION = "storage";

function displayLocation(location) {
    return location ? location : "Storage";
}
/* =========================================================
   STORAGE HELPERS
   Thin wrappers used by login.html and friends for the small
   pieces of state that still live client-side (session, sign-out
   reason) even though asset data itself now comes from the API.
========================================================= */

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
        cache: "no-cache",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    });

    if (response.status === 401) {
        logoutUser();
        throw new Error("Session expired. Please log in again.");
    }

    const body = await response.json().catch(() => ({}));

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
        "alterPrivileges",
        "auditLog"
    ]

};


/* =========================================================
   PAGE LABELS
   Human-readable names for the permission keys above,
   used to render the access matrix on Alter Privileges.
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
    alterPrivileges: "Alter Privileges",
    auditLog: "Audit Log"
};


/* =========================================================
   DEMO USERS
   Sign-in accounts, still local for now since real auth (login
   endpoint, password hashing, JWTs) is being shown to the team
   separately before it's wired in here.
========================================================= */

function initializeUsers() {

    let users =
        JSON.parse(localStorage.getItem("tracepointUsers"));

    if (users && users.length) {
        const hasLegacyDeletedUsers = users.some(user => user.status === "Deleted");
        if (hasLegacyDeletedUsers) {
            users.forEach(user => {
                if (user.status === "Deleted") user.status = "Disabled";
            });
            localStorage.setItem("tracepointUsers", JSON.stringify(users));
        }
    }

    if (!users || users.length === 0) {

        users = [
            {
                id: "USR-001",
                name: "Daniel Boateng",
                email: "admin@tracepoint.com",
                password: "123456",
                role: ROLES.ADMIN,
                status: "Active",
                createdAt: new Date().toISOString()
            },
            {
                id: "USR-002",
                name: "Akosua Owusu",
                email: "supervisor@tracepoint.com",
                password: "123456",
                role: ROLES.SUPERVISOR,
                status: "Active",
                createdAt: new Date().toISOString()
            },
            {
                id: "USR-003",
                name: "Kwame Mensah",
                email: "technician@tracepoint.com",
                password: "123456",
                role: ROLES.TECHNICIAN,
                status: "Active",
                createdAt: new Date().toISOString()
            }
        ];

        localStorage.setItem("tracepointUsers", JSON.stringify(users));
    }
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

async function getKiosk(id) {
    return apiFetch(`/kiosks/${id}`);
}

async function getComponents(params = {}) {
    const query = new URLSearchParams(params);
    return apiFetch(`/components?${query}`);
}

async function getComponent(id) {
    return apiFetch(`/components/${id}`);
}

async function getEvents(params = {}) {
    const query = new URLSearchParams(params);
    return apiFetch(`/events?${query}`);
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

async function resolveFault(faultId, resolution) {
    try {
        const fault = await apiFetch(`/faults/${faultId}/resolve`, {
            method: "PATCH",
            body: JSON.stringify({ resolution })
        });

        return { success: true, fault };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

 function getUsers() {
    initializeUsers();
    return JSON.parse(localStorage.getItem("tracepointUsers")) || [];
}

function getUser(userId) {
    return getUsers().find(user => String(user.id) === String(userId)) || null;
}

async function getAuditLogs(params = {}) {
    const query = new URLSearchParams(params);
    return apiFetch(`/audit-logs?${query}`);
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

function warrantyDaysLeft(component) {
    if (!component || !component.warrantyEnds) return null;
    return Math.ceil((new Date(component.warrantyEnds).getTime() - Date.now()) / 86400000);
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



function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
}

function emptyRow(columnCount, message, action = "") {
    return `<tr><td colspan="${columnCount}" class="empty-state">${escapeHtml(message)} ${action}</td></tr>`;
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
    const user = getCurrentUser();

    return Boolean(
        user &&
        [ROLES.SUPERVISOR, ROLES.ADMIN].includes(user.role)
    );
}


/* =========================================================
   AUDIT LOG
========================================================= */

function addAuditLog(action, description, actorName, actorRole, targetUserId, targetUserName) {

    const user = getCurrentUser();

    const logs =
        JSON.parse(localStorage.getItem("tracepointAuditLogs")) || [];

    logs.unshift({
        id: "AUD-" + Date.now(),
        action: action,
        description: description,
        performedBy: actorName || (user ? user.name : "System"),
        userRole: actorRole || (user ? user.role : "System"),
        targetUserId: targetUserId || null,
        targetUserName: targetUserName || "",
        timestamp: new Date().toISOString()
    });

    localStorage.setItem("tracepointAuditLogs", JSON.stringify(logs));
}


/* =========================================================
   LOGIN / LOGOUT
========================================================= */

function loginUser(email, password) {

    initializeUsers();

    const users =
        JSON.parse(localStorage.getItem("tracepointUsers")) || [];

    const user = users.find(
        item =>
            item.email.toLowerCase() === email.toLowerCase() &&
            item.password === password
    );

    if (!user) {
        return { success: false, message: "Incorrect email or password." };
    }

    if (user.status !== "Active") {
        return {
            success: false,
            message: "This account has been disabled. Contact the system administrator."
        };
    }

    const currentUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
    };

    localStorage.setItem("tracepointCurrentUser", JSON.stringify(currentUser));

    addAuditLog("User Login", `${user.name} signed in to TracePoint`, user.name, user.role);

    return { success: true };
}


function logoutUser() {

    const user = getCurrentUser();

    if (user) {
        addAuditLog("User Logout", `${user.name} signed out of TracePoint`, user.name, user.role);
    }

    localStorage.removeItem("tracepointCurrentUser");
    window.location.href = "login.html";
}


/* =========================================================
   SELF SIGN-UP (public, from the login page)

   New accounts always start as Field Technician.
   There is no role field on this form on purpose —
   nobody can grant themselves access at sign-up time.
   Only an administrator can change a role afterwards,
   from Alter Privileges, and never their own.
========================================================= */

function registerUser(name, email, password) {

    initializeUsers();

    const users =
        JSON.parse(localStorage.getItem("tracepointUsers")) || [];

    const exists = users.some(
        user => user.email.toLowerCase() === email.toLowerCase()
    );

    if (exists) {
        return { success: false, message: "An account with this email already exists." };
    }

    const newUser = {
        id: "USR-" + Date.now(),
        name: name,
        email: email.toLowerCase(),
        password: password,
        role: ROLES.TECHNICIAN,
        status: "Active",
        createdAt: new Date().toISOString()
    };

    users.push(newUser);
    localStorage.setItem("tracepointUsers", JSON.stringify(users));

    addAuditLog(
        "Account Created",
        `${name} created a Field Technician account (self sign-up)`,
        name,
        ROLES.TECHNICIAN
    );

    return { success: true, user: newUser };
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

    if (user.role === ROLES.ADMIN && newRole !== ROLES.ADMIN && activeAdminCount() <= 1) {
        return { success: false, message: "Promote another active administrator before changing this role." };
    }

    const oldRole = user.role;
    user.role = newRole;

    localStorage.setItem("tracepointUsers", JSON.stringify(users));

    addAuditLog(
        "Privilege Changed",
        `Changed ${user.name}'s role from ${oldRole} to ${newRole}`,
        undefined,
        undefined,
        user.id,
        user.name
    );

    return { success: true, user: { ...user } };
}


function changeUserStatus(userId, nextStatus) {

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

    if (!["Active", "Disabled"].includes(nextStatus)) {
        return { success: false, message: "Invalid account status." };
    }

    if (user.status === nextStatus) {
        return { success: false, message: `This account is already ${nextStatus.toLowerCase()}.` };
    }

    if (user.role === ROLES.ADMIN && user.status === "Active" && nextStatus === "Disabled" && activeAdminCount() <= 1) {
        return { success: false, message: "You can't disable the last active administrator." };
    }

    user.status = nextStatus;

    localStorage.setItem("tracepointUsers", JSON.stringify(users));

    addAuditLog(
        nextStatus === "Disabled" ? "Account Disabled" : "Account Enabled",
        `${user.name}'s account was ${user.status.toLowerCase()}`,
        undefined,
        undefined,
        user.id,
        user.name
    );

    return { success: true, user: { ...user }, status: user.status };
}


/* =========================================================
   COMPONENT EVENTS (Log an Event)

   Covers more than a simple swap: a component can be moved,
   installed, pulled to storage, decommissioned, given
   maintenance, or have a fault reported against it. Every
   one of these is written to tracepointEvents and to the
   audit log, so the audit trail reflects what actually
   happened, not just "component moved".
========================================================= */

const EVENT_TYPES = {
    MOVED: "Moved",
    INSTALLED: "Installed",
    REMOVED: "Removed to Storage",
    DECOMMISSIONED: "Decommissioned",
    MAINTENANCE: "Maintenance Performed",
    FAULT: "Fault Reported"
};

/* Event types that change where a component is recorded as installed. */
const LOCATION_CHANGING_EVENTS = [
    EVENT_TYPES.MOVED,
    EVENT_TYPES.INSTALLED,
    EVENT_TYPES.REMOVED
];

async function logComponentEvent(componentId, eventType, destinationKioskId, reason, notes, severity) {
    let component;
    try {
        ({ component } = await getComponent(componentId));
    } catch {
        component = null;
    }
    if (!component || !component.id) {
        return { success: false, message: "We couldn't find that component." };
    }

    // Only "Installed" and "Moved" require a destination kiosk on the
    // server; "Removed to Storage" clears it server-side. Mirror that
    // check here just for a fast client-side message.
    const needsDestination = eventType === "Installed" || eventType === "Moved";
    if (needsDestination && !destinationKioskId) {
      return { success: false, message: "Please choose a kiosk for this event." };
    }

    try {
                // Matches POST /api/components/:id/events exactly:
                // body { event_type, to_kiosk_id, reason, notes }.
                // from_kiosk_id, the transition validation, the component
                // update, and the audit trail are all handled server-side
                // in one transaction — nothing else to do here.
                const result = await apiFetch(`/components/${component.id}/events`, {
                    method: "POST",
                    body: JSON.stringify({
                        event_type: eventType,
                        to_kiosk_id: needsDestination ? destinationKioskId : null,
                        reason: reason || null,
                        notes: notes || null
                    })
                });

                if (eventType === "Fault Reported") {
                    const faultResult = await logFault({
                        componentId: component.id,
                        severity: severity || "Medium",
                        description: reason || notes || "Fault reported via Log an Event"
                    });
                    if (!faultResult.success) {
                        return { success: false, message: faultResult.message };
                    }
                }
        
                return { success: true, component: result.component, event: result.event };
            } catch (err) {
                return { success: false, message: err.message || "Failed to log event." };
            }
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

function closeModal() {
    const overlay = document.getElementById("modalOverlay");
    if (overlay) overlay.classList.remove("open");
}


/* =========================================================
   INITIALIZE DEMO USERS
   Asset data (kiosks, components) now lives in Postgres and
   loads per-page via apiFetch — nothing to seed here anymore.
   Only the login accounts are still local, until real auth
   replaces this.
========================================================= */

function severityPill(severity) {
    const value = String(severity || "Unknown");
    const tone = value.toLowerCase();
    return `<span class="pill pill-${tone}">${escapeHtml(value)}</span>`;
}

function setupSidebarSwipe() {

    const sidebar = document.querySelector(".sidebar");

    if (!sidebar) return;

    if (!sidebar.id) sidebar.id = "app-sidebar";

    const topbar = document.querySelector(".topbar");
    const heading = topbar && topbar.querySelector("h2");
    let toggleButton = null;

    if (topbar && heading) {
        const topbarStart = document.createElement("div");
        topbarStart.className = "topbar-start";

        toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "sidebar-toggle";
        toggleButton.setAttribute("aria-controls", sidebar.id);
        toggleButton.innerHTML = "<span></span><span></span><span></span>";

        topbar.insertBefore(topbarStart, heading);
        topbarStart.append(toggleButton, heading);
    }

    function setSidebarHidden(hidden) {
        document.body.classList.toggle("sidebar-hidden", hidden);

        if (toggleButton) {
            toggleButton.setAttribute("aria-expanded", String(!hidden));
            toggleButton.setAttribute("aria-label", hidden ? "Show navigation" : "Hide navigation");
            toggleButton.title = hidden ? "Show navigation" : "Hide navigation";
        }
    }

    let isMobile = window.innerWidth <= 600;
    function syncSidebarForViewport() {
        const nextIsMobile = window.innerWidth <= 600;

        if (nextIsMobile !== isMobile) {
            isMobile = nextIsMobile;
            setSidebarHidden(isMobile);
        }
    }

    setSidebarHidden(isMobile);
    window.addEventListener("resize", syncSidebarForViewport);

    if (toggleButton) {
        toggleButton.addEventListener("click", () => {
            setSidebarHidden(!document.body.classList.contains("sidebar-hidden"));
        });
    }

    if (!("ontouchstart" in window)) return;

    let startX = 0;
    let startY = 0;

    document.addEventListener("touchstart", event => {
        const touch = event.changedTouches[0];
        startX = touch.clientX;
        startY = touch.clientY;
    }, { passive: true });

    document.addEventListener("touchend", event => {
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;

        if (Math.abs(deltaX) < 70 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return;

        const isHidden = document.body.classList.contains("sidebar-hidden");

        if (isHidden && startX <= 32 && deltaX > 0) {
            setSidebarHidden(false);
        } else if (!isHidden && startX <= sidebar.offsetWidth && deltaX < 0) {
            setSidebarHidden(true);
        }
    }, { passive: true });
}

setupSidebarSwipe();
initializeUsers();