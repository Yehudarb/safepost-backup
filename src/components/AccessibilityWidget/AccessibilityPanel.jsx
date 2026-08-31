import React, { useState } from 'react';
import {
    X, RotateCcw, ChevronDown, Eye, MousePointer2, Brain, FileText,
    Type, AlignJustify, MoveHorizontal, Contrast, FlipHorizontal2, Droplet,
    Link2, MousePointer, Keyboard, PauseCircle, Maximize2, Ruler, Heading,
    SpellCheck, AlignLeft, ImageOff, BookOpen, ListTree,
} from 'lucide-react';

function ToggleRow({ icon, label, checked, onChange, id }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2">
            <label htmlFor={id} className="flex items-center gap-2.5 text-[13px] text-slate-700 dark:text-gray-300 cursor-pointer">
                <span className="text-slate-400 dark:text-gray-500 shrink-0">{icon}</span>
                {label}
            </label>
            <button
                id={id}
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                onClick={() => onChange(!checked)}
                className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${checked ? 'bg-brand' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
            </button>
        </div>
    );
}

function SliderRow({ icon, label, id, value, min, max, step, unit, onChange }) {
    return (
        <div className="py-2">
            <div className="flex items-center justify-between gap-3 mb-1.5">
                <label htmlFor={id} className="flex items-center gap-2.5 text-[13px] text-slate-700 dark:text-gray-300">
                    <span className="text-slate-400 dark:text-gray-500 shrink-0">{icon}</span>
                    {label}
                </label>
                <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400">{value}{unit}</span>
            </div>
            <input
                id={id}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full accent-brand"
            />
        </div>
    );
}

function CollapsibleSection({ title, defaultOpen = true, children }) {
    const [open, setOpen] = useState(defaultOpen);
    const bodyId = `a11y-section-${title.replace(/\s+/g, '-').toLowerCase()}`;
    return (
        <div className="border-b border-gray-100 dark:border-[#30363d] py-3">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls={bodyId}
                className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-gray-400 hover:text-slate-600 dark:hover:text-gray-300 transition"
            >
                {title}
                <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <div id={bodyId} className="mt-1 divide-y divide-gray-50 dark:divide-[#21262d]">{children}</div>}
        </div>
    );
}

