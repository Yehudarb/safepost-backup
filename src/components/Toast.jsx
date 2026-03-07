import React, { useEffect } from 'react';
import { Check, AlertCircle, X, Info } from 'lucide-react';

const Toast = ({ message, type = 'success', onClose }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 5000); // Auto close after 5s

        return () => clearTimeout(timer);
    }, [onClose]);

    const styles = {
        success: "border-emerald-500 text-emerald-500",
        error: "border-rose-500 text-rose-500",
        info: "border-indigo-500 text-indigo-500",
    };

    const icons = {
        success: Check,
        error: AlertCircle,
        info: Info,
    };

    const Icon = icons[type];
    const style = styles[type];

    return (
        <div className={`fixed bottom-8 right-8 flex items-center gap-4 px-6 py-4 rounded-2xl shadow-[var(--card-shadow)] bg-[var(--panel-bg)] backdrop-blur-2xl border-l-[6px] transition-all duration-300 animate-slide-in z-[100] ${style}`}>
            <div className="p-1.5 rounded-lg bg-current bg-opacity-10">
                <Icon className="w-5 h-5" />
            </div>
            <span className="font-bold text-sm text-[var(--text-primary)]">{message}</span>
            <button onClick={onClose} className="ml-4 p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
                <X className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>
        </div>
    );
};

export default Toast;
