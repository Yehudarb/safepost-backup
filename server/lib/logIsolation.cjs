'use strict';

function requireWorkspaceId(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
        const error = new Error('Tenant log requires an authoritative workspace id.');
        error.code = 'LOG_WORKSPACE_REQUIRED';
        throw error;
    }
    return workspaceId.trim();
}

function safeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
    const { workspace_id, workspaceId, ...safe } = metadata;
    return safe;
}

function createTenantEventLog({ workspaceId, taskId, type, message, metadata = {}, timestamp = new Date().toISOString() }) {
    return {
        workspace_id: requireWorkspaceId(workspaceId),
        scope: 'tenant',
        taskId,
        type,
        message,
        metadata: safeMetadata(metadata),
        timestamp,
        age_seconds: 0,
    };
}

function createGlobalEventLog({ type, message, metadata = {}, timestamp = new Date().toISOString() }) {
    return {
        workspace_id: null,
        scope: 'global',
        taskId: null,
        type,
        message,
        metadata: safeMetadata(metadata),
        timestamp,
        age_seconds: 0,
    };
}

function selectWorkspaceEventLogs(logs, workspaceId, { type = null, limit = 50, now = Date.now() } = {}) {
    const authorizedWorkspaceId = requireWorkspaceId(workspaceId);
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    const filtered = (Array.isArray(logs) ? logs : []).filter(log => (
        log &&
        log.scope === 'tenant' &&
        typeof log.workspace_id === 'string' &&
        log.workspace_id === authorizedWorkspaceId &&
        (!type || log.type === type)
    ));

    return {
        total: filtered.length,
        logs: filtered.slice(0, safeLimit).map(log => ({
            ...log,
            age_seconds: Math.max(0, Math.floor((now - new Date(log.timestamp).getTime()) / 1000)),
        })),
    };
}

function systemLogFields({ log_level = 'info', source = 'server', message = '' } = {}) {
    return {
        log_level: typeof log_level === 'string' ? log_level : 'info',
        source: typeof source === 'string' ? source : 'server',
        message: typeof message === 'string' ? message : String(message || ''),
    };
}

function createTenantSystemLog(workspaceId, fields) {
    return {
        ...systemLogFields(fields),
        workspace_id: requireWorkspaceId(workspaceId),
    };
}

function createGlobalSystemLog(fields) {
    return {
        ...systemLogFields(fields),
        workspace_id: null,
    };
}

async function persistTenantSystemLog(database, workspaceId, fields, logger = console) {
    let row;
    try {
        row = createTenantSystemLog(workspaceId, fields);
    } catch (error) {
        logger.error(`[SYSTEM_LOG] Refused unscoped tenant log: ${error.message}`);
        return { ok: false, code: error.code, error };
    }

    const { error } = await database.from('system_logs').insert([row]);
    if (error) {
        logger.error(`[SYSTEM_LOG] Insert failed: ${error.message || error}`);
        return { ok: false, code: 'LOG_INSERT_FAILED', error };
    }
    return { ok: true, row };
}

async function persistGlobalSystemLog(database, fields, logger = console) {
    const row = createGlobalSystemLog(fields);
    const { error } = await database.from('system_logs').insert([row]);
    if (error) {
        logger.error(`[SYSTEM_LOG] Global insert failed: ${error.message || error}`);
        return { ok: false, code: 'LOG_INSERT_FAILED', error };
    }
    return { ok: true, row };
}

module.exports = {
    requireWorkspaceId,
    createTenantEventLog,
    createGlobalEventLog,
    selectWorkspaceEventLogs,
    createTenantSystemLog,
    createGlobalSystemLog,
    persistTenantSystemLog,
    persistGlobalSystemLog,
};
