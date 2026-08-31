import { useState, useEffect, useCallback } from 'react';
import { generateA11yCSS, BOOLEAN_FLAGS, classNameFor } from './a11y-styles';
import { startReadingGuide, stopReadingGuide } from './reading-guide';

export const STORAGE_KEY = 'safepost_accessibility';
const STYLE_TAG_ID = 'a11y-styles';

export const DEFAULT_SETTINGS = {
    fontSize: 100,       // 90-160, step 10
    lineHeight: 1.5,     // 1.2-2.0
    letterSpacing: 0,    // 0-3 (px)
    readingGuide: false,
    tooltips: false,
    ...Object.fromEntries(BOOLEAN_FLAGS.map(f => [f, false])),
};

export function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function ensureStyleTag() {
    let tag = document.getElementById(STYLE_TAG_ID);
    if (!tag) {
        tag = document.createElement('style');
        tag.id = STYLE_TAG_ID;
        document.head.appendChild(tag);
    }
    if (!tag.textContent) tag.textContent = generateA11yCSS();
    return tag;
}

// Applies a settings object to the live document. Exported standalone (not just
// used inside the hook) so main.jsx can call it synchronously before the React
// tree mounts, avoiding a flash of unstyled content for returning users.
export function applyAccessibility(settings) {
    ensureStyleTag();
    const body = document.body;
    const root = document.documentElement;

    BOOLEAN_FLAGS.forEach(flag => {
        body.classList.toggle(classNameFor(flag), !!settings[flag]);
    });

    const fontSizeActive = settings.fontSize !== DEFAULT_SETTINGS.fontSize;
    body.classList.toggle('a11y-large-text', fontSizeActive);
    root.style.setProperty('--a11y-font-size', `${settings.fontSize}%`);

    const lineHeightActive = settings.lineHeight !== DEFAULT_SETTINGS.lineHeight;
    body.classList.toggle('a11y-line-height', lineHeightActive);
    root.style.setProperty('--a11y-line-height', String(settings.lineHeight));

    const letterSpacingActive = settings.letterSpacing !== DEFAULT_SETTINGS.letterSpacing;
    body.classList.toggle('a11y-letter-spacing', letterSpacingActive);
    root.style.setProperty('--a11y-letter-spacing', letterSpacingActive ? `${settings.letterSpacing}px` : 'normal');

    if (settings.tooltips) applyDictionaryTooltips();

    if (settings.readingGuide) startReadingGuide();
    else stopReadingGuide();
}

// "Dictionary/tooltips": best-effort — adds a title attribute to short
// all-caps tokens (likely abbreviations/acronyms) that don't already have one.
function applyDictionaryTooltips() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (el) => (el.children.length === 0 && el.textContent.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const abbrevPattern = /\b[A-Z]{2,6}\b/g;
    let node;
    let count = 0;
    while ((node = walker.nextNode()) && count < 500) {
        if (node.hasAttribute('title') || node.closest('[data-a11y-tooltipped]')) continue;
        const matches = node.textContent.match(abbrevPattern);
        if (matches && matches.length) {
            node.setAttribute('title', `Abbreviation: ${matches[0]}`);
            node.setAttribute('data-a11y-tooltipped', 'true');
            count++;
        }
    }
}

export function resetAccessibility() {
    localStorage.removeItem(STORAGE_KEY);
    applyAccessibility(DEFAULT_SETTINGS);
}

export function useAccessibility() {
    const [settings, setSettings] = useState(loadSettings);

    useEffect(() => {
        applyAccessibility(settings);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSetting = useCallback((key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    }, []);

    const toggleSetting = useCallback((key) => {
        setSettings(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const resetAll = useCallback(() => {
        setSettings({ ...DEFAULT_SETTINGS });
    }, []);

    return { settings, updateSetting, toggleSetting, resetAll };
}
