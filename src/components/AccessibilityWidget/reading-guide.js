const GUIDE_ID = 'a11y-reading-guide-line';
let listening = false;

function onMouseMove(e) {
    const guide = document.getElementById(GUIDE_ID);
    if (guide) guide.style.top = `${e.clientY}px`;
}

export function startReadingGuide() {
    if (document.getElementById(GUIDE_ID)) return;
    const guide = document.createElement('div');
    guide.id = GUIDE_ID;
    guide.setAttribute('aria-hidden', 'true');
    guide.style.cssText = `
        position: fixed; left: 0; right: 0; top: 50%; height: 2px;
        background: rgba(79,70,229,0.6); box-shadow: 0 0 6px rgba(79,70,229,0.6);
        pointer-events: none; z-index: 9998; transition: top 50ms linear;
    `;
    document.body.appendChild(guide);
    if (!listening) {
        document.addEventListener('mousemove', onMouseMove);
        listening = true;
    }
}

export function stopReadingGuide() {
    document.getElementById(GUIDE_ID)?.remove();
    if (listening) {
        document.removeEventListener('mousemove', onMouseMove);
        listening = false;
    }
}
