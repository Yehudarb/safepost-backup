#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🔨 Building SafePost Backup...');

// This file used to write a .env containing a hardcoded Supabase URL and
// service-role secret. That was wrong twice over: the secret was committed to a
// public repo, and the values pointed at a Supabase project that no longer
// exists. Production was unaffected only by luck — dotenv does not override
// variables already present in process.env, so Render's dashboard-configured
// values silently won over the ones written here.
//
// The credentials now come from the environment only (Render dashboard locally,
// .env for local dev — which this script must never clobber).
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED.filter((name) => !process.env[name]);

if (missing.length > 0) {
    // A warning rather than a hard failure: on some hosts these are injected at
    // run time rather than build time, and failing here would break a deploy
    // that would otherwise start fine.
    console.warn(`⚠️  Not set at build time: ${missing.join(', ')}`);
    console.warn('   The server needs these at startup. If it fails to reach Supabase,');
    console.warn('   check the environment variables in your hosting dashboard.');
} else {
    console.log('✅ Supabase environment variables present');
}

console.log('📦 Installing dependencies...');
execSync('npm install', { stdio: 'inherit' });

console.log('🎨 Building frontend...');
execSync('npm run build', { stdio: 'inherit' });

console.log('✅ Build complete!');
