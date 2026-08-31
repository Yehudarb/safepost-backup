import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { translations as translationsApp } from './translations.app';
import { translations as translationsComponents } from './translations.components';

const translations = {
    en: { ...translationsApp.en, ...translationsComponents.en },
    he: { ...translationsApp.he, ...translationsComponents.he },
};

const LanguageContext = createContext(null);

const STORAGE_KEY = 'safepost_lang';

function detectInitialLang() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'en' || saved === 'he') return saved;
    } catch { /* noop */ }
    return 'en'; // default
}

export function LanguageProvider({ children }) {
    const [lang, setLangState] = useState(detectInitialLang);

    useEffect(() => {
        const dir = lang === 'he' ? 'rtl' : 'ltr';
        document.documentElement.lang = lang;
        document.documentElement.dir = dir;
        try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* noop */ }
    }, [lang]);

    const setLang = (next) => setLangState(next === 'he' ? 'he' : 'en');
    const toggleLang = () => setLangState(prev => (prev === 'he' ? 'en' : 'he'));

    const t = useMemo(() => {
        const dict = translations[lang] || translations.en;
        return (key, vars) => {
            let str = dict[key] ?? translations.en[key] ?? key;
            if (vars) {
                for (const [k, v] of Object.entries(vars)) {
                    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
                }
            }
            return str;
        };
    }, [lang]);

    const value = useMemo(() => ({
        lang,
        setLang,
        toggleLang,
        dir: lang === 'he' ? 'rtl' : 'ltr',
        t,
    }), [lang, t]);

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
    const ctx = useContext(LanguageContext);
    if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
    return ctx;
}
