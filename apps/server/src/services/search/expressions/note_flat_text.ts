"use strict";

import type BNote from "../../../becca/entities/bnote.js";
import type SearchContext from "../search_context.js";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import becca from "../../../becca/becca.js";
import { normalize } from "../../utils.js";
import { normalizeSearchText, fuzzyMatchWordWithResult } from "../utils/text_utils.js";
import beccaService from "../../../becca/becca_service.js";

class NoteFlatTextExp extends Expression {
    tokens: string[];

    constructor(tokens: string[]) {
        super();

        // Normalize tokens using centralized normalization function
        this.tokens = tokens.map(token => normalizeSearchText(token));
    }

    execute(inputNoteSet: NoteSet, executionContext: any, searchContext: SearchContext) {
        const resultNoteSet = new NoteSet();

        // Cache normalized titles to avoid redundant normalize+getNoteTitle calls
        const titleCache = new Map<string, string>();
        const getNormalizedTitle = (noteId: string, parentNoteId: string): string => {
            const key = `${noteId}-${parentNoteId}`;
            let cached = titleCache.get(key);
            if (cached === undefined) {
                cached = normalizeSearchText(beccaService.getNoteTitle(noteId, parentNoteId));
                titleCache.set(key, cached);
            }
            return cached;
        };

        /**
         * @param note
         * @param remainingTokens - tokens still needed to be found in the path towards root
         * @param takenPath - path so far taken towards from candidate note towards the root.
         *                    It contains the suffix fragment of the full note path.
         */
        const searchPathTowardsRoot = (note: BNote, remainingTokens: string[], takenPath: string[]) => {
            if (remainingTokens.length === 0) {
                // we're done, just build the result
                const resultPath = this.getNotePath(note, takenPath);

                if (resultPath) {
                    const noteId = resultPath[resultPath.length - 1];

                    if (!resultNoteSet.hasNoteId(noteId)) {
                        // Snapshot takenPath since it's mutable
                        executionContext.noteIdToNotePath[noteId] = resultPath;
                        resultNoteSet.add(becca.notes[noteId]);
                    }
                }

                return;
            }

            if (note.parents.length === 0 || note.noteId === "root") {
                return;
            }

            const foundAttrTokens: string[] = [];

            for (const token of remainingTokens) {
                if ((note.type && note.type.includes(token)) ||
                    (note.mime && note.mime.includes(token))) {
                    foundAttrTokens.push(token);
                }
            }

            for (const attribute of note.getOwnedAttributes()) {
                for (const token of remainingTokens) {
                    if (attribute.normalizedName.includes(token) || attribute.normalizedValue.includes(token)) {
                        foundAttrTokens.push(token);
                    }
                }
            }

            for (const parentNote of note.parents) {
                const title = getNormalizedTitle(note.noteId, parentNote.noteId);

                // Use Set for O(1) lookup instead of Array.includes() which is O(n)
                const foundTokenSet = new Set<string>(foundAttrTokens);

                for (const token of remainingTokens) {
                    if (this.smartMatch(title, token, searchContext)) {
                        foundTokenSet.add(token);
                    }
                }

                if (foundTokenSet.size > 0) {
                    const newRemainingTokens = remainingTokens.filter((token) => !foundTokenSet.has(token));

                    searchPathTowardsRoot(parentNote, newRemainingTokens, [note.noteId, ...takenPath]);
                } else {
                    searchPathTowardsRoot(parentNote, remainingTokens, [note.noteId, ...takenPath]);
                }
            }
        };

        const candidateNotes = this.getCandidateNotes(inputNoteSet, searchContext);

        // Fast path for single-token autocomplete searches:
        // Skip the expensive recursive parent walk and just use getBestNotePath().
        // The flat text already matched, so we know the token is present.
        if (this.tokens.length === 1 && searchContext.autocomplete) {
            for (const note of candidateNotes) {
                if (!resultNoteSet.hasNoteId(note.noteId)) {
                    const notePath = note.getBestNotePath();
                    if (notePath) {
                        executionContext.noteIdToNotePath[note.noteId] = notePath;
                        resultNoteSet.add(note);
                    }
                }
            }
            return resultNoteSet;
        }

        for (const note of candidateNotes) {
            // autocomplete should be able to find notes by their noteIds as well (only leafs)
            if (this.tokens.length === 1 && note.noteId.toLowerCase() === this.tokens[0]) {
                searchPathTowardsRoot(note, [], [note.noteId]);
                continue;
            }

            const foundAttrTokens: string[] = [];

            for (const token of this.tokens) {
                // Add defensive checks for undefined properties
                const typeMatches = note.type && note.type.includes(token);
                const mimeMatches = note.mime && note.mime.includes(token);

                if (typeMatches || mimeMatches) {
                    foundAttrTokens.push(token);
                }

                for (const attribute of note.ownedAttributes) {
                    if (attribute.normalizedName.includes(token) || attribute.normalizedValue.includes(token)) {
                        foundAttrTokens.push(token);
                    }
                }
            }

            for (const parentNote of note.parents) {
                const title = normalizeSearchText(beccaService.getNoteTitle(note.noteId, parentNote.noteId));
                const foundTokens = foundAttrTokens.slice();

                for (const token of this.tokens) {
                    if (this.smartMatch(title, token, searchContext)) {
                        foundTokens.push(token);
                    }
                }

                if (foundTokens.length > 0) {
                    const remainingTokens = this.tokens.filter((token) => !foundTokens.includes(token));

                    searchPathTowardsRoot(parentNote, remainingTokens, [note.noteId]);
                }
            }
        }

        return resultNoteSet;
    }

