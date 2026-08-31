console.log("%c 🟢 SAFEEPOST v7.3 - STATUS PANEL " + new Date().toLocaleTimeString(), "background: green; color: white; font-size: 20px; padding: 10px; border-radius: 5px;");
console.log("[SafePost] Content Script v7.3 LOADED — group sync status panel active");

// Helper: Safe Message Sending (Prevents "Extension context invalidated")
function safeSendMessage(payload, callback = null) {
    try {
        if (!chrome.runtime || !chrome.runtime.id) {
            throw new Error("Extension context invalidated (runtime check failed)");
        }
        if (callback) {
            chrome.runtime.sendMessage(payload, callback);
        } else {
            const p = chrome.runtime.sendMessage(payload);
            if (p && typeof p.catch === 'function') {
                p.catch(() => { });
            }
        }
    } catch (error) {
        if (error.message.includes("Extension context invalidated")) {
            console.log("[SafePost] Extension Updated/Reloaded. Please refresh the page.");
        } else {
            console.warn("[SafePost] Message failed:", error);
        }
    }
}

// 0. Remote Logging Helper
async function logRemote(message, metadata = {}) {
    console.log(`[SafePost-Remote] ${message}`, metadata);
    if (chrome.runtime?.id) {
        try {
            chrome.runtime.sendMessage({
                action: "REPORT_STATUS",
                payload: {
                    taskId: window.currentTaskId || 'DEBUG',
                    status: 'LOG',
                    failure_reason: message,
                    metadata: { ...metadata, timestamp: new Date().toISOString() }
                }
            });
        } catch (e) { }
    }
}

// Same source of truth as popup.js/background.js (chrome.storage.local 'apiUrl'),
// not page localStorage — content scripts run in the facebook.com origin, so a
// localStorage key here would never see what the popup saved.
async function getBackendUrl() {
    const { apiUrl } = await chrome.storage.local.get('apiUrl');
    return (apiUrl || 'https://safepost-backup.onrender.com').replace(/\/+$/, '');
}

// Mirrors authedHeaders() in background.js: attach worker credentials when this
// install is paired, so these calls keep working once WORKER_AUTH_ENFORCED is on.
async function authedHeaders(extra = {}) {
    const { pairedWorkerId, deviceToken, extensionKey } = await chrome.storage.local.get(['pairedWorkerId', 'deviceToken', 'extensionKey']);
    if (pairedWorkerId && deviceToken) {
        return { ...extra, 'x-worker-id': pairedWorkerId, 'x-device-token': deviceToken };
    }
    return extensionKey ? { ...extra, 'x-extension-key': extensionKey } : { ...extra };
}

const FACEBOOK_USER_STORAGE_KEYS = ['fb_session', 'safepost_currentUser', 'safepost_detectedFacebookUser', 'safepost_currentUserId'];
const FACEBOOK_USER_GENERIC_LABELS = new Set([
    'facebook', 'home', 'profile', 'profiles', 'groups', 'marketplace',
    'notifications', 'settings', 'menu', 'search', 'create', 'posts',
    'your profile', 'your profiles', 'switch profile', 'view profile'
]);

function normalizeFacebookUser(value) {
    if (!value || typeof value !== 'string') return null;
    const cleaned = value
        .replace(/\s+/g, ' ')
        .replace(/\(.*?\)/g, '')
        .replace(/\s*[-|•·]\s*Facebook.*$/i, '')
        .trim();
    if (!cleaned || cleaned.length < 2) return null;
    if (FACEBOOK_USER_GENERIC_LABELS.has(cleaned.toLowerCase())) return null;
    return cleaned;
}

async function getStoredFacebookUser() {
    try {
        const data = await chrome.storage.local.get(FACEBOOK_USER_STORAGE_KEYS);
        return {
            name: data.fb_session || data.safepost_currentUser || data.safepost_detectedFacebookUser || null,
            id: data.safepost_currentUserId || null
        };
    } catch {
        return {
            name: localStorage.getItem('safepost_currentUser') || null,
            id: localStorage.getItem('safepost_currentUserId') || null
        };
    }
}

// Facebook slugs that are system pages, never a real person's profile.
const FB_SYSTEM_SLUGS = new Set([
    'r.php', 'home.php', 'login.php', 'logout.php', 'reg', 'recover',
    'friends', 'groups', 'marketplace', 'watch', 'gaming', 'events',
    'pages', 'bookmarks', 'settings', 'me', 'help', 'policies', 'business'
]);

// The c_user cookie holds the numeric ID of the account that is active RIGHT NOW.
// It flips the instant the user switches accounts, so it is the ground truth for
// "who is logged in" and lets us reject a stale name from a previous account.
function getActiveUserIdFromCookie() {
    const m = document.cookie.match(/(?:^|;\s*)c_user=(\d+)/);
    return m ? m[1] : null;
}

// Facebook encodes names in its JSON preload with \uXXXX escapes (Hebrew included).
function decodeUnicodeEscapes(s) {
    try { return JSON.parse('"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\\\\u/g, '\\u') + '"'); }
    catch { return s; }
}

function extractNameFromUserScopedScripts(activeUserId) {
    if (!activeUserId) return null;
    const patterns = [
        new RegExp(`"USER_ID"\\s*:\\s*"${activeUserId}"[\\s\\S]{0,800}?"NAME"\\s*:\\s*"([^"]+)"`),
        new RegExp(`"ACCOUNT_ID"\\s*:\\s*"${activeUserId}"[\\s\\S]{0,800}?"NAME"\\s*:\\s*"([^"]+)"`),
        new RegExp(`"NAME"\\s*:\\s*"([^"]+)"[\\s\\S]{0,800}?"USER_ID"\\s*:\\s*"${activeUserId}"`),
        new RegExp(`"NAME"\\s*:\\s*"([^"]+)"[\\s\\S]{0,800}?"ACCOUNT_ID"\\s*:\\s*"${activeUserId}"`),
    ];

    for (const script of Array.from(document.querySelectorAll('script'))) {
        const text = script.textContent || '';
        if (!text || !text.includes(activeUserId)) continue;
        for (const pattern of patterns) {
            const match = text.match(pattern);
            const normalized = normalizeFacebookUser(decodeUnicodeEscapes(match?.[1] || ''));
            if (normalized) {
                logRemote('Found current user from USER_ID scoped script', { name: normalized, id: activeUserId });
                return normalized;
            }
        }
    }
    return null;
}

// Pull the display name out of Facebook's CurrentUserInitialData blob. We anchor the
// NAME search to the object that follows the marker (not the whole script bundle) so
// we never grab an unrelated "NAME" — a Page, an ad account, a friend. When we know
// the active account id we require the blob's USER_ID to match it.
function extractNameFromInitialData(activeUserId) {
    const exactScopedName = extractNameFromUserScopedScripts(activeUserId);
    if (exactScopedName) return exactScopedName;

    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
        const text = script.textContent;
        if (!text || !text.includes('CurrentUserInitialData')) continue;
        const idx = text.indexOf('CurrentUserInitialData');
        const slice = text.slice(idx, idx + 4000); // stay inside this object
        if (activeUserId) {
            const idMatch = slice.match(/"USER_ID"\s*:\s*"(\d+)"/);
            if (idMatch && idMatch[1] !== activeUserId) continue; // a different account's blob
        }
        const nameMatch = slice.match(/"NAME"\s*:\s*"([^"]+)"/);
        if (nameMatch && nameMatch[1]) {
            const normalized = normalizeFacebookUser(decodeUnicodeEscapes(nameMatch[1]));
            if (normalized) {
                logRemote('Found current user name in JSON', { name: normalized, id: activeUserId });
                return normalized;
            }
        }
    }
    return null;
}

function extractNameFromActiveProfileLinks(activeUserId) {
    if (!activeUserId) return null;
    const linkSelectors = [
        `a[href*="id=${activeUserId}"]`,
        `a[href*="/${activeUserId}"]`,
        `a[data-hovercard*="${activeUserId}"]`,
    ];

    for (const selector of linkSelectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
            const candidates = [
                el.innerText,
                el.textContent,
                el.getAttribute('aria-label'),
                el.getAttribute('title'),
            ];
            for (const candidate of candidates) {
                const normalized = normalizeFacebookUser(candidate);
                if (normalized) {
                    logRemote('Found current user from active profile link', { name: normalized, id: activeUserId, selector });
                    return normalized;
                }
            }
        }
    }
    return null;
}

