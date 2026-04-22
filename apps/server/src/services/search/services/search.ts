"use strict";

import lex from "./lex.js";
import handleParens from "./handle_parens.js";
import parse from "./parse.js";
import SearchResult from "../search_result.js";
import SearchContext from "../search_context.js";
import becca from "../../../becca/becca.js";
import beccaService from "../../../becca/becca_service.js";
import { normalize, removeDiacritic, escapeHtml, escapeRegExp } from "../../utils.js";
import { stripHtmlTags } from "../utils/text_utils.js";
import log from "../../log.js";
import hoistedNoteService from "../../hoisted_note.js";
import type BNote from "../../../becca/entities/bnote.js";
import type BAttribute from "../../../becca/entities/battribute.js";
import type { SearchParams, TokenStructure } from "./types.js";
import type Expression from "../expressions/expression.js";
import sql from "../../sql.js";
import scriptService from "../../script.js";
import protectedSessionService from "../../protected_session.js";
import optionService from "../../options.js";

export interface SearchNoteResult {
    searchResultNoteIds: string[];
    highlightedTokens: string[];
    error: string | null;
}

export const EMPTY_RESULT: SearchNoteResult = {
    searchResultNoteIds: [],
    highlightedTokens: [],
    error: null
};

function searchFromNote(note: BNote): SearchNoteResult {
    let searchResultNoteIds;
    let highlightedTokens: string[];

    const searchScript = note.getRelationValue("searchScript");
    const searchString = note.getLabelValue("searchString") || "";
    let error: string | null = null;

    if (searchScript) {
        searchResultNoteIds = searchFromRelation(note, "searchScript");
        highlightedTokens = [];
    } else {
        const searchContext = new SearchContext({
            fastSearch: note.hasLabel("fastSearch"),
            ancestorNoteId: note.getRelationValue("ancestor") || undefined,
            ancestorDepth: note.getLabelValue("ancestorDepth") || undefined,
            includeArchivedNotes: note.hasLabel("includeArchivedNotes"),
            orderBy: note.getLabelValue("orderBy") || undefined,
            orderDirection: note.getLabelValue("orderDirection") || undefined,
            limit: parseInt(note.getLabelValue("limit") || "0", 10),
            debug: note.hasLabel("debug"),
            fuzzyAttributeSearch: false
        });

        searchResultNoteIds = findResultsWithQuery(searchString, searchContext).map((sr) => sr.noteId);

        highlightedTokens = searchContext.highlightedTokens;
        error = searchContext.getError();
    }

    // we won't return search note's own noteId
    // also don't allow root since that would force infinite cycle
    return {
        searchResultNoteIds: searchResultNoteIds.filter((resultNoteId) => !["root", note.noteId].includes(resultNoteId)),
        highlightedTokens,
        error: error
    };
}

function searchFromRelation(note: BNote, relationName: string) {
    const scriptNote = note.getRelationTarget(relationName);

    if (!scriptNote) {
        log.info(`Search note's relation ${relationName} has not been found.`);

        return [];
    }

    if (!scriptNote.isJavaScript() || scriptNote.getScriptEnv() !== "backend") {
        log.info(`Note ${scriptNote.noteId} is not executable.`);

        return [];
    }

    if (!note.isContentAvailable()) {
        log.info(`Note ${scriptNote.noteId} is not available outside of protected session.`);

        return [];
    }

    const result = scriptService.executeNote(scriptNote, { originEntity: note });

    if (!Array.isArray(result)) {
        log.info(`Result from ${scriptNote.noteId} is not an array.`);

        return [];
    }

    if (result.length === 0) {
        return [];
    }

    // we expect either array of noteIds (strings) or notes, in that case we extract noteIds ourselves
    return typeof result[0] === "string" ? result : result.map((item) => item.noteId);
}

