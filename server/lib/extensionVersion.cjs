'use strict';

const MINIMUM_ENGAGEMENT_EXTENSION_VERSION = '9.2';

function parseNumericVersion(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    // Chrome accepts one to four dot-separated integers, so "10" is a valid
    // manifest version. Requiring two components would have locked the whole
    // fleet out of Engagement the day the version became a single number.
    // Missing components compare as 0 below, so "10" and "10.0" are equal.
    if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) return null;

    const parts = normalized.split('.').map(Number);
    if (parts.some(part => !Number.isSafeInteger(part) || part < 0 || part > 65535)) {
        return null;
    }
    return parts;
}

function compareNumericVersions(left, right) {
    const a = parseNumericVersion(left);
    const b = parseNumericVersion(right);
    if (!a || !b) return null;

    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
        const difference = (a[index] || 0) - (b[index] || 0);
        if (difference !== 0) return difference < 0 ? -1 : 1;
    }
    return 0;
}

function isVersionAtLeast(version, minimum) {
    const comparison = compareNumericVersions(version, minimum);
    return comparison !== null && comparison >= 0;
}

function requireEngagementExtensionVersion(req, res, next) {
    const version = req.worker?.extension_version;
    if (!isVersionAtLeast(version, MINIMUM_ENGAGEMENT_EXTENSION_VERSION)) {
        return res.status(426).json({
            error: 'Extension upgrade required.',
            code: 'EXTENSION_UPGRADE_REQUIRED',
            minimum_version: MINIMUM_ENGAGEMENT_EXTENSION_VERSION,
        });
    }
    return next();
}

module.exports = {
    MINIMUM_ENGAGEMENT_EXTENSION_VERSION,
    parseNumericVersion,
    compareNumericVersions,
    isVersionAtLeast,
    requireEngagementExtensionVersion,
};