function collectFacebookUserCandidates() {
    const candidates = [];
    const visited = new Set();
    const push = (v) => {
        const n = normalizeFacebookUser(v);
        if (n && !visited.has(n)) { candidates.push(n); visited.add(n); }
    };

    const activeUserId = getActiveUserIdFromCookie();

    // Priority 1: name from CurrentUserInitialData, matched to the active account id.
    const nameFromData = extractNameFromInitialData(activeUserId);
    if (nameFromData) push(nameFromData);

    const nameFromProfileLink = extractNameFromActiveProfileLinks(activeUserId);
    if (nameFromProfileLink) push(nameFromProfileLink);

    // Priority 2: profile link — but reject Facebook system pages (r.php, home.php, ...).
    if (!candidates.length) {
        const profileLink = document.querySelector('a[href^="/"][href*="."]');
        const match = profileLink?.href?.match(/facebook\.com\/([^/?]+)/);
        if (match && match[1]) {
            const slug = decodeURIComponent(match[1]);
            if (!FB_SYSTEM_SLUGS.has(slug.toLowerCase()) && !/\.php$/i.test(slug)) {
                push(slug);
            }
        }
    }

    // Priority 3: "ציר הזמן של [Name]" / "timeline of [Name]".
    if (!candidates.length) {
        const timelineElements = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
            .filter(el => {
                const t = el.textContent || '';
                return t.includes('ציר הזמן') || /timeline/i.test(t);
            });
        for (const el of timelineElements) {
            const m = (el.textContent || '').match(/(?:ציר הזמן של|timeline of)\s+([^•\n]+)/i);
            if (m && m[1]) push(m[1]);
        }
    }

    // Priority 4: open graph title.
    if (!candidates.length) {
        const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
        if (ogTitle) push(ogTitle);
    }

    return candidates;
}

async function detectCurrentFacebookUser() {
    const activeId = getActiveUserIdFromCookie();
    const detected = collectFacebookUserCandidates()[0] || null;

    if (detected) {
        // Fresh detection wins and is remembered together with the account id.
        try {
            localStorage.setItem('safepost_currentUser', detected);
            if (activeId) localStorage.setItem('safepost_currentUserId', activeId);
        } catch { /* noop */ }
        return { facebook_user: detected, facebook_user_id: activeId || null };
    }

    // No fresh name on this page — only trust a stored name if it belongs to the SAME
    // account that is active now. This is what stops a previous account's name from
    // sticking after the user switches.
    let storedId = null;
    try { storedId = localStorage.getItem('safepost_currentUserId'); } catch { /* noop */ }
    const storedProfile = await getStoredFacebookUser();
    const storedName = normalizeFacebookUser(storedProfile?.name);
    const persistedId = storedProfile?.id || storedId || null;
    if (storedName && (!activeId || !persistedId || persistedId === activeId)) {
        return { facebook_user: storedName, facebook_user_id: activeId || persistedId || null };
    }
    return { facebook_user: null, facebook_user_id: activeId || null };
}

async function syncDetectedFacebookUser() {
    const profile = await detectCurrentFacebookUser();
    const fbUser = profile?.facebook_user || null;
    const fbUserId = profile?.facebook_user_id || getActiveUserIdFromCookie() || null;
    console.log('🔍 Detected Facebook user:', fbUser);
    logRemote(`🔍 Detected Facebook user: ${fbUser}`);

    if (!fbUser) return null;

    try {
        localStorage.setItem('safepost_currentUser', fbUser);
        if (fbUserId) localStorage.setItem('safepost_currentUserId', fbUserId);
    } catch { /* noop */ }
    safeSendMessage({ action: 'SET_FACEBOOK_USER', facebook_user: fbUser, facebook_user_id: fbUserId });

    // Send to server so dashboard can read it
    try {
        const backendUrl = await getBackendUrl();
        const response = await fetch(`${backendUrl}/api/profile/sync`, {
            method: 'POST',
            headers: await authedHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                facebook_user: fbUser,
                facebook_user_id: fbUserId,
                source: 'extension_content',
                detected_at: new Date().toISOString()
            })
        });
        if (response.ok) {
            logRemote(`✅ Synced Facebook user to server: ${fbUser}`);
        }
    } catch (err) {
        logRemote(`⚠️ Failed to sync user to server`, { error: err.message });
    }

    return { facebook_user: fbUser, facebook_user_id: fbUserId };
}

// Keep the dashboard in sync with the ACTIVE account, not just whoever was logged in
// when the page first loaded. Switching accounts changes the c_user cookie, so we
// re-detect whenever it changes: once now, on every tab focus, and via a light poll.
let __lastSyncedUserId = null;
async function maybeResyncFacebookUser(force = false) {
    const activeId = getActiveUserIdFromCookie();
    console.log('[SafePost] maybeResyncFacebookUser called - activeId:', activeId, 'force:', force, 'lastSyncedId:', __lastSyncedUserId);
    if (!force && activeId && activeId === __lastSyncedUserId) {
        console.log('[SafePost] Skipping resync - user ID unchanged');
        return;
    }
    __lastSyncedUserId = activeId;
    console.log('[SafePost] Calling syncDetectedFacebookUser...');
    await syncDetectedFacebookUser();
}
maybeResyncFacebookUser(true).catch(() => {});
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) maybeResyncFacebookUser().catch(() => {});
});
setInterval(() => maybeResyncFacebookUser().catch(() => {}), 15000);

// True while an auto-scroll scrape is running, so the periodic re-inject below does not
// destroy the button (and its live progress text) mid-scroll.
let __safepostScraping = false;

// 1. Inject Manual Sync Button
function injectButton() {
    // Don't tear the button down while it's actively scrolling/scraping.
    if (__safepostScraping) return;
    // Remove existing if any
    const existing = document.getElementById('safepost-sync-btn');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = 'safepost-sync-btn';
    btn.innerText = "🔄 SAFEPOST: SYNC GROUPS";
    btn.style = `
        position: fixed; 
        bottom: 20px; 
        right: 20px; 
        z-index: 9999; 
        padding: 15px 25px; 
        background-color: #007bff; 
        color: white; 
        font-weight: bold; 
        border: none; 
        border-radius: 50px; 
        box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
        cursor: pointer;
        font-family: sans-serif;
    `;

    btn.onclick = async () => {
        btn.disabled = true;
        btn.style.backgroundColor = "#e0a800"; // Orange
        btn.innerText = "⏳ גולל וסורק...";
        try {
            await scrapeAndSyncGroups((count) => {
                btn.innerText = `⏳ גולל... ${count} קבוצות`;
            });
        } finally {
            btn.disabled = false;
            setTimeout(() => {
                btn.innerText = "🔄 SAFEPOST: SYNC GROUPS";
                btn.style.backgroundColor = "#007bff"; // Back to Blue
            }, 3000);
        }
    };

    // The manual sync button must use the background scan path, which opens the
    // joined-groups page and scrapes there. Scanning the current page can miss
    // most memberships and may never reach the server sync route.
    btn.onclick = async () => {
        btn.disabled = true;
        btn.style.backgroundColor = "#e0a800";
        btn.innerText = "ג³ ׳₪׳•׳×׳— ׳׳× ׳¢׳׳•׳“ ׳”׳§׳‘׳•׳¦׳•׳×...";
        try {
            await syncDetectedFacebookUser().catch(() => null);
            await new Promise((resolve) => {
                safeSendMessage({ action: "SCAN_AND_SYNC_GROUPS" }, (response) => {
                    if (chrome.runtime?.lastError) {
                        console.error("BG Error:", chrome.runtime.lastError);
                        alert("׳©׳’׳™׳׳”: ׳•׳•׳“׳ ׳©׳¨׳¢׳ ׳ ׳× ׳׳× ׳”׳×׳•׳¡׳£!");
                        resolve();
                        return;
                    }
                    if (!response?.success) {
                        console.error("[SafePost] Group sync failed:", response?.error || 'unknown error');
                        alert(`Group sync failed: ${response?.error || 'unknown error'}`);
                        resolve(response);
                        return;
                    }
                    const syncedCount = response?.synced || response?.added || 0;
                    btn.innerText = `ג… ${syncedCount} ׳§׳‘׳•׳¦׳•׳×`;
                    resolve(response);
                });
            });
        } finally {
            btn.disabled = false;
            setTimeout(() => {
                btn.innerText = "נ”„ SAFEPOST: SYNC GROUPS";
                btn.style.backgroundColor = "#007bff";
            }, 3000);
        }
    };

    document.body.appendChild(btn);
}

// Run injection immediately and periodically
injectButton();
setInterval(injectButton, 5000);

