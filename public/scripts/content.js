console.log("%c 🟢 SAFEEPOST v7.0 - ENGINE STABLE " + new Date().toLocaleTimeString(), "background: green; color: white; font-size: 20px; padding: 10px; border-radius: 5px;");
console.log("[SafePost] Content Script v7.0 LOADED - Supabase Storage Sync");

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
        if (chrome.storage?.local?.get) {
            const data = await chrome.storage.local.get(FACEBOOK_USER_STORAGE_KEYS);
            return {
                name: data.fb_session || data.safepost_currentUser || data.safepost_detectedFacebookUser || null,
                id: data.safepost_currentUserId || null
            };
        }
    } catch (e) {
        console.warn('[SafePost] Could not read chrome.storage.local for FB user', e);
    }
    return {
        name: localStorage.getItem('safepost_currentUser') || null,
        id: localStorage.getItem('safepost_currentUserId') || null
    };
}

function getActiveUserIdFromCookie() {
    const m = document.cookie.match(/(?:^|;\s*)c_user=(\d+)/);
    return m ? m[1] : null;
}

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
            if (normalized) return normalized;
        }
    }
    return null;
}

function extractNameFromInitialData(activeUserId) {
    const exactScopedName = extractNameFromUserScopedScripts(activeUserId);
    if (exactScopedName) return exactScopedName;

    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
        const text = script.textContent;
        if (!text || !text.includes('CurrentUserInitialData')) continue;
        const idx = text.indexOf('CurrentUserInitialData');
        const slice = text.slice(idx, idx + 4000);
        if (activeUserId) {
            const idMatch = slice.match(/"USER_ID"\s*:\s*"(\d+)"/);
            if (idMatch && idMatch[1] !== activeUserId) continue;
        }
        const nameMatch = slice.match(/"NAME"\s*:\s*"([^"]+)"/);
        if (nameMatch && nameMatch[1]) {
            const normalized = normalizeFacebookUser(decodeUnicodeEscapes(nameMatch[1]));
            if (normalized) return normalized;
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
                if (normalized) return normalized;
            }
        }
    }
    return null;
}

function collectFacebookUserCandidates() {
    const candidates = [];
    const visited = new Set();
    const push = (value) => {
        const normalized = normalizeFacebookUser(value);
        if (normalized && !visited.has(normalized)) {
            visited.add(normalized);
            candidates.push(normalized);
        }
    };
    const activeUserId = getActiveUserIdFromCookie();

    const nameFromData = extractNameFromInitialData(activeUserId);
    if (nameFromData) push(nameFromData);

    const nameFromProfileLink = extractNameFromActiveProfileLinks(activeUserId);
    if (nameFromProfileLink) push(nameFromProfileLink);

    const selectors = [
        'a[href*="/me/"]',
        'a[href*="profile.php"]',
        '[role="navigation"] a',
        '[role="banner"] a',
        'a[aria-label*="Profile"]',
        'button[aria-label*="Profile"]',
    ];

    selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
            const values = [
                el.innerText,
                el.textContent,
                el.getAttribute('aria-label'),
                el.getAttribute('title'),
            ];
            values.forEach((raw) => {
                push(raw);
            });
        });
    });

    push(document.querySelector('meta[property="og:title"]')?.content);
    push(document.title);

    return candidates;
}

async function detectCurrentFacebookUser() {
    const activeId = getActiveUserIdFromCookie();
    const candidates = collectFacebookUserCandidates();
    const detected = normalizeFacebookUser(candidates[0]);
    if (detected) {
        try {
            localStorage.setItem('safepost_currentUser', detected);
            if (activeId) localStorage.setItem('safepost_currentUserId', activeId);
        } catch { /* noop */ }
        return { facebook_user: detected, facebook_user_id: activeId || null };
    }

    const storedProfile = await getStoredFacebookUser();
    const storedName = normalizeFacebookUser(storedProfile?.name);
    const storedId = storedProfile?.id || localStorage.getItem('safepost_currentUserId') || null;
    if (storedName && (!activeId || !storedId || storedId === activeId)) {
        return { facebook_user: storedName, facebook_user_id: activeId || storedId || null };
    }
    return { facebook_user: null, facebook_user_id: activeId || null };
}