function loadNeededInfoFromDatabase() {
    /**
     * This complex structure is needed to calculate total occupied space by a note. Several object instances
     * (note, revisions, attachments) can point to a single blobId, and thus the blob size should count towards the total
     * only once.
     *
     * noteId => { blobId => blobSize }
     */
    const noteBlobs: Record<string, Record<string, number>> = {};

    type NoteContentLengthsRow = {
        noteId: string;
        blobId: string;
        length: number;
    };
    const noteContentLengths = sql.getRows<NoteContentLengthsRow>(`
        SELECT
            noteId,
            blobId,
            LENGTH(content) AS length
        FROM notes
             JOIN blobs USING(blobId)
        WHERE notes.isDeleted = 0`);

    for (const { noteId, blobId, length } of noteContentLengths) {
        if (!(noteId in becca.notes)) {
            log.error(`Note '${noteId}' not found in becca.`);
            continue;
        }

        becca.notes[noteId].contentSize = length;
        becca.notes[noteId].revisionCount = 0;

        noteBlobs[noteId] = { [blobId]: length };
    }

    type AttachmentContentLengthsRow = {
        noteId: string;
        blobId: string;
        length: number;
    };
    const attachmentContentLengths = sql.getRows<AttachmentContentLengthsRow>(`
        SELECT
            ownerId AS noteId,
            attachments.blobId,
            LENGTH(content) AS length
        FROM attachments
            JOIN notes ON attachments.ownerId = notes.noteId
            JOIN blobs ON attachments.blobId = blobs.blobId
        WHERE attachments.isDeleted = 0
            AND notes.isDeleted = 0`);

    for (const { noteId, blobId, length } of attachmentContentLengths) {
        if (!(noteId in becca.notes)) {
            log.error(`Note '${noteId}' not found in becca.`);
            continue;
        }

        if (!(noteId in noteBlobs)) {
            log.error(`Did not find a '${noteId}' in the noteBlobs.`);
            continue;
        }

        noteBlobs[noteId][blobId] = length;
    }

    for (const noteId in noteBlobs) {
        becca.notes[noteId].contentAndAttachmentsSize = Object.values(noteBlobs[noteId]).reduce((acc, size) => acc + size, 0);
    }

    type RevisionRow = {
        noteId: string;
        blobId: string;
        length: number;
        isNoteRevision: true;
    };
    const revisionContentLengths = sql.getRows<RevisionRow>(`
            SELECT
                noteId,
                revisions.blobId,
                LENGTH(content) AS length,
                1 AS isNoteRevision
            FROM notes
                JOIN revisions USING(noteId)
                JOIN blobs ON revisions.blobId = blobs.blobId
            WHERE notes.isDeleted = 0
        UNION ALL
            SELECT
                noteId,
                revisions.blobId,
                LENGTH(content) AS length,
                0 AS isNoteRevision -- it's attachment not counting towards revision count
            FROM notes
                JOIN revisions USING(noteId)
                JOIN attachments ON attachments.ownerId = revisions.revisionId
                JOIN blobs ON attachments.blobId = blobs.blobId
            WHERE notes.isDeleted = 0`);

    for (const { noteId, blobId, length, isNoteRevision } of revisionContentLengths) {
        if (!(noteId in becca.notes)) {
            log.error(`Note '${noteId}' not found in becca.`);
            continue;
        }

        if (!(noteId in noteBlobs)) {
            log.error(`Did not find a '${noteId}' in the noteBlobs.`);
            continue;
        }

        noteBlobs[noteId][blobId] = length;

        if (isNoteRevision) {
            const noteRevision = becca.notes[noteId];
            if (noteRevision && noteRevision.revisionCount) {
                noteRevision.revisionCount++;
            }
        }
    }

    for (const noteId in noteBlobs) {
        becca.notes[noteId].contentAndAttachmentsAndRevisionsSize = Object.values(noteBlobs[noteId]).reduce((acc, size) => acc + size, 0);
    }
}

