import './landing.css';
import { copy } from './translations';

const STORAGE_KEY = 'safepost_lang';

function initialLang() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'en' || saved === 'he') return saved;
    } catch { /* private mode / storage disabled */ }
    return 'en';
}

let currentLang = initialLang();

function applyLang(lang) {
    currentLang = lang;
    const dict = copy[lang] || copy.en;

    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* noop */ }

    // Text nodes. Uses textContent, not innerHTML — the copy is plain text and
    // there is no reason to hand it to the HTML parser.
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const value = dict[el.dataset.i18n];
        if (value !== undefined) el.textContent = value;
    });

    // Attributes, declared as data-i18n-attr="placeholder:key,aria-label:key".
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
        el.dataset.i18nAttr.split(',').forEach(pair => {
            const [attr, key] = pair.split(':').map(s => s.trim());
            const value = dict[key];
            if (attr && value !== undefined) el.setAttribute(attr, value);
        });
    });

    // The toggle advertises the language you'd switch TO.
    document.querySelectorAll('[data-lang-label]').forEach(el => {
        el.textContent = lang === 'he' ? 'EN' : 'עב';
    });
    document.querySelectorAll('[data-lang-toggle]').forEach(el => {
        el.setAttribute('aria-label', lang === 'he' ? 'Switch to English' : 'החלף לעברית');
    });
}

function toggleLang() {
    applyLang(currentLang === 'he' ? 'en' : 'he');
}

document.querySelectorAll('[data-lang-toggle]').forEach(btn => {
    btn.addEventListener('click', toggleLang);
});

// --- Mobile menu ---
const menuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');
if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', () => {
        const isOpen = mobileMenu.classList.toggle('hidden');
        menuBtn.setAttribute('aria-expanded', String(!isOpen));
    });
    // Any nav tap closes the sheet, otherwise it covers the section you jumped to.
    mobileMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
            menuBtn.setAttribute('aria-expanded', 'false');
        });
    });
}

// --- Navbar shadow on scroll ---
const navbar = document.getElementById('navbar');
if (navbar) {
    const onScroll = () => navbar.classList.toggle('shadow-md', window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}

// --- Scroll reveal ---
// IntersectionObserver rather than a scroll handler doing getBoundingClientRect
// on every element per frame.
const revealTargets = document.querySelectorAll('.reveal');
if (revealTargets.length) {
    if (typeof IntersectionObserver === 'undefined') {
        revealTargets.forEach(el => el.classList.add('active'));
    } else {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('active');
                observer.unobserve(entry.target); // one-shot, don't re-hide on scroll up
            });
        }, { rootMargin: '0px 0px -80px 0px' });
        revealTargets.forEach(el => observer.observe(el));
    }
}

// --- Footer year ---
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

applyLang(currentLang);
