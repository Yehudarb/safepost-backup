/**
 * Time Utility Functions
 * Handles timezone-aware time formatting and calculations
 */

export const formatLocalTime = (utcString) => {
    if (!utcString) return '';
    try {
        const date = new Date(utcString);
        // Format: HH:MM in local timezone
        return date.toLocaleTimeString('he-IL', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch {
        return '';
    }
};

export const formatLocalDateTime = (utcString) => {
    if (!utcString) return '';
    try {
        const date = new Date(utcString);
        // Format: DD/MM HH:MM in local timezone
        return date.toLocaleString('he-IL', {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch {
        return '';
    }
};

export const getLocalDateTimeInput = (date) => {
    if (!date) return '';
    try {
        // Convert to local datetime-local input format (YYYY-MM-DDTHH:mm)
        const local = new Date(date);
        const year = local.getFullYear();
        const month = String(local.getMonth() + 1).padStart(2, '0');
        const day = String(local.getDate()).padStart(2, '0');
        const hours = String(local.getHours()).padStart(2, '0');
        const minutes = String(local.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch {
        return '';
    }
};

export const toUTCISO = (localDateTimeString) => {
    if (!localDateTimeString) return null;
    try {
        // Convert from datetime-local format to UTC ISO string
        const date = new Date(localDateTimeString);
        return date.toISOString();
    } catch {
        return null;
    }
};
