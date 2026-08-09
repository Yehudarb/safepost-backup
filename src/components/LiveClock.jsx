import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

export default function LiveClock() {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const timeStr = time.toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const dateStr = time.toLocaleDateString('he-IL', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    return (
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#161b22] border border-gray-100 dark:border-[#30363d] rounded-xl">
            <Clock size={16} className="text-brand dark:text-brand-dark shrink-0" />
            <div className="text-right">
                <div dir="ltr" className="font-mono text-sm font-bold text-gray-900 dark:text-white">
                    {timeStr}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    {dateStr}
                </div>
            </div>
        </div>
    );
}