// --- Live status panel: shows the user that a scrape is running, how many groups
// have been found so far, and elapsed time. Sits above the sync button. ---
const SyncStatusPanel = (() => {
    let el = null, countEl = null, statusEl = null, timerEl = null, barEl = null, spinnerEl = null;
    let startTs = 0, tick = null;

    function ensureStyles() {
        if (document.getElementById('safepost-status-styles')) return;
        const s = document.createElement('style');
        s.id = 'safepost-status-styles';
        s.textContent = `
            @keyframes sp-spin { to { transform: rotate(360deg); } }
            @keyframes sp-pulse { 0%,100%{opacity:.35} 50%{opacity:1} }
            @keyframes sp-fade { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        `;
        document.head.appendChild(s);
    }

    function fmt(ms) {
        const s = Math.floor(ms / 1000);
        return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }

    function show() {
        ensureStyles();
        if (el) el.remove();
        el = document.createElement('div');
        el.id = 'safepost-status';
        el.dir = 'rtl';
        el.style.cssText = `
            position:fixed; bottom:90px; right:20px; z-index:2147483647;
            width:270px; background:#fff; color:#0b1c30;
            border:1px solid #e5e7eb; border-radius:16px;
            box-shadow:0 12px 34px rgba(0,0,0,.20);
            font-family:'Segoe UI',Arial,sans-serif; overflow:hidden;
            animation:sp-fade .2s ease-out;
        `;
        el.innerHTML = `
            <div style="background:linear-gradient(135deg,#007bff,#0056d6);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px;">
                <div id="sp-spinner" style="width:18px;height:18px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sp-spin .8s linear infinite;flex:0 0 auto;"></div>
                <div style="font-weight:700;font-size:13px;">SafePost — סנכרון קבוצות</div>
            </div>
            <div style="padding:14px;">
                <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px;">
                    <span id="sp-count" style="font-size:30px;font-weight:800;color:#007bff;line-height:1;font-variant-numeric:tabular-nums;">0</span>
                    <span style="font-size:12px;color:#6b7280;">קבוצות נמצאו</span>
                </div>
                <div id="sp-status" style="font-size:12px;color:#374151;display:flex;align-items:center;gap:7px;margin-bottom:11px;">
                    <span style="width:7px;height:7px;border-radius:50%;background:#f59e0b;display:inline-block;animation:sp-pulse 1s infinite;"></span>
                    גולל וטוען קבוצות...
                </div>
                <div style="height:6px;background:#eef1fe;border-radius:99px;overflow:hidden;margin-bottom:11px;">
                    <div id="sp-bar" style="height:100%;width:20%;background:#007bff;border-radius:99px;transition:width .35s ease;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;">
                    <span>זמן שחלף</span>
                    <span id="sp-timer" style="font-variant-numeric:tabular-nums;font-weight:600;">00:00</span>
                </div>
            </div>
        `;
        document.body.appendChild(el);
        countEl = el.querySelector('#sp-count');
        statusEl = el.querySelector('#sp-status');
        timerEl = el.querySelector('#sp-timer');
        barEl = el.querySelector('#sp-bar');
        spinnerEl = el.querySelector('#sp-spinner');
        startTs = Date.now();
        if (tick) clearInterval(tick);
        tick = setInterval(() => { if (timerEl) timerEl.textContent = fmt(Date.now() - startTs); }, 500);
    }

    function update(count, pct) {
        if (countEl) countEl.textContent = count;
        // Prefer the real scroll percentage; fall back to a count-based creep.
        const width = (typeof pct === 'number')
            ? Math.max(6, Math.min(98, pct))
            : Math.min(90, 20 + count * 1.2);
        if (barEl) barEl.style.width = width + '%';
        if (typeof pct === 'number') {
            setStatus(`גולל וטוען קבוצות... ${pct}%`);
        }
    }

    function setStatus(text, color) {
        if (statusEl) {
            statusEl.innerHTML =
                `<span style="width:7px;height:7px;border-radius:50%;background:${color || '#f59e0b'};display:inline-block;animation:sp-pulse 1s infinite;"></span> ${text}`;
        }
    }

    function finish(count, ok) {
        if (tick) { clearInterval(tick); tick = null; }
        if (!el) return;
        const elapsed = fmt(Date.now() - startTs);
        if (spinnerEl) spinnerEl.style.animation = 'none';
        if (barEl) { barEl.style.width = '100%'; barEl.style.background = ok ? '#10b981' : '#ef4444'; }
        if (countEl) countEl.style.color = ok ? '#10b981' : '#ef4444';
        if (statusEl) {
            statusEl.innerHTML = ok
                ? `<span style="color:#10b981;font-weight:700;">✓ הסתיים — ${count} קבוצות נשלחו</span>`
                : `<span style="color:#ef4444;font-weight:700;">✕ ${count > 0 ? 'שגיאה בשליחה' : 'לא נמצאו קבוצות'}</span>`;
        }
        if (timerEl) timerEl.textContent = elapsed;
        setTimeout(() => { if (el) { el.remove(); el = null; } }, 6000);
    }

    return { show, update, setStatus, finish };
})();

// 2. Scrape Logic

// Group slugs that are Facebook navigation, not real groups.
const GROUP_NON_GROUP_SLUGS = new Set([
    'feed', 'discover', 'joins', 'create', 'search', 'your_groups', 'category'
]);

// Normalized names already collected, so the same group linked under both its numeric
// id and its vanity slug is counted once (module-level: shared across scroll steps).
const __seenGroupNames = new Set();
const __normName = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// THE REAL FIX for runaway counts: past the user's real groups, Facebook keeps loading
// an effectively endless "Suggested groups" feed as you scroll — that's why the count
// grows by a steady batch forever instead of stopping. A per-card "Join" text check is
// unreliable (wording varies), so we additionally find the section heading that marks
// where suggestions begin and treat its vertical position as a hard ceiling: nothing at
// or below it is ever counted, no matter how many more scroll ticks happen.
const __SUGGESTION_HEADING_RE = /(suggested|discover more|more groups|groups you may like|קבוצות מומלצות|קבוצות מוצעות|מוצע לך|גלה קבוצות|קבוצות נוספות|אולי יעניין אותך)/i;
let __suggestionCutoffY = Infinity;
let __suggestionCutoffTarget = null; // the scroll target this cutoff's coordinates are relative to

// Position in the same coordinate space as scrollTargetMetrics()'s `pos`/`height`: window
// scroll uses document-absolute Y; an inner scroll container uses Y within its own content
// (since getBoundingClientRect().top is viewport-relative, add its own scrollTop to land
// in content-relative coordinates that stay stable as the container scrolls).
function __absoluteTop(el, target) {
    const rect = el.getBoundingClientRect();
    if (target.type === 'window') return rect.top + window.scrollY;
    // el's position relative to the container's visible top edge, plus how far the
    // container has already scrolled, gives a position stable across further scrolling.
    const containerRect = target.el.getBoundingClientRect();
    return (rect.top - containerRect.top) + target.el.scrollTop;
}

function __refreshSuggestionCutoff(target) {
    if (__suggestionCutoffY !== Infinity) return; // already locked in
    const heads = document.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (const h of heads) {
        const t = (h.textContent || '').trim();
        if (t && __SUGGESTION_HEADING_RE.test(t)) {
            __suggestionCutoffY = __absoluteTop(h, target);
            __suggestionCutoffTarget = target;
            console.log('[SafePost] suggestion cutoff locked at y=' + __suggestionCutoffY + ' (heading: "' + t + '")');
            break;
        }
    }
}
function __isBelowSuggestionCutoff(el) {
    if (__suggestionCutoffY === Infinity || !__suggestionCutoffTarget) return false;
    return __absoluteTop(el, __suggestionCutoffTarget) >= __suggestionCutoffY;
}

// Pull every group link currently in the DOM into `into` (a Map keyed by group id).
// Called on every scroll step because Facebook virtualizes long lists — items that
// scroll out of view are removed from the DOM, so we must accumulate as we go.
// `target` (the scroll container, from findGroupsScrollContainer) is required so the
// suggestions cutoff can be measured in the right coordinate space.
// `_retry` is internal — used by the safety net below, never pass it explicitly.
function extractGroupsIntoMap(into, target, _retry) {
    __refreshSuggestionCutoff(target);
    // Scope to the main column to skip left-nav shortcuts and right-rail suggestions,
    // but fall back to the whole document if the list isn't inside <main>.
    const main = document.querySelector('[role="main"]');
    let links = main ? main.querySelectorAll('a[href*="/groups/"]') : null;
    if (!links || !links.length) links = document.querySelectorAll('a[href*="/groups/"]');

    let rootMatchCount = 0, belowCutoffCount = 0, keptCount = 0;

    links.forEach(el => {
        const name = (el.innerText || '').trim();
        if (name.length <= 2 || name.includes('Join')) return;
        const url = el.href.split('?')[0];
        // Only group-ROOT links (real entries), not /groups/ID/posts/... sub-links.
        const m = url.match(/groups\/(\d+)\/?$/) || url.match(/groups\/([a-zA-Z0-9.]+)\/?$/);
        if (!m) return;
        rootMatchCount++;
        const id = m[1];
        if (GROUP_NON_GROUP_SLUGS.has(id.toLowerCase())) return;
        if (__isBelowSuggestionCutoff(el)) { belowCutoffCount++; return; } // past the suggestions heading — never count
        const nkey = __normName(name);
        if (__seenGroupNames.has(nkey)) return; // same group, different id form
        // A membership row has no "Join" button; a suggestion card does.
        const card = el.closest('[role="listitem"], [role="article"], li') || el.parentElement;
        const cardText = (card?.textContent || '').toLowerCase();
        if (/\bjoin\b/.test(cardText) || cardText.includes('הצטרף') || cardText.includes('מוצע')) return;
        if (!into.has(id)) { into.set(id, { id, name, url }); __seenGroupNames.add(nkey); keptCount++; }
    });

    // Safety net: the heading-based cutoff is a heuristic and can misfire (wrong heading
    // matched, or the real list sits below it in an unexpected layout). If it excludes
    // EVERY real group despite links being present, that's worse than under-filtering —
    // disable it for the rest of this run and retry once, so a bad heuristic can never
    // zero out legitimate results.
    if (!_retry && __suggestionCutoffY !== Infinity && keptCount === 0 && rootMatchCount > 0 && belowCutoffCount > 0) {
        console.warn('[SafePost] suggestion cutoff excluded ALL groups — disabling it for this run and re-extracting');
        __suggestionCutoffY = Infinity;
        extractGroupsIntoMap(into, target, true);
    }
}