function findResultsWithExpression(expression: Expression, searchContext: SearchContext): SearchResult[] {
    if (searchContext.dbLoadNeeded) {
        loadNeededInfoFromDatabase();
    }

    // If there's an explicit orderBy clause, skip progressive search
    // as it would interfere with the ordering
    if (searchContext.orderBy) {
        // For ordered queries, don't use progressive search but respect
        // the original fuzzy matching setting
        return performSearch(expression, searchContext, searchContext.enableFuzzyMatching);
    }

    // If fuzzy matching is explicitly disabled, skip progressive search
    if (!searchContext.enableFuzzyMatching) {
        return performSearch(expression, searchContext, false);
    }

    // Phase 1: Try exact matches first (without fuzzy matching)
    const exactResults = performSearch(expression, searchContext, false);

    // Check if we have sufficient high-quality results
    const minResultThreshold = 5;
    const minScoreForQuality = 10; // Minimum score to consider a result "high quality"

    const highQualityResults = exactResults.filter(result => result.score >= minScoreForQuality);

    // If we have enough high-quality exact matches, return them
    if (highQualityResults.length >= minResultThreshold) {
        return exactResults;
    }

    // Phase 2: Add fuzzy matching as fallback when exact matches are insufficient
    const fuzzyResults = performSearch(expression, searchContext, true);

    // Merge results, ensuring exact matches always rank higher than fuzzy matches
    return mergeExactAndFuzzyResults(exactResults, fuzzyResults);
}

function performSearch(expression: Expression, searchContext: SearchContext, enableFuzzyMatching: boolean): SearchResult[] {
    const allNoteSet = becca.getAllNoteSet();

    const noteIdToNotePath: Record<string, string[]> = {};
    const executionContext = {
        noteIdToNotePath
    };

    // Store original fuzzy setting and temporarily override it
    const originalFuzzyMatching = searchContext.enableFuzzyMatching;
    searchContext.enableFuzzyMatching = enableFuzzyMatching;

    const noteSet = expression.execute(allNoteSet, executionContext, searchContext);

    const searchResults = noteSet.notes.map((note) => {
        const notePathArray = executionContext.noteIdToNotePath[note.noteId] || note.getBestNotePath();

        if (!notePathArray) {
            throw new Error(`Can't find note path for note ${JSON.stringify(note.getPojo())}`);
        }

        return new SearchResult(notePathArray);
    });

    for (const res of searchResults) {
        res.computeScore(searchContext.fulltextQuery, searchContext.highlightedTokens, enableFuzzyMatching);
    }

    // Restore original fuzzy setting
    searchContext.enableFuzzyMatching = originalFuzzyMatching;

    if (!noteSet.sorted) {
        searchResults.sort((a, b) => {
            if (a.score > b.score) {
                return -1;
            } else if (a.score < b.score) {
                return 1;
            }

            // if score does not decide then sort results by depth of the note.
            // This is based on the assumption that more important results are closer to the note root.
            if (a.notePathArray.length === b.notePathArray.length) {
                return a.notePathTitle < b.notePathTitle ? -1 : 1;
            }

            return a.notePathArray.length < b.notePathArray.length ? -1 : 1;
        });
    }

    return searchResults;
}

function mergeExactAndFuzzyResults(exactResults: SearchResult[], fuzzyResults: SearchResult[]): SearchResult[] {
    // Create a map of exact result note IDs for deduplication
    const exactNoteIds = new Set(exactResults.map(result => result.noteId));
    
    // Add fuzzy results that aren't already in exact results
    const additionalFuzzyResults = fuzzyResults.filter(result => !exactNoteIds.has(result.noteId));
    
    // Sort exact results by score (best exact matches first)
    exactResults.sort((a, b) => {
        if (a.score > b.score) {
            return -1;
        } else if (a.score < b.score) {
            return 1;
        }

        // if score does not decide then sort results by depth of the note.
        if (a.notePathArray.length === b.notePathArray.length) {
            return a.notePathTitle < b.notePathTitle ? -1 : 1;
        }

        return a.notePathArray.length < b.notePathArray.length ? -1 : 1;
    });
    
    // Sort fuzzy results by score (best fuzzy matches first)
    additionalFuzzyResults.sort((a, b) => {
        if (a.score > b.score) {
            return -1;
        } else if (a.score < b.score) {
            return 1;
        }

        // if score does not decide then sort results by depth of the note.
        if (a.notePathArray.length === b.notePathArray.length) {
            return a.notePathTitle < b.notePathTitle ? -1 : 1;
        }

        return a.notePathArray.length < b.notePathArray.length ? -1 : 1;
    });
    
    // CRITICAL: Always put exact matches before fuzzy matches, regardless of scores
    return [...exactResults, ...additionalFuzzyResults];
}

