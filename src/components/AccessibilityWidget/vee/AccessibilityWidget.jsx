import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Accessibility } from 'lucide-react';

import AccessibilityStatement from '@/pages/AccessibilityStatement';

import A11yPanel from './A11yPanel';
import { useA11y } from './useA11y';
import { useLanguage } from '@/lib/i18n';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AccessibilityWidget() {
    const { t } = useLanguage();
    const a11y = useA11y();
    const [open, setOpen] = useState(false);
    const [showStatement, setShowStatement] = useState(false);
    const buttonRef = useRef(null);
    const panelRef = useRef(null);
    const closeButtonRef = useRef(null);
    const statementTriggerRef = useRef(null);

    const close = useCallback(() => {
        setOpen(false);
        setTimeout(() => buttonRef.current?.focus(), 0);
    }, []);

    useEffect(() => {
        if (open && !showStatement) {
            closeButtonRef.current?.focus();
        }
    }, [open, showStatement]);

    useEffect(() => {
        if (!open || showStatement) {
            return undefined;
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                close();
                return;
            }
            if (event.key !== 'Tab' || !panelRef.current) {
                return;
            }
            const list = Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
                (element) => element.offsetParent !== null,
            );
            if (!list.length) {
                return;
            }
            const first = list[0];
            const last = list[list.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, close, showStatement]);

    const handleFeedback = useCallback(() => {
        window.location.href = `mailto:support@safepost.app?subject=${encodeURIComponent(t('a11yFeedbackEmailSubject'))}`;
    }, []);

    const handleOpenStatement = useCallback(() => {
        statementTriggerRef.current = document.activeElement;
        setShowStatement(true);
    }, []);

    const handleCloseStatement = useCallback(() => {
        setShowStatement(false);
        setTimeout(() => {
            statementTriggerRef.current?.focus?.();
        }, 0);
    }, []);

    return (
        <div id="a11y-v-widget-root">
            <style>{`
                @keyframes a11y-v-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.5); }
                    50% { box-shadow: 0 0 0 8px rgba(37,99,235,0); }
                }
                #a11y-v-fab { animation: a11y-v-pulse 2.5s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) { #a11y-v-fab { animation: none !important; } }
                @media (max-width: 480px) {
                    #a11y-v-fab {
                        right: 10px !important;
                        width: 34px !important;
                        height: 34px !important;
                    }
                }
            `}</style>

            <button
                id="a11y-v-fab"
                ref={buttonRef}
                type="button"
                onClick={() => (open ? close() : setOpen(true))}
                aria-label={t('a11yFabLabel')}
                aria-expanded={open}
                aria-haspopup="dialog"
                className="fixed rounded-full flex items-center justify-center text-white hover:brightness-110 transition"
                style={{
                    top: '50%',
                    right: 12,
                    transform: 'translateY(-50%)',
                    width: 36,
                    height: 36,
                    zIndex: 99999,
                    background: 'linear-gradient(180deg, #1e40af, #1d4ed8)',
                    boxShadow: '0 4px 14px rgba(29,78,216,0.45)',
                }}
            >
                <Accessibility size={20} />
            </button>

            {open && (
                <>
                    <div
                        onClick={close}
                        aria-hidden="true"
                        className="fixed inset-0 bg-black/40 z-[99998]"
                        style={{ animation: 'a11y-v-fade-in 200ms ease' }}
                    />
                    <style>{`@keyframes a11y-v-fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
                    <div ref={panelRef}>
                        <A11yPanel
                            a11y={a11y}
                            onClose={close}
                            onOpenStatement={handleOpenStatement}
                            onFeedback={handleFeedback}
                            closeButtonRef={closeButtonRef}
                        />
                    </div>
                </>
            )}

            {showStatement && <AccessibilityStatement onClose={handleCloseStatement} />}
        </div>
    );
}
