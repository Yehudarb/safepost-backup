import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Accessibility } from 'lucide-react';
import { useAccessibility } from './useAccessibility';
import AccessibilityPanel from './AccessibilityPanel';
import AccessibilityStatement from '@/pages/AccessibilityStatement';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AccessibilityWidget() {
    const { settings, updateSetting, toggleSetting, resetAll } = useAccessibility();
    const [open, setOpen] = useState(false);
    const [showStatement, setShowStatement] = useState(false);
    const buttonRef = useRef(null);
    const panelRef = useRef(null);
    const firstFocusRef = useRef(null);

    const close = useCallback(() => {
        setOpen(false);
        setTimeout(() => buttonRef.current?.focus(), 0);
    }, []);

    useEffect(() => {
        if (open) firstFocusRef.current?.focus();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function onKeyDown(e) {
            if (e.key === 'Escape') { close(); return; }
            if (e.key !== 'Tab' || !panelRef.current) return;
            const list = Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => el.offsetParent !== null);
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, close]);

    return (
        <div id="a11y-widget-root">
            <button
                ref={buttonRef}
                type="button"
                onClick={() => (open ? close() : setOpen(true))}
                aria-label="Accessibility settings"
                aria-expanded={open}
                aria-haspopup="dialog"
                className="fixed rounded-full flex items-center justify-center text-white bg-[#4f46e5] dark:bg-indigo-500 hover:brightness-110 shadow-lg shadow-indigo-500/40 transition"
                style={{ bottom: 20, right: 20, width: 48, height: 48, zIndex: 10000 }}
            >
                <Accessibility size={26} />
            </button>

            {open && (
                <div ref={panelRef}>
                    <AccessibilityPanel
                        settings={settings}
                        updateSetting={updateSetting}
                        toggleSetting={toggleSetting}
                        resetAll={resetAll}
                        onClose={close}
                        onOpenStatement={() => setShowStatement(true)}
                        firstFocusRef={firstFocusRef}
                    />
                </div>
            )}

            {showStatement && <AccessibilityStatement onClose={() => setShowStatement(false)} />}
        </div>
    );
}
