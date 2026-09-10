/**
 * Decides whether a scanned post or comment is relevant to a saved Watch.
 *
 * Pure by contract: no database, no network, no clock, no randomness, and no
 * logging. It receives text and a watch definition and returns a verdict. That
 * constraint is what allows the whole relevance behaviour to be pinned by
 * fixtures instead of exercised through a live scan.
 *
 * Deliberately not in here: embeddings, LLM calls, any external API. Phase 2A
 * is keyword and phrase matching only. A post that expresses the same intent in
 * different words is expected to be missed, and the UI says so.
 *
 * Relevance is reported as one of three categories rather than a percentage.
 * A number like 87.3% would imply a calibration this does not have.
 */
'use strict';

const {
    normalizeText,
    tokenize,
    flexibleIncludes,
    normalizedIncludes,
} = require('./hebrewNormalize.cjs');

const MATCH_MODES = Object.freeze(['exact', 'flexible']);
const RELEVANCE = Object.freeze({ EXACT: 'exact', STRONG: 'strong', POSSIBLE: 'possible' });

// A comment of four words matching one keyword is weaker evidence than a long
// post matching the same keyword, so short sources cannot reach the top
// category on keyword overlap alone. An exact phrase still can.
const SHORT_SOURCE_TOKENS = 8;

// Excerpt kept on a durable opportunity. Comments are short; posts are capped
// harder than their 2000-character storage limit because the product only needs
// enough text for a human to recognise the lead.
const EXCERPT_LIMIT = 600;

function toList(value) {
    if (Array.isArray(value)) {
        return value.map(entry => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
    }
    return [];
}

/**
 * Builds an excerpt centred on the first match so the reviewer sees the reason
 * rather than the opening of an unrelated paragraph.
 */
function buildExcerpt(text, anchor) {
    const source = typeof text === 'string' ? text.trim() : '';
    if (!source) return '';
    if (source.length <= EXCERPT_LIMIT) return source;

    let start = 0;
    if (anchor) {
        const index = normalizeText(source).indexOf(normalizeText(anchor));
        if (index > 0) start = Math.max(0, index - Math.floor(EXCERPT_LIMIT / 3));
    }
    const slice = source.slice(start, start + EXCERPT_LIMIT).trim();
    return `${start > 0 ? '…' : ''}${slice}${start + EXCERPT_LIMIT < source.length ? '…' : ''}`;
}

function noMatch() {
    return {
        matched: false,
        matchMode: null,
        matchedTerms: [],
        matchedPhrase: null,
        matchReason: null,
        relevance: null,
        excerpt: '',
    };
}

/**
 * @param {string} text                Post or comment text.
 * @param {object} watch               { matchMode, exactPhrases[], keywords[], queryText }
 * @param {object} [options]           { sourceType: 'post' | 'comment' }
 * @returns deterministic verdict; identical inputs always produce identical output.
 */
function matchText(text, watch, options = {}) {
    const source = typeof text === 'string' ? text : '';
    if (!source.trim() || !watch) return noMatch();

    const mode = MATCH_MODES.includes(watch.matchMode) ? watch.matchMode : 'flexible';
    const exactPhrases = toList(watch.exactPhrases);
    // queryText participates as a phrase candidate so a watch is useful before
    // the user has curated any keywords.
    const phrases = exactPhrases.length ? exactPhrases : toList([watch.queryText]);
    const keywords = toList(watch.keywords);
    const excludeTerms = toList(watch.excludeTerms);

    // Exclusions win outright, before any positive evidence is considered.
    for (const term of excludeTerms) {
        if (normalizedIncludes(source, term)) return noMatch();
    }

    // 1. Exact phrase — the strongest and cheapest signal.
    for (const phrase of phrases) {
        if (!normalizedIncludes(source, phrase)) continue;
        return {
            matched: true,
            matchMode: 'exact',
            matchedTerms: [phrase],
            matchedPhrase: phrase,
            matchReason: `contains the exact phrase "${phrase}"`,
            relevance: RELEVANCE.EXACT,
            excerpt: buildExcerpt(source, phrase),
        };
    }

    // Exact mode stops here by definition.
    if (mode === 'exact') return noMatch();

    // 2. Keyword overlap, Hebrew-aware.
    const hits = [];
    for (const keyword of keywords) {
        if (flexibleIncludes(source, keyword)) hits.push(keyword);
    }
    if (!hits.length) return noMatch();

    const isShort = tokenize(source).length < SHORT_SOURCE_TOKENS;
    const multiple = hits.length > 1;
    // Two or more keywords in a source of reasonable length is the only way to
    // reach 'strong' without an exact phrase.
    const relevance = multiple && !isShort ? RELEVANCE.STRONG : RELEVANCE.POSSIBLE;

    const quoted = hits.map(term => `"${term}"`).join(' and ');
    const shortNote = isShort && multiple ? ' in a short comment' : '';

    return {
        matched: true,
        matchMode: 'flexible',
        matchedTerms: hits,
        matchedPhrase: null,
        matchReason: `contains ${quoted}${shortNote}`,
        relevance,
        excerpt: buildExcerpt(source, hits[0]),
    };
}

/**
 * Applies the matcher to a bounded list of scan candidates.
 * Returns only the matches, in input order, each carrying its candidate.
 */
function matchCandidates(candidates, watch, options = {}) {
    if (!Array.isArray(candidates)) return [];
    const results = [];
    for (const candidate of candidates) {
        const verdict = matchText(candidate?.text, watch, {
            sourceType: candidate?.sourceType || options.sourceType,
        });
        if (verdict.matched) results.push({ candidate, verdict });
    }
    return results;
}

module.exports = {
    MATCH_MODES,
    RELEVANCE,
    SHORT_SOURCE_TOKENS,
    EXCERPT_LIMIT,
    buildExcerpt,
    matchText,
    matchCandidates,
};