async function syncDetectedFacebookUser() {
    const profile = await detectCurrentFacebookUser();
    const fbUser = profile?.facebook_user || null;
    const fbUserId = profile?.facebook_user_id || getActiveUserIdFromCookie() || null;
    if (!fbUser) return null;

    try {
        localStorage.setItem('safepost_currentUser', fbUser);
        if (fbUserId) localStorage.setItem('safepost_currentUserId', fbUserId);
    } catch { /* noop */ }

    if (chrome.runtime?.id) {
        try {
            chrome.runtime.sendMessage({
                action: 'SET_FACEBOOK_USER',
                facebook_user: fbUser,
                facebook_user_id: fbUserId
            });
        } catch { /* noop */ }
    }

    return { facebook_user: fbUser, facebook_user_id: fbUserId };
}

syncDetectedFacebookUser().catch(() => {});

// 1. Inject Manual Sync Button
function injectButton() {
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
        btn.innerText = "⏳ Scanning...";
        btn.style.backgroundColor = "#e0a800"; // Orange
        await scrapeAndSyncGroups();
        setTimeout(() => {
            btn.innerText = "🔄 SAFEPOST: SYNC GROUPS";
            btn.style.backgroundColor = "#007bff"; // Back to Blue
        }, 3000);
    };

    document.body.appendChild(btn);
}

// Run injection immediately and periodically
injectButton();
setInterval(injectButton, 5000);

// 2. Scrape Logic
async function scrapeAndSyncGroups() {
    logRemote("Starting group sync via background worker");
    await syncDetectedFacebookUser().catch(() => null);

    chrome.runtime.sendMessage({ action: "SCAN_AND_SYNC_GROUPS" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("BG Error:", chrome.runtime.lastError);
            alert("Sync failed. Reload the extension and try again.");
            return;
        }
        if (!response?.success) {
            alert(`Group sync failed: ${response?.error || 'unknown error'}`);
            return;
        }
        const syncedCount = response?.synced || response?.added || 0;
        alert(`Group sync completed: ${syncedCount} groups.`);
    });
}

// --- Posting Logic ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXECUTE_POST') {
        window.currentTaskId = request.job.id;
        performPost(request.job).then(sendResponse);
        return true;
    }
});

