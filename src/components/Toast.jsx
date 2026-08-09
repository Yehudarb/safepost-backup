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
        success: { border: 'border-l-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-600' },
        error: { border: 'border-l-error', bg: 'bg-error-container', text: 'text-error', icon: 'text-error' },
        info: { border: 'border-l-primary', bg: 'bg-primary-fixed', text: 'text-on-primary-fixed', icon: 'text-primary' },
        warning: { border: 'border-l-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-600' },
    };

    const icons = {
        success: Check,
        error: AlertCircle,
        info: Info,
        warning: AlertTriangle,
    };

    const Icon = icons[type] || Check;
    const colors = colorStyles[type] || colorStyles.info;
    const isUrgent = type === 'error' || type === 'warning';

    return (
        <div
            role={isUrgent ? 'alert' : 'status'}
            aria-live={isUrgent ? 'assertive' : 'polite'}
            className={`fixed bottom-8 right-8 flex items-center gap-4 px-lg py-md rounded-lg border-l-4 transition-all duration-300 animate-slide-in z-[100] shadow-sm ${colors.bg} ${colors.border}`}>
            <div className={`p-sm rounded-md`}>
                <Icon className={`w-5 h-5 ${colors.icon}`} />
            </div>
            <span className={`font-label-sm ${colors.text}`}>{message}</span>
            <button type="button" onClick={onClose} aria-label="סגור הודעה" className="ml-4 p-sm hover:bg-black/5 rounded-md transition-colors flex-shrink-0">
                <X className={`w-4 h-4 ${colors.text}`} />
            </button>
        </div>
    );
};

export default Toast;