// Facebook doesn't always scroll at the window level — on the groups page the list is
// often inside a nested overflow container. Find the element that actually scrolls so
// window.scrollBy doing nothing can't stall the whole scrape.
function findGroupsScrollContainer() {
    const doc = document.documentElement;
    if (doc.scrollHeight > window.innerHeight + 80) return { type: 'window' };

    // Walk up from a group link looking for a scrollable ancestor.
    let node = document.querySelector('a[href*="/groups/"]');
    while (node && node !== document.body) {
        const oy = getComputedStyle(node).overflowY;
        if (/(auto|scroll)/.test(oy) && node.scrollHeight > node.clientHeight + 80) {
            return { type: 'element', el: node };
        }
        node = node.parentElement;
    }

    // Fallback: the tallest scrollable div on the page.
    let best = null, bestH = 0;
    document.querySelectorAll('div').forEach(d => {
        const oy = getComputedStyle(d).overflowY;
        if (/(auto|scroll)/.test(oy) && d.scrollHeight > d.clientHeight + 200 && d.scrollHeight > bestH) {
            best = d; bestH = d.scrollHeight;
        }
    });
    return best ? { type: 'element', el: best } : { type: 'window' };
}

function scrollTargetStep(t) {
    if (t.type === 'window') window.scrollBy(0, Math.max(400, window.innerHeight * 0.9));
    else t.el.scrollTop += Math.max(400, t.el.clientHeight * 0.9);
}

function scrollTargetMetrics(t) {
    if (t.type === 'window') {
        return { pos: window.scrollY + window.innerHeight, height: document.documentElement.scrollHeight };
    }
    return { pos: t.el.scrollTop + t.el.clientHeight, height: t.el.scrollHeight };
}

function scrollTargetReset(t) {
    if (t.type === 'window') window.scrollTo(0, 0);
    else t.el.scrollTop = 0;
}

// Scroll the list to the bottom in steps, collecting groups along the way (Facebook
// removes off-screen items, so we must accumulate as we go), until it stops growing.
// Reports both the running group count and the real scroll percentage so the status
// panel always shows movement — even before new groups appear.
async function autoScrollAndCollectGroups(onProgress) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const collected = new Map();
    __seenGroupNames.clear();       // fresh run — don't carry names over from a previous scrape
    __suggestionCutoffY = Infinity; // fresh run — re-locate the suggestions boundary
    const target = findGroupsScrollContainer();

    extractGroupsIntoMap(collected, target);
    let m = scrollTargetMetrics(target);
    onProgress?.(collected.size, m.height ? Math.round((m.pos / m.height) * 100) : 0);

    let stagnant = 0;
    let lastCount = collected.size;
    let lastHeight = m.height;
    const MAX_STAGNANT = 5;   // consecutive at-bottom rounds with no growth => done
    const MAX_STEPS = 300;    // hard safety cap

    for (let i = 0; i < MAX_STEPS; i++) {
        scrollTargetStep(target);
        await sleep(700);                 // let lazy content render
        extractGroupsIntoMap(collected, target);

        m = scrollTargetMetrics(target);
        const pct = m.height ? Math.min(100, Math.round((m.pos / m.height) * 100)) : 100;
        onProgress?.(collected.size, pct);

        const atBottom = m.pos >= (m.height - 250);
        const grew = m.height > lastHeight || collected.size > lastCount;

        // Once the suggestions heading has been located and we've scrolled well past it,
        // stop immediately — everything beyond is the endless suggestions feed, not more
        // of the user's real groups (this is what previously caused the count to keep
        // growing by a steady batch on every scroll and never settle).
        const wellPastCutoff = __suggestionCutoffY !== Infinity && m.pos > __suggestionCutoffY + 900;

        if ((atBottom && !grew) || wellPastCutoff) {
            stagnant++;
            await sleep(600);             // extra grace for a slow bottom loader
            extractGroupsIntoMap(collected, target);
            if (stagnant >= MAX_STAGNANT || wellPastCutoff) break;
        } else {
            stagnant = 0;
        }
        lastCount = collected.size;
        lastHeight = m.height;
    }

    scrollTargetReset(target);
    const finalGroups = Array.from(collected.values());
    console.log('%c[SafePost DEBUG] final group count: ' + finalGroups.length, 'color:#007bff;font-weight:bold');
    console.log('[SafePost DEBUG] final group names:', finalGroups.map(g => g.name));
    return finalGroups;
}

async function scrapeAndSyncGroups(onProgress) {
    console.log("%c[SafePost] 🟦 SYNC CLICKED — showing status panel (v7.3)", "color:#007bff;font-weight:bold");
    logRemote("Starting group scrape (auto-scroll)");
    __safepostScraping = true;
    SyncStatusPanel.show();
    console.log("[SafePost] Panel element in DOM:", !!document.getElementById('safepost-status'));

    // Detect the FB user in parallel — its server sync has no timeout, so we must not
    // let it block (or stall the panel at 0 before) the scroll from starting.
    const fbProfilePromise = syncDetectedFacebookUser().catch(() => null);

    let groups;
    try {
        groups = await autoScrollAndCollectGroups((count, pct) => {
            SyncStatusPanel.update(count, pct);
            onProgress?.(count);
        });
    } finally {
        __safepostScraping = false;
    }

    const fbProfile = await fbProfilePromise;
    const fbUser = fbProfile?.facebook_user || null;
    const fbUserId = fbProfile?.facebook_user_id || null;
    logRemote(`Scrape complete. Found ${groups.length} groups.`);

    if (groups.length > 0) {
        SyncStatusPanel.setStatus('שולח לשרת...', '#3b82f6');
        safeSendMessage({ action: "SYNC_GROUPS", groups: groups, facebook_user: fbUser, facebook_user_id: fbUserId }, (response) => {
            if (chrome.runtime?.lastError) {
                console.error("BG Error:", chrome.runtime.lastError);
                SyncStatusPanel.finish(groups.length, false);
                alert("שגיאה: וודא שרעננת את התוסף!");
            } else {
                SyncStatusPanel.finish(groups.length, true);
            }
        });
    } else {
        SyncStatusPanel.finish(0, false);
        alert("⚠️ לא נמצאו קבוצות בדף. ודא שאתה בעמוד הקבוצות שלך ונסה שוב.");
    }
}

// --- Admin Approval Detection ---
function detectAdminApprovalBanner() {
    logRemote("🔍 STARTING ADMIN APPROVAL DETECTION", { url: window.location.href });

    // IMPORTANT: match only the SPECIFIC, CONTIGUOUS phrase that Facebook shows for a
    // genuinely approval-gated group. The previous version joined ALL visible page
    // text and used `.*` patterns like /אישור.*מנהל/ — which matched the words
    // "מנהל" (admin) and "אישור" (approval) appearing ANYWHERE on the page (group
    // rules, "group admins" sidebar, unrelated posts). Virtually every group page
    // contains both words, so it produced constant false positives and blocked every
    // post. We now require the exact contiguous approval phrases only.

    // The real banner phrases (contiguous, not spanning the whole page):
    const approvalPhrases = [
        'בהמתנה לאישור מנהל',   // "pending admin approval"
        'ממתין לאישור מנהל',    // "awaiting admin approval"
        'ממתין לאישור המנהל',
        'הפוסט שלך ממתין לאישור', // "your post is pending approval"
        'ממתין לאישור לפני',
        'pending approval',
        'awaiting approval',
        'pending admin approval',
        'your post is pending',
    ];

    // Scan individual elements' own text (not the whole-page concatenation) so a
    // phrase must appear as a real contiguous banner, not assembled from scattered words.
    const elements = Array.from(document.querySelectorAll('div, span, a, h1, h2, h3'));
    let matchedText = null;
    for (const el of elements) {
        if (el.offsetParent === null) continue; // visible only
        const text = (el.textContent || '').trim();
        if (!text || text.length > 300) continue; // banners are short
        const lower = text.toLowerCase();
        if (approvalPhrases.some(p => lower.includes(p.toLowerCase()))) {
            matchedText = text;
            break;
        }
    }

    const detected = matchedText !== null;
    logRemote("🔍 APPROVAL CHECK DETAILED", {
        detected,
        url: window.location.href,
        matchedText: matchedText ? matchedText.substring(0, 200) : null,
    });

    if (detected) {
        logRemote("⛔ APPROVAL BANNER DETECTED - BLOCKING POST", { matchedText });
    } else {
        logRemote("✅ No approval banner — proceeding");
    }

    return detected;
}

// --- Listen for Dashboard Requests ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_FACEBOOK_USER') {
        // detectCurrentFacebookUser() resolves an object, not a bare name — sending it
        // back as-is under the same "facebook_user" key double-wraps it, and the
        // caller (background.js) ends up forwarding that object as the group-sync
        // payload's facebook_user, which the server can't .trim() (crashes the sync).
        detectCurrentFacebookUser().then(profile => {
            sendResponse({ facebook_user: profile?.facebook_user || null, facebook_user_id: profile?.facebook_user_id || null });
        });
        return true;
    }
    if (request.action === 'EXECUTE_POST') {
        window.currentTaskId = request.job.id;
        performPost(request.job).then(sendResponse);
        return true;
    }
});

