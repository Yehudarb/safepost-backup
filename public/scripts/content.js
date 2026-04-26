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

// Get current Facebook user identifier
function getCurrentFacebookUser() {
    // Try to find user profile link in nav
    const profileLink = document.querySelector('a[href*="/me/"], a[data-testid="profile"]');
    if (profileLink) {
        const match = profileLink.href.match(/\/([a-zA-Z0-9.]+)(?:\?|\/|$)/);
        if (match) return match[1];
    }

    // Try to find user name in profile picture alt text
    const profileImg = document.querySelector('img[alt*="'\'']');
    if (profileImg && profileImg.alt) {
        return profileImg.alt.split('\'\'')[0];
    }

    // Try page title which often contains username
    const titleMatch = document.title.match(/([A-Za-z0-9._]+) \|/);
    if (titleMatch) return titleMatch[1];

    return null;
}

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
    logRemote("Starting group scrape");
    const fbUser = getCurrentFacebookUser();
    logRemote("Current Facebook user", { user: fbUser });

    let groupElements = document.querySelectorAll('a[href*="/groups/"]');
    let groups = [];

    groupElements.forEach(el => {
        if (el.innerText && el.innerText.length > 2 && !el.innerText.includes('Join')) {
            let url = el.href.split('?')[0];
            const match = url.match(/groups\/(\d+)/) || url.match(/groups\/([a-zA-Z0-9.]+)/);
            if (match) {
                groups.push({ id: match[1], name: el.innerText, url: url });
            }
        }
    });

    groups = groups.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
    logRemote(`Scrape complete. Found ${groups.length} groups.`);

    if (groups.length > 0) {
        chrome.runtime.sendMessage({ action: "SYNC_GROUPS", groups: groups, facebook_user: fbUser }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("BG Error:", chrome.runtime.lastError);
                alert("שגיאה: וודא שרעננת את התוסף!");
            } else {
                alert(`✅ הצלחה! נשלחו ${groups.length} קבוצות לשרת.${fbUser ? ` (${fbUser})` : ''}`);
            }
        });
    } else {
        alert("⚠️ לא נמצאו קבוצות בדף. גלול למטה ונסה שוב.");
    }
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

    window.hud.mount();
    window.hud.updateText("מתחיל עבודה", "טוען נתוני פוסט...");

    // Debug: Check if we're on Facebook
    const pageTitle = document.title;
    const hasFbClass = document.body.className.includes('fb') || document.body.getAttribute('class')?.includes('fb');
    logRemote("📄 Page state", { title: pageTitle, url: window.location.href, hasFbClass });

    // 1. Trigger "Create Post" Modal
    const triggers = ["What's on your mind", "Write something", "Create a public post", "כתוב משהו", "כאן כותבים", "צור פוסט ציבורי", "הבעת דעה"];
    const trigger = await findElementRobust(triggers);
    if (!trigger) {
        logRemote("❌ Trigger not found");
        window.hud.updateText("שגיאה", "לא נמצא כפתור יצירת פוסט");
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: "Post trigger button not found" }
        });
        return;
    }

    trigger.click();
    logRemote("✅ Clicked Trigger");

    window.hud.updateText("פותח חלונית", "ממתין לטעינת ממשק...");
    await sleep(500);

    // 2. Find the Input Box
    let inputBox = await waitForInputBox();
    if (!inputBox) {
        logRemote("❌ Input box not found");
        window.hud.updateText("שגיאה קריטית", "לא נמצאה תיבת טקסט.");
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: "Input box (textarea) not found" }
        });
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

    await sleep(300);

    // 4. Click Post
    logRemote("🔵 Attempting to click POST button");
    window.hud.updateText("שלב סופי", "מפרסם...");

    let clicked = false;
    try {
        clicked = await clickPostButton();
    } catch (err) {
        logRemote("❌ Click Error", { error: err.message });
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: `Click error: ${err.message}` }
        });
    }

    if (clicked) {
        logRemote("🚀 Post button clicked (Signal Sent)");

        // 5. Verify
        const verifySuccess = await waitForModalClosure();
        if (verifySuccess) {
            logRemote("🎯 Post Success Verified");
            window.hud.updateText("הצלחה! 🏆", "הפוסט פורסם.");
            chrome.runtime.sendMessage({
                action: "REPORT_STATUS",
                payload: { taskId: job.id, status: 'SUCCESS' }
            });
        } else {
            logRemote("❓ Closure check timed out");
            window.hud.updateText("בדיקת סיום", "ממתין לאימות פייסבוק...");
            chrome.runtime.sendMessage({
                action: "REPORT_STATUS",
                payload: { taskId: job.id, status: 'SUCCESS', metadata: { notice: 'No modal closure confirmation' } }
            });
        }
    } else {
        logRemote("❌ Failed to find or click Post button");
        window.hud.updateText("שגיאה", "כפתור פרסום לא נמצא");
        chrome.runtime.sendMessage({
            action: "REPORT_STATUS",
            payload: { taskId: job.id, status: 'FAILED', failure_reason: "Post button not found (Color + Text strategies failed)" }
        });
    }

    await sleep(800);
    window.hud.destroy();
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

