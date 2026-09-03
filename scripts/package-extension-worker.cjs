#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const positional = args.filter(arg => arg !== '--verify-only');
const sourceWorker = path.resolve(positional[0] || 'safe_post_extension/background.js');
const destination = path.resolve(positional[1] || 'dist/scripts');

function fail(message) {
    console.error(`[extension-package] ${message}`);
    process.exitCode = 1;
}

if (!fs.existsSync(sourceWorker)) {
    fail(`Service worker source is missing: ${sourceWorker}`);
    return;
}

const source = fs.readFileSync(sourceWorker, 'utf8');
const dependencies = new Set();
const callPattern = /importScripts\s*\(([^)]*)\)/g;
const stringPattern = /(['"])([^'"]+\.js)\1/g;
let call;
while ((call = callPattern.exec(source)) !== null) {
    stringPattern.lastIndex = 0;
    let dependency;
    while ((dependency = stringPattern.exec(call[1])) !== null) {
        if (/^[a-z]+:/i.test(dependency[2])) {
            fail(`Remote importScripts dependency is not supported: ${dependency[2]}`);
            return;
        }
        dependencies.add(dependency[2]);
    }
}

if (!dependencies.size) {
    fail('No local importScripts dependencies were found in the service worker.');
    return;
}

const sourceDirectory = path.dirname(sourceWorker);
const missingSources = [...dependencies].filter(file =>
    !fs.existsSync(path.resolve(sourceDirectory, file)));
if (missingSources.length) {
    fail(`Missing importScripts source dependencies: ${missingSources.join(', ')}`);
    return;
}

if (!verifyOnly) {
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(sourceWorker, path.join(destination, path.basename(sourceWorker)));
    for (const file of dependencies) {
        const target = path.resolve(destination, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.resolve(sourceDirectory, file), target);
    }
}

const expected = [path.basename(sourceWorker), ...dependencies];
const missingBuilt = expected.filter(file => !fs.existsSync(path.resolve(destination, file)));
if (missingBuilt.length) {
    fail(`Missing built service-worker dependencies: ${missingBuilt.join(', ')}`);
    return;
}

console.log(`[extension-package] Verified ${dependencies.size} importScripts dependencies.`);
