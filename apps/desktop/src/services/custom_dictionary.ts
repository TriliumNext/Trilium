import { becca, cls, getLog, options as optionService, sql_init } from "@triliumnext/core";
import electron, { type Session } from "electron";

const DICTIONARY_NOTE_ID = "_customDictionary";
const loadedSessions = new WeakSet<Session>();

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
    cls.getContext().init(() => {
        const note = becca.getNote(DICTIONARY_NOTE_ID);
        if (!note) {
            getLog().error("Custom dictionary note not found.");
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
    getLog().info(`Cleared ${localWords.length} words from local spellchecker dictionary.`);
}

/**
 * Loads the custom dictionary into Electron's spellchecker session,
 * performing a one-time import of locally stored words on first use.
 */
export async function loadForSession(session: Session) {
    const note = becca.getNote(DICTIONARY_NOTE_ID);
    if (!note) {
        getLog().error("Custom dictionary note not found.");
        return;
    }

    const noteWords = getWords();
    const localWords = await session.listWordsInSpellCheckerDictionary();

    let merged = noteWords;

    // One-time import: if the note is empty but there are local words, import them.
    if (noteWords.size === 0 && localWords.length > 0) {
        getLog().info(`Importing ${localWords.length} words from local spellchecker dictionary.`);
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
        getLog().info(`Loaded ${merged.size} custom dictionary words into spellchecker.`);
    }
}

/**
 * Arms the custom dictionary to sync into every spellcheck-enabled renderer
 * session as it comes online, and to persist words the user accepts via the
 * renderer's context menu.
 *
 * Skipping while the DB is uninitialised avoids touching options/becca during
 * the setup wizard. The per-session WeakSet guard plus the shared session for
 * print windows mean repeated `web-contents-created` events (extra windows,
 * print preview) don't re-sync.
 */
export function setupCustomDictionary() {
    electron.app.on("web-contents-created", (_event, webContents) => {
        if (!sql_init.isDbInitialized()) return;
        if (!optionService.getOptionBool("spellCheckEnabled")) return;
        const session = webContents.session;
        if (loadedSessions.has(session)) return;
        loadedSessions.add(session);
        loadForSession(session).catch(err =>
            getLog().error(`Failed to load custom dictionary for spellcheck: ${err}`)
        );
    });

    electron.ipcMain.on("add-word-to-dictionary", (event, word: unknown) => {
        // Defensive: ipcMain accepts any structured-clonable payload, so a
        // compromised renderer could send a non-string. Reject without doing
        // anything observable.
        if (typeof word !== "string" || word.length === 0) {
            getLog().error("add-word-to-dictionary: invalid word payload received");
            return;
        }
        event.sender.session.addWordToSpellCheckerDictionary(word);
        addWord(word);
    });
}
