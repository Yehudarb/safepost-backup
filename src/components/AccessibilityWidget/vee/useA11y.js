import { useCallback, useEffect, useRef, useState } from 'react';

import { generateA11yCSS, SIMPLE_FLAGS, CONTRAST_FLAGS, computeFilter, lineHeightValue, letterSpacingValue } from './a11y-css';
import { startReadingGuide, stopReadingGuide } from './reading-guide';
import { translations as tApp } from '@/lib/translations.app';
import { translations as tComponents } from '@/lib/translations.components';

const dict = { en: { ...tApp.en, ...tComponents.en }, he: { ...tApp.he, ...tComponents.he } };
function t(key) {
    const lang = (document.documentElement.lang === 'he') ? 'he' : 'en';
    return dict[lang][key] ?? dict.en[key] ?? key;
}

export const STORAGE_KEY = 'safepost_a11y';
const STYLE_TAG_ID = 'a11y-v-styles';
const SKIP_LINKS_ID = 'a11y-v-skip-links';
const LIVE_REGION_ID = 'a11y-v-live-region';

export const DEFAULT_SETTINGS = {
    regionNav: false,
    keyboardNav: false,
    screenReader: false,
    smartNav: false,
    textToSpeech: false,
    voiceCommands: false,
    lightContrast: false,
    darkContrast: false,
    monochrome: false,
    contrastMode: false,
    highSaturation: false,
    lowSaturation: false,
    huePreset: null,
    fontSize: 100,
    lineHeight: 0,
    letterSpacing: 0,
    highlightHeadings: false,
    highlightLinks: false,
    bigCursor: false,
    readingGuide: false,
    readableFont: false,
    brightness: 100,
    contrastLevel: 100,
    saturation: 100,
    sections: { ai: false, profiles: false, nav: true, contrast: true, colors: false, content: false },
};

export function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_SETTINGS };
        }
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            sections: { ...DEFAULT_SETTINGS.sections, ...(parsed.sections || {}) },
        };
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
    if (!tag.textContent) {
        tag.textContent = generateA11yCSS();
    }
    return tag;
}

function ensureSkipLinks(active) {
    let container = document.getElementById(SKIP_LINKS_ID);
    if (!active) {
        container?.remove();
        return;
    }
    if (container) {
        return;
    }

    container = document.createElement('nav');
    container.id = SKIP_LINKS_ID;
    container.className = 'a11y-v-skip-links';
    container.setAttribute('aria-label', t('a11ySkipLinksNavLabel'));

    const targets = [
        { selector: 'main', label: t('a11ySkipToMainContent') },
        { selector: 'header', label: t('a11ySkipToHeader') },
        { selector: 'footer', label: t('a11ySkipToFooter') },
    ];

    targets.forEach(({ selector, label }, index) => {
        const element = document.querySelector(selector);
        if (!element) {
            return;
        }
        if (!element.id) {
            element.id = `a11y-v-landmark-${selector}`;
        }
        const link = document.createElement('a');
        link.href = `#${element.id}`;
        link.textContent = label;
        link.style.right = `${index * 160}px`;
        container.appendChild(link);
    });

    if (container.childElementCount > 0) {
        document.body.prepend(container);
    }
}

function ensureLiveRegion() {
    let region = document.getElementById(LIVE_REGION_ID);
    if (!region) {
        region = document.createElement('div');
        region.id = LIVE_REGION_ID;
        region.setAttribute('aria-live', 'polite');
        region.setAttribute('role', 'status');
        region.style.cssText =
            'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;';
        document.body.appendChild(region);
    }
    return region;
}

function announce(message) {
    const region = ensureLiveRegion();
    region.textContent = '';
    requestAnimationFrame(() => {
        region.textContent = message;
    });
}

let smartNavHandler = null;
function setSmartNav(active) {
    if (smartNavHandler) {
        document.removeEventListener('keydown', smartNavHandler);
        smartNavHandler = null;
    }
    if (!active) {
        return;
    }

    smartNavHandler = (event) => {
        if (!event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
            return;
        }
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        if (!headings.length) {
            return;
        }
        event.preventDefault();
        const currentIndex = headings.findIndex(
            (heading) => heading === document.activeElement || heading.contains(document.activeElement),
        );
        const nextHeading =
            event.key === 'ArrowDown'
                ? headings[currentIndex + 1] || headings[0]
                : headings[currentIndex - 1] || headings[headings.length - 1];
        nextHeading.setAttribute('tabindex', nextHeading.getAttribute('tabindex') || '-1');
        nextHeading.focus();
    };

    document.addEventListener('keydown', smartNavHandler);
}

