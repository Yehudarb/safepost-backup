/**
 * Phase 41 - Engagement Phase 2A dashboard UI (posts only).
 *
 * Renders the real components in jsdom against a stubbed API, following the
 * pattern phase29 established. Two properties matter most here:
 *
 *   1. Comments are invisible AND unreachable. Not just "no toggle rendered" —
 *      every payload the client sends must carry include_comments: false, so a
 *      dormant surface cannot be switched on from the dashboard by accident.
 *   2. A workspace switch clears everything. Stale results from another tenant
 *      must never remain on screen while new ones load.
 */
const path = require('path');
const Module = require('module');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');

let passed = 0;
let failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
}

const root = path.join(__dirname, '..');

// ---- module loading -------------------------------------------------------
// The components import through the '@/' alias and are JSX, so they are bundled
// on the fly and the alias resolved to src/.
const captured = { calls: [] };

function loadComponent(relative) {
    const result = esbuild.buildSync({
        entryPoints: [path.join(root, relative)],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        jsx: 'automatic',
        write: false,
        external: ['react', 'react-dom', 'react/jsx-runtime'],
        alias: { '@': path.join(root, 'src') },
        logLevel: 'silent',
    });
    const code = result.outputFiles[0].text;
    const module = new Module(relative, null);
    module.paths = Module._nodeModulePaths(root);
    module._compile(code, path.join(root, relative));
    return module.exports;
}

function setupDom() {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://safepost.test/app' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    return dom;
}

const dom = setupDom();
const React = require('react');
const { act } = require('react');
const ReactDOMClient = require('react-dom/client');

const WatchList = loadComponent('src/components/engagement/WatchList.jsx').default;
const WatchForm = loadComponent('src/components/engagement/WatchForm.jsx').default;
const OpportunityList = loadComponent('src/components/engagement/OpportunityList.jsx').default;

function render(element) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const rootNode = ReactDOMClient.createRoot(host);
    act(() => { rootNode.render(element); });
    return {
        host,
        rerender: next => act(() => { rootNode.render(next); }),
        unmount: () => act(() => { rootNode.unmount(); }),
        find: sel => host.querySelector(sel),
        all: sel => Array.from(host.querySelectorAll(sel)),
        text: () => host.textContent || '',
        click: sel => act(() => { host.querySelector(sel)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }),
        type: (sel, value) => act(() => {
            const el = host.querySelector(sel);
            const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, value);
            el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        }),
        submit: sel => act(() => { host.querySelector(sel)?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }),
    };
}

const WATCHES = [
    {
        id: 'w-1', name: 'Electricians', query_text: 'מחפש חשמלאי', match_mode: 'flexible',
        keywords: ['חשמלאי'], exact_phrases: [], selected_group_ids: ['g-1'],
        include_posts: true, include_comments: false, enabled: true,
        updated_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
        id: 'w-2', name: 'Solar', query_text: 'מערכת סולארית', match_mode: 'exact',
        keywords: [], exact_phrases: ['מערכת סולארית'], selected_group_ids: [],
        include_posts: true, include_comments: false, enabled: false,
        updated_at: new Date().toISOString(),
    },
];

const OPPORTUNITIES = [
    {
        id: 'o-1', source_type: 'post', facebook_group_id: 'g-1',
        source_url: 'https://www.facebook.com/groups/g-1/posts/1/',
        excerpt: 'מי מכיר חשמלאי טוב?', author_name: 'Dana',
        matched_terms: ['חשמלאי'], match_reason: 'contains "חשמלאי"',
        relevance: 'exact', discovered_at: new Date().toISOString(),
    },
    {
        id: 'o-2', source_type: 'post', facebook_group_id: 'g-2',
        source_url: null,
        excerpt: 'צריך מערכת סולארית', author_name: null,
        matched_terms: ['סולארית'], match_reason: 'contains "סולארית"',
        relevance: 'possible', discovered_at: new Date().toISOString(),
    },
];

