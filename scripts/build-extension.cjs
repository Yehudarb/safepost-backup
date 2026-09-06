#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    MINIMUM_ENGAGEMENT_EXTENSION_VERSION,
    isVersionAtLeast,
} = require('../server/lib/extensionVersion.cjs');

const root = path.resolve(__dirname, '..');
const sourceDirectory = path.join(root, 'safe_post_extension');
// Deliberately NOT dist/. Vite publishes dist/, and Vercel serves whatever is in
// it, so building the extension there would put the ZIP and every unpacked
// extension file — the Facebook automation internals — on the public production
// frontend domain. The release directory is a local build output only.
const releaseDirectory = path.join(root, 'release');
const outputDirectory = path.join(releaseDirectory, 'extension');
const manifestPath = path.join(sourceDirectory, 'manifest.json');
const stalePublicArtifacts = [
    'public/manifest.json',
    'public/popup.html',
    'public/popup.js',
    'public/assets/background.js',
    'public/assets/bridge.js',
    'public/assets/content.js',
    'public/assets/dashboard-bridge.js',
    'public/scripts/background.js',
    'public/scripts/bridge.js',
    'public/scripts/content.js',
    'public/scripts/dashboard-bridge.js',
];

function fail(message) {
    throw new Error(`[extension-build] ${message}`);
}

function relativePath(filePath) {
    return path.relative(root, filePath).split(path.sep).join('/');
}

function listFiles(directory, base = directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) fail(`Symbolic links are not allowed: ${relativePath(absolute)}`);
        if (entry.isDirectory()) files.push(...listFiles(absolute, base));
        if (entry.isFile()) files.push(path.relative(base, absolute).split(path.sep).join('/'));
    }
    return files.sort((a, b) => a.localeCompare(b, 'en'));
}

function ensureFile(relative) {
    const absolute = path.join(sourceDirectory, ...relative.split('/'));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        fail(`Required source file is missing: ${relative}`);
    }
}

function importedWorkerFiles(workerSource) {
    const files = new Set();
    const callPattern = /importScripts\s*\(([^)]*)\)/g;
    const stringPattern = /(['"])([^'"]+\.js)\1/g;
    let call;
    while ((call = callPattern.exec(workerSource)) !== null) {
        let dependency;
        stringPattern.lastIndex = 0;
        while ((dependency = stringPattern.exec(call[1])) !== null) {
            if (/^[a-z]+:/i.test(dependency[2])) fail(`Remote worker import is not allowed: ${dependency[2]}`);
            files.add(dependency[2].replace(/\\/g, '/'));
        }
    }
    if (!files.size) fail('background.js has no local importScripts dependencies.');
    return [...files].sort((a, b) => a.localeCompare(b, 'en'));
}

function missingWorkerDependencies(directory, workerSource) {
    return importedWorkerFiles(workerSource).filter(relative =>
        !fs.existsSync(path.join(directory, ...relative.split('/'))));
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// Stored ZIP entries and a fixed 1980 timestamp make the archive byte-for-byte
// reproducible without adding a platform-specific zip dependency.
function createDeterministicZip(directory, destination) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const files = listFiles(directory);
    const dosTime = 0;
    const dosDate = 0x21;

    for (const relative of files) {
        const name = Buffer.from(relative, 'utf8');
        const data = fs.readFileSync(path.join(directory, ...relative.split('/')));
        const checksum = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, name, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);

        offset += local.length + name.length + data.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    fs.writeFileSync(destination, Buffer.concat([...localParts, centralDirectory, end]));
}

function main() {
    for (const stale of stalePublicArtifacts) {
        if (fs.existsSync(path.join(root, ...stale.split('/')))) {
            fail(`Stale public extension artifact must not exist: ${stale}`);
        }
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        fail(`Cannot read the authoritative manifest: ${error.message}`);
    }
    // The artifact must be at or above the Engagement floor, not exactly equal to
    // it. Requiring equality welded the two together: every extension patch would
    // have had to raise the server's minimum version, and raising the minimum
    // answers every already-installed worker in the fleet with 426 until each one
    // updates. A build is allowed to move ahead of the floor; the floor moves only
    // when an older build genuinely must be refused.
    if (!isVersionAtLeast(manifest.version, MINIMUM_ENGAGEMENT_EXTENSION_VERSION)) {
        fail(`Manifest version ${manifest.version || '(missing)'} is below the minimum Engagement release ${MINIMUM_ENGAGEMENT_EXTENSION_VERSION}.`);
    }
    if (manifest.background?.service_worker !== 'background.js') {
        fail('Manifest must select safe_post_extension/background.js.');
    }

    const contentScripts = (manifest.content_scripts || []).flatMap(entry => entry.js || []);
    for (const required of ['fbUtils.js', 'content.js']) {
        if (!contentScripts.includes(required)) fail(`Manifest does not load the reviewed ${required}.`);
    }

    const workerSource = fs.readFileSync(path.join(sourceDirectory, 'background.js'), 'utf8');
    const workerDependencies = importedWorkerFiles(workerSource);
    const missingDependencies = missingWorkerDependencies(sourceDirectory, workerSource);
    if (missingDependencies.length) {
        fail(`Missing importScripts source dependencies: ${missingDependencies.join(', ')}`);
    }
    const requiredFiles = new Set([
        'manifest.json', 'background.js', 'content.js', 'fbUtils.js',
        'popup.html', 'popup.js', 'engagement/identity.js',
        'engagement/navigation.js', 'engagement/postParser.js',
        'engagement/scanner.js', ...workerDependencies,
    ]);
    for (const referenced of [
        manifest.action?.default_popup,
        ...Object.values(manifest.action?.default_icon || {}),
        ...Object.values(manifest.icons || {}),
    ]) {
        if (referenced) requiredFiles.add(referenced);
    }
    for (const required of requiredFiles) ensureFile(required);

    fs.mkdirSync(releaseDirectory, { recursive: true });
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });

    const sourceFiles = listFiles(sourceDirectory);
    for (const relative of sourceFiles) {
        const source = path.join(sourceDirectory, ...relative.split('/'));
        const destination = path.join(outputDirectory, ...relative.split('/'));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
        if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) {
            fail(`Copied content differs from the reviewed source: ${relative}`);
        }
    }

    const artifactName = `safepost-extension-${manifest.version}.zip`;
    const artifactPath = path.join(releaseDirectory, artifactName);
    for (const name of fs.readdirSync(releaseDirectory)) {
        if (/^safepost-extension-.*\.(zip|sha256)$/.test(name)) {
            fs.rmSync(path.join(releaseDirectory, name), { force: true });
        }
    }
    createDeterministicZip(outputDirectory, artifactPath);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
    fs.writeFileSync(`${artifactPath}.sha256`, `${sha256}  ${artifactName}\n`, 'ascii');

    console.log(`[extension-build] version=${manifest.version}`);
    console.log(`[extension-build] files=${sourceFiles.length}`);
    console.log(`[extension-build] artifact=${relativePath(artifactPath)}`);
    console.log(`[extension-build] sha256=${sha256}`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

module.exports = { importedWorkerFiles, missingWorkerDependencies, createDeterministicZip };