async function performPost(job) {
    logRemote("🤖 Starting Execution Sequence", { jobId: job.id });

    window.hud.mount();
    window.hud.setContext({
        jobId: job.id,
        groupName: job.group_name || job.group_url || 'קבוצה',
        contentChars: job.content ? job.content.length : null
    });
    window.hud.startElapsedTimer();
    window.hud.updateText("בדיקה", "בודק הרשאות קבוצה...");

    // Pre-flight only blocks an explicit inability to post. A pending-approval
    // indicator can belong to an older post and is not an account restriction.
    logRemote("🔐 Starting pre-flight admin approval check...", { url: window.location.href });

    // Wait for page to fully render
    await sleep(2000);

    logRemote("📄 Scanning page for approval banner...");
    const preflightTriggers = [
        "What's on your mind", "Write something", "Create a public post",
        '\u05db\u05ea\u05d5\u05d1 \u05de\u05e9\u05d4\u05d5',
        '\u05db\u05d0\u05df \u05db\u05d5\u05ea\u05d1\u05d9\u05dd',
        '\u05e6\u05d5\u05e8 \u05e4\u05d5\u05e1\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9',
        '\u05d4\u05d1\u05e2\u05ea \u05d3\u05e2\u05d4'
    ];
    const preflightTrigger = await findElementRobust(preflightTriggers);
    const preflight = window.SafePostFB?.detectPreflightPostingBlock(document) || { blocked: false };
    const approved = preflight.blocked && !preflightTrigger;

    if (approved) {
        logRemote("🛑 CRITICAL: ADMIN APPROVAL PENDING DETECTED!!!");
        window.hud.updateText("ביטול משימה", "הקבוצה ממתינה לאישור מנהל");

        // Send cancellation to server
        const payload = {
            taskId: job.id,
            status: 'CANCELLED',
            // NOTHING WAS SUBMITTED on this path — the group already had a post
            // waiting, so we stopped before opening the composer. This is the only
            // moderation outcome that is safe to republish later, and the 48h
            // resume sweep keys off exactly this code.
            error_code: 'POSTING_NOT_ALLOWED',
            failure_reason: 'ממתין לאישור מנהל – הפוסט לא נשלח'
        };

        logRemote("📤 Sending CANCELLED status", payload);
        safeSendMessage({
            action: "REPORT_STATUS",
            payload: payload
        });

        // Wait to ensure message sends
        await sleep(2000);
        logRemote("🔴 Destroying HUD and closing tab");
        window.hud.destroy();

        // Double-ensure tab closes
        safeSendMessage({ action: 'CLOSE_TAB' });
        await sleep(1000);

        logRemote("✅ Task cancelled successfully - stopping execution");
        return; // STOP HERE - do not continue
    }

    logRemote("✅ Pre-flight check PASSED - no admin approval pending, proceeding with post");
    window.hud.updateText("מתחיל עבודה", "טוען נתוני פוסט...");

    // 1. Trigger "Create Post" Modal
    const triggers = ["What's on your mind", "Write something", "Create a public post", "כתוב משהו", "כאן כותבים", "צור פוסט ציבורי", "הבעת דעה"];
    let trigger = await findElementRobust(triggers);

    // FALLBACK: if standard phrases failed, try to find ANY contenteditable or input for posts
    if (!trigger) {
      logRemote("🔄 Standard trigger phrases failed. Trying fallback strategies...");
      // Try clicking any button that contains "post" or matches composition box role
      const allButtons = Array.from(document.querySelectorAll('[role="button"], button'));
      for (const btn of allButtons) {
        if (btn.offsetParent === null) continue; // visible only
        const text = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('post') || text.includes('כתוב') || text.includes('write') ||
            btn.getAttribute('aria-label')?.includes('Create') ||
            btn.className?.includes('input') || btn.className?.includes('compose')) {
          trigger = btn;
          logRemote("✅ Fallback found potential trigger", { text });
          break;
        }
      }
    }

    if (!trigger) {
        logRemote("❌ Trigger not found (standard + fallback)");
        window.hud.updateText("שגיאה", "לא נמצא כפתור יצירת פוסט");
        safeSendMessage({ action: "REPORT_STATUS", payload: { taskId: job.id, status: 'FAILED', failure_reason: "Trigger button not found (all strategies)" } });
        await sleep(3000);
        window.hud.destroy();
        safeSendMessage({ action: 'CLOSE_TAB' });
        return;
    }

    trigger.click();
    logRemote("✅ Clicked Trigger");

    window.hud.updateText("פותח חלונית", "ממתין לטעינת ממשק...");
    await window.hud.startTimer(4);

    // 2. Find the Input Box
    let inputBox = await waitForInputBox();
    if (!inputBox) {
        logRemote("❌ Input box not found");
        window.hud.updateText("שגיאה קריטית", "לא נמצאה תיבת טקסט.");
        safeSendMessage({ action: "REPORT_STATUS", payload: { taskId: job.id, status: 'FAILED', failure_reason: "Input box not found" } });
        await sleep(3000);
        window.hud.destroy();
        safeSendMessage({ action: 'CLOSE_TAB' });
        return;
    }

    logRemote("✅ Found Input Box");

    // 2.5 Upload Media (If exists)
    const mediaToUpload = job.media_url || job.image_url;
    if (mediaToUpload) {
        try {
            await uploadMedia(mediaToUpload);
            logRemote("✅ Media upload flow completed");
        } catch (e) {
            logRemote("⚠️ Media Upload Error", { error: e.message });
            window.hud.updateText("שגיאת מדיה", "נכשל הוספת קובץ. ממשיך עם טקסט בלבד...");
            await sleep(2000);
        }
    }

    // 3. Inject Text
    window.hud.updateText("כותב תוכן", "מזין טקסט...");
    await typeHumanLike(inputBox, job.content);
    logRemote("✅ Text injected");

    await window.hud.startTimer(2);

    // 4. Click Post
    logRemote("🔵 Attempting to click POST button");
    window.hud.updateText("שלב סופי", "מפרסם...");

    let clicked = false;
    try {
        clicked = await clickPostButton();
    } catch (err) {
        logRemote("❌ Click Error", { error: err.message });
    }

    // Handled BEFORE the truthiness check below: DRY_RUN_BLOCKED is a non-empty
    // string, so `if (clicked)` would treat a blocked publish as a successful one
    // and walk straight into the verification/SUCCESS path.
    if (clicked === DRY_RUN_BLOCKED) {
        logRemote("🛑 DRY RUN — task terminated without publishing");
        window.hud.updateText("DRY RUN", "הפרסום נחסם — לא נשלח לפייסבוק");
        safeSendMessage({
            action: "REPORT_STATUS",
            payload: {
                taskId: job.id,
                status: 'CANCELLED',
                error_code: 'DRY_RUN_BLOCKED',
                failure_reason: 'DRY RUN — הפרסום נחסם בתוסף. לא נוצר פוסט בפייסבוק'
            }
        });
        await sleep(2000);
        window.hud.destroy();
        safeSendMessage({ action: 'CLOSE_TAB' });
        return;
    }

    if (clicked) {
        logRemote("🚀 Post button clicked (Signal Sent)");

        // 5. Verify
        const verifySuccess = await waitForModalClosure();

        // Check for post-flight pending approval
        if (verifySuccess === 'PENDING_REVIEW') {
            logRemote("⛔ Post submitted but pending review detected - cancelling task");
            window.hud.updateText("ביטול", "הפוסט ממתין לאישור מנהל");
            safeSendMessage({
                action: "REPORT_STATUS",
                payload: {
                    taskId: job.id,
                    status: 'CANCELLED',
                    failure_reason: 'ממתין לאישור מנהל – הפוסט ממתין לאישור מנהל'
                }
            });
        } else {
            // The dialog closing (or timing out) is NOT evidence of publication —
            // Facebook closes it just the same when the post goes into the group's
            // approval queue. Both branches now go through the same positive
            // verification; the only difference is what we log.
            if (!verifySuccess) logRemote("❓ Closure check timed out — verifying anyway");
            window.hud.updateText("מאמת פרסום...", "בודק תוצאה בפייסבוק...");

            const result = await verifyPublishOutcome(job);
            logRemote("🎯 Final Post Result", result);

            if (result.outcome === 'PENDING_APPROVAL') {
                window.hud.updateText("ממתין לאישור", "הפוסט ממתין לאישור מנהל");
                safeSendMessage({
                    action: "REPORT_STATUS",
                    payload: {
                        taskId: job.id,
                        status: 'CANCELLED',
                        // The post WAS submitted and is sitting in the group's approval
                        // queue. Republishing it later would duplicate content that a
                        // moderator may since have approved, so this code deliberately
                        // excludes the job from the 48h resume sweep.
                        error_code: 'MODERATION_PENDING_SUBMITTED',
                        failure_reason: 'ממתין לאישור מנהל – הפוסט נשלח וממתין לאישור'
                    }
                });
            } else if (result.outcome === 'PUBLISHED') {
                window.hud.updateText("הצלחה! 🏆", "הפוסט פורסם.");
                safeSendMessage({
                    action: "REPORT_STATUS",
                    payload: { taskId: job.id, status: 'SUCCESS', proof_url: result.permalink || null }
                });
            } else {
                // Ambiguous: the submission may or may not have gone through. Report
                // a terminal, NON-retryable state — retrying a submission that did
                // succeed would post the same content to the group twice.
                window.hud.updateText("לא אומת", "לא ניתן לאמת את הפרסום");
                safeSendMessage({
                    action: "REPORT_STATUS",
                    payload: {
                        taskId: job.id,
                        status: 'FAILED',
                        error_code: 'PUBLISH_UNVERIFIED',
                        failure_reason: 'הפרסום לא אומת – ייתכן שהפוסט נשלח. נדרשת בדיקה ידנית לפני ניסיון נוסף'
                    }
                });
            }
        }
    } else {
        logRemote("❌ Failed to find or click Post button");
        window.hud.updateText("שגיאה", "כפתור פרסום לא נמצא");
        safeSendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: "Post button not found (Color + Text strategies failed)" }
        });
    }

    await sleep(3000);
    window.hud.destroy();

    // Close the Facebook tab with explicit callback and logging
    logRemote("🔄 Requesting tab close");
    safeSendMessage({ action: 'CLOSE_TAB' }, (response) => {
        logRemote("✅ Tab close acknowledged", response);
    });

    // Fallback: close after 2 seconds if background script doesn't respond
    await sleep(2000);
    if (window.location.hostname.includes('facebook')) {
        logRemote("🔴 Fallback: forcing tab close");
        window.close();
    }
}

