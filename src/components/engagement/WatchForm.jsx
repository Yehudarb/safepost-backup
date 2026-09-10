// Create or edit an Engagement watch — Phase 2A, posts only.
//
// There is no comments control here, and no "coming soon" placeholder either. A
// real-Facebook measurement found a median of zero visible comments per post, so
// comments are not an active surface; an inert toggle would invite questions
// about a feature with no date. include_posts/include_comments are set by the
// API client, not by any field on this form.
import React, { useEffect, useState } from 'react';

const EXAMPLES = ['מחפש חשמלאי', 'מערכת סולארית', 'מלון כשר בבודפשט'];

/** "a, b , c" -> ['a','b','c'], dropping blanks and duplicates. */
function parseTerms(value) {
    const seen = [];
    for (const part of String(value || '').split(',')) {
        const term = part.trim();
        if (term && !seen.includes(term)) seen.push(term);
    }
    return seen;
}

const emptyDraft = {
    name: '',
    queryText: '',
    keywords: '',
    exactPhrases: '',
    matchMode: 'flexible',
    groupIds: [],
    enabled: true,
};

function draftFrom(watch) {
    if (!watch) return { ...emptyDraft };
    return {
        name: watch.name || '',
        queryText: watch.query_text || '',
        keywords: (watch.keywords || []).join(', '),
        exactPhrases: (watch.exact_phrases || []).join(', '),
        matchMode: watch.match_mode || 'flexible',
        groupIds: (watch.selected_group_ids || []).map(String),
        enabled: watch.enabled !== false,
    };
}

export default function WatchForm({
    watch = null,
    groups = [],
    saving = false,
    previewing = false,
    onSave,
    onSaveAndPreview,
    onPreview,
    onCancel,
}) {
    const [draft, setDraft] = useState(() => draftFrom(watch));
    const [error, setError] = useState(null);

    // Re-seed when the caller switches which watch is being edited, including
    // when it switches to null for "new".
    useEffect(() => { setDraft(draftFrom(watch)); setError(null); }, [watch?.id]);

    const isEditing = Boolean(watch?.id);
    const set = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));

    function build() {
        const name = draft.name.trim();
        const queryText = draft.queryText.trim();
        if (!name) { setError('Give this search a name so you can recognise it later.'); return null; }
        if (queryText.length < 2) { setError('Describe what you are looking for.'); return null; }
        setError(null);
        return {
            name,
            queryText,
            keywords: parseTerms(draft.keywords),
            exactPhrases: parseTerms(draft.exactPhrases),
            groupIds: draft.groupIds,
            matchMode: draft.matchMode,
            enabled: draft.enabled,
        };
    }

    const busy = saving || previewing;
    const field = 'w-full min-w-0 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#161b22] px-3 py-2 text-sm text-gray-900 dark:text-white';
    const hint = 'mt-1 block text-xs text-gray-500 dark:text-gray-400';

    return (
        <form
            data-testid="watch-form"
            aria-labelledby="watch-form-heading"
            onSubmit={event => { event.preventDefault(); const payload = build(); if (payload) onSave?.(payload); }}
            className="space-y-3"
        >
            <h3 id="watch-form-heading" className="text-sm font-bold text-gray-900 dark:text-white">
                {isEditing ? `Edit "${watch.name}"` : 'New search'}
            </h3>

            <p className="text-xs text-gray-600 dark:text-gray-300">
                SafePost searches the text of top-level posts in the groups you scan. Comments are not included.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
                <label className="min-w-0">
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Search name</span>
                    <input
                        data-testid="watch-name"
                        type="text"
                        dir="auto"
                        maxLength={120}
                        value={draft.name}
                        onChange={e => set('name', e.target.value)}
                        className={field}
                    />
                </label>

                <label className="min-w-0">
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Matching</span>
                    <select
                        data-testid="watch-mode"
                        value={draft.matchMode}
                        onChange={e => set('matchMode', e.target.value)}
                        className={field}
                    >
                        <option value="flexible">Flexible — handles Hebrew prefixes and plurals</option>
                        <option value="exact">Exact — the phrase must appear as written</option>
                    </select>
                </label>
            </div>

            <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">What are you looking for?</span>
                <input
                    data-testid="watch-query"
                    type="text"
                    maxLength={500}
                    dir="auto"
                    value={draft.queryText}
                    onChange={e => set('queryText', e.target.value)}
                    aria-describedby="watch-query-help"
                    className={field}
                />
                <span id="watch-query-help" className={hint}>
                    For example: {EXAMPLES.map((example, i) => (
                        <React.Fragment key={example}>
                            {i > 0 && ' · '}
                            <button
                                type="button"
                                onClick={() => set('queryText', example)}
                                className="underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200"
                            >
                                <span dir="auto">{example}</span>
                            </button>
                        </React.Fragment>
                    ))}
                </span>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
                <label className="min-w-0">
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Keywords</span>
                    <input
                        data-testid="watch-keywords"
                        type="text"
                        dir="auto"
                        value={draft.keywords}
                        onChange={e => set('keywords', e.target.value)}
                        aria-describedby="watch-keywords-help"
                        className={field}
                    />
                    <span id="watch-keywords-help" className={hint}>
                        Comma separated. Any one of these can match.
                    </span>
                </label>

                <label className="min-w-0">
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Exact phrases</span>
                    <input
                        data-testid="watch-phrases"
                        type="text"
                        dir="auto"
                        value={draft.exactPhrases}
                        onChange={e => set('exactPhrases', e.target.value)}
                        aria-describedby="watch-phrases-help"
                        className={field}
                    />
                    <span id="watch-phrases-help" className={hint}>
                        Comma separated. A phrase match is always ranked highest.
                    </span>
                </label>
            </div>

            <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Groups <span className="font-normal">(leave empty for every group you scan)</span>
                </span>
                <select
                    data-testid="watch-groups"
                    multiple
                    size={Math.min(5, Math.max(3, groups.length))}
                    value={draft.groupIds}
                    onChange={e => set('groupIds', Array.from(e.target.selectedOptions, o => o.value))}
                    className={`${field} h-auto`}
                >
                    {groups.map(group => (
                        <option key={group.id} value={String(group.id)}>{group.name || group.id}</option>
                    ))}
                </select>
            </label>

            <label className="flex items-center gap-2">
                <input
                    data-testid="watch-enabled"
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={e => set('enabled', e.target.checked)}
                    className="h-4 w-4"
                />
                <span className="text-xs text-gray-700 dark:text-gray-200">
                    Active — match new scans against this search
                </span>
            </label>

            {error && (
                <p data-testid="watch-form-error" role="alert" className="text-sm text-rose-700 dark:text-rose-400">
                    {error}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <button
                    type="submit"
                    data-testid="watch-save"
                    disabled={busy}
                    className="rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-bold text-white"
                >
                    {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create search'}
                </button>

                {/* Preview needs a saved watch: the backend loads it by id and
                    workspace. For a new search this saves first and says so,
                    rather than quietly creating a draft the user did not ask for. */}
                <button
                    type="button"
                    data-testid="watch-preview"
                    disabled={busy}
                    onClick={() => {
                        const payload = build();
                        if (!payload) return;
                        if (isEditing) onPreview?.(watch, payload);
                        else onSaveAndPreview?.(payload);
                    }}
                    className="rounded-xl border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 disabled:opacity-40"
                >
                    {previewing ? 'Checking…' : isEditing ? 'Preview' : 'Save & preview'}
                </button>

                {isEditing && (
                    <button
                        type="button"
                        data-testid="watch-cancel"
                        onClick={() => onCancel?.()}
                        className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300"
                    >
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
}
