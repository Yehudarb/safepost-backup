console.log("[SafePost] Content Script Loaded");

// Inject Floating Button
function injectButton() {
    if (document.getElementById('safepost-sync-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'safepost-sync-btn';
    btn.innerText = '🔄 Sync to SafePost';
    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        z-index: 9999;
        padding: 12px 24px;
        background-color: #2563eb;
        color: white;
        border: none;
        border-radius: 50px;
        font-family: system-ui, -apple-system, sans-serif;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
        cursor: pointer;
        transition: transform 0.2s, background-color 0.2s;
    `;

    btn.onmouseover = () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.backgroundColor = '#1d4ed8';
    };
    btn.onmouseout = () => {
        btn.style.transform = 'scale(1)';
        btn.style.backgroundColor = '#2563eb';
    };

    btn.onclick = handleSync;
    document.body.appendChild(btn);
}

// Scrape and Sync Logic
// Scrape and Sync Logic
async function handleSync() {
    const btn = document.getElementById('safepost-sync-btn');
    const originalText = btn.innerText;

    // Safety Reset Timer (prevents "stuck" state)
    const safetyTimer = setTimeout(() => {
        if (btn.disabled) {
            btn.innerText = '⚠️ Timeout';
            btn.style.backgroundColor = '#f59e0b';
            btn.disabled = false;
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.backgroundColor = '#2563eb';
            }, 3000);
        }
    }, 15000);

    try {
        btn.innerText = '⏳ Scanning Page...';
        btn.disabled = true;

        // 1. Auto-Scroll slightly to trigger lazy loads
        window.scrollBy(0, 500);
        await new Promise(r => setTimeout(r, 1000));

        // 2. Advanced Scraper for "Joins" Page
        const groups = new Map(); // Use Map to dedup by ID

        // Strategy: Link must contain /groups/, NOT contain 'create', 'feed', 'discover'
        const candidateLinks = Array.from(document.querySelectorAll('a[href*="/groups/"]'));

        console.log(`[SafePost] Analyzing ${candidateLinks.length} links...`);

        candidateLinks.forEach(a => {
            const href = a.getAttribute('href'); // Get raw href
            if (!href) return;

            // Filter out navigation/sidebar junk
            if (href.includes('/groups/create') ||
                href.includes('/groups/discover') ||
                href.includes('/groups/feed') ||
                href.includes('/groups/category')) {
                return;
            }

            // Regex key patterns
            // 1. /groups/12345/
            // 2. /groups/vanity.name/
            const match = href.match(/\/groups\/([a-zA-Z0-9.]+)\/?/);

            if (match && match[1]) {
                const id = match[1];

                // Name Extraction Strategy
                // Facebook links often contain nested spans. We want the most significant text.
                let name = a.innerText.split('\n')[0].trim();

                // Fallback: If link text is empty (e.g. wrapper around image), look for aria-label
                if (!name && a.getAttribute('aria-label')) {
                    name = a.getAttribute('aria-label').replace('Visit group', '').trim();
                }

                // If name is still generic or empty, skip or try getting it from a sibling? 
                // For now, accept only if name length is decent.
                if (name && name.length > 2 && !name.toLowerCase().includes('join')) {
                    if (!groups.has(id)) {
                        groups.set(id, {
                            name: name,
                            url: `https://www.facebook.com/groups/${id}/`,
                            facebook_id: id
                        });
                    }
                }
            }
        });

        const uniqueGroups = Array.from(groups.values());

        if (uniqueGroups.length === 0) {
            throw new Error("No valid groups found. Please scroll down to load more groups and try again.");
        }

        const groups = uniqueGroups; // Map to user's variable name
        console.log(`[SafePost] Found ${groups.length} valid groups.`);
        btn.innerText = `🔄 Syncing ${groups.length}...`;

        // User Payload (Hebrew Feedback)
        console.log(`🚀 Sending ${groups.length} groups via Background Relay...`);

        chrome.runtime.sendMessage({ type: "SYNC_GROUPS", data: groups }, e => {
            clearTimeout(safetyTimer);
            if (e && e.success) {
                console.log("✅ Sync Successful!", e);
                alert(`סנכרון הצליח! ${groups.length} קבוצות עודכנו.`);
                btn.innerText = `✅ Added ${groups.length}`;
                btn.style.backgroundColor = '#10b981';
            } else {
                console.error("❌ Sync Failed:", e);
                alert("שגיאה בסנכרון. בדוק שהשרת (3001) דולק.");
                throw new Error(e?.error || "Sync Failed");
            }
        });

    } catch (e) {
        clearTimeout(safetyTimer);
        console.error(e);
        btn.innerText = '❌ Error';
        btn.style.backgroundColor = '#ef4444';
        alert(e.message);
    } finally {
        setTimeout(() => {
            if (btn.innerText.includes('Error') || btn.innerText.includes('Added') || btn.innerText.includes('Timeout')) {
                btn.innerText = originalText;
                btn.style.backgroundColor = '#2563eb';
                btn.disabled = false;
            }
        }, 4000);
    }
}

// Auto-Inject on relevant pages
// Using interval to handle SPA navigation
setInterval(() => {
    if (window.location.href.includes('facebook.com') && !document.getElementById('safepost-sync-btn')) {
        injectButton();
    }
}, 2000);