async function waitForInputBox() {
    for (let i = 0; i < 20; i++) {
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
            const edit = dialog.querySelector('[contenteditable="true"]');
            if (edit) return edit;
            const aria = dialog.querySelector('[aria-label*="יצירת פוסט"], [aria-label*="Create"], [aria-label*="כתוב"]');
            if (aria) return aria;
        }
        const globalEdit = document.querySelector('div[role="dialog"] div[role="textbox"]');
        if (globalEdit) return globalEdit;
        await sleep(500);
    }
    return null;
}

// --- Media Type Helpers ---
function getMediaType(pathOrUrl) {
    const clean = (pathOrUrl || '').split('?')[0].toLowerCase();
    if (/\.(mp4|webm|mov|avi|mkv)/.test(clean)) return 'video';
    return 'image';
}
function resolveMime(blobType, pathOrUrl) {
    if (blobType && (blobType.startsWith('video/') || blobType.startsWith('image/'))) return blobType;
    return getMediaType(pathOrUrl) === 'video' ? 'video/mp4' : 'image/jpeg';
}

async function uploadMedia(mediaPath) {
    const mediaType = getMediaType(mediaPath);
    logRemote(`🎬 Starting Media Flow [${mediaType.toUpperCase()}]`, { path: mediaPath });

    let fullUrl = mediaPath;
    if (!mediaPath.startsWith('http')) {
        fullUrl = `${await getBackendUrl()}${mediaPath}`;
    }

    window.hud.updateText(mediaType === 'video' ? "טוען סרטון" : "מוריד תמונה", "טוען מהענן...");
    const res = await fetch(fullUrl);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const blob = await res.blob();

    const mimeType = resolveMime(blob.type, mediaPath);
    const fileName = mediaType === 'video' ? 'upload.mp4' : 'upload.jpg';
    const file = new File([blob], fileName, { type: mimeType });
    logRemote(`📦 File ready: ${fileName} | ${mimeType} | ${(blob.size / 1024).toFixed(1)}KB`);

    window.hud.updateText("מצרף קובץ", "מחפש לחצן העלאה...");

    // Video-specific triggers searched first for video uploads
    const triggers = mediaType === 'video'
        ? ["Video", "סרטון", "Photo/Video", "תמונה/סרטון", "צילום/סרטון"]
        : ["Photo/Video", "תמונה/סרטון", "צילום/סרטון", "Add Photos", "הוסף תמונות", "תמונות/סרטונים"];

    let mediaTrigger = await findElementInModal(triggers);
    if (!mediaTrigger) {
        const query = mediaType === 'video'
            ? 'div[role="dialog"] [aria-label*="Video"], div[role="dialog"] [aria-label*="Photo"]'
            : 'div[role="dialog"] [aria-label*="Photo"], div[role="dialog"] [aria-label*="תמונה"]';
        mediaTrigger = document.querySelector(query);
    }

    if (mediaTrigger) {
        logRemote("✅ Media trigger found, clicking");
        mediaTrigger.click();
        await sleep(2000);
    }

    const fileInput = document.querySelector('div[role="dialog"] input[type="file"]');
    if (fileInput) {
        logRemote("✅ File input found, injecting file");
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Videos need extra time — Facebook encodes them server-side before the Post button enables
        const waitMs = mediaType === 'video' ? 8000 : 3000;
        window.hud.updateText(
            mediaType === 'video' ? "מעלה סרטון" : "מעלה תמונה",
            mediaType === 'video' ? "ממתין לעיבוד (עד 8 שניות)..." : "מסיים העלאה..."
        );
        await sleep(waitMs);
    } else {
        logRemote("↩️ No file input, falling back to Drag & Drop");
        const dropZone = document.querySelector('div[role="dialog"]');
        if (dropZone) {
            const dt = new DataTransfer();
            dt.items.add(file);
            ['dragenter', 'dragover', 'drop'].forEach(type => {
                dropZone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
            });
        }
        await sleep(mediaType === 'video' ? 8000 : 3000);
    }
}

// --- DRY RUN SAFETY -------------------------------------------------------
// Reads the persisted setting fresh on every call, so toggling it takes effect
// on the next job without reloading the extension or the Facebook tab.
// Any failure to read is treated as "dry run ON": an unevaluable setting must
// never be the reason a real Facebook post goes out.
const DRY_RUN_BLOCKED = (globalThis.SafePostFB && globalThis.SafePostFB.DRY_RUN_BLOCKED) || 'DRY_RUN_BLOCKED';

async function isDryRunEnabled() {
    try {
        const settings = await chrome.storage.local.get(['dryRunMode', 'apiUrl']);
        return globalThis.SafePostFB.resolveDryRun(settings);
    } catch (e) {
        console.warn('[SafePost] dry-run setting unreadable — blocking publish', e);
        return true;
    }
}

// --- Human-Like Click Helper ---
// Returns true when a real click was dispatched, false when it was blocked.
// This is the ONE function in the extension that performs the final Facebook
// submission (both clickPostButton strategies funnel through it), so the guard
// lives here as well as at the entry to clickPostButton — a future caller that
// forgets the outer check still cannot publish.
async function humanClick(el) {
    if (!el) return false;

    if (await isDryRunEnabled()) {
        console.warn('🛑 [SafePost] DRY RUN — FINAL PUBLISH BLOCKED (humanClick)');
        logRemote('🛑 DRY RUN — FINAL PUBLISH BLOCKED (humanClick guard)');
        return false;
    }

    console.log("🖱️ Triggering Human-Like Click on:", el);

    // 1. Focus
    el.focus();

    // 2. MouseDown
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, view: window }));
    await sleep(50);

    // 3. MouseUp
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, view: window }));
    await sleep(50);

    // 4. Click
    el.click();
    return true;
}

