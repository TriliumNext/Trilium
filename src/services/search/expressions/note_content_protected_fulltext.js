"use strict";

const Expression = require('./expression');
const NoteSet = require('../note_set');
const log = require('../../log');
const noteCache = require('../../note_cache/note_cache');
const protectedSessionService = require('../../protected_session');
const striptags = require('striptags');

class NoteContentProtectedFulltextExp extends Expression {
    constructor(operator, tokens, raw) {
        super();

        if (operator !== '*=*') {
            throw new Error(`Note content can be searched only with *=* operator`);
        }

        this.tokens = tokens;
        this.raw = !!raw;
    }

    execute(inputNoteSet) {
        const resultNoteSet = new NoteSet();

        if (!protectedSessionService.isProtectedSessionAvailable()) {
            return resultNoteSet;
        }

        const sql = require('../../sql');

        for (let {noteId, type, mime, content} of sql.iterateRows(`
                SELECT noteId, type, mime, content 
                FROM notes JOIN note_contents USING (noteId) 
                WHERE type IN ('text', 'code') AND isDeleted = 0 AND isProtected = 1`)) {

            if (!inputNoteSet.hasNoteId(noteId) || !(noteId in noteCache.notes)) {
                continue;
            }

            try {
                content = protectedSessionService.decryptString(content);
            }
            catch (e) {
                log.info(`Cannot decrypt content of note ${noteId}`);
                continue;
            }

            content = content.toLowerCase();

            if (type === 'text' && mime === 'text/html') {
                if (!this.raw && content.length < 20000) { // striptags is slow for very large notes
                    content = striptags(content);
                }

                content = content.replace(/&nbsp;/g, ' ');
            }

            if (!this.tokens.find(token => !content.includes(token))) {
                resultNoteSet.add(noteCache.notes[noteId]);
            }
        }

        return resultNoteSet;
    }
}

module.exports = NoteContentProtectedFulltextExp;
