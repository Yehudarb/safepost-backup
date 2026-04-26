import React, { useEffect } from 'react';
import { Check, AlertCircle, X, Info, AlertTriangle } from 'lucide-react';

const Toast = ({ message, type = 'success', onClose }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 5000); // Auto close after 5s

        return () => clearTimeout(timer);
    }, [onClose]);

    const colorStyles = {
        success: { border: 'border-emerald-500', text: 'text-emerald-400' },
        error: { border: 'border-rose-500', text: 'text-rose-400' },
        info: { border: 'border-blue-500', text: 'text-blue-400' },
        warning: { border: 'border-amber-500', text: 'text-amber-400' },
    };

    const icons = {
        success: Check,
        error: AlertCircle,
        info: Info,
        warning: AlertTriangle,
    };

    const Icon = icons[type] || Check;
    const colors = colorStyles[type] || colorStyles.info;

    return (
        <div className={`fixed bottom-8 right-8 flex items-center gap-4 px-6 py-4 rounded-2xl shadow-2xl bg-[#1c2128] border border-[#30363d] border-l-[6px] transition-all duration-300 animate-slide-in z-[100] ${colors.border}`}>
            <div className={`p-1.5 rounded-lg bg-current bg-opacity-10`}>
                <Icon className={`w-5 h-5 ${colors.text}`} />
            </div>
            <span className={`font-bold text-sm text-white`}>{message}</span>
            <button onClick={onClose} className="ml-4 p-1 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0">
                <X className="w-4 h-4 text-gray-400 hover:text-white" />
            </button>
        </div>
    );
};

export default Toast;