function parseQueryToExpression(query: string, searchContext: SearchContext) {
    const { fulltextQuery, fulltextTokens, expressionTokens, leadingOperator } = lex(query);
    searchContext.fulltextQuery = fulltextQuery;

    let structuredExpressionTokens: TokenStructure;

    try {
        structuredExpressionTokens = handleParens(expressionTokens);
    } catch (e: any) {
        structuredExpressionTokens = [];
        searchContext.addError(e.message);
    }

    const expression = parse({
        fulltextTokens,
        expressionTokens: structuredExpressionTokens,
        searchContext,
        originalQuery: query,
        leadingOperator
    });

    if (searchContext.debug) {
        searchContext.debugInfo = {
            fulltextTokens,
            structuredExpressionTokens,
            expression
        };

        log.info(`Search debug: ${JSON.stringify(searchContext.debugInfo, null, 4)}`);
    }

    return expression;
}

function searchNotes(query: string, params: SearchParams = {}): BNote[] {
    const searchResults = findResultsWithQuery(query, new SearchContext(params));

    return searchResults.map((sr) => becca.notes[sr.noteId]);
}

function findResultsWithQuery(query: string, searchContext: SearchContext): SearchResult[] {
    query = query || "";
    searchContext.originalQuery = query;

    // For autocomplete searches, use the dedicated autocomplete fuzzy option
    // instead of the global fuzzy setting. Do this early so it applies to all code paths.
    if (searchContext.autocomplete) {
        searchContext.enableFuzzyMatching = optionService.getOptionBool("searchAutocompleteFuzzy");
    }

    const expression = parseQueryToExpression(query, searchContext);

    if (!expression) {
        return [];
    }

    // If the query starts with '#', it's a pure expression query.
    // Don't use progressive search for these as they may have complex 
    // ordering or other logic that shouldn't be interfered with.
    const isPureExpressionQuery = query.trim().startsWith('#');
    
    if (isPureExpressionQuery) {
        // For pure expression queries, use standard search without progressive phases
        return performSearch(expression, searchContext, searchContext.enableFuzzyMatching);
    }

    return findResultsWithExpression(expression, searchContext);
}

function findFirstNoteWithQuery(query: string, searchContext: SearchContext): BNote | null {
    const searchResults = findResultsWithQuery(query, searchContext);

    return searchResults.length > 0 ? becca.notes[searchResults[0].noteId] : null;
}

/**
 * Returns the first non-empty textRepresentation for a note's own blob
 * or any of its attachment blobs.
 */
function getTextRepresentationForNote(note: BNote): string | null {
    // Query only textRepresentation to avoid loading large binary content into memory.
    const row = sql.getRow<{ textRepresentation: string | null }>(`
        SELECT b.textRepresentation FROM blobs b
        WHERE b.textRepresentation IS NOT NULL
          AND b.textRepresentation != ''
          AND (
              b.blobId = ?
              OR b.blobId IN (SELECT blobId FROM attachments WHERE ownerId = ? AND isDeleted = 0)
          )
        LIMIT 1
    `, [note.blobId, note.noteId]);

    return row?.textRepresentation ?? null;
}