function PageStructureOverlay({ onClose }) {
    const [tree] = useState(() =>
        Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
            .map(el => ({ level: parseInt(el.tagName[1], 10), text: el.textContent.trim() || '(empty heading)' }))
    );
    return (
        <div className="fixed inset-0 bg-black/70 z-[10001] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Page heading structure">
            <div dir="ltr" className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-md max-h-[70vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-left">
                <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex items-center justify-between">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">Page Structure</h3>
                    <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition"><X size={18} /></button>
                </div>
                <div tabIndex={0} className="p-4 overflow-y-auto text-[12px] text-slate-600 dark:text-gray-400 space-y-1">
                    {tree.length === 0 && <p>No headings found on this page.</p>}
                    {tree.map((h, i) => (
                        <div key={i} style={{ paddingInlineStart: `${(h.level - 1) * 16}px` }} className="flex items-center gap-2">
                            <span className="font-mono text-[10px] px-1 rounded bg-gray-100 dark:bg-[#0d1117] text-brand">H{h.level}</span>
                            <span className="truncate">{h.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function AccessibilityPanel({ settings, updateSetting, toggleSetting, resetAll, onClose, onOpenStatement, firstFocusRef }) {
    const [showStructure, setShowStructure] = useState(false);

    return (
        <div role="dialog" aria-modal="true" aria-label="Accessibility settings" className="fixed inset-y-0 right-0 w-[320px] max-w-[90vw] bg-white dark:bg-[#161b22] border-l border-gray-200 dark:border-[#30363d] shadow-2xl z-[9999] flex flex-col" dir="ltr">
            <div className="p-4 border-b border-gray-200 dark:border-[#30363d]">
                <div className="flex items-center justify-between">
                    <h2 className="font-bold text-sm text-slate-900 dark:text-white">Accessibility Settings</h2>
                    <button ref={firstFocusRef} type="button" onClick={onClose} aria-label="Close accessibility settings" className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition p-1 -m-1">
                        <X size={18} />
                    </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">Adjust the display to your needs</p>
                <button
                    type="button"
                    onClick={resetAll}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-200 dark:border-[#30363d] text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#21262d] transition"
                >
                    <RotateCcw size={12} /> Reset all settings
                </button>
            </div>

            <div tabIndex={0} className="flex-1 overflow-y-auto custom-scrollbar px-4">
                <CollapsibleSection title="Vision">
                    <SliderRow icon={<Type size={15} />} label="Font size" id="a11y-font-size" value={settings.fontSize} min={90} max={160} step={10} unit="%" onChange={v => updateSetting('fontSize', v)} />
                    <SliderRow icon={<AlignJustify size={15} />} label="Line height" id="a11y-line-height" value={settings.lineHeight} min={1.2} max={2.0} step={0.1} unit="" onChange={v => updateSetting('lineHeight', v)} />
                    <SliderRow icon={<MoveHorizontal size={15} />} label="Letter spacing" id="a11y-letter-spacing" value={settings.letterSpacing} min={0} max={3} step={0.5} unit="px" onChange={v => updateSetting('letterSpacing', v)} />
                    <ToggleRow icon={<Contrast size={15} />} label="High contrast mode" id="a11y-high-contrast" checked={settings.highContrast} onChange={() => toggleSetting('highContrast')} />
                    <ToggleRow icon={<FlipHorizontal2 size={15} />} label="Invert colors" id="a11y-invert" checked={settings.invertColors} onChange={() => toggleSetting('invertColors')} />
                    <ToggleRow icon={<Droplet size={15} />} label="Grayscale" id="a11y-grayscale" checked={settings.grayscale} onChange={() => toggleSetting('grayscale')} />
                    <ToggleRow icon={<Link2 size={15} />} label="Highlight links" id="a11y-highlight-links" checked={settings.highlightLinks} onChange={() => toggleSetting('highlightLinks')} />
                    <ToggleRow icon={<MousePointer size={15} />} label="Large cursor" id="a11y-large-cursor" checked={settings.largeCursor} onChange={() => toggleSetting('largeCursor')} />
                </CollapsibleSection>

                <CollapsibleSection title="Motor / Navigation">
                    <ToggleRow icon={<Keyboard size={15} />} label="Keyboard navigation" id="a11y-keyboard-nav" checked={settings.keyboardNav} onChange={() => toggleSetting('keyboardNav')} />
                    <ToggleRow icon={<PauseCircle size={15} />} label="Stop animations" id="a11y-no-animations" checked={settings.stopAnimations} onChange={() => toggleSetting('stopAnimations')} />
                    <ToggleRow icon={<Maximize2 size={15} />} label="Big click targets" id="a11y-big-targets" checked={settings.bigTargets} onChange={() => toggleSetting('bigTargets')} />
                </CollapsibleSection>

                <CollapsibleSection title="Cognitive">
                    <ToggleRow icon={<Ruler size={15} />} label="Reading guide" id="a11y-reading-guide" checked={settings.readingGuide} onChange={() => toggleSetting('readingGuide')} />
                    <ToggleRow icon={<Heading size={15} />} label="Highlight headings" id="a11y-highlight-headings" checked={settings.highlightHeadings} onChange={() => toggleSetting('highlightHeadings')} />
                    <ToggleRow icon={<SpellCheck size={15} />} label="Dyslexia-friendly font" id="a11y-dyslexia-font" checked={settings.dyslexiaFont} onChange={() => toggleSetting('dyslexiaFont')} />
                    <ToggleRow icon={<AlignLeft size={15} />} label="Text align left" id="a11y-left-align" checked={settings.leftAlign} onChange={() => toggleSetting('leftAlign')} />
                    <ToggleRow icon={<ImageOff size={15} />} label="Hide images" id="a11y-hide-images" checked={settings.hideImages} onChange={() => toggleSetting('hideImages')} />
                </CollapsibleSection>

                <CollapsibleSection title="Content" defaultOpen={false}>
                    <ToggleRow icon={<BookOpen size={15} />} label="Dictionary / tooltips" id="a11y-tooltips" checked={settings.tooltips} onChange={() => toggleSetting('tooltips')} />
                    <div className="py-2">
                        <button
                            type="button"
                            onClick={() => setShowStructure(true)}
                            className="w-full flex items-center gap-2.5 text-[13px] text-slate-700 dark:text-gray-300 hover:text-brand transition py-1"
                        >
                            <ListTree size={15} className="text-slate-400 dark:text-gray-500 shrink-0" /> Page structure
                        </button>
                    </div>
                </CollapsibleSection>
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-[#30363d]">
                <button type="button" onClick={onOpenStatement} className="text-[11px] text-slate-500 dark:text-gray-400 hover:text-brand transition underline underline-offset-2">
                    Read our accessibility statement
                </button>
            </div>

            {showStructure && <PageStructureOverlay onClose={() => setShowStructure(false)} />}
        </div>
    );
}
