import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    AArrowDown,
    AArrowUp,
    AlignJustify,
    ArrowLeftRight,
    Circle,
    Droplet,
    Droplets,
    Ear,
    Eye,
    Globe,
    Heading,
    Keyboard,
    LayoutGrid,
    Link,
    ListTree,
    Minus,
    Moon,
    MousePointer,
    Plus,
    Search,
    Space,
    Sparkles,
    Sun,
    Type,
    Volume2,
    X,
} from 'lucide-react';

import A11ySection from './A11ySection';
import A11yTile from './A11yTile';
import { HUE_PRESETS } from './a11y-css';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function A11ySlider({ label, value, min, max, step, onChange, id, unit = '%' }) {
    return (
        <div className="py-2 px-2">
            <div className="flex items-center justify-between mb-2">
                <label htmlFor={id} className="text-[12px] font-semibold text-[#1e3a8a]">
                    {label}
                </label>
                <span className="text-[12px] font-mono text-[#64748b]">
                    {value}
                    {unit}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onChange(Math.max(min, value - step))}
                    aria-label={`הקטן ${label}`}
                    className="p-1.5 rounded hover:bg-[#f1f5f9] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563eb]"
                >
                    <Minus size={16} className="text-[#1e3a8a]" />
                </button>
                <input
                    id={id}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(event) => onChange(Number(event.target.value))}
                    className="flex-1 accent-[#2563eb]"
                    aria-label={label}
                />
                <button
                    type="button"
                    onClick={() => onChange(Math.min(max, value + step))}
                    aria-label={`הגדל ${label}`}
                    className="p-1.5 rounded hover:bg-[#f1f5f9] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563eb]"
                >
                    <Plus size={16} className="text-[#1e3a8a]" />
                </button>
            </div>
        </div>
    );
}

const HUE_SWATCH_COLORS = {
    blue: '#2563eb',
    green: '#16a34a',
    red: '#dc2626',
    purple: '#7c3aed',
    orange: '#ea580c',
};

const HUE_LABELS = {
    blue: 'כחול',
    green: 'ירוק',
    red: 'אדום',
    purple: 'סגול',
    orange: 'כתום',
};