function extractContentSnippet(noteId: string, searchTokens: string[], maxLength: number = 200): string {
    const note = becca.notes[noteId];
    if (!note) {
        return "";
    }

    try {
        let content: string | undefined;

        if (["text", "code", "mermaid", "canvas", "mindMap"].includes(note.type)) {
            const raw = note.getContent();
            if (raw && typeof raw === "string") {
                content = raw;
            }
        } else {
            // For non-text notes (image, file), use OCR text representation
            content = getTextRepresentationForNote(note) || undefined;
        }

        if (!content) {
            return "";
        }

        // Handle protected notes
        if (note.isProtected && protectedSessionService.isProtectedSessionAvailable()) {
            try {
                content = protectedSessionService.decryptString(content) || "";
            } catch (e) {
                return ""; // Can't decrypt, don't show content
            }
        } else if (note.isProtected) {
            return ""; // Protected but no session available
        }

        // Strip HTML tags for text notes
        if (note.type === "text") {
            content = stripHtmlTags(content);
        }

        if (!content) {
            return "";
        }

        // Find match position using normalize on the raw stripped content.
        // We use a single normalize() pass — no need for expensive whitespace
        // normalization just to find the match index.
        const normalizedContent = normalize(content);
        const normalizedTokens = searchTokens.map(token => normalize(token));
        let snippetStart = 0;

        for (const normalizedToken of normalizedTokens) {
            const matchIndex = normalizedContent.indexOf(normalizedToken);

            if (matchIndex !== -1) {
                // Center the snippet around the match
                snippetStart = Math.max(0, matchIndex - maxLength / 2);
                break;
            }
        }

        // Extract a snippet region from the raw content, then clean only that
        const snippetRegion = content.substring(snippetStart, snippetStart + maxLength + 100);

        // Normalize whitespace only on the small snippet region
        let snippet = snippetRegion
            .replace(/\n\s*\n/g, "\n\n")
            .replace(/[ \t]+/g, " ")
            .trim()
            .substring(0, maxLength);

        // If snippet contains linebreaks, limit to max 4 lines
        const lines = snippet.split('\n');
        if (lines.length > 4) {
            // Find the first line that contains a search token
            let firstMatchLine = -1;
            for (let i = 0; i < lines.length; i++) {
                const normalizedLine = normalize(lines[i]);
                if (normalizedTokens.some(token => normalizedLine.includes(token))) {
                    firstMatchLine = i;
                    break;
                }
            }

            if (firstMatchLine !== -1) {
                const startLine = Math.max(0, firstMatchLine - 1);
                const endLine = Math.min(lines.length, startLine + 4);
                snippet = lines.slice(startLine, endLine).join('\n');
            } else {
                snippet = lines.slice(0, 4).join('\n');
            }
            snippet = snippet + "...";
        } else if (lines.length <= 1) {
            // Single line content - apply word boundary logic
            if (snippetStart > 0) {
                const firstSpace = snippet.search(/\s/);
                if (firstSpace > 0 && firstSpace < 20) {
                    snippet = snippet.substring(firstSpace + 1);
                }
                snippet = "..." + snippet;
            }

            if (snippetStart + maxLength < content.length) {
                const lastSpace = snippet.search(/\s[^\s]*$/);
                if (lastSpace > snippet.length - 20 && lastSpace > 0) {
                    snippet = snippet.substring(0, lastSpace);
                }
                snippet = snippet + "...";
            }
        }

        return snippet;
    } catch (e) {
        log.error(`Error extracting content snippet for note ${noteId}: ${e}`);
        return "";
    }
}

function extractAttributeSnippet(noteId: string, searchTokens: string[], maxLength: number = 200): string {
    const note = becca.notes[noteId];
    if (!note) {
        return "";
    }

    try {
        // Get all attributes for this note
        const attributes = note.getAttributes();
        if (!attributes || attributes.length === 0) {
            return "";
        }

        let matchingAttributes: Array<{name: string, value: string, type: string}> = [];
        
        // Look for attributes that match the search tokens
        for (const attr of attributes) {
            // Use pre-normalized fields from BAttribute for diacritic-insensitive matching
            const attrName = attr.normalizedName || normalize(attr.name || "");
            const attrValue = attr.normalizedValue || normalize(attr.value || "");
            const attrType = attr.type || "";

            // Check if any search token matches the attribute name or value
            const hasMatch = searchTokens.some(token => {
                const normalizedToken = normalize(token);
                return attrName.includes(normalizedToken) || attrValue.includes(normalizedToken);
            });
            
            if (hasMatch) {
                matchingAttributes.push({
                    name: attr.name || "",
                    value: attr.value || "",
                    type: attrType
                });
            }
        }

        if (matchingAttributes.length === 0) {
            return "";
        }

        // Limit to 4 lines maximum, similar to content snippet logic
        const lines: string[] = [];
        for (const attr of matchingAttributes.slice(0, 4)) {
            let line = "";
            if (attr.type === "label") {
                line = attr.value ? `#${attr.name}="${attr.value}"` : `#${attr.name}`;
            } else if (attr.type === "relation") {
                // For relations, show the target note title if possible
                const targetNote = attr.value ? becca.notes[attr.value] : null;
                const targetTitle = targetNote ? targetNote.title : attr.value;
                line = `~${attr.name}="${targetTitle}"`;
            }
            
            if (line) {
                lines.push(line);
            }
        }

        let snippet = lines.join('\n');
        
        // Apply length limit while preserving line structure
        if (snippet.length > maxLength) {
            // Try to truncate at word boundaries but keep lines intact
            const truncated = snippet.substring(0, maxLength);
            const lastNewline = truncated.lastIndexOf('\n');
            
            if (lastNewline > maxLength / 2) {
                // If we can keep most content by truncating to last complete line
                snippet = truncated.substring(0, lastNewline);
            } else {
                // Otherwise just truncate and add ellipsis
                const lastSpace = truncated.lastIndexOf(' ');
                snippet = truncated.substring(0, lastSpace > maxLength / 2 ? lastSpace : maxLength - 3);
                snippet = snippet + "...";
            }
        }

        return snippet;
    } catch (e) {
        log.error(`Error extracting attribute snippet for note ${noteId}: ${e}`);
        return "";
    }
}

