import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TABS = [
    { id: 'terms', label: 'Terms of Service' },
    { id: 'privacy', label: 'Privacy Policy' },
    { id: 'disclaimer', label: 'Disclaimer' },
    { id: 'affiliate', label: 'Affiliate Disclosure' },
    { id: 'accessibility', label: 'Accessibility' },
];

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

function TermsContent() {
    return (
        <>
            <Section title="Independent Tool">
                <p>
                    SafePost is a third-party tool and is not affiliated with, endorsed by, or
                    sponsored by Meta Platforms, Inc. or Facebook.
                </p>
            </Section>
            <Section title="User Responsibility">
                <p>
                    You are solely responsible for the content you post through SafePost and must
                    comply with Facebook&apos;s Terms of Service and Community Standards at all times.
                </p>
            </Section>
            <Section title="No Guarantee of Service">
                <p>
                    SafePost does not guarantee uninterrupted service, and does not guarantee that
                    Facebook will not restrict, suspend, or ban your account as a result of using
                    this tool.
                </p>
            </Section>
            <Section title="Prohibited Use">
                <p>
                    You must not use SafePost for spam, harassment, illegal content, or any
                    activity that violates applicable laws.
                </p>
            </Section>
            <Section title="Account Suspension">
                <p>
                    SafePost reserves the right to suspend accounts that abuse the system or violate
                    these Terms.
                </p>
            </Section>
            <Section title="Rate Limits">
                <p>Rate limits and posting restrictions are enforced for your protection and cannot be bypassed.</p>
            </Section>
            <Section title="No Warranties">
                <p>The service is provided &quot;as is&quot; without warranties of any kind, express or implied.</p>
            </Section>
            <Section title="Limitation of Liability">
                <p>
                    To the maximum extent permitted by law, SafePost shall not be liable for any
                    indirect, incidental, or consequential damages arising from your use of the service.
                </p>
            </Section>
            <Section title="Changes to These Terms">
                <p>
                    SafePost reserves the right to modify these Terms at any time. Continued use of
                    the service after changes constitutes acceptance of the updated Terms.
                </p>
            </Section>
        </>
    );
}

function PrivacyContent() {
    return (
        <>
            <Section title="Data We Collect">
                <p>
                    We collect Facebook account tokens, session data, posting logs, group IDs, and
                    user preferences necessary to operate the service.
                </p>
            </Section>
            <Section title="How Data Is Stored">
                <p>Data is encrypted at rest and stored on secure servers.</p>
            </Section>
            <Section title="No Selling or Sharing">
                <p>We do not sell your data or share it with third parties.</p>
            </Section>
            <Section title="Retention">
                <p>
                    Posting logs are retained for a limited period for debugging purposes, after
                    which they are deleted.
                </p>
            </Section>
            <Section title="Facebook Tokens">
                <p>Facebook tokens are stored encrypted and are used only to post on your behalf.</p>
            </Section>
            <Section title="Data Deletion">
                <p>You may request deletion of your data at any time.</p>
            </Section>
            <Section title="Cookies & Local Storage">
                <p>
                    SafePost uses local storage in your browser to remember preferences such as
                    theme and session state. No third-party tracking cookies are used.
                </p>
            </Section>
            <Section title="Contact">
                <p>For privacy inquiries, please contact the SafePost support team through your account dashboard.</p>
            </Section>
        </>
    );
}

function DisclaimerContent() {
    return (
        <>
            <Section title="Independent Automation Tool">
                <p>SafePost is an independent automation tool and is not an official Meta or Facebook product.</p>
            </Section>
            <Section title="Risk of Using Automation">
                <p>
                    Using automation tools may violate Facebook&apos;s Terms of Service and may result
                    in account restrictions or bans.
                </p>
            </Section>
            <Section title="No Responsibility for Platform Actions">
                <p>SafePost is not responsible for any account bans, content removal, or restrictions imposed by Facebook.</p>
            </Section>
            <Section title="Assumption of Risk">
                <p>Users assume all risk when using this tool.</p>
            </Section>
            <Section title="Safety Features">
                <p>
                    SafePost&apos;s built-in rate limiting and safety features are designed to minimize
                    risk but do not eliminate it.
                </p>
            </Section>
        </>
    );
}

