import React from 'react';

export default function Footer({ onOpenLegal }) {
    return (
        <footer className="fixed bottom-8 left-0 right-0 h-9 bg-white/95 dark:bg-[#0d1117]/95 backdrop-blur border-t border-gray-200 dark:border-[#30363d] flex items-center justify-between px-4 text-[10px] text-slate-500 dark:text-gray-400 z-[60]">
            <span>© 2024 SafePost · v2.2</span>
            <nav aria-label="Legal links" className="flex items-center gap-1.5">
                <button onClick={() => onOpenLegal('terms')} className="hover:text-slate-800 dark:hover:text-gray-300 transition underline-offset-2 hover:underline">Terms</button>
                <span aria-hidden="true">·</span>
                <button onClick={() => onOpenLegal('privacy')} className="hover:text-slate-800 dark:hover:text-gray-300 transition underline-offset-2 hover:underline">Privacy</button>
                <span aria-hidden="true">·</span>
                <button onClick={() => onOpenLegal('disclaimer')} className="hover:text-slate-800 dark:hover:text-gray-300 transition underline-offset-2 hover:underline">Disclaimer</button>
            </nav>
            <span>Not affiliated with Meta/Facebook</span>
        </footer>
    );
}