async function performPost(job) {
    logRemote("🤖 Starting Execution Sequence", { jobId: job.id, url: window.location.href });
    console.log(`[Content] 🚀 STARTING JOB #${job.id}`);
    console.log(`[Content] URL: ${window.location.href}`);
    console.log(`[Content] Content: ${job.content.substring(0, 50)}...`);

    window.hud.mount();
    window.hud.setContext({
        jobId: job.id,
        groupName: job.group_name || job.group_url || 'קבוצה',
        contentChars: job.content ? job.content.length : null
    });
    window.hud.updateText("מתחיל עבודה", "טוען נתוני פוסט...");

    // Debug: Check if we're on Facebook
    const pageTitle = document.title;
    const hasFbClass = document.body.className.includes('fb') || document.body.getAttribute('class')?.includes('fb');
    logRemote("📄 Page state", { title: pageTitle, url: window.location.href, hasFbClass });
    console.log(`[Content] 📄 Page Title: ${pageTitle}, Has FB Class: ${hasFbClass}`);

    // 1. Trigger "Create Post" Modal
    console.log(`[Content] 🔍 STEP 1: Looking for trigger button...`);
    const triggers = ["What's on your mind", "Write something", "Create a public post", "כתוב משהו", "כאן כותבים", "צור פוסט ציבורי", "הבעת דעה"];
    const step1Start = Date.now();
    const trigger = await findElementRobust(triggers, 7000);
    const step1Time = Date.now() - step1Start;
    console.log(`[Content] 📊 STEP 1 took ${step1Time}ms`);

    if (!trigger) {
        console.error(`[Content] ❌ FAILED: Trigger button not found after ${step1Time}ms`);
        logRemote("❌ STEP 1 TIMEOUT: Trigger not found", { timeMs: step1Time });
        window.hud.updateText("שגיאה", "לא נמצא כפתור יצירת פוסט");
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: `STEP 1 TIMEOUT (${step1Time}ms): Post trigger button not found` }
        });
        return;
    }

    console.log(`[Content] ✅ Found trigger button, clicking...`);
    trigger.click();
    logRemote("✅ Clicked Trigger");

    window.hud.updateText("פותח חלונית", "ממתין לטעינת ממשק...");
    await sleep(500);

    // 2. Find the Input Box
    console.log(`[Content] ⌛ STEP 2: Waiting for input box...`);
    const step2Start = Date.now();
    let inputBox = await waitForInputBox(8000);
    const step2Time = Date.now() - step2Start;
    console.log(`[Content] 📊 STEP 2 took ${step2Time}ms`);

    if (!inputBox) {
        console.error(`[Content] ❌ FAILED: Input box not found after ${step2Time}ms`);
        logRemote("❌ STEP 2 TIMEOUT: Input box not found", { timeMs: step2Time });
        window.hud.updateText("שגיאה קריטית", "לא נמצאה תיבת טקסט.");
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: `STEP 2 TIMEOUT (${step2Time}ms): Input box not found` }
        });
        return;
    }

    console.log(`[Content] ✅ Found input box`);
    logRemote("✅ Found Input Box");

    // 2.5 Upload Media (If exists)
    const mediaToUpload = job.media_url || job.image_url;
    if (mediaToUpload) {
        console.log(`[Content] 📸 STEP 2.5: Uploading media...`);
        try {
            await uploadMedia(mediaToUpload);
            console.log(`[Content] ✅ Media upload completed`);
            logRemote("✅ Media upload flow completed");
        } catch (e) {
            console.error(`[Content] ⚠️ Media upload error: ${e.message}`);
            logRemote("⚠️ Media Upload Error", { error: e.message });
            window.hud.updateText("שגיאת מדיה", "נכשל הוספת קובץ. ממשיך עם טקסט בלבד...");
            await sleep(2000);
        }
    }

    // 3. Inject Text
    console.log(`[Content] 📝 STEP 3: Typing text (${job.content.length} chars)...`);
    window.hud.updateText("כותב תוכן", "מזין טקסט...");
    await typeHumanLike(inputBox, job.content);
    console.log(`[Content] ✅ Text injected`);
    logRemote("✅ Text injected");

    await sleep(300);

    // 4. Click Post
    console.log(`[Content] 🔘 STEP 4: Looking for POST button...`);
    logRemote("🔵 Attempting to click POST button");
    window.hud.updateText("שלב סופי", "מפרסם...");

    let clicked = false;
    const step4Start = Date.now();
    try {
        clicked = await clickPostButton(6000);
        const step4Time = Date.now() - step4Start;
        console.log(`[Content] 📊 STEP 4 took ${step4Time}ms. Click result: ${clicked}`);
    } catch (err) {
        const step4Time = Date.now() - step4Start;
        console.error(`[Content] ❌ STEP 4 error after ${step4Time}ms: ${err.message}`);
        logRemote("❌ STEP 4 Error", { error: err.message, timeMs: step4Time });
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: `STEP 4 ERROR (${step4Time}ms): ${err.message}` }
        });
        return;
    }

    if (clicked) {
        console.log(`[Content] ✅ Post button clicked successfully`);
        logRemote("🚀 Post button clicked (Signal Sent)");

        // 5. Verify
        console.log(`[Content] ⏳ STEP 5: Waiting for modal closure verification...`);
        const step5Start = Date.now();
        const verifySuccess = await waitForModalClosure(8000);
        const step5Time = Date.now() - step5Start;
        console.log(`[Content] 📊 STEP 5 took ${step5Time}ms`);

        if (verifySuccess) {
            console.log(`[Content] ✅✅✅ JOB #${job.id} COMPLETED SUCCESSFULLY`);
            logRemote("🎯 Post Success Verified");
            window.hud.updateText("הצלחה! 🏆", "הפוסט פורסם.");
            chrome.runtime.sendMessage({
                action: "REPORT_STATUS",
                payload: { taskId: job.id, status: 'SUCCESS' }
            });
        } else {
            console.log(`[Content] ⏳ Modal closure verification timed out after ${step5Time}ms (likely still posted)`);
            logRemote("❓ STEP 5 TIMEOUT: Closure check timed out", { timeMs: step5Time });
            window.hud.updateText("בדיקת סיום", "ממתין לאימות פייסבוק...");
            // Still mark as SUCCESS because post button was clicked
            chrome.runtime.sendMessage({
                action: "REPORT_STATUS",
                payload: { taskId: job.id, status: 'SUCCESS', metadata: { notice: 'Modal closure timeout, but post likely sent' } }
            });
        }
    } else {
        console.error(`[Content] ❌❌ JOB #${job.id} FAILED - Post button not found`);
        logRemote("❌ STEP 4 TIMEOUT/FAILED: Post button not found");
        window.hud.updateText("שגיאה", "כפתור פרסום לא נמצא");
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: "STEP 4: Post button not found (Color + Text strategies failed)" }
        });
    }

    await sleep(800);
    window.hud.destroy();
}

