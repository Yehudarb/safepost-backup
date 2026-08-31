// Simple structured logging
const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug'
};

class Logger {
    constructor(name = 'app') {
        this.name = name;
    }

    #formatLog(level, message, data = {}) {
        return {
            timestamp: new Date().toISOString(),
            level,
            name: this.name,
            message,
            ...data
        };
    }

    error(message, data = {}) {
        const log = this.#formatLog('ERROR', message, data);
        console.error(`❌ [${log.name}]`, message, data);
        return log;
    }

    warn(message, data = {}) {
        const log = this.#formatLog('WARN', message, data);
        console.warn(`⚠️  [${log.name}]`, message, data);
        return log;
    }

    info(message, data = {}) {
        const log = this.#formatLog('INFO', message, data);
        console.log(`ℹ️  [${log.name}]`, message, data);
        return log;
    }

    debug(message, data = {}) {
        if (process.env.DEBUG) {
            const log = this.#formatLog('DEBUG', message, data);
            console.debug(`🐛 [${log.name}]`, message, data);
            return log;
        }
    }
}

module.exports = Logger;