function searchNotesForAutocomplete(query: string, fastSearch: boolean = true) {
    const searchContext = new SearchContext({
        fastSearch: fastSearch,
        includeArchivedNotes: false,
        includeHiddenNotes: true,
        fuzzyAttributeSearch: true,
        ignoreInternalAttributes: true,
        ancestorNoteId: hoistedNoteService.isHoistedInHiddenSubtree() ? "root" : hoistedNoteService.getHoistedNoteId(),
        autocomplete: true
    });

    const allSearchResults = findResultsWithQuery(query, searchContext);

    const trimmed = allSearchResults.slice(0, 200);

    // Extract content and attribute snippets
    for (const result of trimmed) {
        result.contentSnippet = extractContentSnippet(result.noteId, searchContext.highlightedTokens);
        result.attributeSnippet = extractAttributeSnippet(result.noteId, searchContext.highlightedTokens);
    }

    highlightSearchResults(trimmed, searchContext.highlightedTokens, searchContext.ignoreInternalAttributes);

    return trimmed.map((result) => {
        const { title, icon } = beccaService.getNoteTitleAndIcon(result.noteId);
        return {
            notePath: result.notePath,
            noteTitle: title,
            notePathTitle: result.notePathTitle,
            highlightedNotePathTitle: result.highlightedNotePathTitle,
            contentSnippet: result.contentSnippet,
            highlightedContentSnippet: result.highlightedContentSnippet,
            attributeSnippet: result.attributeSnippet,
            highlightedAttributeSnippet: result.highlightedAttributeSnippet,
            icon: icon ?? "bx bx-note"
        };
    });
}

/**
 * @param ignoreInternalAttributes whether to ignore certain attributes from the search such as ~internalLink.
 */
