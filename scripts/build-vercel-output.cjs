'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { root, resolveFrontendEnvironment, forbiddenProductionReferences } = require('./environment-isolation.cjs');

function run() {
    const config = resolveFrontendEnvironment(process.env);
    process.env.VITE_PUBLIC_APP_HOST = config.publicHost;
    const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    const build = spawnSync(process.execPath, [vite, 'build'], { cwd: root, env: process.env, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status || 1);

    const output = path.join(root, '.vercel', 'output');
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    fs.cpSync(path.join(root, 'dist'), path.join(output, 'static'), { recursive: true });

    const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        `connect-src 'self' ${config.apiOrigin} ${config.apiWebSocketOrigin} ${config.supabaseOrigin}`,
        "img-src 'self' data: https: blob:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "media-src 'self' blob: https:",
        "worker-src blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        'upgrade-insecure-requests',
    ].join('; ') + ';';
    const headers = {
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Access-Control-Allow-Origin': config.publicOrigin,
        'Content-Security-Policy': csp,
    };
    fs.writeFileSync(path.join(output, 'config.json'), JSON.stringify({
        version: 3,
        routes: [
            { src: '/(.*)', headers, continue: true },
            { src: '/app', dest: '/app/index.html' },
            { src: '/app/(.*)', dest: '/app/index.html' },
            { handle: 'filesystem' },
        ],
    }, null, 2) + '\n');

    if (config.target === 'qa') {
        const hits = forbiddenProductionReferences(output);
        if (hits.length) throw new Error(`QA output references production:\n${hits.join('\n')}`);
    }
    console.log(`[vercel-build] environment=${config.target}`);
    console.log(`[vercel-build] api=${config.apiOrigin}`);
    console.log(`[vercel-build] supabase_ref=${process.env.SAFEPOST_EXPECTED_SUPABASE_REF}`);
}

try { run(); } catch (error) { console.error(`[vercel-build] ${error.message}`); process.exit(1); }