function run() {
    console.log('\nPhase 41 - Engagement 2A UI (posts only)\n');

    console.log('A. Watch list');
    {
        const view = render(React.createElement(WatchList, { watches: WATCHES, opportunityCounts: { 'w-1': 4 } }));
        assert('both watches render', view.all('[data-testid="watch-row"]').length === 2);
        assert('names shown', view.text().includes('Electricians') && view.text().includes('Solar'));
        assert('match mode is described in words, not a code',
            view.text().includes('Flexible') && view.text().includes('Exact phrase'));
        assert('group count shown for a scoped watch', view.text().includes('1 group'));
        assert('an empty group list reads as all groups', view.text().includes('All scanned groups'));
        assert('match count shown when known', view.find('[data-testid="watch-match-count"]')?.textContent.includes('4'));
        assert('enabled state is exposed to assistive tech',
            view.all('[data-testid="watch-toggle"]')[0].getAttribute('aria-pressed') === 'true'
            && view.all('[data-testid="watch-toggle"]')[1].getAttribute('aria-pressed') === 'false');
        assert('every action button has an accessible name',
            view.all('button').every(b => (b.textContent || '').trim() || b.getAttribute('aria-label')));
        view.unmount();
    }
    {
        const view = render(React.createElement(WatchList, { watches: [] }));
        assert('empty state renders', Boolean(view.find('[data-testid="watches-empty"]')));
        assert('empty state is not styled as an error',
            !(view.find('[data-testid="watches-empty"]').className || '').includes('rose'));
        view.unmount();
    }

    console.log('\nB. Delete confirmation');
    {
        let deleted = null;
        const view = render(React.createElement(WatchList, { watches: WATCHES, onDelete: w => { deleted = w; } }));
        assert('no confirmation until asked', !view.find('[data-testid="watch-delete-confirm"]'));
        view.click('[data-testid="watch-delete"]');
        const confirm = view.find('[data-testid="watch-delete-confirm"]');
        assert('confirmation appears', Boolean(confirm));
        assert('confirmation is an alertdialog with a name',
            confirm.getAttribute('role') === 'alertdialog' && confirm.getAttribute('aria-label'));
        assert('nothing deleted yet', deleted === null);
        view.click('[data-testid="watch-delete-cancel"]');
        assert('cancel dismisses without deleting',
            !view.find('[data-testid="watch-delete-confirm"]') && deleted === null);
        view.click('[data-testid="watch-delete"]');
        view.click('[data-testid="watch-delete-confirmed"]');
        assert('confirming deletes the right watch', deleted?.id === 'w-1');
        view.unmount();
    }

    console.log('\nC. Toggle and edit');
    {
        let toggled = null;
        let edited = null;
        const view = render(React.createElement(WatchList, {
            watches: WATCHES, onToggle: w => { toggled = w; }, onEdit: w => { edited = w; },
        }));
        view.click('[data-testid="watch-toggle"]');
        assert('toggle reports the watch', toggled?.id === 'w-1');
        view.click('[data-testid="watch-edit"]');
        assert('edit reports the watch', edited?.id === 'w-1');
        view.unmount();
    }

    console.log('\nD. Watch form — creation, and no comments anywhere');
    {
        let saved = null;
        const view = render(React.createElement(WatchForm, { groups: [{ id: 'g-1', name: 'Group One' }], onSave: p => { saved = p; } }));

        assert('form renders', Boolean(view.find('[data-testid="watch-form"]')));
        assert('every input has a label',
            view.all('input, select, textarea').every(el => el.closest('label') || el.getAttribute('aria-label')));
        assert('copy states posts-only plainly',
            view.text().includes('top-level posts') && view.text().includes('Comments are not included'));

        // The core dormancy assertion at the UI layer.
        const html = view.host.innerHTML;
        assert('NO comments control is rendered',
            !/include[_-]?comments/i.test(html) && !view.find('[data-testid="watch-include-comments"]'));
        assert('no "coming soon" placeholder for comments',
            !/coming soon|בקרוב/i.test(view.text()));
        assert('the word "comment" appears only in the posts-only disclaimer',
            (view.text().match(/comment/gi) || []).length <= 1, String((view.text().match(/comment/gi) || []).length));

        view.type('[data-testid="watch-name"]', 'Electricians');
        view.type('[data-testid="watch-query"]', 'מחפש חשמלאי');
        view.type('[data-testid="watch-keywords"]', 'חשמלאי, חשמל ');
        view.submit('[data-testid="watch-form"]');

        assert('save receives the trimmed name', saved?.name === 'Electricians');
        assert('save receives the query', saved?.queryText === 'מחפש חשמלאי');
        assert('keywords are parsed and trimmed',
            JSON.stringify(saved?.keywords) === JSON.stringify(['חשמלאי', 'חשמל']), JSON.stringify(saved?.keywords));
        assert('the payload carries no comments field',
            saved && !('includeComments' in saved) && !('include_comments' in saved));
        view.unmount();
    }
    {
        let saved = null;
        const view = render(React.createElement(WatchForm, { onSave: p => { saved = p; } }));
        view.submit('[data-testid="watch-form"]');
        assert('an empty form is refused with a message',
            Boolean(view.find('[data-testid="watch-form-error"]')) && saved === null);
        assert('the error is announced', view.find('[data-testid="watch-form-error"]').getAttribute('role') === 'alert');
        view.unmount();
    }

    console.log('\nE. Watch form — editing and preview affordance');
    {
        const view = render(React.createElement(WatchForm, { watch: WATCHES[0], groups: [] }));
        assert('existing values are seeded', view.find('[data-testid="watch-name"]').value === 'Electricians');
        assert('keywords are joined for editing', view.find('[data-testid="watch-keywords"]').value === 'חשמלאי');
        assert('mode is seeded', view.find('[data-testid="watch-mode"]').value === 'flexible');
        assert('a saved watch offers Preview', view.find('[data-testid="watch-preview"]').textContent.trim() === 'Preview');
        assert('editing offers Cancel', Boolean(view.find('[data-testid="watch-cancel"]')));
        view.unmount();
    }
    {
        // The backend needs a saved watch to preview, so a new search says so.
        let previewPayload = null;
        const view = render(React.createElement(WatchForm, { onSaveAndPreview: p => { previewPayload = p; } }));
        assert('a new search offers Save & preview',
            view.find('[data-testid="watch-preview"]').textContent.trim() === 'Save & preview');
        view.type('[data-testid="watch-name"]', 'S');
        view.type('[data-testid="watch-query"]', 'מחפש חשמלאי');
        view.click('[data-testid="watch-preview"]');
        assert('Save & preview passes a complete payload', previewPayload?.name === 'S');
        view.unmount();
    }
    {
        const view = render(React.createElement(WatchForm, { saving: true }));
        assert('save in progress disables both actions',
            view.find('[data-testid="watch-save"]').disabled && view.find('[data-testid="watch-preview"]').disabled);
        view.unmount();
        const previewing = render(React.createElement(WatchForm, { previewing: true }));
        assert('preview in progress is announced on the control',
            previewing.find('[data-testid="watch-preview"]').textContent.includes('Checking'));
        previewing.unmount();
    }

    console.log('\nF. Opportunities');
    {
        const view = render(React.createElement(OpportunityList, { opportunities: OPPORTUNITIES, watches: WATCHES }));
        assert('rows render', view.all('[data-testid="opportunity-row"]').length === 2);
        assert('relevance bands render as words',
            view.all('[data-testid="opportunity-relevance"]').map(e => e.textContent).join(',') === 'Exact,Possible');
        assert('no percentage is ever shown', !/\d+(\.\d+)?\s*%/.test(view.text()), view.text().slice(0, 120));
        assert('the match reason is shown', view.find('[data-testid="opportunity-reason"]').textContent.includes('חשמלאי'));
        assert('matched terms render', Boolean(view.find('[data-testid="opportunity-terms"]')));
        assert('source type reads as Post', view.text().includes('Post'));
        assert('Open on Facebook only where a URL exists',
            view.all('[data-testid="opportunity-open"]').length === 1);
        assert('the link is safe', view.find('[data-testid="opportunity-open"]').getAttribute('rel').includes('noopener'));
        assert('there is no comment filter',
            !view.text().toLowerCase().includes('comment') && !view.find('[data-testid="opportunity-filter-source"]'));
        view.unmount();
    }
    {
        const view = render(React.createElement(OpportunityList, { opportunities: [] }));
        assert('empty state renders', Boolean(view.find('[data-testid="opportunities-empty"]')));
        assert('empty state is not an error',
            !(view.find('[data-testid="opportunities-empty"]').className || '').includes('rose'));
        view.unmount();
    }
    {
        const view = render(React.createElement(OpportunityList, { opportunities: [], loading: true }));
        assert('loading state renders and is announced',
            view.find('[data-testid="opportunities-loading"]')?.getAttribute('aria-live') === 'polite');
        view.unmount();
    }
    {
        let filters = null;
        const view = render(React.createElement(OpportunityList, {
            opportunities: OPPORTUNITIES, watches: WATCHES, filters: {}, onFilterChange: f => { filters = f; },
        }));
        act(() => {
            const select = view.find('[data-testid="opportunity-filter-relevance"]');
            select.value = 'strong';
            select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        assert('relevance filter reports upward', filters?.relevance === 'strong');
        view.unmount();
    }

    console.log('\nG. The API client cannot enable comments');
    {
        const fs = require('fs');
        const raw = fs.readFileSync(path.join(root, 'src/lib/engagementApi.js'), 'utf8');
        // Comments stripped first: the file documents that it never sends
        // workspace_id, and a raw scan reads that sentence as the thing it forbids.
        const api = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
        assert('createWatch pins include_comments false',
            /createWatch[\s\S]{0,900}?include_comments:\s*false/.test(api));
        assert('createWatch pins include_posts true',
            /createWatch[\s\S]{0,900}?include_posts:\s*true/.test(api));
        assert('updateWatch also pins them, even if a caller passes otherwise',
            /updateWatch[\s\S]{0,900}?include_comments\s*=\s*false/.test(api));
        assert('no source_type filter is ever sent',
            !/params\.set\('source_type'/.test(api));
        assert('workspace_id is never sent from the client',
            !/workspace_id/.test(api), 'the server derives it from the session');
        assert('new methods reuse the shared request helper',
            (api.match(/return request\(/g) || []).length >= 11);
    }

    console.log('\nH. Panel wiring: workspace reset and gating');
    {
        const fs = require('fs');
        const panel = fs.readFileSync(path.join(root, 'src/components/engagement/EngagementPanel.jsx'), 'utf8');
        for (const cleared of ['setWatches([]);', 'setEditingWatch(null);', 'setPreviewResult(null);', 'setOpportunities([]);']) {
            assert(`workspace change clears ${cleared}`, panel.includes(cleared));
        }
        assert('Phase 2A data loads only when Engagement is enabled',
            /if \(!enabled\) return;[\s\S]{0,200}loadWatches\(\)/.test(panel));
        assert('the load effect re-runs on workspace change',
            /\}, \[enabled, workspaceId\]\);/.test(panel));
        assert('the panel renders no comments control',
            !/include_comments|Include comments/i.test(panel));
        assert('preview copy states no Facebook request was made',
            /No Facebook\s*\n?\s*\*?\s*request was made|No Facebook request was made/.test(panel.replace(/\s+/g, ' ')));
    }

    console.log('\nI. Hebrew layout and overflow (QA findings)');
    {
        // Hebrew in an un-isolated element lays out LTR: it aligns to the wrong
        // edge, and `truncate` then clips the START of the phrase rather than the
        // end — so a watch called "חשמלאי ירושלים" loses the word that identifies
        // it. Every element that can hold user Hebrew declares dir="auto".
        const view = render(React.createElement(WatchList, { watches: WATCHES }));
        const rows = view.all('[data-testid="watch-row"]');
        const truncating = rows.flatMap(row => Array.from(row.querySelectorAll('.truncate')));
        assert('watch list has truncating text', truncating.length > 0);
        // Non-vacuity: the fixture must actually contain Hebrew, or this whole
        // section would pass on an all-Latin list that never exercises RTL.
        assert('fixture exercises Hebrew', truncating.some(el => /[֐-׿]/.test(el.textContent || '')));
        assert('every truncating element carrying user text is direction-isolated',
            truncating.every(el => el.getAttribute('dir') === 'auto'),
            truncating.map(el => `${el.getAttribute('dir')}:${(el.textContent || '').trim().slice(0, 14)}`).join(' | '));
        view.unmount();
    }
    {
        const view = render(React.createElement(WatchForm, { watch: WATCHES[0], groups: [] }));
        for (const id of ['watch-name', 'watch-query', 'watch-keywords', 'watch-phrases']) {
            assert(`${id} accepts Hebrew and is direction-isolated`,
                view.find(`[data-testid="${id}"]`).getAttribute('dir') === 'auto');
        }
        view.unmount();
    }
    {
        const fs = require('fs');
        // A `truncate` child of a flex row cannot shrink below its content width
        // without min-w-0, so a long group id pushes the whole card wide instead
        // of ellipsing. Caught in the preview row during QA review.
        const panel = fs.readFileSync(path.join(root, 'src/components/engagement/EngagementPanel.jsx'), 'utf8');
        const previewBlock = panel.slice(panel.indexOf('data-testid="preview-result"'), panel.indexOf('New scan'));
        const truncatesInPreview = previewBlock.match(/className="[^"]*\btruncate\b[^"]*"/g) || [];
        assert('preview has truncating text', truncatesInPreview.length > 0);
        assert('every truncating element in preview can actually shrink',
            truncatesInPreview.every(c => c.includes('min-w-0')), truncatesInPreview.join(' | '));

        const opportunity = fs.readFileSync(path.join(root, 'src/components/engagement/OpportunityList.jsx'), 'utf8');
        const truncatesInOpp = opportunity.match(/className="[^"]*\btruncate\b[^"]*"/g) || [];
        assert('every truncating element in opportunities can shrink',
            truncatesInOpp.every(c => c.includes('min-w-0')), truncatesInOpp.join(' | '));
    }
    {
        // Physical direction utilities break under RTL; the components use
        // logical ones (text-start, gap) so the layout mirrors correctly.
        const fs = require('fs');
        for (const file of ['WatchList', 'WatchForm', 'OpportunityList']) {
            const source = fs.readFileSync(path.join(root, `src/components/engagement/${file}.jsx`), 'utf8');
            assert(`${file} uses no physical direction classes`,
                !/\b(text-left|text-right|ml-\d|mr-\d|pl-\d|pr-\d)\b/.test(source));
        }
    }

    console.log('\nJ. Saving a search leaves a clean form (QA finding)');
    {
        // Found in the browser QA pass: after "Search created." the form was
        // still populated. WatchForm re-seeds its draft on watch?.id, and for a
        // new search that id is undefined both before and after the save, so the
        // effect never fired. Clicking the adjacent "Save & preview" then created
        // a second identical watch — and every later scan produced duplicate
        // opportunities, one per copy. The panel now gives the blank form an
        // identity that changes on each successful save, remounting it clean.
        const view = render(React.createElement(WatchForm, { watch: null, groups: [] }));
        assert('a freshly mounted new-search form is empty',
            view.find('[data-testid="watch-name"]').value === ''
            && view.find('[data-testid="watch-query"]').value === '');
        view.unmount();

        const fs = require('fs');
        const panel = fs.readFileSync(path.join(root, 'src/components/engagement/EngagementPanel.jsx'), 'utf8');
        assert('the blank form is keyed so it can be remounted',
            /key=\{editingWatch\?\.id \|\| `new-\$\{newFormGeneration\}`\}/.test(panel));
        assert('a successful save bumps that key',
            /setNewFormGeneration\(n => n \+ 1\);/.test(panel));
        // The bump must sit on the success path, not in the catch or finally,
        // or a failed save would silently discard what the user typed.
        const saveBody = panel.slice(panel.indexOf('const saveWatch'), panel.indexOf('} catch (err) {', panel.indexOf('const saveWatch')));
        assert('the key is bumped only after the save succeeded',
            saveBody.includes('setNewFormGeneration(n => n + 1);'));
    }

    console.log('\nK. Secondary text stays readable in both themes (QA finding)');
    {
        // Tailwind grays get DARKER as the number grows. A light background needs
        // dark text (high number) and a dark background needs light text (low
        // number), so a correct pair always has the dark: value LOWER than the
        // base. Written the other way round it picks the lightest value in both
        // themes at once: the opportunity timestamp measured 2.54:1 on white and
        // 3.58:1 on the dark card, both under the 4.5:1 WCAG AA floor.
        const fs = require('fs');
        const offenders = [];
        for (const file of ['WatchList', 'WatchForm', 'OpportunityList']) {
            const source = fs.readFileSync(path.join(root, `src/components/engagement/${file}.jsx`), 'utf8')
                .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');   // strip comments, which discuss these very classes
            for (const [, base, dark] of source.matchAll(/text-gray-(\d{3})\s+dark:text-gray-(\d{3})/g)) {
                if (Number(dark) >= Number(base)) offenders.push(`${file}: text-gray-${base} dark:text-gray-${dark}`);
            }
        }
        assert('no inverted gray pair (the dark: value must be a lower number than the base)',
            offenders.length === 0, offenders.join(' | '));
    }

    console.log(`\nPhase 41: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run();
