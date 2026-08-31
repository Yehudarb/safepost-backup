// Static, class-gated CSS for every accessibility feature. Nothing here depends
// on the current settings values directly — toggling is done by adding/removing
// body classes and by setting the --a11y-* custom properties on :root (see
// useAccessibility.js). Keeping the stylesheet text static means we only ever
// need to inject it once; live changes are just class/var flips, so nothing
// flashes or re-parses on every toggle.
export function generateA11yCSS() {
    return `
/* Font size */
body.a11y-large-text { font-size: var(--a11y-font-size, 100%) !important; }

/* Line height */
body.a11y-line-height, body.a11y-line-height * { line-height: var(--a11y-line-height, 1.5) !important; }

/* Letter spacing */
body.a11y-letter-spacing, body.a11y-letter-spacing * { letter-spacing: var(--a11y-letter-spacing, normal) !important; }

/* High contrast */
body.a11y-high-contrast {
    background: #000 !important;
    color: #fff !important;
}
body.a11y-high-contrast * {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #fff !important;
}
body.a11y-high-contrast a { color: #ffff00 !important; }

/* Invert colors */
body.a11y-invert { filter: invert(100%) !important; }
body.a11y-invert img, body.a11y-invert video { filter: invert(100%) !important; }

/* Grayscale */
body.a11y-grayscale { filter: grayscale(100%) !important; }
body.a11y-invert.a11y-grayscale { filter: invert(100%) grayscale(100%) !important; }

/* Stop animations */
body.a11y-no-animations *,
body.a11y-no-animations *::before,
body.a11y-no-animations *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
}

/* Highlight links */
body.a11y-highlight-links a {
    text-decoration: underline !important;
    outline: 2px solid #ffff00 !important;
    color: #0000ff !important;
    background: #ffffe0 !important;
}
body.a11y-high-contrast.a11y-highlight-links a { color: #ffff00 !important; background: #000 !important; }

/* Large cursor */
body.a11y-large-cursor,
body.a11y-large-cursor * {
    cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M4 2l16 8-6.5 2L11 20z" fill="black" stroke="white" stroke-width="1.5"/></svg>') 4 4, auto !important;
}

/* Keyboard focus */
body.a11y-keyboard-nav *:focus {
    outline: 3px solid #4f46e5 !important;
    outline-offset: 2px !important;
}

/* Big click targets */
body.a11y-big-targets button,
body.a11y-big-targets a,
body.a11y-big-targets input,
body.a11y-big-targets select {
    min-height: 48px !important;
    min-width: 48px !important;
    padding: 8px 12px !important;
}

/* Dyslexia-friendly font */
body.a11y-dyslexia-font,
body.a11y-dyslexia-font * {
    font-family: 'OpenDyslexic', 'Comic Sans MS', sans-serif !important;
}

/* Highlight headings */
body.a11y-highlight-headings h1,
body.a11y-highlight-headings h2,
body.a11y-highlight-headings h3,
body.a11y-highlight-headings h4,
body.a11y-highlight-headings h5,
body.a11y-highlight-headings h6 {
    background: rgba(79, 70, 229, 0.15) !important;
    padding: 4px 8px !important;
    border-radius: 4px !important;
}

/* Hide images */
body.a11y-hide-images img { opacity: 0 !important; }

/* Left align text */
body.a11y-left-align * { text-align: left !important; }

/* Never let any of the above leak into print output */
@media print {
    body[class*="a11y-"] { filter: none !important; }
    #a11y-reading-guide-line, #a11y-widget-root { display: none !important; }
}
`;
}

// Keys that map 1:1 to a body class of the same a11y-<key-in-kebab-case> shape.
export const BOOLEAN_FLAGS = [
    'highContrast', 'invertColors', 'grayscale', 'highlightLinks', 'largeCursor',
    'keyboardNav', 'stopAnimations', 'bigTargets', 'highlightHeadings',
    'dyslexiaFont', 'leftAlign', 'hideImages',
];

const CLASS_NAMES = {
    highContrast: 'a11y-high-contrast',
    invertColors: 'a11y-invert',
    grayscale: 'a11y-grayscale',
    highlightLinks: 'a11y-highlight-links',
    largeCursor: 'a11y-large-cursor',
    keyboardNav: 'a11y-keyboard-nav',
    stopAnimations: 'a11y-no-animations',
    bigTargets: 'a11y-big-targets',
    highlightHeadings: 'a11y-highlight-headings',
    dyslexiaFont: 'a11y-dyslexia-font',
    leftAlign: 'a11y-left-align',
    hideImages: 'a11y-hide-images',
};

export function classNameFor(flag) {
    return CLASS_NAMES[flag];
}