async function clickPostButton() {
    console.group("⚓ [SafePost] V7.0 Bottom-Right Anchor Strategy");
    console.log("Searching for Blue Button in Bottom-Right Zone...");

    // 1. Target the Dialog
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) {
        console.error("❌ No dialog found!");
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
async function waitForModalClosure() {
    for (let i = 0; i < 20; i++) {
        if (!document.querySelector('div[role="dialog"]')) return true;
        await sleep(500);
    }
    return false;
}

function isElementVisibleAndEnabled(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getAttribute('aria-disabled') !== 'true';
}

async function findElementRobust(phrases) {
    logRemote("🔍 Starting trigger search", { phrases });

    for (let i = 0; i < 15; i++) {
        for (let phrase of phrases) {
            const xpath = `//div[@role="button"][contains(., "${phrase}")] | //button[contains(., "${phrase}")] | //div[@aria-label="${phrase}"] | //span[contains(text(), "${phrase}")]`;
            const res = document.evaluate(xpath, document, null, 9, null).singleNodeValue;
            if (res) {
                const btn = res.closest('[role="button"]') || res.closest('button') || res;
                if (isElementVisibleAndEnabled(btn)) {
                    logRemote("✅ Found trigger button", { phrase, attempt: i });
                    return btn;
                }
            }
        }
        if (i === 0) {
            logRemote("⚠️ Trigger not found on first attempt", { url: window.location.href, title: document.title });
        }
        await sleep(500);
    }

    logRemote("❌ Trigger not found after all attempts", { url: window.location.href, title: document.title, isLoggedIn: !!document.querySelector('[aria-label*="Profile"]') });
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
    mount: () => {
        if (document.getElementById('safepost-hud')) return;
        const div = document.createElement('div');
        div.id = 'safepost-hud';
        const hudTimer = document.createElement('div');
        hudTimer.id = 'hud-timer'; hudTimer.textContent = '--s';
        const hudTitle = document.createElement('div');
        hudTitle.id = 'hud-title'; hudTitle.textContent = 'מערכת אופטימיזציה';
        const hudStatus = document.createElement('div');
        hudStatus.id = 'hud-status'; hudStatus.textContent = 'מוכן לעבודה';
        const hudVersion = document.createElement('div');
        hudVersion.id = 'hud-version'; hudVersion.textContent = 'v6.2';
        div.appendChild(hudTimer); div.appendChild(hudTitle);
        div.appendChild(hudStatus); div.appendChild(hudVersion);
        document.body.appendChild(div);
    },
    updateText: (t, s) => {
        const title = document.getElementById('hud-title');
        const status = document.getElementById('hud-status');
        if (title) title.innerText = t;
        if (status) status.innerText = s;
    },
    startTimer: async (s) => {
        const timer = document.getElementById('hud-timer');
        for (let i = s; i > 0; i--) {
            if (timer) timer.innerText = `${i}s`;
            await sleep(1000);
        }
        if (timer) timer.innerText = "GO!";
    },
    destroy: () => {
        const h = document.getElementById('safepost-hud');
        if (h) h.remove();
    }
};

function injectStyles() {
    if (document.getElementById('hud-css')) return;
    const s = document.createElement('style');
    s.id = 'hud-css';
    s.textContent = `
        #safepost-hud { position: fixed; bottom: 20px; right: 20px; width: 280px; background: #1a1a1a; border: 3px solid #28a745; color: white; padding: 15px; border-radius: 10px; z-index: 1000000; direction: rtl; font-family: sans-serif; box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
        #hud-timer { position: absolute; top: 15px; left: 15px; background: #007bff; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 14px; }
        #hud-title { font-weight: bold; margin-bottom: 5px; color: #007bff; font-size: 16px; margin-left: 50px; }
        #hud-status { font-size: 13px; opacity: 0.8; }
        #hud-version { position: absolute; bottom: 5px; left: 5px; font-size: 9px; opacity: 0.3; }
    `;
    document.head.appendChild(s);
}