async function waitForInputBox(timeoutMs = 8000) {
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
            const edit = dialog.querySelector('[contenteditable="true"]');
            if (edit) return edit;
            const aria = dialog.querySelector('[aria-label*="יצירת פוסט"], [aria-label*="Create"], [aria-label*="כתוב"]');
            if (aria) return aria;
        }
        const globalEdit = document.querySelector('div[role="dialog"] div[role="textbox"]');
        if (globalEdit) return globalEdit;

        attempt++;
        if (attempt % 3 === 0) {
            console.log(`[Content] ⏳ STEP 2: Waiting for input box... attempt ${attempt}, ${Math.round((Date.now() - startTime) / 1000)}s elapsed`);
        }
        await sleep(500);
    }

    console.error(`[Content] ❌ Input box timeout after ${timeoutMs}ms`);
    return null;
}

async function uploadMedia(mediaPath) {
    logRemote("📸 Starting Media Flow", { path: mediaPath });

    let fullUrl = mediaPath;
    if (!mediaPath.startsWith('http')) {
        fullUrl = `http://localhost:3001${mediaPath}`;
    }

    window.hud.updateText("מוריד תמונה", "טוען מהענן...");
    const res = await fetch(fullUrl);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], "upload.jpg", { type: blob.type });

    window.hud.updateText("מצרף קובץ", "מחפש לחצן העלאה...");
    const photoVideoTriggers = ["Photo/Video", "צילום/סרטון", "תמונה/סרטון", "הוסף תמונות", "Add Photos", "תמונות/סרטונים", "מדיה"];
    let mediaTrigger = await findElementInModal(photoVideoTriggers);

    if (!mediaTrigger) {
        mediaTrigger = document.querySelector('div[role="dialog"] [aria-label*="Photo"], div[role="dialog"] [aria-label*="תמונה"], div[role="dialog"] [aria-label*="מדיה"]');
    }

    if (mediaTrigger) {
        logRemote("Clicking media trigger");
        mediaTrigger.click();
        await sleep(2000);
    }

    const fileInput = document.querySelector('div[role="dialog"] input[type="file"]');
    if (fileInput) {
        logRemote("Found file input, injecting file");
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait for it to stabilize
        await sleep(3000);
    } else {
        logRemote("No file input found, trying Drag & Drop");
        const dropZone = document.querySelector('div[role="dialog"]');
        const dt = new DataTransfer(); dt.items.add(file);
        ['dragenter', 'dragover', 'drop'].forEach(type => {
            dropZone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        });
        await sleep(3000);
    }
}

// --- Human-Like Click Helper ---
async function humanClick(el) {
    if (!el) return;

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
}

