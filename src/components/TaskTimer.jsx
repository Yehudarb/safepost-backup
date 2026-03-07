import React, { useState, useEffect } from 'react';

/**
 * TaskTimer Component
 * 
 * Displays a live countdown in MM:SS format.
 * Implements proper cleanup and state synchronization.
 * 
 * @param {string} targetTime - UTC ISO string from backend (scheduled_time)
 * @param {string} status - Current status of the task
 * @param {function} onComplete - Callback when timer hits zero
 */
const TaskTimer = ({ targetTime, status, onComplete }) => {
    // Initialize state immediately to avoid first-render null/flicker
    const [timeLeft, setTimeLeft] = useState(() => {
        const isPending = status && status.toUpperCase() === 'PENDING';
        if (!isPending || !targetTime) return null;
        
        const diff = new Date(targetTime).getTime() - new Date().getTime();
        return Math.max(0, diff);
    });

    useEffect(() => {
        const isPending = status && status.toUpperCase() === 'PENDING';
        
        if (!isPending || !targetTime) {
            setTimeLeft(null);
            return;
        }

        const calculateTimeLeft = (isInitial = false) => {
            const now = new Date();
            const target = new Date(targetTime);
            const difference = target.getTime() - now.getTime();

            if (difference <= 0) {
                setTimeLeft(0);
                // Only trigger onComplete if it's a real transition, not on every mount of a past-due task
                if (!isInitial && onComplete) {
                    onComplete();
                }
                return false;
            }

            setTimeLeft(difference);
            return true;
        };

        const timerId = setInterval(() => {
            calculateTimeLeft(false);
        }, 1000);

        return () => clearInterval(timerId);
    }, [targetTime, status, onComplete]);

    const isPending = status && status.toUpperCase() === 'PENDING';
    if (!isPending || timeLeft === null) return null;

    const totalSeconds = Math.max(0, Math.floor(timeLeft / 1000));
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');

    // Visual urgency
    const isOverdue = totalSeconds === 0;
    const isUrgent = totalSeconds < 60;

    return (
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono font-bold text-[10px] w-fit ${
            isOverdue ? 'bg-sky-500/20 text-sky-400 animate-pulse border border-sky-500/30' :
            isUrgent ? 'bg-rose-500/20 text-rose-500 animate-pulse border border-rose-500/30' : 
            'bg-amber-500/10 text-amber-500 border border-amber-500/20'
        }`}>
            <span className="opacity-70 text-[8px] uppercase tracking-tighter">T-Minus</span>
            <span>{mm}:{ss}</span>
        </div>
    );
};

export default TaskTimer;
