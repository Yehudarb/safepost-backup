// SafePost extension settings + pairing popup.
// MV3 requires popup scripts to be external (no inline JS).

const DEFAULT_API_URL = 'https://safepost-backup.onrender.com';
const $ = (id) => document.getElementById(id);

async function getApiUrl() {
    const { apiUrl } = await chrome.storage.local.get('apiUrl');
    return (apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
}

function normalizeUrl(raw) {
    return (raw || '').trim().replace(/\/+$/, '');
}

// ---- settings ----
async function saveUrl() {
    const url = normalizeUrl($('apiUrl').value);
    if (url && !/^https?:\/\//i.test(url)) { setResult('testResult', 'URL must start with http:// or https://', false); return; }
    if (url) await chrome.storage.local.set({ apiUrl: url });
    else await chrome.storage.local.remove('apiUrl');

    const key = $('extensionKey').value.trim();
    if (key) await chrome.storage.local.set({ extensionKey: key });
    else await chrome.storage.local.remove('extensionKey');

    setResult('testResult', 'Saved.', true);
}

async function testConnection() {
    const url = normalizeUrl($('apiUrl').value) || DEFAULT_API_URL;
    const key = $('extensionKey').value.trim();
    setResult('testResult', 'Testing…', true);
    try {
        // /api/health is deliberately unauthenticated, so it only proves the
        // server is reachable. Check a gated route too, otherwise a wrong
        // extension key would still report "Connected".
        const health = await fetch(`${url}/api/health`, { method: 'GET' });
        if (!health.ok) { setResult('testResult', `Server responded ${health.status}`, false); return; }

        const headers = key ? { 'x-extension-key': key } : {};
        const gated = await fetch(`${url}/api/jobs/next`, { headers });
        if (gated.status === 401) {
            setResult('testResult', key
                ? 'Reachable, but the extension key was rejected.'
                : 'Reachable, but this server requires an extension key.', false);
            return;
        }
        setResult('testResult', `Connected (${gated.status})`, gated.ok);
    } catch {
        setResult('testResult', 'Connection failed — check the URL and server.', false);
    }
}

// ---- pairing ----
async function refreshPairUI() {
    const { pairedWorkerId, deviceToken, pairedWorkspaceId } = await chrome.storage.local.get(['pairedWorkerId', 'deviceToken', 'pairedWorkspaceId']);
    const isPaired = Boolean(pairedWorkerId && deviceToken);
    $('unpaired').style.display = isPaired ? 'none' : 'block';
    $('paired').style.display = isPaired ? 'block' : 'none';
    if (isPaired) {
        $('pairedWorker').textContent = String(pairedWorkerId).slice(0, 8) + '…';
        $('pairedWs').textContent = pairedWorkspaceId ? String(pairedWorkspaceId).slice(0, 8) + '…' : '—';
    }
}

async function pair() {
    const code = $('pairCode').value.trim().toUpperCase();
    if (code.length < 6) { setResult('pairResult', 'Enter the code from the dashboard.', false); return; }
    setResult('pairResult', 'Pairing…', true);
    const url = await getApiUrl();
    try {
        const res = await fetch(`${url}/api/workers/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                worker_name: `Chrome · ${navigator.platform || 'device'}`,
                extension_version: chrome.runtime.getManifest().version,
                browser_version: (navigator.userAgent.match(/Chrome\/[\d.]+/) || ['Chrome'])[0],
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setResult('pairResult', json.error || `Failed (${res.status})`, false); return; }
        await chrome.storage.local.set({
            pairedWorkerId: json.worker_id,
            deviceToken: json.device_token,
            pairedWorkspaceId: json.workspace_id,
        });
        $('pairCode').value = '';
        setResult('pairResult', 'Paired!', true);
        refreshPairUI();
    } catch {
        setResult('pairResult', 'Pairing failed — check the API URL.', false);
    }
}

async function unpair() {
    await chrome.storage.local.remove(['pairedWorkerId', 'deviceToken', 'pairedWorkspaceId']);
    refreshPairUI();
}

function setResult(id, msg, ok) {
    const el = $(id);
    el.textContent = msg;
    el.className = 'test-result ' + (ok ? 'ok' : 'err');
}

async function load() {
    const { apiUrl, extensionKey } = await chrome.storage.local.get(['apiUrl', 'extensionKey']);
    $('apiUrl').value = apiUrl || '';
    $('apiUrl').placeholder = DEFAULT_API_URL;
    $('extensionKey').value = extensionKey || '';
    $('version').textContent = chrome.runtime.getManifest().version;
    refreshPairUI();
}

document.addEventListener('DOMContentLoaded', () => {
    load();
    $('saveBtn').addEventListener('click', saveUrl);
    $('testBtn').addEventListener('click', testConnection);
    $('pairBtn').addEventListener('click', pair);
    $('unpairBtn').addEventListener('click', unpair);
});