async function clickPostButton(timeoutMs = 6000) {
    const startTime = Date.now();
    console.group("⚓ [SafePost] V7.0 Bottom-Right Anchor Strategy");
    console.log("Searching for Blue Button in Bottom-Right Zone...");

    // 1. Target the Dialog
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) {
        console.error("❌ No dialog found!");
        console.groupEnd();
        return false;
    }

    // Safety: if we exceed timeout, abort
    if (Date.now() - startTime > timeoutMs) {
        console.error(`❌ clickPostButton timeout after ${timeoutMs}ms`);
        console.groupEnd();
        return false;
    }

    // 2. Collect Candidates (Recursive Scan)
    // Strategy: Find all elements, filter for interactive ones
    const allElements = Array.from(dialog.querySelectorAll('*'));
    const candidates = allElements.filter(el => {
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        const isInteractive = (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || style.cursor === 'pointer');
        return isVisible && isInteractive && el.offsetParent !== null;
    });

    console.log(`🔎 Scan: Found ${candidates.length} interactive candidates.`);

    const blueCandidates = [];

    // 3. Filter for Blue Range (Relaxed V7.0 Algorithm)
    for (const el of candidates) {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const color = style.color;

        // Parse RGB
        const rgbMatch = bg.match(/\d+/g);
        if (!rgbMatch || rgbMatch.length < 3) continue;

        const r = parseInt(rgbMatch[0]);
        const g = parseInt(rgbMatch[1]);
        const b = parseInt(rgbMatch[2]);

        console.log(`🎨 Candidate: "${el.innerText.substring(0, 15)}..." [${r}, ${g}, ${b}]`);

        // Logic: B > R + 30 && B > G + 30 (Facebook Blue)
        if (b > r + 30 && b > g + 30) {
            console.log(`🔵 Blue Candidate Found: "${el.innerText}" (R:${r} G:${g} B:${b})`);
            blueCandidates.push(el);
        }
    }

    console.log(`🎯 Filter: ${blueCandidates.length} Blue Candidates remain.`);

    let bestCandidate = null;
    let maxAnchorScore = -Infinity;

    // 4. Position Scoring: Maximize (Bottom + Right)
    const dialogRect = dialog.getBoundingClientRect();
    const dialogBottom = dialogRect.bottom;
    const dialogRight = dialogRect.right;

    for (const el of blueCandidates) {
        const rect = el.getBoundingClientRect();

        // Anchor Score = rect.bottom + rect.right (Higher is further down-right)
        const anchorScore = rect.bottom + rect.right;

        console.log(`📐 Cand "${el.innerText.substring(0, 15)}...": Score=${Math.round(anchorScore)} (Bottom:${Math.round(rect.bottom)}, Right:${Math.round(rect.right)})`);

        if (anchorScore > maxAnchorScore) {
            maxAnchorScore = anchorScore;
            bestCandidate = el;
        }
    }

    if (bestCandidate) {
        console.log("✅ WINNER:", bestCandidate.innerText);

        // 5. Visual Confirmation
        bestCandidate.style.border = "6px solid #00FF00"; // LIME GREEN
        bestCandidate.style.boxShadow = "0 0 20px #00FF00";
        bestCandidate.scrollIntoView({ block: "center", behavior: "smooth" });

        // 6. Human Sequence Interaction
        console.log("⚡ Dispatching Human Sequence...");
        await sleep(1000); // Wait for visual

        await humanClick(bestCandidate);

        // Verification: Check if dialog closes
        await sleep(3000);
        if (document.querySelector('div[role="dialog"]')) {
            console.warn("⚠️ Dialog still open. Trying text fallback...");
            // Fallback: aria-label="פרסום"
            const fallback = document.querySelector('[aria-label="פרסום"], [aria-label="Post"], [aria-label="Publish"]');
            if (fallback) {
                console.log("🔄 Fallback triggered on aria-label='Post/פרסום'");
                await humanClick(fallback);
            }
        }

        console.groupEnd();
        return true;
    }

    console.warn("❌ No blue buttons found. Trying Text Fallback...");

    // Last Resort Text Fallback
    const postKeywords = ["Post", "פרסום", "פרסם", "Submit", "Publish"];
    for (const kw of postKeywords) {
        const found = candidates.find(el => (el.innerText || "").includes(kw));
        if (found) {
            console.log(`🏳️ Text Fallback match: ${kw}`);
            await humanClick(found);
            console.groupEnd();
            return true;
        }
    }

    console.error("❌ STUCK: No candidates found.");
    console.groupEnd();
    return false;
}

// Helpers
async function waitForModalClosure(timeoutMs = 8000) {
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
        if (!document.querySelector('div[role="dialog"]')) {
            console.log(`[Content] ✅ Modal closed after ${Date.now() - startTime}ms`);
            return true;
        }
        attempt++;
        if (attempt % 3 === 0) {
            console.log(`[Content] ⏳ STEP 5: Waiting for modal closure... ${Math.round((Date.now() - startTime) / 1000)}s elapsed`);
        }
        await sleep(500);
    }

    console.warn(`[Content] ⏳ Modal closure timeout after ${timeoutMs}ms (likely still posted)`);
    return false;
}

function isElementVisibleAndEnabled(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getAttribute('aria-disabled') !== 'true';
}

