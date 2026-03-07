import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from "lucide-react";

// Helper to get days in month
const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

const dayNames = ["S", "M", "T", "W", "T", "F", "S"];

const CalendarDay = ({ day, isHeader, isSelected, isToday, onClick, compact }) => {
    if (isHeader) {
        return (
            <div className={`flex ${compact ? 'h-5' : 'h-6'} w-full items-center justify-center text-[10px] font-bold text-slate-400 select-none`}>
                {day}
            </div>
        );
    }

    return (
        <div
            onClick={onClick}
            className={`flex ${compact ? 'h-6' : 'h-7'} w-full cursor-pointer items-center justify-center rounded-lg text-xs transition-all duration-200 select-none ${isSelected
                ? "bg-indigo-600 text-white shadow-md font-bold scale-105"
                : isToday
                    ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
                }`}
        >
            {day}
        </div>
    );
};

export function Calendar({ value, onChange, compact = false }) {
    const inputRef = useRef(null);

    // Parse state or default
    const dateObj = value ? new Date(value) : new Date();
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth(); // 0-indexed
    const day = dateObj.getDate();
    const today = new Date();

    // Formatting strings
    const monthName = dateObj.toLocaleString("default", { month: "long" });
    const timeString = value ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : "--:--";

    // Grid Data
    const numDays = getDaysInMonth(year, month);
    const startDay = getFirstDayOfMonth(year, month);
    const daysArray = Array.from({ length: numDays }, (_, i) => i + 1);
    const emptyDays = Array.from({ length: startDay }, (_, i) => i);

    // Handlers
    const handleDayClick = (clickedDay) => {
        const newDate = new Date(year, month, clickedDay);
        if (value) {
            const current = new Date(value);
            newDate.setHours(current.getHours());
            newDate.setMinutes(current.getMinutes());
        } else {
            const now = new Date();
            newDate.setHours(now.getHours());
            newDate.setMinutes(now.getMinutes());
        }
        const localIso = new Date(newDate.getTime() - (newDate.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        onChange({ target: { value: localIso } });
    };

    const openNativePicker = () => {
        inputRef.current?.showPicker();
    };

    return (
        <div className={`w-full overflow-hidden rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-[#161b22] transition-all hover:shadow-lg ${compact ? 'shadow-sm' : 'shadow-md'}`}>

            {/* Header Section */}
            <div className={`flex items-center justify-between ${compact ? 'p-3 pb-1' : 'p-4 pb-2'}`}>
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mission Date</span>
                    <div className="flex items-baseline gap-1 relative group cursor-pointer" onClick={openNativePicker}>
                        <h2 className={`${compact ? 'text-lg' : 'text-xl'} font-bold text-slate-900 dark:text-white group-hover:text-indigo-500 transition-colors`}>{monthName}</h2>
                        <span className="text-sm font-medium text-slate-500">{year}</span>
                        <input
                            ref={inputRef}
                            type="datetime-local"
                            className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                            value={value || ""}
                            onChange={onChange}
                        />
                    </div>
                </div>

                {/* Time Badge */}
                <div onClick={openNativePicker} className={`flex cursor-pointer items-center gap-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors`}>
                    <Clock size={compact ? 12 : 14} className="text-indigo-600 dark:text-indigo-400" />
                    <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-bold text-indigo-700 dark:text-indigo-300 tabular-nums`}>
                        {timeString}
                    </span>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className={`${compact ? 'p-2 pt-0' : 'p-3 pt-0'}`}>
                <div className={`rounded-lg border border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-[#0d1117]/50 ${compact ? 'p-1.5' : 'p-2'}`}>
                    <div className="grid grid-cols-7 gap-1">
                        {/* Headers */}
                        {dayNames.map((d, i) => <CalendarDay key={`head-${i}`} day={d} isHeader compact={compact} />)}

                        {/* Empty Slots */}
                        {emptyDays.map((i) => <div key={`empty-${i}`} />)}

                        {/* Days */}
                        {daysArray.map((d) => {
                            const isSelected = value && d === day;
                            const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

                            return (
                                <CalendarDay
                                    key={d}
                                    day={d}
                                    isSelected={isSelected}
                                    isToday={isToday}
                                    onClick={() => handleDayClick(d)}
                                    compact={compact}
                                />
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
