/**
 * Lightweight Hebrew text normalisation for Engagement matching.
 *
 * This is NOT Hebrew morphology. There is no root extraction, no part-of-speech
 * analysis and no dictionary. It is character folding plus additive affix
 * variants, which handles the common shapes a person types into a group post
 * and will visibly miss others. Anything that reads like a claim of real
 * linguistic analysis is a bug in the comment, not a feature of the code.
 *
 * What it does handle:
 *   חשמלאי · החשמלאי · לחשמלאי · חשמלאים   → share a comparable form
 *
 * What it does not:
 *   "צריך בעל מקצוע"  does not reach  "מחפש חשמלאי"
 *   That needs semantics, which Phase 2A deliberately does not have.
 *
 * Pure: no I/O, no clock, no randomness, no database. Every function is
 * deterministic on its input, which is what makes the matcher fixture-testable.
 */
'use strict';

// Nikud, cantillation and Hebrew punctuation marks.
const NIKUD = /[֑-ׇ]/g;

// Final (sofit) forms folded to their medial equivalents so that a word ending
// a sentence compares equal to the same word inside one.
const FINAL_FORMS = Object.freeze({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' });

// Single-letter particles that attach to the front of a Hebrew word.
const PREFIXES = Object.freeze(['ו', 'ה', 'ב', 'ל', 'כ', 'מ', 'ש']);

// Plural and feminine endings, longest first.
//
// Written in FOLDED form on purpose. normalizeText() folds final letters before
// affixes are considered, so a plural ending arrives as 'ימ', never 'ים'. Listing
// the visually-correct 'ים' here silently disables plural stripping entirely —
// the suffix can never match a folded token.
//
// Bare 'מ' is in the list because a noun already ending in י takes only ם in the
// plural: חשמלאי → חשמלאים. Stripping 'ימ' from that gives חשמלא, which is not
// the singular; stripping 'מ' gives חשמלאי, which is. Every applicable suffix is
// applied, so both forms are produced and the correct one is available to match.
const SUFFIXES = Object.freeze(['יות', 'ימ', 'ות', 'ה', 'ת', 'מ']);

/**
 * Shortest token that may be produced by stripping an affix.
 *
 * This guard is the difference between useful and destructive. Without it
 * מים (water) strips its מ prefix and becomes ים (sea), and שלום loses its ש.
 * Three characters is the point where Hebrew stems stop being ambiguous
 * particles, and it is applied to the REMAINDER, never to the input.
 */
const MIN_STEM_LENGTH = 3;

function foldFinals(value) {
    let output = '';
    for (const character of value) output += FINAL_FORMS[character] || character;
    return output;
}

/**
 * Canonical form of a piece of text: case-folded, nikud-free, final-folded,
 * punctuation-stripped, whitespace-collapsed. Applied identically to the query
 * and to the scanned content so the two are compared on the same footing.
 */
function normalizeText(value) {
    if (typeof value !== 'string' || !value) return '';
    return foldFinals(
        value
            .toLowerCase()
            .replace(NIKUD, '')
            // Hebrew geresh/gershayim behave as punctuation inside acronyms.
            .replace(/[׳״'"`]/g, '')
            // Anything that is not a letter, digit or whitespace becomes a gap,
            // so "חשמלאי?" and "חשמלאי" tokenise the same way.
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
    );
}

function tokenize(value) {
    const normalized = normalizeText(value);
    return normalized ? normalized.split(' ').filter(Boolean) : [];
}

const isHebrew = token => /[א-ת]/.test(token);

/**
 * Every form of a token worth matching on.
 *
 * Additive by design: the original is always kept and variants are added beside
 * it. A wrong expansion therefore costs a little precision; it can never cost a
 * match. Replacing instead of adding would invert that trade.
 */
function expandToken(token) {
    const base = normalizeText(token);
    const forms = new Set();
    if (!base) return forms;
    forms.add(base);
    if (!isHebrew(base)) return forms;

    const withPrefixStripped = [];
    for (const prefix of PREFIXES) {
        if (!base.startsWith(prefix)) continue;
        const remainder = base.slice(prefix.length);
        if (remainder.length >= MIN_STEM_LENGTH) {
            forms.add(remainder);
            withPrefixStripped.push(remainder);
        }
    }

    // Suffixes are stripped from the original and from any prefix-stripped form,
    // so לחשמלאים reaches חשמלאי in one pass.
    for (const candidate of [base, ...withPrefixStripped]) {
        for (const suffix of SUFFIXES) {
            if (!candidate.endsWith(suffix)) continue;
            const stem = candidate.slice(0, -suffix.length);
            if (stem.length >= MIN_STEM_LENGTH) forms.add(stem);
        }
    }

    return forms;
}

/** Union of the expansions of every token in a phrase. */
function expandTerm(term) {
    const forms = new Set();
    for (const token of tokenize(term)) {
        for (const form of expandToken(token)) forms.add(form);
    }
    return forms;
}

/**
 * True when any expanded form of `term` appears among the expanded forms of the
 * text's tokens. Comparison is form-to-form rather than substring, so חשמל does
 * not match חשמלאי by accident.
 */
function flexibleIncludes(text, term) {
    const termForms = expandTerm(term);
    if (!termForms.size) return false;
    const textForms = new Set();
    for (const token of tokenize(text)) {
        for (const form of expandToken(token)) textForms.add(form);
    }
    for (const form of termForms) {
        if (textForms.has(form)) return true;
    }
    return false;
}

/** Exact phrase containment, after normalisation of both sides. */
function normalizedIncludes(text, phrase) {
    const haystack = normalizeText(text);
    const needle = normalizeText(phrase);
    if (!haystack || !needle) return false;
    return haystack.includes(needle);
}

module.exports = {
    MIN_STEM_LENGTH,
    PREFIXES,
    SUFFIXES,
    FINAL_FORMS,
    normalizeText,
    tokenize,
    expandToken,
    expandTerm,
    flexibleIncludes,
    normalizedIncludes,
};
