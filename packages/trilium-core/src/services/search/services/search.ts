import type { HighlightedTokenInfo, SearchResultDetails } from "@triliumnext/commons";
import { extractLlmChatText } from "@triliumnext/commons/src/lib/llm/extract_chat_text.js";
import striptags from "striptags";

import becca from "../../../becca/becca.js";
import becca_service from "../../../becca/becca_service.js";
import type BNote from "../../../becca/entities/bnote.js";
import hoistedNoteService from "../../hoisted_note.js";
import { getLog } from "../../log.js";
import protectedSessionService from "../../protected_session.js";
import scriptService from "../../script.js";
import { isScriptingEnabled } from "../../scripting_guard.js";
import { escapeHtml, escapeRegExp, normalizePreservingLength } from "../../utils/index.js";
import type Expression from "../expressions/expression.js";
import SearchContext from "../search_context.js";
import SearchResult from "../search_result.js";
import handleParens from "./handle_parens.js";
import lex from "./lex.js";
import parse from "./parse.js";
import type { SearchParams, TokenStructure } from "./types.js";
import { getSql } from "../../sql/index.js";

/** Cap on marker wraps per snippet field per token, bounding pathological regex patterns. */
const MAX_HIGHLIGHT_WRAPS = 50;

export interface SearchNoteResult {
    searchResultNoteIds: string[];
    highlightedTokens: string[];
    /**
     * Structured highlight tokens (additive). Empty for script-based searches, which
     * have no lexed tokens. {@link highlightedTokens} is left untouched — it is part
     * of the public scripting API.
     */
    highlightedTokenInfos: HighlightedTokenInfo[];
    error: string | null;
}

export const EMPTY_RESULT: SearchNoteResult = {
    searchResultNoteIds: [],
    highlightedTokens: [],
    highlightedTokenInfos: [],
    error: null
};

function searchFromNote(note: BNote): SearchNoteResult {
    const { searchResults, searchContext, error } = searchFromNoteWithContext(note);

    // we won't return search note's own noteId
    // also don't allow root since that would force infinite cycle
    return {
        searchResultNoteIds: searchResults
            .map((sr) => sr.noteId)
            .filter((resultNoteId) => !["root", note.noteId].includes(resultNoteId)),
        highlightedTokens: searchContext ? searchContext.highlightedTokens : [],
        highlightedTokenInfos: searchContext ? searchContext.getHighlightedTokenInfos() : [],
        error
    };
}

/**
 * Runs a saved search note, returning the raw {@link SearchResult}s together with
 * the {@link SearchContext} that produced them so callers can build snippets and
 * highlight token infos. Script-based searches (`~searchScript`) have no lexed
 * query, so `searchContext` is `null` for them (and there are no snippets/tokens).
 */
function searchFromNoteWithContext(note: BNote): {
    searchResults: SearchResult[];
    searchContext: SearchContext | null;
    error: string | null;
} {
    const searchScript = note.getRelationValue("searchScript");
    const searchString = note.getLabelValue("searchString") || "";

    if (searchScript) {
        const searchResults = searchFromRelation(note, "searchScript").map((noteId) => {
            const notePath = becca.notes[noteId]?.getBestNotePath() ?? [noteId];
            return new SearchResult(notePath);
        });

        return { searchResults, searchContext: null, error: null };
    }

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

    const searchResults = findResultsWithQuery(searchString, searchContext);

    return { searchResults, searchContext, error: searchContext.getError() };
}

