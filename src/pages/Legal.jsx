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
            <Section title="What We Do Not Collect">
                <p>
                    SafePost does <strong>not</strong> collect or store your Facebook password,
                    login cookies, or Facebook access tokens. Posting happens through the
                    SafePost browser extension, using the Facebook session already open in your
                    own browser. Your Facebook credentials never reach our servers.
                </p>
            </Section>
            <Section title="Data We Collect">
                <p>To operate the service we store:</p>
                <ul className="list-disc pr-5 space-y-1">
                    <li>Your account email and the workspace you belong to.</li>
                    <li>
                        Posts you create or schedule, including their text, any media you upload,
                        and their delivery status.
                    </li>
                    <li>
                        The Facebook groups you sync — group name, ID and URL — and the Facebook
                        display name of the account that synced them.
                    </li>
                    <li>
                        Your numeric Facebook account identifier, read by the extension from the
                        <code> c_user</code> cookie in your browser. It is used to confirm that
                        synced groups belong to the Facebook account currently signed in, so posts
                        are never sent from the wrong account. It is not used to contact you and is
                        not shared.
                    </li>
                    <li>
                        Identifiers for each browser you pair with SafePost, along with a hashed
                        device token. The token itself is shown to you once at pairing and is
                        stored only as a hash.
                    </li>
                    <li>Activity and error logs describing what the service did and when.</li>
                </ul>
            </Section>
            <Section title="Discovered Posts From Facebook Groups">
                <p>
                    SafePost includes an optional feature that reads existing posts in groups you
                    select and saves them for you to review. When it is enabled, we store the post
                    text, the author&apos;s display name, their profile link, and the post link.
                    This is content written by other people in those groups.
                </p>
                <p>
                    This feature is currently disabled for all accounts. We do not yet operate an
                    automatic deletion schedule for this content, and we are addressing that before
                    the feature is made generally available.
                </p>
            </Section>
            <Section title="How Data Is Stored">
                <p>
                    Data is held in a managed PostgreSQL database (Supabase) with application
                    hosting on Render and Vercel. We rely on those providers&apos; encryption of
                    data at rest and in transit.
                </p>
            </Section>
            <Section title="Who Else Processes Your Data">
                <p>
                    We do not sell your data and we do not share it for advertising. We do use
                    service providers to run SafePost, and your data passes through them:
                </p>
                <ul className="list-disc pr-5 space-y-1">
                    <li>Supabase — database and authentication.</li>
                    <li>Render — backend hosting.</li>
                    <li>Vercel — dashboard hosting.</li>
                    <li>
                        Anthropic and Google — only when you use the AI writing assistant. The post
                        text you are drafting is sent to the model that generates the suggestion.
                        Nothing is sent to these providers unless you use that feature.
                    </li>
                </ul>
            </Section>
            <Section title="Retention">
                <p>
                    Posts, groups and logs are kept for as long as your account exists. We do not
                    currently run automatic deletion after a fixed period. If you want data removed
                    sooner, contact us and we will delete it.
                </p>
            </Section>
            <Section title="Data Deletion and Access">
                <p>
                    There is no self-service delete or export button in the dashboard yet. To
                    request a copy of your data, or its deletion, contact us through your account
                    dashboard and we will action it manually. Deleting your account removes your
                    workspace and the posts, groups, templates and logs belonging to it.
                </p>
            </Section>
            <Section title="Cookies & Local Storage">
                <p>
                    SafePost uses local storage in your browser to remember preferences such as
                    theme, language and which workspace you last opened, and to record that you
                    accepted these terms. No third-party tracking or advertising cookies are used.
                </p>
                <p>
                    The SafePost browser extension requests permission to read cookies for
                    facebook.com. It uses this for one purpose only: reading the
                    <code> c_user</code> value that identifies which Facebook account is signed in.
                    It does not read, store or transmit any other cookie.
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
