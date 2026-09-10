// Saved Engagement watches — Phase 2A, posts only.
//
// Visual language is deliberately the existing Engagement panel's: same rounded
// containers, same border and text tokens, same button weights. This is a new
// section inside a familiar surface, not a new design.
import React, { useState } from 'react';

const MODE_LABEL = {
    exact: 'Exact phrase',
    flexible: 'Flexible (Hebrew-aware)',
};

function relativeTime(value) {
    if (!value) return null;
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return null;
    const minutes = Math.round((Date.now() - then.getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

/** One-line summary of what a watch looks for, without dumping every term. */
function querySummary(watch) {
    const phrases = Array.isArray(watch.exact_phrases) ? watch.exact_phrases : [];
    const keywords = Array.isArray(watch.keywords) ? watch.keywords : [];
    if (phrases.length) return `"${phrases[0]}"${phrases.length > 1 ? ` +${phrases.length - 1}` : ''}`;
    if (keywords.length) return `${keywords.slice(0, 3).join(', ')}${keywords.length > 3 ? ` +${keywords.length - 3}` : ''}`;
    return watch.query_text;
}

export default function WatchList({
    watches = [],
    opportunityCounts = {},
    selectedId = null,
    busyId = null,
    onSelect,
    onEdit,
    onToggle,
    onDelete,
}) {
    // Confirmation is local state rather than window.confirm: a native dialog is
    // not styleable, not reliably announced, and cannot be asserted in a test.
    const [confirmingId, setConfirmingId] = useState(null);

    if (!watches.length) {
        return (
            <p data-testid="watches-empty" className="text-sm text-gray-600 dark:text-gray-300">
                No searches yet. Create one below to start finding relevant posts in the groups you scan.
            </p>
        );
    }

    return (
        <ul data-testid="watch-list" className="space-y-2">
            {watches.map(watch => {
                const groupCount = Array.isArray(watch.selected_group_ids) ? watch.selected_group_ids.length : 0;
                const matches = opportunityCounts[watch.id];
                const isSelected = selectedId === watch.id;
                const isBusy = busyId === watch.id;

                return (
                    <li
                        key={watch.id}
                        data-testid="watch-row"
                        className={`rounded-xl border p-3 transition ${isSelected
                            ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-500/10'
                            : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#161b22]'}`}
                    >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => onSelect?.(watch)}
                                aria-pressed={isSelected}
                                className="min-w-0 flex-1 text-start"
                            >
                                {/* dir="auto" because both of these are usually Hebrew.
                                    Without it the browser lays them out LTR, so the
                                    text aligns to the wrong edge and `truncate` clips
                                    the beginning of the phrase instead of the end. */}
                                <span dir="auto" className="block truncate text-sm font-bold text-gray-900 dark:text-white">
                                    {watch.name}
                                </span>
                                <span dir="auto" className="mt-0.5 block truncate text-xs text-gray-600 dark:text-gray-300">
                                    {querySummary(watch)}
                                </span>
                            </button>

                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    data-testid="watch-toggle"
                                    onClick={() => onToggle?.(watch)}
                                    disabled={isBusy}
                                    aria-pressed={watch.enabled === true}
                                    aria-label={`${watch.enabled ? 'Disable' : 'Enable'} ${watch.name}`}
                                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide disabled:opacity-40 ${watch.enabled
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                                        : 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400'}`}
                                >
                                    {watch.enabled ? 'On' : 'Off'}
                                </button>
                                <button
                                    type="button"
                                    data-testid="watch-edit"
                                    onClick={() => onEdit?.(watch)}
                                    aria-label={`Edit ${watch.name}`}
                                    className="rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200"
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    data-testid="watch-delete"
                                    onClick={() => setConfirmingId(watch.id)}
                                    aria-label={`Delete ${watch.name}`}
                                    className="rounded-lg border border-rose-200 dark:border-rose-500/30 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                            <span>{MODE_LABEL[watch.match_mode] || watch.match_mode}</span>
                            <span aria-hidden="true">·</span>
                            <span>{groupCount === 0 ? 'All scanned groups' : `${groupCount} group${groupCount === 1 ? '' : 's'}`}</span>
                            {typeof matches === 'number' && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span data-testid="watch-match-count">{matches} match{matches === 1 ? '' : 'es'}</span>
                                </>
                            )}
                            {relativeTime(watch.updated_at) && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>updated {relativeTime(watch.updated_at)}</span>
                                </>
                            )}
                        </div>

                        {confirmingId === watch.id && (
                            <div
                                data-testid="watch-delete-confirm"
                                role="alertdialog"
                                aria-label={`Delete ${watch.name}?`}
                                className="mt-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-3"
                            >
                                <p className="text-xs text-rose-800 dark:text-rose-200">
                                    Delete <strong>{watch.name}</strong>? Its saved opportunities are removed too. This cannot be undone.
                                </p>
                                <div className="mt-2 flex gap-2">
                                    <button
                                        type="button"
                                        data-testid="watch-delete-confirmed"
                                        onClick={() => { setConfirmingId(null); onDelete?.(watch); }}
                                        className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white"
                                    >
                                        Delete search
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="watch-delete-cancel"
                                        onClick={() => setConfirmingId(null)}
                                        className="rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200"
                                    >
                                        Keep it
                                    </button>
                                </div>
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
