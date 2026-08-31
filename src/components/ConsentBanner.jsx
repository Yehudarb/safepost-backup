import React from 'react';

const STORAGE_KEY = 'safepost_tos_accepted';

export function hasAcceptedTos() {
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

export default function ConsentBanner({ onAccept, onReadTerms }) {
    function accept() {
        localStorage.setItem(STORAGE_KEY, 'true');
        onAccept();
    }

    return (
        <div className="fixed inset-0 z-[500] flex items-start justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
            <div
                role="alert"
                className="relative mt-6 mx-4 max-w-2xl w-full bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
            >
                <p className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed flex-1">
                    By using SafePost you agree to our Terms of Service and acknowledge our Privacy Policy.
                    This tool is not affiliated with Meta/Facebook.
                </p>
                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={onReadTerms}
                        className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-gray-400 border border-gray-200 dark:border-[#30363d] hover:bg-gray-100 dark:hover:bg-[#21262d] transition"
                    >
                        Read Terms
                    </button>
                    <button
                        onClick={accept}
                        className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-gradient-to-br from-brand to-brand-dark text-white shadow-lg shadow-brand/30 hover:shadow-brand/50 transition-all"
                    >
                        Accept
                    </button>
                </div>
            </div>
        </div>
    );
}