async function clickPostButton() {
    console.group("⚓ [SafePost] V7.2 Deep-Search Strategy");

    // HARD GUARD. Checked before any candidate search so that in dry-run mode the
    // extension never even reaches a publish control, and returns a value the
    // caller must handle explicitly rather than a truthy "clicked" flag.
    if (await isDryRunEnabled()) {
        console.warn('🛑 [SafePost] DRY RUN — FINAL PUBLISH BLOCKED');
        logRemote('🛑 DRY RUN — FINAL PUBLISH BLOCKED (no Facebook submission was made)');
        console.groupEnd();
        return DRY_RUN_BLOCKED;
    }

    // Helper: Find by XPath
    const findByText = (root, strings) => {
        const results = [];
        for (const s of strings) {
            // XPath to find elements containing the text, case insensitive approximation
            // Using a broad scan for div, span, button, a
            const xpath = `.//*[self::div or self::span or self::button or self::a][text()="${s}" or @aria-label="${s}"]`;
            const iterator = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < iterator.snapshotLength; i++) {
                results.push(iterator.snapshotItem(i));
            }
        }
        return results;
    };

    // 1. Identify Scope (Dialogs)
    let scopes = Array.from(document.querySelectorAll('div[role="dialog"]'));
    if (scopes.length === 0) {
        console.warn("⚠️ No dialogs found. Scanning Process Scope (Body)...");
        scopes = [document.body];
    } else {
        console.log(`🔍 Found ${scopes.length} active dialogs.`);
    }

    const keywords = ["Post", "פרסום", "Publish", "פרסם"];
    const antiKeywords = ["boost", "כדאי לנסות", "schedule", "תזמון", "ערוך", "edit"];

    // 2. Semantic Search Loop
    console.log("SEARCH: Deep Semantic Text Scan...");

    for (const scope of scopes) {
        // A. Direct Text Match (Tag Agnostic)
        const candidates = findByText(scope, keywords);

        // B. Filter candidates
        const valid = candidates.find(el => {
            if (!isElementVisibleAndEnabled(el)) return false;

            // Check generic text anti-patterns
            const txt = (el.innerText || "").toLowerCase();
            if (antiKeywords.some(bad => txt.includes(bad))) return false;

            // Ensure it's not just a label text but interactive-ish
            // If it's a span/div, make sure it has a click listener (hard to detect) or pointer cursor
            const style = window.getComputedStyle(el);
            const isClickable = el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || style.cursor === 'pointer';

            return isClickable;
        });

        if (valid) {
            console.log("✅ SEMANTIC WINNER FOUND:", valid);

            // Highlight
            valid.style.border = "5px solid #FF00FF"; // Magenta
            valid.style.boxShadow = "0 0 20px #FF00FF";
            valid.scrollIntoView({ block: "center", behavior: "smooth" });

            await sleep(500);
            const dispatched = await humanClick(valid);
            console.groupEnd();
            // humanClick refuses in dry-run mode; never report that as published.
            return dispatched ? true : DRY_RUN_BLOCKED;
        }
    }

    // 3. Heuristic Fallback (Blue Button)
    console.log("SEARCH: Heuristic Fallback...");

    let allCandidates = [];
    scopes.forEach(s => {
        allCandidates = allCandidates.concat(Array.from(s.querySelectorAll('div[role="button"], button, div[class*="Button"]')));
    });

    const blueCandidates = [];
    for (const el of allCandidates) {
        if (!isElementVisibleAndEnabled(el)) continue;

        const txt = (el.innerText || "").toLowerCase();
        if (antiKeywords.some(bad => txt.includes(bad))) continue;

        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const rgbMatch = bg.match(/\d+/g);
        if (!rgbMatch || rgbMatch.length < 3) continue;

        const r = parseInt(rgbMatch[0]);
        const g = parseInt(rgbMatch[1]);
        const b = parseInt(rgbMatch[2]);

        // Relaxed Blue
        if (b > r + 10 && b > g + 10) {
            blueCandidates.push(el);
        }
    }

    // Sort by "Footer-ness" (Bottom-most)
    // RTL Support: In RTL, "Next/Post" is often Left-aligned or Start-aligned. 
    // But usually in dialogs, primary action is at the corner.
    // Let's rely purely on Y (Bottom) and then X (Edge).

    if (blueCandidates.length > 0) {
        // Sort by Bottom coordinate descending
        blueCandidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectB.bottom - rectA.bottom; // Lowest first
        });

        const best = blueCandidates[0]; // Bottom-most blue button
        console.log("✅ HEURISTIC WINNER:", best);

        best.style.border = "5px solid #00FFFF"; // Cyan
        best.scrollIntoView({ block: "center", behavior: "smooth" });
        await sleep(500);
        const dispatched = await humanClick(best);
        console.groupEnd();
        // Same rule on the heuristic fallback branch.
        return dispatched ? true : DRY_RUN_BLOCKED;
    }

    console.error("❌ FAILED: Deep Search yielded no results.");
    console.groupEnd();
    return false;
}

// Helpers
async function waitForModalClosure() {
    logRemote("⏳ Monitoring modal closure...");
    for (let i = 0; i < 30; i++) {
        const dialog = document.querySelector('div[role="dialog"]');

        // If no dialog or dialog contains "Post successful" or similar (Hebrew/English)
        if (!dialog) return true;

        const dialogText = dialog.innerText || "";
        if (dialogText.includes("Post successful") || dialogText.includes("הפוסט פורסם")) return true;

        // Check for post-flight pending approval
        const pendingPatterns = [
            'ממתין לאישור',      // "pending approval"
            'ממתין למנהל',       // "pending admin"
            'ממתין מנהל',        // "pending admin" (variant)
            'בהמתנה לאישור',    // "awaiting approval"
            'בהמתנה מנהל',       // "awaiting admin"
            'pending review',
            'awaiting approval',
            'needs approval'
        ];
        if (pendingPatterns.some(p => dialogText.toLowerCase().includes(p.toLowerCase()))) {
            logRemote("⚠️ Post submitted but pending review detected - blocking post");
            return 'PENDING_REVIEW';
        }

        await sleep(500);
    }
    return false;
}

// Decide what actually happened after the submit click.
//
// waitForModalClosure() only ever inspected the OPEN dialog, and its first line
// returns true the moment the dialog is gone — so a submission that Facebook
// accepted straight into the group's approval queue looked identical to a real
// publication. The pending banner is rendered on the GROUP PAGE after the dialog
// closes, which is precisely when the old code had already stopped looking.
//
// Returns one of:
//   { outcome: 'PENDING_APPROVAL' }              — held for a moderator
//   { outcome: 'PUBLISHED', permalink|null }     — positively verified
//   { outcome: 'UNVERIFIED' }                    — no evidence either way
async function verifyPublishOutcome(job) {
    logRemote("🔎 Verifying publish outcome (post-submit)...");

    // 1. Moderation wins: it is the one state Facebook shows explicitly, and
    //    treating it as published is the bug this function exists to prevent.
    //    Re-uses the same contiguous-phrase scan as the pre-flight check.
    for (let i = 0; i < 4; i++) {
        await sleep(1500);
        if (detectAdminApprovalBanner()) {
            logRemote("⛔ Post-submit: pending-approval detected");
            return { outcome: 'PENDING_APPROVAL' };
        }
    }

    // 2. Strongest positive evidence: a permalink to the new post.
    const permalink = await findPostPermalink();
    if (permalink) {
        logRemote("✅ Post-submit: permalink verified", { permalink });
        return { outcome: 'PUBLISHED', permalink };
    }

    // 3. Weaker but still positive: our own content rendered in the group feed.
    //    Matching on a distinctive slice of the text we just submitted avoids
    //    mistaking somebody else's post for ours.
    const needle = (job && typeof job.content === 'string')
        ? job.content.replace(/\s+/g, ' ').trim().slice(0, 60)
        : null;
    if (needle && needle.length >= 12) {
        const pageText = (document.body.innerText || '').replace(/\s+/g, ' ');
        if (pageText.includes(needle)) {
            logRemote("✅ Post-submit: content located in the group feed");
            return { outcome: 'PUBLISHED', permalink: null };
        }
    }

    logRemote("❓ Post-submit: neither publication nor moderation could be verified");
    return { outcome: 'UNVERIFIED' };
}

async function findPostPermalink() {
    logRemote("🔍 Searching for new post permalink...");
    await sleep(2000); // Wait for feed to update

    const timePhrases = ["Just now", "אף לא רגע", "עכשיו", "1 min", "1 דק"];
    
    for (let attempt = 0; attempt < 3; attempt++) {
        const links = Array.from(document.querySelectorAll('a[href*="/groups/"][href*="/permalink/"]'));
        for (const link of links) {
            const text = link.innerText || "";
            if (timePhrases.some(p => text.includes(p))) {
                const url = link.href.split('?')[0];
                logRemote("✅ Permalink found via timestamp link", { url });
                return url;
            }
        }
        await sleep(2000);
    }

    // Deliberately NULL, not the group URL. Returning the group URL here made an
    // unfound permalink indistinguishable from a found one, and the caller then
    // reported SUCCESS with the group address as its "proof" — which is how a post
    // sitting in a group's approval queue was recorded as published. The caller
    // decides what an absent permalink means; it is not evidence of publication.
    logRemote("⚠️ Specific permalink not found");
    return null;
}

function isElementVisibleAndEnabled(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getAttribute('aria-disabled') !== 'true';
}

async function findElementRobust(phrases) {
    // Try standard phrase matching first
    for (let i = 0; i < 8; i++) {
        for (let phrase of phrases) {
            const xpath = `//div[@role="button"][contains(., "${phrase}")] | //button[contains(., "${phrase}")] | //div[@aria-label="${phrase}"] | //span[contains(text(), "${phrase}")]`;
            const res = document.evaluate(xpath, document, null, 9, null).singleNodeValue;
            if (res) {
                const btn = res.closest('[role="button"]') || res.closest('button') || res;
                if (isElementVisibleAndEnabled(btn)) return btn;
            }
        }
        await sleep(300);
    }

    // FALLBACK 1: Any button/div with text matching phrases (case-insensitive)
    for (let i = 0; i < 3; i++) {
        const allButtons = Array.from(document.querySelectorAll('[role="button"], button, div[data-testid*="composer"], div[data-testid*="post"]'));
        for (const btn of allButtons) {
            if (btn.offsetParent === null) continue;
            const text = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
            if (phrases.some(p => text.includes(p.toLowerCase()))) {
                if (isElementVisibleAndEnabled(btn)) return btn;
            }
        }
        await sleep(300);
    }

    // FALLBACK 2: Look for composition/input area by data attributes or class names
    const compositionPatterns = [
        'div[contenteditable="true"]',
        'textarea',
        'input[type="text"]',
        'div[data-testid*="composer"]',
        'div[data-testid*="input"]',
        'div[class*="input"]',
        'div[class*="compose"]',
        'div[role="textbox"]'
    ];
    const compositionBox = document.querySelector(compositionPatterns.join(', '));
    if (compositionBox && isElementVisibleAndEnabled(compositionBox)) {
        // Found composition box, now look for nearby post/submit button
        const parent = compositionBox.closest('[role="dialog"], form, div[data-testid*="composer"]') || compositionBox.parentElement;
        if (parent) {
            const buttons = parent.querySelectorAll('[role="button"], button');
            for (const btn of buttons) {
                if (isElementVisibleAndEnabled(btn) && !btn.textContent.toLowerCase().includes('cancel')) {
                    return btn;
                }
            }
        }
    }

    return null;
}