function PageStructureOverlay({ onClose }) {
    const dialogRef = useRef(null);
    const overlayTitleId = useId();
    const tree = useMemo(
        () =>
            Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((element) => ({
                level: parseInt(element.tagName[1], 10),
                text: element.textContent.trim() || '(כותרת ריקה)',
            })),
        [],
    );

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const firstFocusable = dialogRef.current?.querySelector(FOCUSABLE_SELECTOR);
        firstFocusable?.focus();

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                onClose();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) {
                return;
            }
            const focusables = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
            if (!focusables.length) {
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 bg-black/70 z-[10001] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={overlayTitleId}
            dir="rtl"
            lang="he"
        >
            <div
                ref={dialogRef}
                className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-md max-h-[70vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-right"
            >
                <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex items-center justify-between">
                    <button
                        onClick={onClose}
                        aria-label="סגור"
                        className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition"
                    >
                        <X size={18} />
                    </button>
                    <h3 id={overlayTitleId} className="font-bold text-sm text-slate-900 dark:text-white">
                        מבנה כותרות העמוד
                    </h3>
                </div>
                <div tabIndex={0} className="p-4 overflow-y-auto text-[12px] text-slate-600 dark:text-gray-400 space-y-1">
                    {tree.length === 0 && <p>לא נמצאו כותרות בעמוד.</p>}
                    {tree.map((heading, index) => (
                        <div
                            key={`${heading.level}-${index}`}
                            style={{ paddingInlineStart: `${(heading.level - 1) * 16}px` }}
                            className="flex items-center gap-2"
                        >
                            <span className="font-mono text-[10px] px-1 rounded bg-gray-100 dark:bg-[#0d1117] text-brand">
                                H{heading.level}
                            </span>
                            <span className="truncate">{heading.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function A11yPanel({
    a11y,
    onClose,
    onOpenStatement,
    onFeedback,
    closeButtonRef,
}) {
    const {
        settings,
        toggleSetting,
        updateSetting,
        setHuePreset,
        cycleLevel,
        adjustFontSize,
        toggleSection,
        resetAll,
    } = a11y;
    const [showStructure, setShowStructure] = useState(false);
    const titleId = useId();
    const subtitleId = useId();
    const settingsData = settings;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={subtitleId}
            dir="rtl"
            lang="he"
            className="a11y-v-panel-root fixed inset-y-0 right-0 w-[360px] max-[480px]:w-screen max-w-full bg-white shadow-2xl z-[99999] flex flex-col"
            style={{ animation: 'a11y-v-slide-in 300ms ease' }}
        >
            <style>{`
                @keyframes a11y-v-slide-in {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .a11y-v-panel-root { animation: none !important; }
                }
            `}</style>

            <div style={{ background: 'linear-gradient(180deg, #1e40af, #1d4ed8)' }} className="text-white shrink-0">
                <div className="flex items-center justify-between px-3 pt-3">
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
                        aria-label="סגור הגדרות נגישות"
                        className="p-1.5 rounded-full hover:bg-white/10 transition"
                    >
                        <X size={20} />
                    </button>
                    <button
                        type="button"
                        className="flex items-center gap-1.5 text-[12px] font-semibold px-2 py-1 rounded-lg hover:bg-white/10 transition"
                        aria-label="שפת הממשק"
                    >
                        <Globe size={14} />
                        עברית
                    </button>
                    <div className="flex items-center gap-1">
                        <button type="button" aria-label="חיפוש נגישות" className="p-1.5 rounded-full hover:bg-white/10 transition">
                            <Search size={16} />
                        </button>
                        <button type="button" aria-label="ניווט חכם" className="p-1.5 rounded-full hover:bg-white/10 transition">
                            <ArrowLeftRight size={16} />
                        </button>
                    </div>
                </div>
                <div className="flex justify-center pb-3 pt-2">
                    <div className="text-center">
                        <h2 id={titleId} className="px-4 py-1 rounded-full bg-white/15 text-[13px] font-bold">
                            נגישות
                        </h2>
                        <p id={subtitleId} className="mt-2 text-[11px] text-white/80">
                            התאמת התצוגה, הקריאה והניווט לצרכים שלך
                        </p>
                    </div>
                </div>
            </div>

            <div tabIndex={0} className="flex-1 overflow-y-auto custom-scrollbar">
                <A11ySection title="סיוע מבוסס AI" open={settingsData.sections.ai} onToggle={() => toggleSection('ai')} bodyId="a11y-v-section-ai">
                    <p className="text-[12px] text-slate-500">בקרוב.</p>
                </A11ySection>

                <A11ySection
                    title="פרופילי נגישות"
                    open={settingsData.sections.profiles}
                    onToggle={() => toggleSection('profiles')}
                    bodyId="a11y-v-section-profiles"
                >
                    <p className="text-[12px] text-slate-500">בקרוב.</p>
                </A11ySection>

                <A11ySection title="התאמות ניווט" open={settingsData.sections.nav} onToggle={() => toggleSection('nav')} bodyId="a11y-v-section-nav">
                    <div className="grid grid-cols-3 gap-2.5">
                        <A11yTile icon={<LayoutGrid size={28} />} label="ניווט אזורים" active={settingsData.regionNav} onClick={() => toggleSetting('regionNav')} />
                        <A11yTile icon={<Keyboard size={28} />} label="ניווט מקלדת" active={settingsData.keyboardNav} onClick={() => toggleSetting('keyboardNav')} />
                        <A11yTile icon={<Ear size={28} />} label="קורא מסך" active={settingsData.screenReader} onClick={() => toggleSetting('screenReader')} />
                        <A11yTile icon={<ArrowLeftRight size={28} />} label="ניווט חכם" active={settingsData.smartNav} onClick={() => toggleSetting('smartNav')} />
                        <A11yTile icon={<Volume2 size={28} />} label="הקראת טקסט" active={settingsData.textToSpeech} onClick={() => toggleSetting('textToSpeech')} />
                        <A11yTile icon={<Sparkles size={28} />} label="פקודות קוליות" active={settingsData.voiceCommands} onClick={() => toggleSetting('voiceCommands')} badge="בקרוב" />
                    </div>
                </A11ySection>

                <A11ySection
                    title="התאמות ניגודיות"
                    open={settingsData.sections.contrast}
                    onToggle={() => toggleSection('contrast')}
                    bodyId="a11y-v-section-contrast"
                >
                    <div className="grid grid-cols-3 gap-2.5">
                        <A11yTile icon={<Sun size={28} />} label="ניגודיות בהירה" active={settingsData.lightContrast} onClick={() => toggleSetting('lightContrast')} />
                        <A11yTile icon={<Moon size={28} />} label="ניגודיות כהה" active={settingsData.darkContrast} onClick={() => toggleSetting('darkContrast')} />
                        <A11yTile icon={<Eye size={28} />} label="מונוכרום" active={settingsData.monochrome} onClick={() => toggleSetting('monochrome')} />
                        <A11yTile icon={<Circle size={28} />} label="חיזוק ניגודיות" active={settingsData.contrastMode} onClick={() => toggleSetting('contrastMode')} />
                        <A11yTile
                            icon={<Droplets size={28} />}
                            label="רוויה גבוהה"
                            active={settingsData.highSaturation}
                            disabled={settingsData.monochrome}
                            onClick={() => toggleSetting('highSaturation')}
                        />
                        <A11yTile
                            icon={<Droplet size={28} />}
                            label="רוויה נמוכה"
                            active={settingsData.lowSaturation}
                            disabled={settingsData.monochrome}
                            onClick={() => toggleSetting('lowSaturation')}
                        />
                    </div>
                </A11ySection>

                <A11ySection title="התאמת צבעים" open={settingsData.sections.colors} onToggle={() => toggleSection('colors')} bodyId="a11y-v-section-colors">
                    <p className="text-[12px] font-semibold text-[#1e3a8a] mb-2.5 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#2563eb] inline-block" />
                        שינוי גוון האתר
                    </p>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        {Object.keys(HUE_PRESETS).map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                onClick={() => setHuePreset(preset)}
                                aria-pressed={settingsData.huePreset === preset}
                                aria-label={HUE_LABELS[preset]}
                                title={HUE_LABELS[preset]}
                                className={`w-9 h-9 rounded-full border-2 transition ${
                                    settingsData.huePreset === preset ? 'border-[#1e3a8a] scale-110' : 'border-[#e2e8f0]'
                                }`}
                                style={{ background: HUE_SWATCH_COLORS[preset] }}
                            />
                        ))}
                    </div>
                </A11ySection>

                <A11ySection title="התאמות תוכן" open={settingsData.sections.content} onToggle={() => toggleSection('content')} bodyId="a11y-v-section-content">
                    <div className="grid grid-cols-3 gap-2.5 mb-4">
                        <A11yTile icon={<AArrowUp size={28} />} label="הגדלת טקסט" active={settingsData.fontSize > 100} onClick={() => adjustFontSize(20)} />
                        <A11yTile icon={<AArrowDown size={28} />} label="הקטנת טקסט" active={settingsData.fontSize < 100} onClick={() => adjustFontSize(-20)} />
                        <A11yTile icon={<AlignJustify size={28} />} label="מרווח שורות" active={settingsData.lineHeight > 0} onClick={() => cycleLevel('lineHeight')} />
                        <A11yTile icon={<Space size={28} />} label="מרווח אותיות" active={settingsData.letterSpacing > 0} onClick={() => cycleLevel('letterSpacing')} />
                        <A11yTile icon={<Heading size={28} />} label="הדגשת כותרות" active={settingsData.highlightHeadings} onClick={() => toggleSetting('highlightHeadings')} />
                        <A11yTile icon={<Link size={28} />} label="הדגשת קישורים" active={settingsData.highlightLinks} onClick={() => toggleSetting('highlightLinks')} />
                        <A11yTile icon={<MousePointer size={28} />} label="סמן גדול" active={settingsData.bigCursor} onClick={() => toggleSetting('bigCursor')} />
                        <A11yTile icon={<Minus size={28} />} label="קו קריאה" active={settingsData.readingGuide} onClick={() => toggleSetting('readingGuide')} />
                        <A11yTile icon={<Type size={28} />} label="פונט קריא" active={settingsData.readableFont} onClick={() => toggleSetting('readableFont')} />
                    </div>

                    <div className="border-t border-[#e2e8f0] pt-3">
                        <p className="text-[11px] font-semibold text-[#1e3a8a] mb-3">התאמות מדויקות</p>
                        <A11ySlider label="בהירות" value={settingsData.brightness || 100} min={50} max={150} step={10} id="a11y-brightness" onChange={(value) => updateSetting('brightness', value)} />
                        <A11ySlider
                            label="ניגודיות"
                            value={settingsData.contrastLevel || 100}
                            min={80}
                            max={150}
                            step={10}
                            id="a11y-contrast"
                            onChange={(value) => updateSetting('contrastLevel', value)}
                        />
                        <A11ySlider label="רוויה" value={settingsData.saturation || 100} min={0} max={150} step={10} id="a11y-saturation" onChange={(value) => updateSetting('saturation', value)} />

                        <div className="mt-3 px-2">
                            <button
                                type="button"
                                onClick={() => setShowStructure(true)}
                                className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#dbe6ff] bg-[#f8fbff] px-3 py-2 text-[12px] font-semibold text-[#1e3a8a] hover:bg-[#eef5ff] transition"
                            >
                                <ListTree size={16} />
                                הצג מבנה כותרות בעמוד
                            </button>
                        </div>
                    </div>
                </A11ySection>
            </div>

            <div style={{ background: 'linear-gradient(180deg, #1e40af, #1d4ed8)' }} className="shrink-0 h-11 flex items-center justify-center gap-2 text-white text-[11px] font-semibold px-3">
                <button type="button" onClick={resetAll} className="hover:underline">
                    בטל נגישות
                </button>
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-white/60" />
                <button type="button" onClick={onOpenStatement} className="hover:underline">
                    הצהרת נגישות
                </button>
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-white/60" />
                <button type="button" onClick={onFeedback} className="hover:underline">
                    שלח משוב
                </button>
            </div>

            {showStructure && <PageStructureOverlay onClose={() => setShowStructure(false)} />}
        </div>
    );
}
