// SafePost extension settings popup.
// MV3 requires popup scripts to be external (no inline JS).

const DEFAULT_API_URL = 'https://safepost-backup.onrender.com';

const $ = (id) => document.getElementById(id);

async function generateWorkerId() {
    const { workerId } = await chrome.storage.local.get('workerId');
    if (workerId) return workerId;
    const id = 'worker-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    await chrome.storage.local.set({ workerId: id });
    return id;
}

async function load() {
    const { apiUrl } = await chrome.storage.local.get('apiUrl');
    $('apiUrl').value = apiUrl || '';
    $('apiUrl').placeholder = DEFAULT_API_URL;
    $('workerId').textContent = await generateWorkerId();
    $('version').textContent = chrome.runtime.getManifest().version;
}

function normalizeUrl(raw) {
    let url = (raw || '').trim().replace(/\/+$/, '');
    return url;
}

async function save() {
    const url = normalizeUrl($('apiUrl').value);
    if (url && !/^https?:\/\//i.test(url)) {
        setResult('URL must start with http:// or https://', false);
        return;
    }
    if (url) {
        await chrome.storage.local.set({ apiUrl: url });
    } else {
        await chrome.storage.local.remove('apiUrl'); // empty → fall back to default
    }
    setResult('Saved.', true);
}

async function testConnection() {
    const url = normalizeUrl($('apiUrl').value) || DEFAULT_API_URL;
    setResult('Testing…', true);
    try {
        const res = await fetch(`${url}/api/health`, { method: 'GET' });
        if (res.ok) {
            setResult(`Connected (${res.status}) to ${url}`, true);
        } else {
            setResult(`Server responded ${res.status}`, false);
        }
    } catch (e) {
        setResult('Connection failed — check the URL and that the server is running.', false);
    }
}

function setResult(msg, ok) {
    const el = $('testResult');
    el.textContent = msg;
    el.className = 'test-result ' + (ok ? 'ok' : 'err');
}

document.addEventListener('DOMContentLoaded', () => {
    load();
    $('saveBtn').addEventListener('click', save);
    $('testBtn').addEventListener('click', testConnection);
});
