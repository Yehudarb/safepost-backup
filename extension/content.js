console.log("%c 🟢 SAFEEPOST v7.2 - ENGINE STABLE " + new Date().toLocaleTimeString(), "background: green; color: white; font-size: 20px; padding: 10px; border-radius: 5px;");
console.log("[SafePost] Content Script v7.2 LOADED - Production Build");

const BASE_URL = "https://safepost-backup.onrender.com";

// Helper: Safe Message Sending (prevents "Extension context invalidated" crashes)
function safeSendMessage(payload, callback = null) {
    try {
        if (!chrome.runtime || !chrome.runtime.id) {
            throw new Error("Extension context invalidated");
        }
        if (callback) {
            chrome.runtime.sendMessage(payload, callback);
        } else {
            const p = chrome.runtime.sendMessage(payload);
            if (p && typeof p.catch === 'function') p.catch(() => {});
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
            }).catch(e => console.warn("[SafePost] Remote log rejected:", e.message));
        } catch (e) {
            console.warn("[SafePost] Failed to send log:", e);
        }
    }
}

// 1. Inject Manual Sync Button
function injectButton() {
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
        btn.style.backgroundColor = "#e0a800";
        await scrapeAndSyncGroups();
        setTimeout(() => {
            btn.innerText = "🔄 SAFEPOST: SYNC GROUPS";
            btn.style.backgroundColor = "#007bff";
        }, 3000);
    };

    document.body.appendChild(btn);
}

injectButton();
setInterval(injectButton, 5000);

// 2. Scrape Logic
async function scrapeAndSyncGroups() {
    logRemote("Starting group scrape");
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
        safeSendMessage({ action: "SYNC_GROUPS", groups: groups }, (response) => {
            if (chrome.runtime?.lastError) {
                console.error("BG Error:", chrome.runtime.lastError);
                alert("שגיאה: וודא שרעננת את התוסף!");
            } else {
                alert(`✅ הצלחה! נשלחו ${groups.length} קבוצות לשרת.`);
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

        // Notify server that we are starting
        fetch(`${BASE_URL}/api/worker/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: request.job.id })
        }).catch(err => console.warn("[SafePost] Ack failed, proceeding anyway...", err));

        performPost(request.job).then(sendResponse);
        return true;
    }
});

async function reportStatus(taskId, status, extra = {}) {
    const payload = { taskId, status, ...extra };
    console.log(`[SafePost] Reporting status: ${status} for task ${taskId}`);
    try {
        const res = await fetch(`${BASE_URL}/api/tasks/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        console.log(`[SafePost] ✅ Status reported: ${status}`, data);
    } catch (err) {
        console.error(`[SafePost] ❌ Status report failed:`, err);
        // Fallback via background.js
        safeSendMessage({ action: "REPORT_STATUS", payload });
    }
}

async function closeTab() {
    safeSendMessage({ action: 'CLOSE_TAB' });
    setTimeout(() => { try { window.close(); } catch(e) {} }, 1500);
}

async function performPost(job) {
    logRemote("🤖 Starting Execution Sequence", { jobId: job.id });

    window.hud.mount();
    window.hud.updateText("מתחיל עבודה", "טוען נתוני פוסט...");

    // 1. Trigger "Create Post" Modal
    const triggers = ["What's on your mind", "Write something", "Create a public post", "כתוב משהו", "כאן כותבים", "צור פוסט ציבורי", "הבעת דעה"];
    const trigger = await findElementRobust(triggers);
    if (!trigger) {
        logRemote("❌ Trigger not found");
        window.hud.updateText("שגיאה", "לא נמצא כפתור יצירת פוסט");
        await reportStatus(job.id, 'FAILED', { failure_reason: "Trigger button not found" });
        await sleep(500);
        window.hud.destroy();
        closeTab();
        return;
    }

    trigger.click();
    logRemote("✅ Clicked Trigger");

    window.hud.updateText("פותח חלונית", "ממתין לטעינת ממשק...");
    await window.hud.startTimer(1);

    // 2. Find the Input Box
    let inputBox = await waitForInputBox();
    if (!inputBox) {
        logRemote("❌ Input box not found");
        window.hud.updateText("שגיאה קריטית", "לא נמצאה תיבת טקסט.");
        await reportStatus(job.id, 'FAILED', { failure_reason: "Input box not found" });
        await sleep(500);
        window.hud.destroy();
        closeTab();
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
    await pasteText(inputBox, job.content);
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
    }

    if (clicked) {
        logRemote("🚀 Post button clicked");

        // 5. Verify
        const verifySuccess = await waitForModalClosure();
        if (verifySuccess) {
            logRemote("🎯 Post Success Verified. Capturing permalink...");
            window.hud.updateText("הצלחה! 🏆", "הפוסט פורסם.");
            const proofUrl = await findPostPermalink();
            await reportStatus(job.id, 'SUCCESS', { proof_url: proofUrl });
        } else {
            logRemote("❓ Modal closure timed out — assuming success");
            window.hud.updateText("הצלחה! 🏆", "הפוסט פורסם.");
            await reportStatus(job.id, 'SUCCESS', { failure_reason: 'No modal closure confirmation' });
        }
    } else {
        logRemote("❌ Failed to find or click Post button");
        window.hud.updateText("שגיאה", "כפתור פרסום לא נמצא");
        await reportStatus(job.id, 'FAILED', { failure_reason: "Post button not found" });
    }

    await sleep(500);
    window.hud.destroy();
    closeTab();
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
        fullUrl = `${BASE_URL}${mediaPath}`;
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

// --- Human-Like Click Helper ---
async function humanClick(el) {
    if (!el) return;
    console.log("🖱️ Triggering Human-Like Click on:", el);
    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, view: window }));
    await sleep(50);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, view: window }));
    await sleep(50);
    el.click();
}