    getNotePath(note: BNote, takenPath: string[]): string[] {
        if (takenPath.length === 0) {
            throw new Error("Path is not expected to be empty.");
        } else if (takenPath.length === 1 && takenPath[0] === note.noteId) {
            return note.getBestNotePath();
        } else {
            // this note is the closest to root containing the last matching token(s), thus completing the requirements
            // what's in this note's predecessors does not matter, thus we'll choose the best note path
            const topMostMatchingTokenNotePath = becca.getNote(takenPath[0])?.getBestNotePath() || [];

            return [...topMostMatchingTokenNotePath, ...takenPath.slice(1)];
        }
    }

    /**
     * Returns noteIds which have at least one matching tokens
     */
    getCandidateNotes(noteSet: NoteSet, searchContext?: SearchContext): BNote[] {
        const candidateNotes: BNote[] = [];

        // Use the pre-built flat text index for fast scanning.
        // This provides pre-computed flat texts in a parallel array, avoiding
        // per-note property access overhead at large scale (50K+ notes).
        const { notes: indexNotes, flatTexts } = becca.getFlatTextIndex();

        // Build a set for quick membership check when noteSet isn't the full set
        const isFullSet = noteSet.notes.length === indexNotes.length;

        for (let i = 0; i < indexNotes.length; i++) {
            const note = indexNotes[i];

            // Skip notes not in the input set (only check when not using the full set)
            if (!isFullSet && !noteSet.hasNoteId(note.noteId)) {
                continue;
            }

            const flatText = flatTexts[i];
            for (const token of this.tokens) {
                if (this.smartMatch(flatText, token, searchContext)) {
                    candidateNotes.push(note);
                    break;
                }
            }
        }

        return candidateNotes;
    }

    /**
     * Smart matching that tries exact match first, then fuzzy fallback
     * @param text The text to search in
     * @param token The token to search for
     * @param searchContext The search context to track matched words for highlighting
     * @returns True if match found (exact or fuzzy)
     */
    private smartMatch(text: string, token: string, searchContext?: SearchContext): boolean {
        // Exact match has priority
        if (text.includes(token)) {
            return true;
        }
        
        // Fuzzy fallback only if enabled and for tokens >= 4 characters
        if (searchContext?.enableFuzzyMatching && token.length >= 4) {
            const matchedWord = fuzzyMatchWordWithResult(token, text);
            if (matchedWord) {
                // Track the fuzzy matched word for highlighting
                if (!searchContext.highlightedTokens.includes(matchedWord)) {
                    searchContext.highlightedTokens.push(matchedWord);
                }
                return true;
            }
        }
        
        return false;
    }
}

export default NoteFlatTextExp;
