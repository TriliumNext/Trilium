import { becca_service } from "@triliumnext/core";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { normalize } from "../../utils.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import { fuzzyMatchWord, fuzzyMatchWordWithResult,normalizeSearchText } from "../utils/text_utils.js";
import Expression from "./expression.js";

class NoteFlatTextExp extends Expression {
    tokens: string[];

    constructor(tokens: string[]) {
        super();

        // Normalize tokens using centralized normalization function
        this.tokens = tokens.map(token => normalizeSearchText(token));
    }

    execute(inputNoteSet: NoteSet, executionContext: any, searchContext: SearchContext) {
        const resultNoteSet = new NoteSet();

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
                        // we could get here from multiple paths, the first one wins because the paths
                        // are sorted by importance
                        executionContext.noteIdToNotePath[noteId] = resultPath;

                        resultNoteSet.add(becca.notes[noteId]);
                    }
                }

                return;
            }

            if (note.parents.length === 0 || note.noteId === "root") {
                // we've reached root, but there are still remaining tokens -> this candidate note produced no result
                return;
            }

            const foundAttrTokens: string[] = [];

            for (const token of remainingTokens) {
                // Add defensive checks for undefined properties
                const typeMatches = note.type && note.type.includes(token);
                const mimeMatches = note.mime && note.mime.includes(token);

                if (typeMatches || mimeMatches) {
                    foundAttrTokens.push(token);
                }
            }

            for (const attribute of note.getOwnedAttributes()) {
                const normalizedName = normalizeSearchText(attribute.name);
                const normalizedValue = normalizeSearchText(attribute.value);

                for (const token of remainingTokens) {
                    if (normalizedName.includes(token) || normalizedValue.includes(token)) {
                        foundAttrTokens.push(token);
                    }
                }
            }

            for (const parentNote of note.parents) {
                const title = normalizeSearchText(becca_service.getNoteTitle(note.noteId, parentNote.noteId));
                const foundTokens: string[] = foundAttrTokens.slice();

                for (const token of remainingTokens) {
                    if (this.smartMatch(title, token, searchContext)) {
                        foundTokens.push(token);
                    }
                }

                if (foundTokens.length > 0) {
                    const newRemainingTokens = remainingTokens.filter((token) => !foundTokens.includes(token));

                    searchPathTowardsRoot(parentNote, newRemainingTokens, [note.noteId, ...takenPath]);
                } else {
                    searchPathTowardsRoot(parentNote, remainingTokens, [note.noteId, ...takenPath]);
                }
            }
        };

        const candidateNotes = this.getCandidateNotes(inputNoteSet, searchContext);

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
                    if (normalizeSearchText(attribute.name).includes(token) || normalizeSearchText(attribute.value).includes(token)) {
                        foundAttrTokens.push(token);
                    }
                }
            }

            for (const parentNote of note.parents) {
                const title = normalizeSearchText(becca_service.getNoteTitle(note.noteId, parentNote.noteId));
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

        for (const note of noteSet.notes) {
            const normalizedFlatText = normalizeSearchText(note.getFlatText());
            for (const token of this.tokens) {
                if (this.smartMatch(normalizedFlatText, token, searchContext)) {
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
