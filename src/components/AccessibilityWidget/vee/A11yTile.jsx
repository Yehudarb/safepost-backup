import React from 'react';

export default function A11yTile({ icon, label, active, onClick, disabled, badge }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={`
                relative flex flex-col items-center justify-center gap-1.5
                rounded-xl border transition-all duration-150
                w-full aspect-[10/9] p-2
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]
                active:scale-95
                disabled:opacity-40 disabled:cursor-not-allowed
                ${active
                    ? 'bg-[#2563eb] border-[#2563eb] text-white shadow-lg shadow-[#2563eb]/30'
                    : 'bg-[#f1f5f9] border-[#e2e8f0] text-[#1e3a8a] hover:bg-[#eff6ff] hover:border-[#2563eb]/30'}
            `}
        >
            {badge && (
                <span className="absolute top-1 left-1 text-[8px] font-bold px-1 rounded bg-black/10 text-current">{badge}</span>
            )}
            <span className={active ? 'text-white' : 'text-[#1e3a8a]'}>{icon}</span>
            <span className="text-[11px] font-semibold leading-tight text-center">{label}</span>
        </button>
    );
}