function highlightSearchResults(searchResults: SearchResult[], highlightedTokens: string[], ignoreInternalAttributes = false) {
    highlightedTokens = Array.from(new Set(highlightedTokens));

    // we remove < signs because they can cause trouble in matching and overwriting existing highlighted chunks
    // which would make the resulting HTML string invalid.
    // { and } are used for marking <b> and </b> tag (to avoid matches on single 'b' character)
    // < and > are used for marking <small> and </small>
    highlightedTokens = highlightedTokens.map((token) => token.replace("/[<\{\}]/g", "")).filter((token) => !!token?.trim());

    // sort by the longest, so we first highlight the longest matches
    highlightedTokens.sort((a, b) => (a.length > b.length ? -1 : 1));

    for (const result of searchResults) {
        result.highlightedNotePathTitle = result.notePathTitle.replace(/[<{}]/g, "");
        
        // Initialize highlighted content snippet
        if (result.contentSnippet) {
            // Escape HTML but preserve newlines for later conversion to <br>
            result.highlightedContentSnippet = escapeHtml(result.contentSnippet);
            // Remove any stray < { } that might interfere with our highlighting markers
            result.highlightedContentSnippet = result.highlightedContentSnippet.replace(/[<{}]/g, "");
        }
        
        // Initialize highlighted attribute snippet
        if (result.attributeSnippet) {
            // Escape HTML but preserve newlines for later conversion to <br>
            result.highlightedAttributeSnippet = escapeHtml(result.attributeSnippet);
            // Remove any stray < { } that might interfere with our highlighting markers
            result.highlightedAttributeSnippet = result.highlightedAttributeSnippet.replace(/[<{}]/g, "");
        }
    }

    function wrapText(text: string, start: number, length: number, prefix: string, suffix: string) {
        return text.substring(0, start) + prefix + text.substr(start, length) + suffix + text.substring(start + length);
    }

    for (const token of highlightedTokens) {
        if (!token) {
            // Avoid empty tokens, which might cause an infinite loop.
            continue;
        }

        for (const result of searchResults) {
            let match;

            // Highlight in note path title
            if (result.highlightedNotePathTitle) {
                const titleRegex = new RegExp(escapeRegExp(token), "gi");
                // Compute diacritic-free version ONCE before the loop, not on every iteration
                let titleNoDiacritics = removeDiacritic(result.highlightedNotePathTitle);
                while ((match = titleRegex.exec(titleNoDiacritics)) !== null) {
                    result.highlightedNotePathTitle = wrapText(result.highlightedNotePathTitle, match.index, token.length, "{", "}");
                    // 2 characters are added, so we need to adjust the index and re-derive
                    titleRegex.lastIndex += 2;
                    titleNoDiacritics = removeDiacritic(result.highlightedNotePathTitle);
                }
            }

            // Highlight in content snippet
            if (result.highlightedContentSnippet) {
                const contentRegex = new RegExp(escapeRegExp(token), "gi");
                let contentNoDiacritics = removeDiacritic(result.highlightedContentSnippet);
                while ((match = contentRegex.exec(contentNoDiacritics)) !== null) {
                    result.highlightedContentSnippet = wrapText(result.highlightedContentSnippet, match.index, token.length, "{", "}");
                    contentRegex.lastIndex += 2;
                    contentNoDiacritics = removeDiacritic(result.highlightedContentSnippet);
                }
            }

            // Highlight in attribute snippet
            if (result.highlightedAttributeSnippet) {
                const attributeRegex = new RegExp(escapeRegExp(token), "gi");
                let attrNoDiacritics = removeDiacritic(result.highlightedAttributeSnippet);
                while ((match = attributeRegex.exec(attrNoDiacritics)) !== null) {
                    result.highlightedAttributeSnippet = wrapText(result.highlightedAttributeSnippet, match.index, token.length, "{", "}");
                    attributeRegex.lastIndex += 2;
                    attrNoDiacritics = removeDiacritic(result.highlightedAttributeSnippet);
                }
            }
        }
    }

    for (const result of searchResults) {
        if (result.highlightedNotePathTitle) {
            result.highlightedNotePathTitle = result.highlightedNotePathTitle.replace(/{/g, "<b>").replace(/}/g, "</b>");
        }
        
        if (result.highlightedContentSnippet) {
            // Replace highlighting markers with HTML tags
            result.highlightedContentSnippet = result.highlightedContentSnippet.replace(/{/g, "<b>").replace(/}/g, "</b>");
            // Convert newlines to <br> tags for HTML display
            result.highlightedContentSnippet = result.highlightedContentSnippet.replace(/\n/g, "<br>");
        }
        
        if (result.highlightedAttributeSnippet) {
            // Replace highlighting markers with HTML tags
            result.highlightedAttributeSnippet = result.highlightedAttributeSnippet.replace(/{/g, "<b>").replace(/}/g, "</b>");
            // Convert newlines to <br> tags for HTML display
            result.highlightedAttributeSnippet = result.highlightedAttributeSnippet.replace(/\n/g, "<br>");
        }
    }
}

export default {
    searchFromNote,
    searchNotesForAutocomplete,
    findResultsWithQuery,
    findFirstNoteWithQuery,
    searchNotes,
    extractContentSnippet,
    extractAttributeSnippet,
    highlightSearchResults
};