let ttsHandler = null;
function setTextToSpeech(active) {
    if (ttsHandler) {
        document.removeEventListener('mouseup', ttsHandler);
        ttsHandler = null;
    }
    if (!active) {
        window.speechSynthesis?.cancel?.();
        return;
    }
    if (!window.speechSynthesis) {
        return;
    }

    ttsHandler = () => {
        const text = window.getSelection()?.toString()?.trim();
        if (!text) {
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'he-IL';
        window.speechSynthesis.speak(utterance);
    };

    document.addEventListener('mouseup', ttsHandler);
}

export function applyA11y(settings, prevSettings) {
    ensureStyleTag();
    const body = document.body;
    const root = document.documentElement;

    Object.entries(SIMPLE_FLAGS).forEach(([key, className]) => {
        body.classList.toggle(className, !!settings[key]);
    });
    Object.entries(CONTRAST_FLAGS).forEach(([key, className]) => {
        body.classList.toggle(className, !!settings[key]);
    });

    const fontSizeActive = settings.fontSize !== DEFAULT_SETTINGS.fontSize;
    body.classList.toggle('a11y-v-font-size', fontSizeActive);
    root.style.setProperty('--a11y-v-font-size', `${settings.fontSize}%`);

    const lineHeightActive = settings.lineHeight > 0;
    body.classList.toggle('a11y-v-line-height', lineHeightActive);
    root.style.setProperty('--a11y-v-line-height', lineHeightValue(settings.lineHeight));

    const letterSpacingActive = settings.letterSpacing > 0;
    body.classList.toggle('a11y-v-letter-spacing', letterSpacingActive);
    root.style.setProperty('--a11y-v-letter-spacing', letterSpacingValue(settings.letterSpacing));

    const filter = computeFilter(settings);
    if (filter) {
        body.style.setProperty('filter', filter, 'important');
    } else {
        body.style.removeProperty('filter');
    }

    ensureSkipLinks(!!settings.regionNav || !!settings.smartNav);
    setSmartNav(!!settings.smartNav);
    setTextToSpeech(!!settings.textToSpeech);

    if (settings.readingGuide) {
        startReadingGuide();
    } else {
        stopReadingGuide();
    }

    if (settings.screenReader && !prevSettings?.screenReader) {
        announce(t('a11yScreenReaderModeOn'));
    }
    if (!settings.screenReader && prevSettings?.screenReader) {
        announce(t('a11yScreenReaderModeOff'));
    }
}

export function resetA11y() {
    localStorage.removeItem(STORAGE_KEY);
    document.body.style.removeProperty('filter');
    applyA11y(DEFAULT_SETTINGS);
}

const EXCLUSIVE_PAIRS = [
    ['lightContrast', 'darkContrast'],
    ['highSaturation', 'lowSaturation'],
];

export function useA11y() {
    const [settings, setSettings] = useState(loadSettings);
    const prevRef = useRef(settings);

    useEffect(() => {
        applyA11y(settings, prevRef.current);
        prevRef.current = settings;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSetting = useCallback((key, value) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }, []);

    const toggleSetting = useCallback((key) => {
        setSettings((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            EXCLUSIVE_PAIRS.forEach(([a, b]) => {
                if (key === a && next[a]) next[b] = false;
                if (key === b && next[b]) next[a] = false;
            });
            if (key === 'monochrome' && next.monochrome) {
                next.highSaturation = false;
                next.lowSaturation = false;
            }
            return next;
        });
    }, []);

    const setHuePreset = useCallback((preset) => {
        setSettings((prev) => ({ ...prev, huePreset: prev.huePreset === preset ? null : preset }));
    }, []);

    const cycleLevel = useCallback((key, max = 3) => {
        setSettings((prev) => ({ ...prev, [key]: (prev[key] + 1) % (max + 1) }));
    }, []);

    const adjustFontSize = useCallback((delta) => {
        setSettings((prev) => ({
            ...prev,
            fontSize: Math.min(160, Math.max(80, prev.fontSize + delta)),
        }));
    }, []);

    const toggleSection = useCallback((key) => {
        setSettings((prev) => ({
            ...prev,
            sections: { ...prev.sections, [key]: !prev.sections[key] },
        }));
    }, []);

    const resetAll = useCallback(() => {
        setSettings({ ...DEFAULT_SETTINGS });
    }, []);

    return {
        settings,
        toggleSetting,
        updateSetting,
        setHuePreset,
        cycleLevel,
        adjustFontSize,
        toggleSection,
        resetAll,
        isMonochromeLocked: settings.monochrome,
    };
}
