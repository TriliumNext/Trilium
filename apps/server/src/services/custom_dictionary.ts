import type { Session } from "electron";

import becca from "../becca/becca.js";
import cls from "./cls.js";
import log from "./log.js";

const DICTIONARY_NOTE_ID = "_customDictionary";

/**
 * Reads the custom dictionary words from the hidden note.
 */
function getWords(): Set<string> {
    const note = becca.getNote(DICTIONARY_NOTE_ID);
    if (!note) {
        return new Set();
    }

    const content = note.getContent();
    if (typeof content !== "string" || !content.trim()) {
        return new Set();
    }

    return new Set(
        content.split("\n")
            .map((w) => w.trim())
            .filter((w) => w.length > 0)
    );
}

/**
 * Saves the given words to the custom dictionary note, one per line.
 */
function saveWords(words: Set<string>) {
    cls.init(() => {
        const note = becca.getNote(DICTIONARY_NOTE_ID);
        if (!note) {
            log.error("Custom dictionary note not found.");
            return;
        }

        const sorted = [...words].sort((a, b) => a.localeCompare(b));
        note.setContent(sorted.join("\n"));
    });
}

/**
 * Adds a single word to the custom dictionary note.
 */
function addWord(word: string) {
    const words = getWords();
    words.add(word);
    saveWords(words);
}

/**
 * Removes all words from Electron's local spellchecker dictionary
 * so they are not re-imported on subsequent startups.
 */
function clearFromLocalDictionary(session: Session, localWords: string[]) {
    for (const word of localWords) {
        session.removeWordFromSpellCheckerDictionary(word);
    }
    log.info(`Cleared ${localWords.length} words from local spellchecker dictionary.`);
}

/**
 * Loads the custom dictionary into Electron's spellchecker session,
 * performing a one-time import of locally stored words on first use.
 */
async function loadForSession(session: Session) {
    const note = becca.getNote(DICTIONARY_NOTE_ID);
    if (!note) {
        log.error("Custom dictionary note not found.");
        return;
    }

    const noteWords = getWords();
    const localWords = await session.listWordsInSpellCheckerDictionary();

    let merged = noteWords;

    // One-time import: if the note is empty but there are local words, import them.
    if (noteWords.size === 0 && localWords.length > 0) {
        log.info(`Importing ${localWords.length} words from local spellchecker dictionary.`);
        merged = new Set(localWords);
        saveWords(merged);
    }

    // Remove local words that are not in the note (e.g. user removed them manually).
    const staleWords = localWords.filter((w) => !merged.has(w));
    if (staleWords.length > 0) {
        clearFromLocalDictionary(session, staleWords);
    }

    // Add note words that aren't already in the local dictionary.
    const localWordsSet = new Set(localWords);
    for (const word of merged) {
        if (!localWordsSet.has(word)) {
            session.addWordToSpellCheckerDictionary(word);
        }
    }

    if (merged.size > 0) {
        log.info(`Loaded ${merged.size} custom dictionary words into spellchecker.`);
    }
}

export default {
    getWords,
    saveWords,
    addWord,
    loadForSession
};
