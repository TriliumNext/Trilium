"use strict";

import beccaService from "../../becca/becca_service.js";
import becca from "../../becca/becca.js";
import { normalizeSearchText } from "./utils/text_utils.js";

// 🔥 Native Rust scorer
import { computeScore } from "@trilium/search-native";

class SearchResult {
    notePathArray: string[];
    score: number;
    notePathTitle: string;
    highlightedNotePathTitle?: string;
    contentSnippet?: string;
    highlightedContentSnippet?: string;
    attributeSnippet?: string;
    highlightedAttributeSnippet?: string;

    constructor(notePathArray: string[]) {
        this.notePathArray = notePathArray;
        this.notePathTitle = beccaService.getNoteTitleForPath(notePathArray);
        this.score = 0;
    }

    get notePath() {
        return this.notePathArray.join("/");
    }

    get noteId() {
        return this.notePathArray[this.notePathArray.length - 1];
    }

    /**
     * Score note using Rust native module
     */
    computeScore(
        fulltextQuery: string,
        tokens: string[],
        enableFuzzyMatching: boolean = true // currently ignored (always on in Rust)
    ) {
        const note = becca.notes[this.noteId];

        const normalizedQuery = normalizeSearchText(
            fulltextQuery.toLowerCase()
        );

        const score = computeScore(
            {
                query: fulltextQuery.toLowerCase(),
                tokens,
                normalizedQuery,
            },
            {
                id: note.noteId,
                title: note.title,
                pathTitle: this.notePathTitle,
                hidden: note.isInHiddenSubtree(),
            }
        );

        this.score = score;
    }
}

export default SearchResult;
