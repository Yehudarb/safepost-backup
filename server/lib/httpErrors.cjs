'use strict';

// Shared HTTP error shaping.
//
// Extracted from server/index.cjs so the engagement router uses the SAME
// implementation rather than a second copy. Two copies of error handling is how
// a leak gets fixed in one place and left open in the other.
//
// Behaviour is unchanged from the original: driver errors describe the database
// — table and column names, declared types, constraint names — so they are
// logged where operators can see them and answered with a generic message.
//
// SQLSTATE 22P02 (invalid_text_representation) is the one driver error that is
// not a server fault: the caller supplied a value the column cannot parse. That
// is a 400, and keeping it out of the 5xx rate matters because the health
// alerting treats 5xx as meaningful.
function dbFailure(res, context, error) {
    if (error?.code === '22P02') {
        console.warn(`[DB] ${context}: rejected unparseable identifier`);
        return res.status(400).json({ error: 'Invalid id' });
    }
    console.error(`[DB] ${context}: ${error?.message || error}`);
    return res.status(500).json({ error: 'Database operation failed.' });
}

module.exports = { dbFailure };
