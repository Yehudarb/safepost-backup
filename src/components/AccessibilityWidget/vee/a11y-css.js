// Static, class-gated CSS for every non-composable feature (things that don't
// need to combine with each other in one property). Filter-based features
// (monochrome, contrast boost, saturation, hue presets) are NOT handled here —
// they're composed into a single `filter` value and applied as an inline style
// from useA11y.js, because CSS `filter` isn't additive across separate rules:
// whichever class-based rule matches last simply wins outright instead of
// combining, which would silently break any two filter toggles used together.
export function generateA11yCSS() {
    return `
/* Region / landmark navigation — skip links, visible only on focus */
.a11y-v-skip-links { position: fixed; top: 0; right: 0; z-index: 99998; }
.a11y-v-skip-links a {
    position: absolute; right: 0; top: -40px;
    background: #1d4ed8; color: #fff; padding: 8px 14px; border-radius: 0 0 0 8px;
    font-size: 13px; font-weight: 700; text-decoration: none; transition: top 150ms;
}
.a11y-v-skip-links a:focus { top: 0; }

/* Keyboard navigation focus rings */
body.a11y-v-keyboard-nav *:focus {
    outline: 3px solid #2563eb !important;
    outline-offset: 2px !important;
}

/* High contrast — light */
body.a11y-v-contrast-light { background: #fff !important; color: #000 !important; }
body.a11y-v-contrast-light * {
    background-color: #fff !important;
    color: #000 !important;
    border-color: #000 !important;
}
body.a11y-v-contrast-light a { color: #1d4ed8 !important; text-decoration: underline !important; }

/* High contrast — dark */
body.a11y-v-contrast-dark { background: #000 !important; color: #fff !important; }
body.a11y-v-contrast-dark * {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #fff !important;
}
body.a11y-v-contrast-dark a { color: #ffe100 !important; text-decoration: underline !important; }

/* Font size */
body.a11y-v-font-size { font-size: var(--a11y-v-font-size, 100%) !important; }

/* Line height */
body.a11y-v-line-height, body.a11y-v-line-height * { line-height: var(--a11y-v-line-height, normal) !important; }

/* Letter spacing */
body.a11y-v-letter-spacing, body.a11y-v-letter-spacing * { letter-spacing: var(--a11y-v-letter-spacing, normal) !important; }

/* Highlight headings */
body.a11y-v-highlight-headings h1,
body.a11y-v-highlight-headings h2,
body.a11y-v-highlight-headings h3,
body.a11y-v-highlight-headings h4,
body.a11y-v-highlight-headings h5,
body.a11y-v-highlight-headings h6 {
    background: rgba(37, 99, 235, 0.18) !important;
    padding: 4px 8px !important;
    border-radius: 4px !important;
}

/* Highlight links */
body.a11y-v-highlight-links a {
    text-decoration: underline !important;
    outline: 2px solid #ffe100 !important;
    color: #1d4ed8 !important;
    background: #eff6ff !important;
}

/* Big cursor */
body.a11y-v-big-cursor,
body.a11y-v-big-cursor * {
    cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M4 2l16 8-6.5 2L11 20z" fill="%232563eb" stroke="white" stroke-width="1.5"/></svg>') 4 4, auto !important;
}

/* Dyslexia-friendly / readable font */
body.a11y-v-readable-font,
body.a11y-v-readable-font * {
    font-family: 'OpenDyslexic', 'Comic Sans MS', sans-serif !important;
}

@media print {
    body[class*="a11y-v-"] { filter: none !important; }
    #a11y-v-widget-root, #a11y-v-reading-guide-line, .a11y-v-skip-links { display: none !important; }
}
`;
}

export const HUE_PRESETS = {
    blue: 210,
    green: 120,
    red: 0,
    purple: 270,
    orange: 30,
};

export const SIMPLE_FLAGS = {
    keyboardNav: 'a11y-v-keyboard-nav',
    highlightHeadings: 'a11y-v-highlight-headings',
    highlightLinks: 'a11y-v-highlight-links',
    bigCursor: 'a11y-v-big-cursor',
    readableFont: 'a11y-v-readable-font',
};

export const CONTRAST_FLAGS = {
    lightContrast: 'a11y-v-contrast-light',
    darkContrast: 'a11y-v-contrast-dark',
};

// Composes the settings that manipulate CSS `filter` into a single value,
// since filter functions stack (space-separated) but each toggle can't own
// its own !important rule without the last-matching one silently replacing
// the others instead of combining.
export function computeFilter(settings) {
    const parts = [];
    if (settings.monochrome) parts.push('grayscale(100%)');
    if (settings.contrastMode) parts.push('contrast(1.4)');
    if (settings.highSaturation) parts.push('saturate(1.6)');
    if (settings.lowSaturation) parts.push('saturate(0.5)');
    if (settings.huePreset && HUE_PRESETS[settings.huePreset] !== undefined) {
        parts.push(`hue-rotate(${HUE_PRESETS[settings.huePreset]}deg)`);
    }
    return parts.join(' ');
}

const LINE_HEIGHT_STEPS = ['normal', '1.5', '1.8', '2.2'];
const LETTER_SPACING_STEPS = ['normal', '0.05em', '0.1em', '0.15em'];

export function lineHeightValue(level) {
    return LINE_HEIGHT_STEPS[level] ?? LINE_HEIGHT_STEPS[0];
}

export function letterSpacingValue(level) {
    return LETTER_SPACING_STEPS[level] ?? LETTER_SPACING_STEPS[0];
}
