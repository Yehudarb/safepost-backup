import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Section({ title, children }) {
    return (
        <div className="space-y-2 mb-6">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
            <div className="text-sm leading-relaxed text-slate-600 dark:text-gray-400 space-y-2">
                {children}
            </div>
        </div>
    );
}

export default function AccessibilityStatement({ onClose }) {
    const containerRef = useRef(null);
    const previouslyFocused = useRef(null);
    const titleId = 'accessibility-statement-title';
    const lastUpdated = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    useEffect(() => {
        previouslyFocused.current = document.activeElement;
        const focusable = containerRef.current?.querySelector(FOCUSABLE_SELECTOR);
        focusable?.focus();
        return () => previouslyFocused.current?.focus?.();
    }, []);

    useEffect(() => {
        function onKeyDown(event) {
            if (event.key === 'Escape') {
                onClose?.();
                return;
            }
            if (event.key !== 'Tab' || !containerRef.current) {
                return;
            }
            const list = Array.from(containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
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
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[400] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
        >
            <div
                ref={containerRef}
                dir="ltr"
                className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-left"
            >
                <div className="p-5 border-b border-gray-200 dark:border-[#30363d] flex items-center justify-between bg-gray-50 dark:bg-[#1c2128]">
                    <h2 id={titleId} className="text-slate-900 dark:text-white font-bold text-sm">
                        Accessibility Statement | SafePost
                    </h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div tabIndex={0} className="p-6 overflow-y-auto custom-scrollbar">
                    <Section title="Our Commitment">
                        <p>
                            SafePost is committed to making its dashboard accessible to all users,
                            including people with disabilities.
                        </p>
                    </Section>
                    <Section title="Standard">
                        <p>We aim to conform to WCAG 2.1 Level AA and Israeli Standard 5568.</p>
                    </Section>
                    <Section title="Accessibility Features">
                        <ul className="list-disc pr-5 pl-5 space-y-1">
                            <li>Keyboard navigation support throughout the dashboard</li>
                            <li>Screen reader compatible interface</li>
                            <li>Adjustable text size, contrast, and spacing</li>
                            <li>Reduced motion support</li>
                            <li>Focus indicators on all interactive elements</li>
                        </ul>
                    </Section>
                    <Section title="Accessibility Widget">
                        <p>
                            Our built-in accessibility widget allows you to customize the display
                            to your specific needs, including font size, contrast, animations,
                            reading guides, and more. Look for the accessibility button in the
                            bottom-right corner of the screen.
                        </p>
                    </Section>
                    <Section title="Known Limitations">
                        <ul className="list-disc pr-5 pl-5 space-y-1">
                            <li>
                                Some third-party content such as Facebook group names may not be
                                fully accessible
                            </li>
                            <li>Real-time countdown animations require JavaScript</li>
                        </ul>
                    </Section>
                    <Section title="Contact">
                        <p>
                            If you encounter any accessibility issues, please contact us through
                            your account dashboard. We will do our best to resolve issues within
                            48 hours.
                        </p>
                    </Section>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-8">
                        Last updated: {lastUpdated}
                    </p>
                </div>
            </div>
        </div>
    );
}