// V7.2 Post Button Strategy: Semantic text search first, color heuristic as fallback
async function clickPostButton() {
    console.group("⚓ [SafePost] V7.2 Deep-Search Strategy");

    const findByText = (root, strings) => {
        const results = [];
        for (const s of strings) {
            const xpath = `.//*[self::div or self::span or self::button or self::a][text()="${s}" or @aria-label="${s}"]`;
            const iterator = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < iterator.snapshotLength; i++) {
                results.push(iterator.snapshotItem(i));
            }
        }
        return results;
    };

    let scopes = Array.from(document.querySelectorAll('div[role="dialog"]'));
    if (scopes.length === 0) {
        console.warn("⚠️ No dialogs found. Scanning body...");
        scopes = [document.body];
    } else {
        console.log(`🔍 Found ${scopes.length} active dialogs.`);
    }

    const keywords = ["Post", "פרסום", "Publish", "פרסם"];
    const antiKeywords = ["boost", "כדאי לנסות", "schedule", "תזמון", "ערוך", "edit"];

    // 1. Semantic Search — find by exact text/aria-label
    console.log("SEARCH: Deep Semantic Text Scan...");
    for (const scope of scopes) {
        const candidates = findByText(scope, keywords);
        const valid = candidates.find(el => {
            if (!isElementVisibleAndEnabled(el)) return false;
            const txt = (el.innerText || "").toLowerCase();
            if (antiKeywords.some(bad => txt.includes(bad))) return false;
            const style = window.getComputedStyle(el);
            const isClickable = el.tagName === 'BUTTON' || el.tagName === 'A'
                || el.getAttribute('role') === 'button' || style.cursor === 'pointer';
            return isClickable;
        });

        if (valid) {
            console.log("✅ SEMANTIC WINNER FOUND:", valid.innerText);
            valid.style.border = "5px solid #FF00FF";
            valid.style.boxShadow = "0 0 20px #FF00FF";
            valid.scrollIntoView({ block: "center", behavior: "smooth" });
            await sleep(500);
            await humanClick(valid);
            console.groupEnd();
            return true;
        }
    }

    // 2. Heuristic Fallback — bottom-most blue button
    console.log("SEARCH: Heuristic Fallback (Blue Button)...");
    let allCandidates = [];
    scopes.forEach(s => {
        allCandidates = allCandidates.concat(
            Array.from(s.querySelectorAll('div[role="button"], button, div[class*="Button"]'))
        );
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
        if (b > r + 10 && b > g + 10) {
            blueCandidates.push(el);
        }
    }

    if (blueCandidates.length > 0) {
        blueCandidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectB.bottom - rectA.bottom;
        });
        const best = blueCandidates[0];
        console.log("✅ HEURISTIC WINNER:", best.innerText);
        best.style.border = "5px solid #00FFFF";
        best.scrollIntoView({ block: "center", behavior: "smooth" });
        await sleep(500);
        await humanClick(best);
        console.groupEnd();
        return true;
    }

    console.error("❌ FAILED: No candidates found.");
    console.groupEnd();
    return false;
}