function AffiliateContent() {
    return (
        <>
            <Section title="Affiliate Links">
                <p>
                    This site may contain affiliate links. If you make a purchase through one of
                    these links, SafePost may earn a commission at no additional cost to you.
                </p>
            </Section>
            <Section title="Amazon Associates">
                <p>As an Amazon Associate, SafePost earns from qualifying purchases.</p>
            </Section>
            <Section title="Editorial Independence">
                <p>Affiliate relationships do not affect our recommendations or content.</p>
            </Section>
        </>
    );
}

function AccessibilityContent() {
    return (
        <>
            <Section title="Our Commitment">
                <p>
                    SafePost is committed to making its dashboard accessible in line with WCAG 2.1
                    Level AA, and with Israel&apos;s Equal Rights for Persons with Disabilities Law,
                    1998 (חוק שוויון זכויות לאנשים עם מוגבלות, תשנ&quot;ח-1998) and the Equal Rights
                    for Persons with Disabilities Regulations (Accessibility Adjustments to Service)
                    (תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות)).
                </p>
            </Section>
            <Section title="What We&apos;ve Done">
                <p>
                    Semantic HTML structure, keyboard-operable controls, focus management and visible
                    focus indicators in dialogs and drawers, ARIA labeling for icon-only controls
                    and live status regions, and support for reduced-motion preferences.
                </p>
            </Section>
            <Section title="Known Limitations">
                <p>
                    The compact queue view uses smaller action buttons that do not yet meet the
                    44×44px touch-target guideline. The standard queue view meets this guideline,
                    and we are working to close this gap.
                </p>
            </Section>
            <Section title="Contact Us">
                <p>
                    If you encounter an accessibility barrier while using SafePost, please contact
                    us through your account dashboard so we can address it.
                </p>
            </Section>
        </>
    );
}

const CONTENT = {
    terms: TermsContent,
    privacy: PrivacyContent,
    disclaimer: DisclaimerContent,
    affiliate: AffiliateContent,
    accessibility: AccessibilityContent,
};

export default function Legal({ initialTab = 'terms', onClose }) {
    const [activeTab, setActiveTab] = useState(initialTab);
    const containerRef = useRef(null);
    const previouslyFocused = useRef(null);
    const titleId = useId();
    const panelId = useId();
    const tabRefs = useRef([]);

    useEffect(() => {
        setActiveTab(initialTab);
    }, [initialTab]);

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

    const activeIndex = useMemo(
        () => TABS.findIndex((tab) => tab.id === activeTab),
        [activeTab],
    );
    const ActiveContent = CONTENT[activeTab];

    function handleTabKeyDown(event, index) {
        let nextIndex = index;
        if (event.key === 'ArrowRight') {
            nextIndex = (index + 1) % TABS.length;
        } else if (event.key === 'ArrowLeft') {
            nextIndex = (index - 1 + TABS.length) % TABS.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = TABS.length - 1;
        } else {
            return;
        }
        event.preventDefault();
        setActiveTab(TABS[nextIndex].id);
        tabRefs.current[nextIndex]?.focus();
    }

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
                        Legal
                    </h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div
                    className="flex border-b border-gray-200 dark:border-[#30363d] overflow-x-auto"
                    role="tablist"
                    aria-label="Legal document sections"
                >
                    {TABS.map((tab, index) => {
                        const selected = activeTab === tab.id;
                        const tabId = `legal-tab-${tab.id}`;
                        const tabPanelId = `${panelId}-${tab.id}`;
                        return (
                            <button
                                key={tab.id}
                                ref={(element) => {
                                    tabRefs.current[index] = element;
                                }}
                                id={tabId}
                                role="tab"
                                aria-selected={selected}
                                aria-controls={tabPanelId}
                                tabIndex={selected ? 0 : -1}
                                onClick={() => setActiveTab(tab.id)}
                                onKeyDown={(event) => handleTabKeyDown(event, index)}
                                className={`px-4 py-3 text-xs font-bold uppercase tracking-wide whitespace-nowrap transition border-b-2 ${
                                    selected
                                        ? 'border-brand text-brand'
                                        : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-300'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div
                    id={`${panelId}-${activeTab}`}
                    className="p-6 overflow-y-auto custom-scrollbar"
                    role="tabpanel"
                    aria-labelledby={`legal-tab-${activeTab}`}
                >
                    <ActiveContent />
                </div>
            </div>
        </div>
    );
}