function searchFromRelation(note: BNote, relationName: string) {
    const scriptNote = note.getRelationTarget(relationName);

    const log = getLog();
    if (!scriptNote) {
        log.info(`Search note's relation ${relationName} has not been found.`);

        return [];
    }

    if (!isScriptingEnabled()) {
        log.info("Script-based search is disabled (backend scripting is not enabled).");
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
    const log = getLog();
    const noteContentLengths = getSql().getRows<NoteContentLengthsRow>(`
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
    const attachmentContentLengths = getSql().getRows<AttachmentContentLengthsRow>(`
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
    const revisionContentLengths = getSql().getRows<RevisionRow>(`
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

    // Each progressive phase re-executes the expression tree, so clear content-match
    // records first — otherwise phase-2 (fuzzy) records would mix with phase-1 ones.
    searchContext.contentMatches.clear();

    const noteSet = expression.execute(allNoteSet, executionContext, searchContext);

    const searchResults = noteSet.notes.map((note) => {
        const notePathArray = executionContext.noteIdToNotePath[note.noteId] || note.getBestNotePath();

        if (!notePathArray) {
            throw new Error(`Can't find note path for note ${JSON.stringify(note.getPojo())}`);
        }

        return new SearchResult(notePathArray);
    });

    for (const res of searchResults) {
        res.computeScore(searchContext.fulltextQuery, searchContext.highlightedTokens, enableFuzzyMatching, searchContext.contentMatches.get(res.noteId));
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

        getLog().info(`Search debug: ${JSON.stringify(searchContext.debugInfo, null, 4)}`);
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
    const row = getSql().getRow<{ textRepresentation: string | null }>(`
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

function extractContentSnippet(noteId: string, searchTokens: HighlightedTokenInfo[] | string[], maxLength: number = 200): string {
    const note = becca.notes[noteId];
    if (!note) {
        return "";
    }

    const tokenInfos = toTokenInfos(searchTokens);

    try {
        let content: string | undefined;

        if (["text", "code", "mermaid", "canvas", "mindMap", "llmChat"].includes(note.type)) {
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
            content = striptags(content);
        } else if (note.type === "llmChat") {
            // The note stores the whole conversation as a JSON blob; show the readable prose only.
            content = extractLlmChatText(content);
            if (!content) {
                return "";
            }
        }

        // Normalize whitespace while preserving paragraph breaks
        // First, normalize multiple newlines to double newlines (paragraph breaks)
        content = content.replace(/\n\s*\n/g, "\n\n");
        // Then normalize spaces within lines
        content = content.split('\n').map(line => line.replace(/\s+/g, " ").trim()).join('\n');
        // Finally trim the whole content
        content = content.trim();

        if (!content) {
            return "";
        }

        // Try to find a snippet around the first matching token. Positions are found
        // on a length-preserving normalization so they slice the original 1:1.
        const normalizedContent = normalizePreservingLength(content);
        let snippetStart = 0;
        let matchFound = false;

        for (const info of tokenInfos) {
            const matchIndex = tokenInfoFirstIndex(info, normalizedContent);

            if (matchIndex !== -1) {
                // Center the snippet around the match
                snippetStart = Math.max(0, matchIndex - maxLength / 2);
                matchFound = true;
                break;
            }
        }

        // Extract snippet
        let snippet = content.substring(snippetStart, snippetStart + maxLength);

        // If snippet contains linebreaks, limit to max 4 lines and override character limit
        const lines = snippet.split('\n');
        if (lines.length > 4) {
            // Find which lines contain the search tokens to ensure they're included
            const normalizedLines = lines.map((line) => normalizePreservingLength(line));

            // Find the first line that contains a search token
            let firstMatchLine = -1;
            for (let i = 0; i < normalizedLines.length; i++) {
                if (tokenInfos.some((info) => tokenInfoMatches(info, normalizedLines[i]))) {
                    firstMatchLine = i;
                    break;
                }
            }

            if (firstMatchLine !== -1) {
                // Center the 4-line window around the first match
                // Try to show 1 line before and 2 lines after the match
                const startLine = Math.max(0, firstMatchLine - 1);
                const endLine = Math.min(lines.length, startLine + 4);
                snippet = lines.slice(startLine, endLine).join('\n');
            } else {
                // No match found in lines (shouldn't happen), just take first 4
                snippet = lines.slice(0, 4).join('\n');
            }
            // Add ellipsis if we truncated lines
            snippet = `${snippet}...`;
        } else if (lines.length > 1) {
            // For multi-line snippets that are 4 or fewer lines, keep them as-is
            // No need to truncate
        } else {
            // Single line content - apply original word boundary logic
            // Try to start/end at word boundaries
            if (snippetStart > 0) {
                const firstSpace = snippet.search(/\s/);
                if (firstSpace > 0 && firstSpace < 20) {
                    snippet = snippet.substring(firstSpace + 1);
                }
                snippet = `...${snippet}`;
            }

            if (snippetStart + maxLength < content.length) {
                const lastSpace = snippet.search(/\s[^\s]*$/);
                if (lastSpace > snippet.length - 20 && lastSpace > 0) {
                    snippet = snippet.substring(0, lastSpace);
                }
                snippet = `${snippet}...`;
            }
        }

        return snippet;
    } catch (e) {
        getLog().error(`Error extracting content snippet for note ${noteId}: ${e}`);
        return "";
    }
}

function extractAttributeSnippet(noteId: string, searchTokens: HighlightedTokenInfo[] | string[], maxLength: number = 200): string {
    const note = becca.notes[noteId];
    if (!note) {
        return "";
    }

    const tokenInfos = toTokenInfos(searchTokens);

    try {
        // Get all attributes for this note
        const attributes = note.getAttributes();
        if (!attributes || attributes.length === 0) {
            return "";
        }

        const matchingAttributes: Array<{name: string, value: string, type: string}> = [];

        // Look for attributes that match the search tokens
        for (const attr of attributes) {
            const attrName = attr.name?.toLowerCase() || "";
            const attrValue = attr.value?.toLowerCase() || "";
            const attrType = attr.type || "";

            // Check if any search token matches the attribute name or value
            const normalizedName = normalizePreservingLength(attrName);
            const normalizedValue = normalizePreservingLength(attrValue);
            const hasMatch = tokenInfos.some((info) =>
                tokenInfoMatches(info, normalizedName) || tokenInfoMatches(info, normalizedValue));

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
                snippet = `${snippet}...`;
            }
        }

        return snippet;
    } catch (e) {
        getLog().error(`Error extracting attribute snippet for note ${noteId}: ${e}`);
        return "";
    }
}

function searchNotesForAutocomplete(query: string, fastSearch: boolean = true) {
    const searchContext = new SearchContext({
        fastSearch,
        includeArchivedNotes: false,
        includeHiddenNotes: true,
        fuzzyAttributeSearch: true,
        ignoreInternalAttributes: true,
        ancestorNoteId: hoistedNoteService.isHoistedInHiddenSubtree() ? "root" : hoistedNoteService.getHoistedNoteId()
    });

    const trimmed = findResultsWithQuery(query, searchContext).slice(0, 200);

    return buildSearchResultDetails(trimmed, searchContext);
}

/**
 * Shared builder for the snippet + highlight details of a page of search results.
 * Extracts content/attribute snippets using the context's structured (regex-aware)
 * highlight tokens, applies highlighting, and maps each result to the wire shape
 * (including `noteId`). Mutates the passed {@link SearchResult}s (setting their
 * snippet fields) as a side effect of extraction/highlighting.
 */
function buildSearchResultDetails(results: SearchResult[], searchContext: SearchContext): SearchResultDetails[] {
    const tokenInfos = searchContext.getHighlightedTokenInfos();

    for (const result of results) {
        result.contentSnippet = extractContentSnippet(result.noteId, tokenInfos);
        result.attributeSnippet = extractAttributeSnippet(result.noteId, tokenInfos);
    }

    highlightSearchResults(results, tokenInfos, searchContext.ignoreInternalAttributes);

    return results.map((result) => {
        const { title, icon } = becca_service.getNoteTitleAndIcon(result.noteId);
        return {
            noteId: result.noteId,
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
 * @param tokens the tokens to highlight, either legacy plain strings or structured
 *   {@link HighlightedTokenInfo}s (regex-aware). Legacy strings are treated as plain.
 * @param ignoreInternalAttributes whether to ignore certain attributes from the search such as ~internalLink.
 */
function highlightSearchResults(searchResults: SearchResult[], tokens: HighlightedTokenInfo[] | string[], ignoreInternalAttributes = false) {
    const tokenInfos = normalizeHighlightTokens(tokens);

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

    for (const tokenInfo of tokenInfos) {
        for (const result of searchResults) {
            result.highlightedNotePathTitle = highlightField(result.highlightedNotePathTitle, tokenInfo);
            result.highlightedContentSnippet = highlightField(result.highlightedContentSnippet, tokenInfo);
            result.highlightedAttributeSnippet = highlightField(result.highlightedAttributeSnippet, tokenInfo);
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
    searchFromNoteWithContext,
    searchNotesForAutocomplete,
    buildSearchResultDetails,
    findResultsWithQuery,
    findFirstNoteWithQuery,
    searchNotes,
    extractContentSnippet,
    extractAttributeSnippet,
    highlightSearchResults
};

/** Widens a legacy `string[]` (all plain) or a structured token-info list to token infos. */
function toTokenInfos(tokens: HighlightedTokenInfo[] | string[]): HighlightedTokenInfo[] {
    return tokens.map((token) => (typeof token === "string" ? { token, type: "plain" } : token));
}

/** Index of the first match of a token within already-normalized text, or -1 if none. */
function tokenInfoFirstIndex(info: HighlightedTokenInfo, normalizedText: string): number {
    if (info.type === "regex") {
        try {
            const match = new RegExp(info.token, "gi").exec(normalizedText);
            return match ? match.index : -1;
        } catch {
            return -1; // Skip invalid regex patterns.
        }
    }

    return normalizedText.indexOf(normalizePreservingLength(info.token));
}

/** Whether a token matches anywhere within already-normalized text. */
function tokenInfoMatches(info: HighlightedTokenInfo, normalizedText: string): boolean {
    return tokenInfoFirstIndex(info, normalizedText) !== -1;
}

/**
 * Normalizes the highlight token input for {@link highlightSearchResults}: widens
 * legacy strings to plain token infos, strips marker/angle characters from plain
 * tokens (regex patterns are kept verbatim), drops blanks, dedupes, and sorts
 * longest-first so longer matches win before shorter ones.
 */
function normalizeHighlightTokens(tokens: HighlightedTokenInfo[] | string[]): HighlightedTokenInfo[] {
    const seen = new Set<string>();
    const result: HighlightedTokenInfo[] = [];

    for (const info of toTokenInfos(tokens)) {
        // { } are used as <b>/</b> markers and < can break the surrounding HTML, so we
        // strip them from plain tokens; regex patterns keep them (e.g. `a{2}` quantifiers).
        const token = info.type === "regex" ? info.token : info.token.replace(/[<>{}]/g, "");

        if (!token.trim() || seen.has(token)) {
            continue;
        }

        seen.add(token);
        result.push({ token, type: info.type });
    }

    result.sort((a, b) => (a.token.length > b.token.length ? -1 : 1));

    return result;
}

/** Builds the case-insensitive matching regex for a token, or null for an invalid regex pattern. */
function buildHighlightRegex(info: HighlightedTokenInfo): RegExp | null {
    if (info.type === "regex") {
        try {
            return new RegExp(info.token, "gi");
        } catch {
            return null; // Skip invalid regex patterns.
        }
    }

    return new RegExp(escapeRegExp(info.token), "gi");
}

/**
 * Wraps every match of one token in a single field with `{`/`}` markers (later
 * turned into `<b>`/`</b>`). Match positions are found on a length-preserving
 * normalization so they align 1:1 with the original field. The wrap count is
 * capped to bound pathological regex patterns, and zero-width matches break the
 * loop rather than spin forever.
 */
function highlightField(field: string | undefined, info: HighlightedTokenInfo): string | undefined {
    if (!field) {
        return field;
    }

    const regex = buildHighlightRegex(info);
    if (!regex) {
        return field;
    }

    let match: RegExpExecArray | null;
    let wraps = 0;
    while ((match = regex.exec(normalizePreservingLength(field))) !== null) {
        const matchLength = match[0].length;
        if (matchLength === 0) {
            break; // Zero-width match can't be highlighted; avoid an infinite loop.
        }

        field = wrapText(field, match.index, matchLength, "{", "}");
        // Two marker characters were inserted, so advance past them as well.
        regex.lastIndex += 2;

        if (++wraps >= MAX_HIGHLIGHT_WRAPS) {
            break;
        }
    }

    return field;
}

function wrapText(text: string, start: number, length: number, prefix: string, suffix: string) {
    return text.substring(0, start) + prefix + text.substr(start, length) + suffix + text.substring(start + length);
}