async function findElementInModal(phrases) {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return null;
    for (let phrase of phrases) {
        const els = Array.from(dialog.querySelectorAll('*'));
        const found = els.find(el => (el.innerText || "").includes(phrase) || (el.getAttribute('aria-label') || "").includes(phrase));
        if (found) return found.closest('[role="button"]') || found;
    }
    return null;
}

async function typeHumanLike(element, text) {
    const errorInjectionRate = 0.03; 
    const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
    
    const keyboardLayout = {
        'א': 'ב', 'ב': 'ג', 'ש': 'ד', 'ד': 'ג', 'ק': 'ר', 'ר': 'א',
        'a': 's', 's': 'd', 'd': 'f', 'e': 'r', 'r': 't'
    };
    const getAdjacentKey = (c) => keyboardLayout[c.toLowerCase()] || 'x';

    element.focus();

    const dispatchSimulatedChar = async (char) => {
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: char }));

        if (element.isContentEditable) {
            document.execCommand('insertText', false, char);
        } else {
            const prototype = Object.getPrototypeOf(element);
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (setter) {
                setter.call(element, element.value + char);
            } else {
                element.value += char;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }

        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
    };

    const dispatchSimulatedBackspace = async () => {
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace', keyCode: 8 }));
        
        if (element.isContentEditable) {
            document.execCommand('delete', false, null);
        } else {
            const prototype = Object.getPrototypeOf(element);
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (setter) {
                setter.call(element, element.value.slice(0, -1));
            } else {
                element.value = element.value.slice(0, -1);
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }

        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Backspace', keyCode: 8 }));
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // Skip error injection for speed (errorInjectionRate = 0 for fast mode)
        // if (Math.random() < errorInjectionRate && char.match(/[a-zA-Zא-ת]/)) {
        //     const wrongChar = getAdjacentKey(char);
        //     await dispatchSimulatedChar(wrongChar);
        //     await sleep(randomBetween(100, 200));
        //     await dispatchSimulatedBackspace();
        //     await sleep(randomBetween(30, 80));
        // }

        await dispatchSimulatedChar(char);

        // OPTIMIZED for ~7 second typing (from 15-20s)
        let delayInterval = randomBetween(8, 15);   // Regular char: 8-15ms (was 20-50)
        if (char === ' ') {
            delayInterval = randomBetween(10, 20);  // Space: 10-20ms (was 60-150)
        } else if (char === '.' || char === ',' || char === '\n') {
            delayInterval = randomBetween(15, 50);  // Punctuation: 15-50ms (was 200-400)
        }

        await sleep(delayInterval);
    }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// HUD Implementation
injectStyles();
window.hud = {
    elapsedInterval: null,
    elapsedSeconds: 0,
    timerTotal: 0,
    timerRemaining: null,
    context: null,

    mount: () => {
        if (document.getElementById('safepost-hud')) return;
        const div = document.createElement('div');
        div.id = 'safepost-hud';
        div.innerHTML = `
            <div id="hud-elapsed">0s</div>
            <div id="hud-timer">--s</div>
            <div id="hud-title">מערכת אופטימיזציה</div>
            <div id="hud-status">מוכן לעבודה</div>
            <div id="hud-meta">ממתין להתחלת משימה</div>
            <div id="hud-progress"><span></span></div>
            <div id="hud-version">v7.2</div>
        `;
        document.body.appendChild(div);
        window.hud.refreshMeta();
    },
    refreshMeta: () => {
        const meta = document.getElementById('hud-meta');
        if (!meta) return;
        const parts = [];
        if (window.hud.context?.jobId) parts.push(`משימה #${window.hud.context.jobId}`);
        if (window.hud.context?.groupName) parts.push(window.hud.context.groupName);
        if (typeof window.hud.context?.contentChars === 'number') parts.push(`${window.hud.context.contentChars} תווים`);
        if (window.hud.elapsedSeconds > 0) parts.push(`רץ ${window.hud.formatElapsed(window.hud.elapsedSeconds)}`);
        meta.innerText = parts.length ? parts.join(' · ') : 'ממתין להתחלת משימה';
    },
    formatElapsed: (totalSeconds) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    },
    setContext: (ctx = {}) => {
        window.hud.context = {
            jobId: ctx.jobId || null,
            groupName: ctx.groupName || ctx.group_url || 'קבוצה',
            contentChars: typeof ctx.contentChars === 'number' ? ctx.contentChars : null,
        };
        window.hud.refreshMeta();
    },
    updateProgress: () => {
        const bar = document.querySelector('#hud-progress span');
        if (!bar) return;
        if (window.hud.timerTotal > 0 && window.hud.timerRemaining !== null) {
            const pct = Math.max(0, Math.min(100, ((window.hud.timerTotal - window.hud.timerRemaining) / window.hud.timerTotal) * 100));
            bar.style.width = `${pct}%`;
        } else if (window.hud.elapsedSeconds > 0) {
            bar.style.width = `${Math.min(100, (window.hud.elapsedSeconds % 30) * (100 / 30))}%`;
        } else {
            bar.style.width = '18%';
        }
    },
    updateText: (t, s) => {
        const title = document.getElementById('hud-title');
        const status = document.getElementById('hud-status');
        if (title) title.innerText = t;
        if (status) status.innerText = s;
        window.hud.refreshMeta();
    },
    startTimer: async (s) => {
        const timer = document.getElementById('hud-timer');
        window.hud.timerTotal = s;
        window.hud.timerRemaining = s;
        window.hud.updateProgress();
        for (let i = s; i > 0; i--) {
            window.hud.timerRemaining = i;
            if (timer) timer.innerText = `${i}s`;
            window.hud.updateProgress();
            await sleep(1000);
        }
        window.hud.timerRemaining = 0;
        if (timer) timer.innerText = "GO!";
        window.hud.updateProgress();
    },
    startElapsedTimer: () => {
        if (window.hud.elapsedInterval) clearInterval(window.hud.elapsedInterval);
        window.hud.elapsedSeconds = 0;
        const elapsed_el = document.getElementById('hud-elapsed');
        if (elapsed_el) elapsed_el.innerText = "0s";
        window.hud.updateProgress();

        window.hud.elapsedInterval = setInterval(() => {
            window.hud.elapsedSeconds++;
            if (elapsed_el) {
                elapsed_el.innerText = window.hud.formatElapsed(window.hud.elapsedSeconds);
            }
            window.hud.refreshMeta();
            window.hud.updateProgress();
        }, 1000);
    },
    stopElapsedTimer: () => {
        if (window.hud.elapsedInterval) {
            clearInterval(window.hud.elapsedInterval);
            window.hud.elapsedInterval = null;
        }
    },
    destroy: () => {
        window.hud.stopElapsedTimer();
        window.hud.timerTotal = 0;
        window.hud.timerRemaining = null;
        window.hud.elapsedSeconds = 0;
        window.hud.context = null;
        const h = document.getElementById('safepost-hud');
        if (h) h.remove();
    }
};

function injectStyles() {
    if (document.getElementById('hud-css')) return;
    const s = document.createElement('style');
    s.id = 'hud-css';
    s.innerHTML = `
        #safepost-hud { position: fixed; bottom: 18px; right: 18px; width: 320px; background: linear-gradient(180deg, #1a1a1a 0%, #111 100%); border: 2px solid #28a745; color: white; padding: 14px 14px 12px; border-radius: 14px; z-index: 1000000; direction: rtl; font-family: sans-serif; box-shadow: 0 10px 28px rgba(0,0,0,0.38); backdrop-filter: blur(10px); }
        #hud-elapsed { position: absolute; top: 12px; left: 12px; background: #28a745; padding: 4px 10px; border-radius: 999px; font-weight: 800; font-size: 12px; font-family: monospace; min-width: 44px; text-align: center; color: white; direction: ltr; box-shadow: 0 0 0 1px rgba(255,255,255,0.1) inset; }
        #hud-timer { position: absolute; top: 12px; right: 12px; background: #007bff; padding: 4px 10px; border-radius: 999px; font-weight: 800; font-size: 12px; min-width: 44px; text-align: center; }
        #hud-title { font-weight: 800; margin: 26px 52px 4px; color: #c8dcff; font-size: 14px; line-height: 1.1; }
        #hud-status { font-size: 12px; opacity: 0.92; margin: 0 0 4px; color: #f3f4f6; }
        #hud-meta { font-size: 10px; opacity: 0.72; line-height: 1.35; min-height: 14px; margin-bottom: 8px; color: #cbd5e1; }
        #hud-progress { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-bottom: 8px; }
        #hud-progress span { display:block; height:100%; width:18%; border-radius:inherit; background: linear-gradient(90deg, #28a745, #63e6be); transition: width .25s ease; }
        #hud-version { position: absolute; bottom: 8px; left: 12px; font-size: 9px; opacity: 0.32; letter-spacing: 0.12em; }
    `;
    document.head.appendChild(s);
}