async function findElementRobust(phrases, timeoutMs = 7000) {
    logRemote("🔍 Starting trigger search", { phrases, timeoutMs });
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
        // Strategy 1: Text contains (case-sensitive)
        for (let phrase of phrases) {
            const xpath = `//div[@role="button"][contains(., "${phrase}")] | //button[contains(., "${phrase}")] | //div[@aria-label="${phrase}"] | //span[contains(text(), "${phrase}")]`;
            const res = document.evaluate(xpath, document, null, 9, null).singleNodeValue;
            if (res) {
                const btn = res.closest('[role="button"]') || res.closest('button') || res;
                if (isElementVisibleAndEnabled(btn)) {
                    logRemote("✅ Found trigger (exact match)", { phrase, attempt, timeMs: Date.now() - startTime });
                    return btn;
                }
            }
        }

        // Strategy 2: Case-insensitive with aria-label contains
        for (let phrase of phrases) {
            const xpath = `//div[contains(@aria-label, "${phrase}")] | //button[contains(@aria-label, "${phrase}")] | //*[contains(@role, "button")][contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${phrase.toLowerCase()}")]`;
            const res = document.evaluate(xpath, document, null, 9, null).singleNodeValue;
            if (res) {
                const btn = res.closest('[role="button"]') || res.closest('button') || res;
                if (isElementVisibleAndEnabled(btn)) {
                    logRemote("✅ Found trigger (case-insensitive)", { phrase, attempt, timeMs: Date.now() - startTime });
                    return btn;
                }
            }
        }

        // Strategy 3: data-testid (Facebook's internal selectors)
        let testIdRes = document.evaluate(`//div[@data-testid="status-update"] | //div[@data-testid="create-status"] | //a[@aria-label*="Write"]`, document, null, 9, null).singleNodeValue;
        if (testIdRes && isElementVisibleAndEnabled(testIdRes)) {
            logRemote("✅ Found trigger (data-testid)", { attempt, timeMs: Date.now() - startTime });
            return testIdRes;
        }

        // Strategy 4: Broad text scan - look for any button with write/create/post/כתוב
        const allInteractive = Array.from(document.querySelectorAll('[role="button"], button, a[role="button"]'));
        const writeButton = allInteractive.find(el => {
            const text = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
            const hebrewText = (el.innerText || el.getAttribute('aria-label') || '');
            return (text.includes('write') || text.includes('create') || text.includes('post') ||
                    hebrewText.includes('כתוב') || hebrewText.includes('צור') || hebrewText.includes('כאן') ||
                    text.includes("what's on your mind") || text.includes("compose"));
        });
        if (writeButton && isElementVisibleAndEnabled(writeButton)) {
            logRemote("✅ Found trigger (text scan fallback)", { attempt, timeMs: Date.now() - startTime });
            return writeButton;
        }

        if (attempt === 0) {
            // Debug: log first 15 buttons we see on first attempt
            const sample = Array.from(document.querySelectorAll('[role="button"], button'))
                .slice(0, 15)
                .map(b => (b.innerText || b.getAttribute('aria-label') || 'no-text').substring(0, 40))
                .filter(t => t && t.length > 2);
            logRemote("⚠️ Trigger not found on first attempt", {
                url: window.location.href,
                title: document.title,
                sampleButtons: sample,
                totalButtons: document.querySelectorAll('[role="button"], button').length
            });
        }

        attempt++;
        await sleep(500);
    }

    // Timeout reached
    const timeElapsed = Date.now() - startTime;
    console.error(`[Content] ❌ Trigger timeout after ${timeElapsed}ms`);
    const allButtons = Array.from(document.querySelectorAll('[role="button"], button'))
        .map(b => (b.innerText || b.getAttribute('aria-label') || 'no-text').substring(0, 30));
    logRemote("❌ Trigger not found after timeout", {
        url: window.location.href,
        title: document.title,
        timeoutMs,
        timeElapsed,
        isLoggedIn: !!document.querySelector('[aria-label*="Profile"]'),
        totalButtonsOnPage: allButtons.length,
        sampleButtons: allButtons.slice(0, 20)
    });
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

async function typeHumanLike(el, text) {
    el.focus();
    await sleep(200);
    const success = document.execCommand('insertText', false, text);
    if (!success) el.innerText = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
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
            <div id="hud-version">v6.2</div>
        `;
        document.body.appendChild(div);
        window.hud.refreshMeta();
    },
    formatElapsed: (totalSeconds) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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
        const elapsedEl = document.getElementById('hud-elapsed');
        if (elapsedEl) elapsedEl.innerText = '0s';
        window.hud.updateProgress();
        window.hud.elapsedInterval = setInterval(() => {
            window.hud.elapsedSeconds += 1;
            if (elapsedEl) elapsedEl.innerText = window.hud.formatElapsed(window.hud.elapsedSeconds);
            window.hud.refreshMeta();
            window.hud.updateProgress();
        }, 1000);
    },
    destroy: () => {
        if (window.hud.elapsedInterval) {
            clearInterval(window.hud.elapsedInterval);
            window.hud.elapsedInterval = null;
        }
        window.hud.elapsedSeconds = 0;
        window.hud.timerTotal = 0;
        window.hud.timerRemaining = null;
        window.hud.context = null;
        const h = document.getElementById('safepost-hud');
        if (h) h.remove();
    }
};

function injectStyles() {
    if (document.getElementById('hud-css')) return;
    const s = document.createElement('style');
    s.id = 'hud-css';
    s.textContent = `
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
