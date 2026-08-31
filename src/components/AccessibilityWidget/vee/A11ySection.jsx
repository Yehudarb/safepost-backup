import React from 'react';
import { Plus, Minus } from 'lucide-react';

export default function A11ySection({ title, open, onToggle, bodyId, children }) {
    return (
        <div className="border-b border-[#e2e8f0]">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={bodyId}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right hover:bg-[#f8fafc] transition-colors"
            >
                <span className="text-[15px] font-bold text-[#1e3a8a]">{title}</span>
                <span
                    aria-hidden="true"
                    className="shrink-0 w-7 h-7 rounded-full bg-[#2563eb] text-white flex items-center justify-center"
                >
                    {open ? <Minus size={16} /> : <Plus size={16} />}
                </span>
            </button>
            {open && (
                <div id={bodyId} className="px-4 pb-4">
                    {children}
                </div>
            )}
        </div>
    );
}
