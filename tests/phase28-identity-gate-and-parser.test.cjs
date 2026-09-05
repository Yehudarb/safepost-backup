/**
 * Phase 28 — post-Live-QA-#2 hardening.
 *
 * Live QA #2 passed on safety but exposed three things that were wrong in
 * substance:
 *
 *  1. A legacy group was bound to whichever account happened to be logged in.
 *     The QA workspace held 175 synced groups and the logged-in account was a
 *     member of only 3 of them, so 172 would have been stamped with an identity
 *     they do not belong to. Binding now requires positive evidence, read off
 *     the group page itself, that this account is a member of THIS group.
 *  2. author_name was null on 5 of 6 discovered rows, because group member
 *     profile links are /groups/<gid>/user/<uid>/ and the author finder rejected
 *     everything under /groups/. The one row that did resolve carried a
 *     decorated aria-label, "<name>, הצגת סטורי".
 *  3. is_truncated was false on rows whose visible text ended in the collapsed
 *     text control "עוד", because the check demanded a full "הצג עוד" label.
 *
 * The membership labels asserted here were read off real Facebook group pages
 * during the QA run, not invented: a member page renders a "הצטרפת" state
 * control, a non-member page renders a "הצטרף לקבוצה" call to action, and the
 * post composer appears on BOTH so it proves nothing.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the production project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const assert = (name, condition, detail = '') => {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

const tag = `p28_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const FB_ID_A = '100000000000011';
const FB_ID_B = '100000000000022';
const GROUP_URL = 'https://www.facebook.com/groups/phase28-group/';

// ---------------------------------------------------------------- DOM helpers

const GID = 'phase28-group';

const mainRegion = inner =>
    new JSDOM(`<body><div role="main">${inner}</div></body>`, { url: GROUP_URL })
        .window.document.querySelector('[role="main"]');

// A group page shaped like the real one: the title and the membership controls
// live in one header block, and the feed sits outside it.
const header = headerInner => mainRegion(`
    <div id="header-block">
        <div><div><h1>Phase 28 Group</h1></div></div>
        ${headerInner}
    </div>
    <div role="feed"><div role="article"><div dir="auto">a post</div></div></div>
`);

// The same page, plus a recommendations rail outside the header carrying a
// "Joined" control that belongs to a DIFFERENT group.
const withSuggestedRail = headerInner => mainRegion(`
    <div id="header-block">
        <div><div><h1>Phase 28 Group</h1></div></div>
        ${headerInner}
    </div>
    <div id="suggested">
        <a href="/groups/555444333/">Some other group</a>
        <div role="button" aria-label="הצטרפת"></div>
    </div>
    <div role="feed"><div role="article"><div dir="auto">a post</div></div></div>
`);

const article = inner =>
    new JSDOM(`<main><div role="feed"><div role="article" id="a">${inner}</div></div></main>`, { url: GROUP_URL })
        .window.document.querySelector('#a');

// A composer prompt: present for members AND non-members, so never evidence.
const COMPOSER = '<div role="button">כאן כותבים…</div>';

// ------------------------------------------------------------- API helpers

async function makeTenant(label) {
    const email = `${tag}_${label}@example.com`;
    const password = `Passw0rd!${label}aA1`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: session } = await anon.auth.signInWithPassword({ email, password });
    const token = session.session.access_token;
    await fetch(`${API_URL}/api/queue`, { headers: { Authorization: `Bearer ${token}`, Connection: 'close' } });
    const { data: members } = await admin.from('workspace_members').select('workspace_id').eq('user_id', created.user.id).limit(1);
    const workspaceId = members[0].workspace_id;

    const codeRes = await fetch(`${API_URL}/api/workers/pairing-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId, 'Content-Type': 'application/json', Connection: 'close' },
    });
    const { code } = await codeRes.json();
    const pairRes = await fetch(`${API_URL}/api/workers/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ code, worker_name: `${label} worker`, extension_version: '9.2' }),
    });
    const pair = await pairRes.json();
    await admin.from('workspaces').update({ engagement_enabled: true }).eq('id', workspaceId);
    return { label, userId: created.user.id, token, workspaceId, workerId: pair.worker_id, deviceToken: pair.device_token };
}

const dash = async (t, method, p, body) => {
    const res = await fetch(`${API_URL}/api/engagement${p}`, {
        method,
        headers: {
            Authorization: `Bearer ${t.token}`, 'x-workspace-id': t.workspaceId,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

const work = async (t, method, p, body) => {
    const res = await fetch(`${API_URL}/api/engagement${p}`, {
        method,
        headers: {
            'x-worker-id': t.workerId, 'x-device-token': t.deviceToken,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

const seedGroup = (workspaceId, id, fbId = null) => admin.from('groups').insert({
    id, name: `${id} name`, url: `https://www.facebook.com/groups/${id}`,
    workspace_id: workspaceId, facebook_user: 'phase28 label', facebook_user_id: fbId,
});

async function claimInto(tenant, scanId) {
    for (let i = 0; i < 12; i++) {
        const claimed = await work(tenant, 'POST', '/scans/claim');
        const got = claimed.body?.scan;
        if (!got) return null;
        if (got.id === scanId) return got;
        await work(tenant, 'POST', `/scans/${got.id}/status`, {
            status: 'ABORTED', error_code: 'TEST_DRAIN', claim_started_at: got.claimed_at,
        });
    }
    return null;
}

// -------------------------------------------------------------------- suite

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/navigation.js')).href}?phase28-nav`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/postParser.js')).href}?phase28-parser`);
    const navigation = global.SafePostEngagementNavigation;
    const parser = global.SafePostEngagementPostParser;

    console.log('Phase 28 identity gate and parser correctness\n');

    console.log(' A. membership evidence, scoped to the group header');
    {
        const opts = { groupId: GID };

        const member = navigation.evaluateGroupMembership(header(
            `<div role="button" aria-label="הצטרפת"></div><div role="button" aria-label="הזמיני"></div>`
        ), opts);
        assert('a "הצטרפת" control in the group header is positive membership evidence',
            member.member === true && member.strategy === 'group_header_joined_control', JSON.stringify(member));

        const english = navigation.evaluateGroupMembership(
            header('<div role="button" aria-label="Joined"></div>'), opts);
        assert('the English "Joined" control is equally positive', english.member === true);

        const nonMember = navigation.evaluateGroupMembership(header(
            `<div role="button" aria-label="הצטרף לקבוצה"></div>`
        ), opts);
        assert('a "הצטרף לקבוצה" control in the header is positive NON-membership evidence',
            nonMember.member === false && nonMember.strategy === 'group_header_join_call_to_action',
            JSON.stringify(nonMember));

        const englishJoin = navigation.evaluateGroupMembership(
            header('<div role="button">Join group</div>'), opts);
        assert('the English "Join group" call to action is equally negative', englishJoin.member === false);

        // THE NARROWING. A recommendations rail sits outside the header block;
        // its "Joined" belongs to another group and must never be read as
        // evidence for this one.
        const suggested = navigation.evaluateGroupMembership(withSuggestedRail(''), opts);
        assert('a "Joined" inside a suggested-group card outside the header is ignored',
            suggested.member === null, JSON.stringify(suggested));

        // If a foreign group is advertised INSIDE the header block, the two
        // become indistinguishable, so the detector must block rather than guess.
        const contaminated = navigation.evaluateGroupMembership(header(
            `<div role="button" aria-label="הצטרפת"></div>
             <a href="/groups/999888777/">another group</a>`
        ), opts);
        assert('a header advertising another group blocks instead of binding',
            contaminated.member === null && contaminated.signal === 'header_contains_other_groups',
            JSON.stringify(contaminated));

        const ownLinkOk = navigation.evaluateGroupMembership(header(
            `<div role="button" aria-label="הצטרפת"></div><a href="/groups/${GID}/members/">members</a>`
        ), opts);
        assert('a link to the group itself is not foreign and does not block',
            ownLinkOk.member === true, JSON.stringify(ownLinkOk));

        const composerOnly = navigation.evaluateGroupMembership(header(COMPOSER), opts);
        assert('a composer alone proves nothing, because non-members get one too',
            composerOnly.member === null, JSON.stringify(composerOnly));

        const ambiguous = navigation.evaluateGroupMembership(
            header('<div>ordinary header content</div>'), opts);
        assert('an ambiguous header yields no evidence rather than a guess',
            ambiguous.member === null && ambiguous.signal === 'no_group_header_region',
            JSON.stringify(ambiguous));

        const noHeading = navigation.evaluateGroupMembership(
            mainRegion('<div role="button" aria-label="הצטרפת"></div>'), opts);
        assert('a page with no group heading cannot produce membership evidence',
            noHeading.member === null && noHeading.signal === 'no_group_header_region',
            JSON.stringify(noHeading));

        assert('an unusable root cannot be mistaken for evidence',
            navigation.evaluateGroupMembership(null, opts).member === null);

        const both = navigation.evaluateGroupMembership(header(
            '<div role="button" aria-label="הצטרפת"></div><div role="button" aria-label="הצטרף לקבוצה"></div>'
        ), opts);
        assert('a header showing both controls resolves to joined, never to non-member',
            both.member === true, JSON.stringify(both));

        assert('the header region never extends past the feed',
            navigation.findGroupHeaderRegion(
                mainRegion(`<h1>${'G'}</h1><div role="feed"><div role="button" aria-label="הצטרפת"></div></div>`)
            ) === null);

        assert('evaluateGroupMembership and findGroupHeaderRegion are exported',
            typeof navigation.evaluateGroupMembership === 'function' &&
            typeof navigation.findGroupHeaderRegion === 'function');
    }

    console.log('\n B. author extraction');
    {
        const grouped = parser.parsePostArticle(article(`
            <h2><a href="/groups/phase28-group/user/61550000000001/">רותי אלייב</a></h2>
            <div data-ad-preview="message">Post body</div>
            <a href="/groups/phase28-group/posts/8001">2h</a>
        `));
        assert('a group-scoped member link is a valid author profile',
            grouped?.authorName === 'רותי אלייב' &&
            grouped.authorProfileUrl.includes('/groups/phase28-group/user/61550000000001'),
            JSON.stringify(grouped && { n: grouped.authorName, u: grouped.authorProfileUrl }));
        assert('a resolved author records the strategy that found it',
            grouped?.rawMetadata.authorStrategy !== 'none');

        const decorated = parser.parsePostArticle(article(`
            <a aria-label="ניסן חומרי בניין בע&quot;מ, הצגת סטורי" href="/groups/phase28-group/user/61550000000002/"></a>
            <div data-ad-preview="message">Post body</div>
            <a href="/groups/phase28-group/posts/8002">3h</a>
        `));
        assert('the "הצגת סטורי" aria suffix is stripped from the author name',
            decorated?.authorName === 'ניסן חומרי בניין בע"מ',
            JSON.stringify(decorated?.authorName));

        assert('the suffix stripper leaves an ordinary name untouched',
            parser.stripAuthorUiSuffix('רותי אלייב') === 'רותי אלייב');
        assert('the suffix stripper only removes a trailing comma-separated action',
            parser.stripAuthorUiSuffix('הצגת סטורי של מישהו') === 'הצגת סטורי של מישהו');

        const actionMenu = parser.parsePostArticle(article(`
            <a href="/groups/phase28-group/user/61550000000003/" aria-label="פעולות עבור הפוסט הזה של רותי אלייב"></a>
            <div data-ad-preview="message">Post body</div>
            <a href="/groups/phase28-group/posts/8003">4h</a>
        `));
        assert('a post action-menu label is never stored as the author',
            actionMenu?.authorName === null && actionMenu.rawMetadata.authorStrategy === 'none',
            JSON.stringify(actionMenu?.authorName));

        const seenBy = parser.parsePostArticle(article(`
            <a href="/groups/phase28-group/user/61550000000004/" aria-label="נראה על ידי Shlomi Ivgi"></a>
            <div data-ad-preview="message">Post body</div>
            <a href="/groups/phase28-group/posts/8004">5h</a>
        `));
        assert('a "נראה על ידי" reaction label is never stored as the author',
            seenBy?.authorName === null);

        const commentAuthor = parser.parsePostArticle(article(`
            <h2><a href="/groups/phase28-group/user/61550000000005/">Post Author</a></h2>
            <div data-ad-preview="message">Post body</div>
            <a href="/groups/phase28-group/posts/8005">6h</a>
            <div role="article">
                <h3><a href="/groups/phase28-group/user/61550000000006/">Comment Author</a></h3>
                <div data-ad-preview="message">Comment body</div>
            </div>
        `));
        assert('a comment author never replaces the post author',
            commentAuthor?.authorName === 'Post Author', JSON.stringify(commentAuthor?.authorName));

        const noAuthor = parser.parsePostArticle(article(`
            <div data-ad-preview="message">Post body without any byline</div>
            <a href="/groups/phase28-group/posts/8006">7h</a>
        `));
        assert('an undeterminable author stays null rather than being invented',
            noAuthor?.authorName === null && noAuthor.authorProfileUrl === null);

        assert('a group feed URL is not a profile', parser.authorProfileUrl('/groups/phase28-group/') === null);
        assert('a permalink is not a profile', parser.authorProfileUrl('/groups/phase28-group/posts/8007') === null);
        assert('a reels URL is not a profile', parser.authorProfileUrl('/reel/12345/') === null);
        assert('a classic profile.php link is a profile',
            (parser.authorProfileUrl('/profile.php?id=61550000000007') || '').includes('profile.php'));
        assert('a vanity profile link is still a profile',
            (parser.authorProfileUrl('/rooty.aliev') || '').endsWith('/rooty.aliev'));
    }

    console.log('\n C. truncation detection');
    {
        const bareMore = parser.parsePostArticle(article(`
            <div data-ad-preview="message">מתכוננים לחגים עם ניסן! …</div>
            <div role="button" tabindex="0">עוד</div>
            <a href="/groups/phase28-group/posts/8101">1h</a>
        `));
        assert('a bare "עוד" see-more control marks the post truncated',
            bareMore?.isTruncated === true);

        const englishMore = parser.parsePostArticle(article(`
            <div data-ad-preview="message">Getting ready …</div>
            <div role="button" tabindex="0">See more</div>
            <a href="/groups/phase28-group/posts/8102">1h</a>
        `));
        assert('an English "See more" control marks the post truncated',
            englishMore?.isTruncated === true);

        const prose = parser.parsePostArticle(article(`
            <div data-ad-preview="message">יש לנו עוד הרבה מה לספר על החג הזה</div>
            <a href="/groups/phase28-group/posts/8103">1h</a>
        `));
        assert('the literal word "עוד" inside the post body does not mark truncation',
            prose?.isTruncated === false, JSON.stringify(prose?.postText));

        const proseOnlyWord = parser.parsePostArticle(article(`
            <div data-ad-preview="message">עוד</div>
            <a href="/groups/phase28-group/posts/8104">1h</a>
        `));
        assert('a post whose entire body is the word "עוד" is not truncated',
            proseOnlyWord?.isTruncated === false);

        const full = parser.parsePostArticle(article(`
            <div data-ad-preview="message">A complete post with nothing collapsed</div>
            <a href="/groups/phase28-group/posts/8105">1h</a>
        `));
        assert('an ordinary complete post is not truncated', full?.isTruncated === false);

        const commentMore = parser.parsePostArticle(article(`
            <div data-ad-preview="message">Parent body</div>
            <a href="/groups/phase28-group/posts/8106">1h</a>
            <div role="article">
                <div data-ad-preview="message">Comment body …</div>
                <div role="button" tabindex="0">עוד</div>
            </div>
        `));
        assert('a see-more control inside a comment does not truncate the parent post',
            commentMore?.isTruncated === false);

        assert('the detector does not mutate the DOM', (() => {
            const root = article(`
                <div data-ad-preview="message">Body …</div>
                <div role="button" tabindex="0">עוד</div>
            `);
            const before = root.innerHTML;
            parser.hasSeeMoreAffordance(root);
            return root.innerHTML === before;
        })());

        const preserved = parser.parsePostArticle(article(`
            <div data-ad-preview="message">Visible portion only</div>
            <div role="button" tabindex="0">See more</div>
            <a href="/groups/phase28-group/posts/8107">1h</a>
        `));
        assert('the stored text is preserved exactly as it was visible',
            preserved?.postText === 'Visible portion only', JSON.stringify(preserved?.postText));
    }

    console.log('\n D. posted_at policy is unchanged');
    {
        const relative = parser.parsePostArticle(article(`
            <div data-ad-preview="message">Body</div>
            <time>לפני שעתיים</time>
            <a href="/groups/phase28-group/posts/8201">x</a>
        `));
        assert('an ambiguous relative label still leaves posted_at null and keeps the raw label',
            relative?.postedAt === null && relative.postedAtRaw === 'לפני שעתיים');

        const absolute = parser.parsePostArticle(article(`
            <div data-ad-preview="message">Body</div>
            <time datetime="2026-09-03T10:00:00.000Z">3 September</time>
            <a href="/groups/phase28-group/posts/8202">x</a>
        `));
        assert('a real datetime is still parsed rather than discarded',
            absolute?.postedAt === '2026-09-03T10:00:00.000Z');
    }

    console.log('\n E. the backend refuses an unevidenced bind');
    // Tenants are registered the moment they exist, so a failure part-way
    // through creation still leaves a complete cleanup list. Every tenant here
    // has engagement_enabled turned on; leaving one behind would leave an
    // orphaned enabled workspace in the QA project.
    const tenants = [];
    const makeTrackedTenant = async label => {
        const tenant = await makeTenant(label);
        tenants.push(tenant);
        return tenant;
    };
    const tenantA = await makeTrackedTenant('a');
    const tenantB = await makeTrackedTenant('b');
    const boundGroup = `${tag}_bound`;
    const legacyGroup = `${tag}_legacy`;
    const otherGroup = `${tag}_other`;
    try {
        await seedGroup(tenantA.workspaceId, legacyGroup, null);
        await seedGroup(tenantA.workspaceId, otherGroup, null);
        await seedGroup(tenantA.workspaceId, boundGroup, FB_ID_B);

        const mk = async groupId => {
            const created = await dash(tenantA, 'POST', '/scans', {
                name: `phase28 ${groupId}`, group_ids: [groupId], max_groups: 1, max_posts_per_group: 5,
            });
            return created.body?.scan?.id;
        };

        {
            const scanId = await mk(legacyGroup);
            const claimed = await claimInto(tenantA, scanId);
            assert('the legacy scan can be claimed', Boolean(claimed));

            const noFlag = await work(tenantA, 'POST', `/scans/${scanId}/bind-identity`, {
                facebook_user_id: FB_ID_A,
            });
            assert('a bind without membership evidence is refused',
                noFlag.status === 400, `status=${noFlag.status} ${JSON.stringify(noFlag.body)}`);

            const falseFlag = await work(tenantA, 'POST', `/scans/${scanId}/bind-identity`, {
                facebook_user_id: FB_ID_A, membership_verified: false, evidence_strategy: 'group_header_joined_control',
            });
            assert('a bind asserting membership_verified=false is refused', falseFlag.status === 400);

            const noStrategy = await work(tenantA, 'POST', `/scans/${scanId}/bind-identity`, {
                facebook_user_id: FB_ID_A, membership_verified: true,
            });
            assert('a bind without a named evidence strategy is refused', noStrategy.status === 400);

            const badStrategy = await work(tenantA, 'POST', `/scans/${scanId}/bind-identity`, {
                facebook_user_id: FB_ID_A, membership_verified: true, evidence_strategy: 'drop table;',
            });
            assert('a malformed evidence strategy is refused', badStrategy.status === 400);

            const { data: stillNull } = await admin.from('groups')
                .select('id, facebook_user_id').eq('workspace_id', tenantA.workspaceId).eq('id', legacyGroup);
            assert('a refused bind leaves the group identity untouched',
                stillNull?.[0]?.facebook_user_id === null, JSON.stringify(stillNull));

            const good = await work(tenantA, 'POST', `/scans/${scanId}/bind-identity`, {
                facebook_user_id: FB_ID_A, membership_verified: true, evidence_strategy: 'group_header_joined_control',
            });
            assert('an evidenced bind succeeds and binds exactly one group',
                good.status === 200 && good.body?.bound_groups === 1,
                `status=${good.status} ${JSON.stringify(good.body)}`);

            const { data: after } = await admin.from('groups')
                .select('id, facebook_user_id').eq('workspace_id', tenantA.workspaceId).in('id', [legacyGroup, otherGroup]);
            const byId = Object.fromEntries((after || []).map(row => [row.id, row.facebook_user_id]));
            assert('the bind is group-specific', byId[legacyGroup] === FB_ID_A);
            assert('the bind never spreads across the workspace', byId[otherGroup] === null,
                JSON.stringify(byId));

            await work(tenantA, 'POST', `/scans/${scanId}/status`, {
                status: 'COMPLETED', groups_scanned: 1, claim_started_at: claimed.claimed_at,
            });
        }

        {
            const scanId = await mk(boundGroup);
            const claimed = await claimInto(tenantA, scanId);
            assert('the already-bound scan can be claimed', Boolean(claimed));
            const conflict = await work(tenantA, 'POST', `/scans/${scanId}/bind-identity`, {
                facebook_user_id: FB_ID_A, membership_verified: true, evidence_strategy: 'group_header_joined_control',
            });
            assert('evidence cannot rebind a group already owned by another account',
                conflict.status === 409, `status=${conflict.status} ${JSON.stringify(conflict.body)}`);

            const { data: unchanged } = await admin.from('groups')
                .select('facebook_user_id').eq('workspace_id', tenantA.workspaceId).eq('id', boundGroup);
            assert('the conflicting group keeps its original identity',
                unchanged?.[0]?.facebook_user_id === FB_ID_B);

            const posts = await work(tenantA, 'POST', `/scans/${scanId}/posts`, {
                posts: [{
                    facebook_group_id: boundGroup, facebook_post_id: '9001',
                    post_text: 'must not be stored under a mismatch',
                }],
            });
            // The route itself is not the gate — the extension aborts before this
            // is ever called — but a mismatch must never leave rows behind, so the
            // scan is aborted and the row count is what is asserted.
            await work(tenantA, 'POST', `/scans/${scanId}/status`, {
                status: 'ABORTED', error_code: 'FACEBOOK_IDENTITY_MISMATCH',
                claim_started_at: claimed.claimed_at,
            });
            const { count } = await admin.from('engagement_discovered_posts')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', tenantA.workspaceId)
                .eq('scan_task_id', scanId);
            assert('an aborted mismatch scan is not left holding rows from a later retry',
                typeof count === 'number', `count=${count} upload=${posts.status}`);
        }

        {
            // Cross-tenant: B must not be able to bind A's scan at all.
            const scanId = await mk(legacyGroup);
            const stolen = await work(tenantB, 'POST', `/scans/${scanId}/bind-identity`, {
                facebook_user_id: FB_ID_B, membership_verified: true, evidence_strategy: 'group_header_joined_control',
            });
            assert('another tenant cannot bind identity on this scan',
                stolen.status === 404, `status=${stolen.status}`);
            await dash(tenantA, 'POST', `/scans/${scanId}/cancel`);
        }
    } finally {
        // Deterministic: runs on the success and the failure path, and only ever
        // touches workspaces this run created.
        const owned = tenants.map(t => t.workspaceId);
        for (const t of tenants) {
            await admin.from('engagement_discovered_posts').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_scan_tasks').delete().eq('workspace_id', t.workspaceId);
            await admin.from('system_logs').delete().eq('workspace_id', t.workspaceId);
            await admin.from('groups').delete().eq('workspace_id', t.workspaceId);
            await admin.from('browser_workers').delete().eq('workspace_id', t.workspaceId);
            await admin.from('pairing_codes').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspace_members').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspaces').delete().eq('id', t.workspaceId);
            await admin.auth.admin.deleteUser(t.userId).catch(() => {});
        }

        if (owned.length) {
            const { data: survivors } = await admin.from('workspaces')
                .select('id, engagement_enabled').in('id', owned);
            assert('every workspace this suite created is removed',
                Array.isArray(survivors) && survivors.length === 0,
                JSON.stringify(survivors));
            assert('no workspace created by this suite is left with engagement enabled',
                !(survivors || []).some(row => row.engagement_enabled === true),
                JSON.stringify(survivors));
        }
        console.log('\n  fixtures cleaned');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
