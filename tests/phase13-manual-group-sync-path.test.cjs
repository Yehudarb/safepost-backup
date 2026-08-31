const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const contentPath = path.join(repoRoot, 'safe_post_extension', 'content.js');
const backgroundPath = path.join(repoRoot, 'safe_post_extension', 'background.js');

const content = fs.readFileSync(contentPath, 'utf8');
const background = fs.readFileSync(backgroundPath, 'utf8');

let passed = 0;
let failed = 0;

function assert(name, condition) {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}`);
    }
}

console.log('Phase 13 manual group sync wiring\n');

const manualOverridePattern = /manual sync button must use the background scan path[\s\S]*?btn\.onclick = async \(\) =>[\s\S]*?safeSendMessage\(\{\s*action:\s*"SCAN_AND_SYNC_GROUPS"/i;
const internalListenerPattern = /if\s*\(request\.action\s*===\s*"SCAN_AND_SYNC_GROUPS"\)\s*\{[\s\S]*?scanAndSyncGroups\(\)/;

assert('manual Facebook sync button delegates to SCAN_AND_SYNC_GROUPS', manualOverridePattern.test(content));
assert('background internal listener handles SCAN_AND_SYNC_GROUPS', internalListenerPattern.test(background));

if (failed) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
}

console.log(`\nAll ${passed} assertions passed.`);