// Helpers
async function waitForModalClosure() {
    logRemote("⏳ Monitoring modal closure...");
    for (let i = 0; i < 12; i++) {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return true;
        const dialogText = dialog.innerText || "";
        if (dialogText.includes("Post successful") || dialogText.includes("הפוסט פורסם")) return true;
        await sleep(400);
    }
    return false;
}

async function findPostPermalink() {
    logRemote("🔍 Searching for new post permalink...");
    await sleep(500);

    const timePhrases = ["Just now", "אף לא רגע", "עכשיו", "1 min", "1 דק"];

    for (let attempt = 0; attempt < 2; attempt++) {
        const links = Array.from(document.querySelectorAll('a[href*="/groups/"][href*="/permalink/"]'));
        for (const link of links) {
            const text = link.innerText || "";
            if (timePhrases.some(p => text.includes(p))) {
                const url = link.href.split('?')[0];
                logRemote("✅ Permalink found", { url });
                return url;
            }
        }
        await sleep(800);
    }

    logRemote("⚠️ Permalink not found, using group URL as fallback");
    return window.location.href.split('?')[0];
}

function isElementVisibleAndEnabled(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getAttribute('aria-disabled') !== 'true';
}

async function findElementRobust(phrases) {
    for (let i = 0; i < 15; i++) {
        for (let phrase of phrases) {
            const xpath = `//div[@role="button"][contains(., "${phrase}")] | //button[contains(., "${phrase}")] | //div[@aria-label="${phrase}"] | //span[contains(text(), "${phrase}")]`;
            const res = document.evaluate(xpath, document, null, 9, null).singleNodeValue;
            if (res) {
                const btn = res.closest('[role="button"]') || res.closest('button') || res;
                if (isElementVisibleAndEnabled(btn)) return btn;
            }
        }
        await sleep(200);
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

async function pasteText(element, text) {
    element.focus();
    // Type fast but visibly: ~15-25ms per char → ~4s for 200 chars
    const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
    for (const char of text) {
        document.execCommand('insertText', false, char);
        await sleep(randomBetween(15, 25));
    }
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

        if (Math.random() < errorInjectionRate && char.match(/[a-zA-Zא-ת]/)) {
            const wrongChar = getAdjacentKey(char);
            await dispatchSimulatedChar(wrongChar);
            await sleep(randomBetween(150, 300));
            await dispatchSimulatedBackspace();
            await sleep(randomBetween(50, 150));
        }

        await dispatchSimulatedChar(char);

        let delayInterval = randomBetween(30, 80);
        if (char === ' ') {
            delayInterval = randomBetween(100, 200);
        } else if (char === '.' || char === ',' || char === '\n') {
            delayInterval = randomBetween(500, 1000);
        }

        await sleep(delayInterval);
    }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// HUD Implementation
injectStyles();
window.hud = {
    mount: () => {
        if (document.getElementById('safepost-hud')) return;
        const div = document.createElement('div');
        div.id = 'safepost-hud';
        // Use DOM methods instead of innerHTML to prevent XSS
        const hudTimer = document.createElement('div');
        hudTimer.id = 'hud-timer'; hudTimer.textContent = '--s';
        const hudTitle = document.createElement('div');
        hudTitle.id = 'hud-title'; hudTitle.textContent = 'מערכת אופטימיזציה';
        const hudStatus = document.createElement('div');
        hudStatus.id = 'hud-status'; hudStatus.textContent = 'מוכן לעבודה';
        const hudVersion = document.createElement('div');
        hudVersion.id = 'hud-version'; hudVersion.textContent = 'v7.2';
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
    // textContent is safe for CSS content in <style> tags
    s.textContent = `
        #safepost-hud { position: fixed; bottom: 20px; right: 20px; width: 280px; background: #1a1a1a; border: 3px solid #28a745; color: white; padding: 15px; border-radius: 10px; z-index: 1000000; direction: rtl; font-family: sans-serif; box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
        #hud-timer { position: absolute; top: 15px; left: 15px; background: #007bff; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 14px; }
        #hud-title { font-weight: bold; margin-bottom: 5px; color: #007bff; font-size: 16px; margin-left: 50px; }
        #hud-status { font-size: 13px; opacity: 0.8; }
        #hud-version { position: absolute; bottom: 5px; left: 5px; font-size: 9px; opacity: 0.3; }
    `;
    document.head.appendChild(s);
}
