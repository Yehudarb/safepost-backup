'use strict';

function logEngagementSweepResult(result, logger = console) {
    const swept = Number(result?.swept) || 0;
    if (swept <= 0) return false;

    const requeued = Number(result?.requeued) || 0;
    const failed = Number(result?.failed) || 0;
    logger.warn(`[sweep] engagement recovered swept=${swept} requeued=${requeued} failed=${failed}`);
    return true;
}

module.exports = { logEngagementSweepResult };
