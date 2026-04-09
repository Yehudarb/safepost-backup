#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔨 Building SafePost Backup...');

// Create .env file
const envContent = `SUPABASE_URL=https://namyhsldzufeoycleqxf.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_RnLBNjUkhLHjF630ucbfsA_MLuonpua
`;

fs.writeFileSync(path.join(__dirname, '.env'), envContent);
console.log('✅ .env created');

// Install dependencies
console.log('📦 Installing dependencies...');
execSync('npm install', { stdio: 'inherit' });

// Build frontend
console.log('🎨 Building frontend...');
execSync('npm run build', { stdio: 'inherit' });

console.log('✅ Build complete!');
