"use strict";

import type { NoteRow } from "@triliumnext/commons";
import type SearchContext from "../search_context.js";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import log from "../../log.js";
import becca from "../../../becca/becca.js";
import protectedSessionService from "../../protected_session.js";
import striptags from "striptags";
import { normalize } from "../../utils.js";
import sql from "../../sql.js";
import { 
    normalizeSearchText, 
    calculateOptimizedEditDistance, 
    validateFuzzySearchTokens, 
    validateAndPreprocessContent,
    fuzzyMatchWord,
    FUZZY_SEARCH_CONFIG 
} from "../utils/text_utils.js";
import ftsSearchService, { FTSError, FTSNotAvailableError, FTSQueryError } from "../fts_search.js";

const ALLOWED_OPERATORS = new Set(["=", "!=", "*=*", "*=", "=*", "%=", "~=", "~*"]);

// Maximum content size for search processing (2MB)
const MAX_SEARCH_CONTENT_SIZE = 2 * 1024 * 1024;

const cachedRegexes: Record<string, RegExp> = {};

function getRegex(str: string): RegExp {
    if (!(str in cachedRegexes)) {
        cachedRegexes[str] = new RegExp(str, "ms"); // multiline, dot-all
    }

    return cachedRegexes[str];
}

interface ConstructorOpts {
    tokens: string[];
    raw?: boolean;
    flatText?: boolean;
}

type SearchRow = Pick<NoteRow, "noteId" | "type" | "mime" | "content" | "isProtected">;

class NoteContentFulltextExp extends Expression {
    private operator: string;
    tokens: string[];
    private raw: boolean;
    private flatText: boolean;

    constructor(operator: string, { tokens, raw, flatText }: ConstructorOpts) {
        super();

        if (!operator || !tokens || !Array.isArray(tokens)) {
            throw new Error('Invalid parameters: operator and tokens are required');
        }

        // Validate fuzzy search tokens
        const validation = validateFuzzySearchTokens(tokens, operator);
        if (!validation.isValid) {
            throw new Error(validation.error!);
        }

        this.operator = operator;
        this.tokens = tokens;
        this.raw = !!raw;
        this.flatText = !!flatText;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        if (!ALLOWED_OPERATORS.has(this.operator)) {
            searchContext.addError(`Note content can be searched only with operators: ${Array.from(ALLOWED_OPERATORS).join(", ")}, operator ${this.operator} given.`);

            return inputNoteSet;
        }

        const resultNoteSet = new NoteSet();

        // Try to use FTS5 if available for better performance
        if (ftsSearchService.checkFTS5Availability() && this.canUseFTS5()) {
            try {
                // Performance comparison logging for FTS5 vs traditional search
                const searchQuery = this.tokens.join(" ");
                const isQuickSearch = searchContext.fastSearch === false; // quick-search sets fastSearch to false
                if (isQuickSearch) {
                    log.info(`[QUICK-SEARCH-COMPARISON] Starting comparison for query: "${searchQuery}" with operator: ${this.operator}`);
                }
                
                // Check if we need to search protected notes
                const searchProtected = protectedSessionService.isProtectedSessionAvailable();
                
                // Time FTS5 search
                const ftsStartTime = Date.now();
                const noteIdSet = inputNoteSet.getNoteIds();
                const ftsResults = ftsSearchService.searchSync(
                    this.tokens,
                    this.operator,
                    noteIdSet.size > 0 ? noteIdSet : undefined,
                    {
                        includeSnippets: false,
                        searchProtected: false // FTS5 doesn't index protected notes
                    }
                );
                const ftsEndTime = Date.now();
                const ftsTime = ftsEndTime - ftsStartTime;

                // Add FTS results to note set
                for (const result of ftsResults) {
                    if (becca.notes[result.noteId]) {
                        resultNoteSet.add(becca.notes[result.noteId]);
                    }
                }
                
                // For quick-search, also run traditional search for comparison
                if (isQuickSearch) {
                    const traditionalStartTime = Date.now();
                    const traditionalNoteSet = new NoteSet();
                    
                    // Run traditional search (use the fallback method)
                    const traditionalResults = this.executeWithFallback(inputNoteSet, traditionalNoteSet, searchContext);
                    
                    const traditionalEndTime = Date.now();
                    const traditionalTime = traditionalEndTime - traditionalStartTime;
                    
                    // Log performance comparison
                    const speedup = traditionalTime > 0 ? (traditionalTime / ftsTime).toFixed(2) : "N/A";
                    log.info(`[QUICK-SEARCH-COMPARISON] ===== Results for query: "${searchQuery}" =====`);
                    log.info(`[QUICK-SEARCH-COMPARISON] FTS5 search: ${ftsTime}ms, found ${ftsResults.length} results`);
                    log.info(`[QUICK-SEARCH-COMPARISON] Traditional search: ${traditionalTime}ms, found ${traditionalResults.notes.length} results`);
                    log.info(`[QUICK-SEARCH-COMPARISON] FTS5 is ${speedup}x faster (saved ${traditionalTime - ftsTime}ms)`);
                    
                    // Check if results match
                    const ftsNoteIds = new Set(ftsResults.map(r => r.noteId));
                    const traditionalNoteIds = new Set(traditionalResults.notes.map(n => n.noteId));
                    const matchingResults = ftsNoteIds.size === traditionalNoteIds.size && 
                                          Array.from(ftsNoteIds).every(id => traditionalNoteIds.has(id));
                    
                    if (!matchingResults) {
                        log.info(`[QUICK-SEARCH-COMPARISON] Results differ! FTS5: ${ftsNoteIds.size} notes, Traditional: ${traditionalNoteIds.size} notes`);
                        
                        // Find differences
                        const onlyInFTS = Array.from(ftsNoteIds).filter(id => !traditionalNoteIds.has(id));
                        const onlyInTraditional = Array.from(traditionalNoteIds).filter(id => !ftsNoteIds.has(id));
                        
                        if (onlyInFTS.length > 0) {
                            log.info(`[QUICK-SEARCH-COMPARISON] Only in FTS5: ${onlyInFTS.slice(0, 5).join(", ")}${onlyInFTS.length > 5 ? "..." : ""}`);
                        }
                        if (onlyInTraditional.length > 0) {
                            log.info(`[QUICK-SEARCH-COMPARISON] Only in Traditional: ${onlyInTraditional.slice(0, 5).join(", ")}${onlyInTraditional.length > 5 ? "..." : ""}`);
                        }
                    } else {
                        log.info(`[QUICK-SEARCH-COMPARISON] Results match perfectly! ✓`);
                    }
                    log.info(`[QUICK-SEARCH-COMPARISON] ========================================`);
                }
                
                // If we need to search protected notes, use the separate method
                if (searchProtected) {
                    const protectedResults = ftsSearchService.searchProtectedNotesSync(
                        this.tokens,
                        this.operator,
                        noteIdSet.size > 0 ? noteIdSet : undefined,
                        {
                            includeSnippets: false
                        }
                    );
                    
                    // Add protected note results
                    for (const result of protectedResults) {
                        if (becca.notes[result.noteId]) {
                            resultNoteSet.add(becca.notes[result.noteId]);
                        }
                    }
                }

                // Handle special cases that FTS5 doesn't support well
                if (this.operator === "%=" || this.flatText) {
                    // Fall back to original implementation for regex and flat text searches
                    return this.executeWithFallback(inputNoteSet, resultNoteSet, searchContext);
                }

                return resultNoteSet;
            } catch (error) {
                // Handle structured errors from FTS service
                if (error instanceof FTSError) {
                    if (error instanceof FTSNotAvailableError) {
                        log.info("FTS5 not available, using standard search");
                    } else if (error instanceof FTSQueryError) {
                        log.error(`FTS5 query error: ${error.message}`);
                        searchContext.addError(`Search optimization failed: ${error.message}`);
                    } else {
                        log.error(`FTS5 error: ${error}`);
                    }
                    
                    // Use fallback for recoverable errors
                    if (error.recoverable) {
                        log.info("Using fallback search implementation");
                    } else {
                        // For non-recoverable errors, return empty result
                        searchContext.addError(`Search failed: ${error.message}`);
                        return resultNoteSet;
                    }
                } else {
                    log.error(`Unexpected error in FTS5 search: ${error}`);
                }
                // Fall back to original implementation
            }
        }

        // Original implementation for fallback or when FTS5 is not available
        for (const row of sql.iterateRows<SearchRow>(`
                SELECT noteId, type, mime, content, isProtected
                FROM notes JOIN blobs USING (blobId)
                WHERE type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap') 
                  AND isDeleted = 0 
                  AND LENGTH(content) < ${MAX_SEARCH_CONTENT_SIZE}`)) {
            this.findInText(row, inputNoteSet, resultNoteSet);
        }

        return resultNoteSet;
    }

    /**
     * Determines if the current search can use FTS5
     */
    private canUseFTS5(): boolean {
        // FTS5 doesn't support regex searches well
        if (this.operator === "%=") {
            return false;
        }
        
        // For now, we'll use FTS5 for most text searches
        // but keep the original implementation for complex cases
        return true;
    }

    /**
     * Executes search with fallback for special cases
     */
    private executeWithFallback(inputNoteSet: NoteSet, resultNoteSet: NoteSet, searchContext: SearchContext): NoteSet {
        // Keep existing results from FTS5 and add additional results from fallback
        for (const row of sql.iterateRows<SearchRow>(`
                SELECT noteId, type, mime, content, isProtected
                FROM notes JOIN blobs USING (blobId)
                WHERE type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap') 
                  AND isDeleted = 0 
                  AND LENGTH(content) < ${MAX_SEARCH_CONTENT_SIZE}`)) {
            if (this.operator === "%=" || this.flatText) {
                // Only process for special cases
                this.findInText(row, inputNoteSet, resultNoteSet);
            }
        }
        return resultNoteSet;
    }

    findInText({ noteId, isProtected, content, type, mime }: SearchRow, inputNoteSet: NoteSet, resultNoteSet: NoteSet) {
        if (!inputNoteSet.hasNoteId(noteId) || !(noteId in becca.notes)) {
            return;
        }

        if (isProtected) {
            if (!protectedSessionService.isProtectedSessionAvailable() || !content || typeof content !== "string") {
                return;
            }

            try {
                content = protectedSessionService.decryptString(content) || undefined;
            } catch (e) {
                log.info(`Cannot decrypt content of note ${noteId}`);
                return;
            }
        }

        if (!content) {
            return;
        }

        content = this.preprocessContent(content, type, mime);
        
        // Apply content size validation and preprocessing
        const processedContent = validateAndPreprocessContent(content, noteId);
        if (!processedContent) {
            return; // Content too large or invalid
        }
        content = processedContent;

        if (this.tokens.length === 1) {
            const [token] = this.tokens;

            if (
                (this.operator === "=" && token === content) ||
                (this.operator === "!=" && token !== content) ||
                (this.operator === "*=" && content.endsWith(token)) ||
                (this.operator === "=*" && content.startsWith(token)) ||
                (this.operator === "*=*" && content.includes(token)) ||
                (this.operator === "%=" && getRegex(token).test(content)) ||
                (this.operator === "~=" && this.matchesWithFuzzy(content, noteId)) ||
                (this.operator === "~*" && this.fuzzyMatchToken(normalizeSearchText(token), normalizeSearchText(content)))
            ) {
                resultNoteSet.add(becca.notes[noteId]);
            }
        } else {
            // Multi-token matching with fuzzy support and phrase proximity
            if (this.operator === "~=" || this.operator === "~*") {
                if (this.matchesWithFuzzy(content, noteId)) {
                    resultNoteSet.add(becca.notes[noteId]);
                }
            } else {
                const nonMatchingToken = this.tokens.find(
                    (token) =>
                        !this.tokenMatchesContent(token, content, noteId)
                );

                if (!nonMatchingToken) {
                    resultNoteSet.add(becca.notes[noteId]);
                }
            }
        }

        return content;
    }

    preprocessContent(content: string | Buffer, type: string, mime: string) {
        content = normalize(content.toString());

        if (type === "text" && mime === "text/html") {
            if (!this.raw) {
                // Content size already filtered at DB level, safe to process
                content = this.stripTags(content);
            }

            content = content.replace(/&nbsp;/g, " ");
        } else if (type === "mindMap" && mime === "application/json") {
            content = processMindmapContent(content);
        } else if (type === "canvas" && mime === "application/json") {
            interface Element {
                type: string;
                text?: string; // Optional since not all objects have a `text` property
                id: string;
                [key: string]: any; // Other properties that may exist
            }

            let canvasContent = JSON.parse(content);
            const elements: Element[] = canvasContent.elements;
            const texts = elements
                .filter((element: Element) => element.type === "text" && element.text) // Filter for 'text' type elements with a 'text' property
                .map((element: Element) => element.text!); // Use `!` to assert `text` is defined after filtering

            content = normalize(texts.toString());
        }

        return content.trim();
    }

    /**
     * Checks if a token matches content with optional fuzzy matching
     */
    private tokenMatchesContent(token: string, content: string, noteId: string): boolean {
        const normalizedToken = normalizeSearchText(token);
        const normalizedContent = normalizeSearchText(content);
        
        if (normalizedContent.includes(normalizedToken)) {
            return true;
        }
        
        // Check flat text for default fulltext search
        if (!this.flatText || !becca.notes[noteId].getFlatText().includes(token)) {
            return false;
        }
        
        return true;
    }

    /**
     * Performs fuzzy matching with edit distance and phrase proximity
     */
    private matchesWithFuzzy(content: string, noteId: string): boolean {
        try {
            const normalizedContent = normalizeSearchText(content);
            const flatText = this.flatText ? normalizeSearchText(becca.notes[noteId].getFlatText()) : "";
            
            // For phrase matching, check if tokens appear within reasonable proximity
            if (this.tokens.length > 1) {
                return this.matchesPhrase(normalizedContent, flatText);
            }
            
            // Single token fuzzy matching
            const token = normalizeSearchText(this.tokens[0]);
            return this.fuzzyMatchToken(token, normalizedContent) || 
                   (this.flatText && this.fuzzyMatchToken(token, flatText));
        } catch (error) {
            log.error(`Error in fuzzy matching for note ${noteId}: ${error}`);
            return false;
        }
    }

    /**
     * Checks if multiple tokens match as a phrase with proximity consideration
     */
    private matchesPhrase(content: string, flatText: string): boolean {
        const searchText = this.flatText ? `${content} ${flatText}` : content;
        
        // Apply content size limits for phrase matching
        const limitedText = validateAndPreprocessContent(searchText);
        if (!limitedText) {
            return false;
        }
        
        const words = limitedText.toLowerCase().split(/\s+/);
        
        // Only skip phrase matching for truly extreme word counts that could crash the system
        if (words.length > FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT) {
            console.error(`Phrase matching skipped due to extreme word count that could cause system instability: ${words.length} words`);
            return false;
        }
        
        // Warn about large word counts but still attempt matching
        if (words.length > FUZZY_SEARCH_CONFIG.PERFORMANCE_WARNING_WORDS) {
            console.info(`Large word count for phrase matching: ${words.length} words - may take longer but will attempt full matching`);
        }
        
        // Find positions of each token
        const tokenPositions: number[][] = this.tokens.map(token => {
            const normalizedToken = normalizeSearchText(token);
            const positions: number[] = [];
            
            words.forEach((word, index) => {
                if (this.fuzzyMatchSingle(normalizedToken, word)) {
                    positions.push(index);
                }
            });
            
            return positions;
        });
        
        // Check if we found all tokens
        if (tokenPositions.some(positions => positions.length === 0)) {
            return false;
        }
        
        // Check for phrase proximity using configurable distance
        return this.hasProximityMatch(tokenPositions, FUZZY_SEARCH_CONFIG.MAX_PHRASE_PROXIMITY);
    }

    /**
     * Checks if token positions indicate a phrase match within max distance
     */
    private hasProximityMatch(tokenPositions: number[][], maxDistance: number): boolean {
        // For 2 tokens, simple proximity check
        if (tokenPositions.length === 2) {
            const [pos1, pos2] = tokenPositions;
            return pos1.some(p1 => pos2.some(p2 => Math.abs(p1 - p2) <= maxDistance));
        }
        
        // For more tokens, check if we can find a sequence where all tokens are within range
        const findSequence = (remaining: number[][], currentPos: number): boolean => {
            if (remaining.length === 0) return true;
            
            const [nextPositions, ...rest] = remaining;
            return nextPositions.some(pos => 
                Math.abs(pos - currentPos) <= maxDistance && 
                findSequence(rest, pos)
            );
        };
        
        const [firstPositions, ...rest] = tokenPositions;
        return firstPositions.some(startPos => findSequence(rest, startPos));
    }

    /**
     * Performs fuzzy matching for a single token against content
     */
    private fuzzyMatchToken(token: string, content: string): boolean {
        if (token.length < FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH) {
            // For short tokens, require exact match to avoid too many false positives
            return content.includes(token);
        }
        
        const words = content.split(/\s+/);
        
        // Only limit word processing for truly extreme cases to prevent system instability
        const limitedWords = words.slice(0, FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT);
        
        return limitedWords.some(word => this.fuzzyMatchSingle(token, word));
    }

    /**
     * Fuzzy matches a single token against a single word
     */
    private fuzzyMatchSingle(token: string, word: string): boolean {
        // Use shared optimized fuzzy matching logic
        return fuzzyMatchWord(token, word, FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
    }


    stripTags(content: string) {
        // we want to allow link to preserve URLs: https://github.com/zadam/trilium/issues/2412
        // we want to insert space in place of block tags (because they imply text separation)
        // but we don't want to insert text for typical formatting inline tags which can occur within one word
        const linkTag = "a";
        const inlineFormattingTags = ["b", "strong", "em", "i", "span", "big", "small", "font", "sub", "sup"];

        // replace tags which imply text separation with a space
        content = striptags(content, [linkTag, ...inlineFormattingTags], " ");

        // replace the inline formatting tags (but not links) without a space
        content = striptags(content, [linkTag], "");

        // at least the closing link tag can be easily stripped
        return content.replace(/<\/a>/gi, "");
    }
}

export function processMindmapContent(content: string) {
    let mindMapcontent;

    try {
        mindMapcontent = JSON.parse(content);
    } catch (e) {
        return "";
    }

    // Define interfaces for the JSON structure
    interface MindmapNode {
        id: string;
        topic: string;
        children: MindmapNode[]; // Recursive structure
        direction?: number;
        expanded?: boolean;
    }

    interface MindmapData {
        nodedata: MindmapNode;
        arrows: any[]; // If you know the structure, replace `any` with the correct type
        summaries: any[];
        direction: number;
        theme: {
            name: string;
            type: string;
            palette: string[];
            cssvar: Record<string, string>; // Object with string keys and string values
        };
    }

    // Recursive function to collect all topics
    function collectTopics(node?: MindmapNode): string[] {
        if (!node) {
            return [];
        }

        // Collect the current node's topic
        let topics = [node.topic];

        // If the node has children, collect topics recursively
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                topics = topics.concat(collectTopics(child));
            }
        }

        return topics;
    }

    // Start extracting from the root node
    const topicsArray = collectTopics(mindMapcontent.nodedata);

    // Combine topics into a single string
    const topicsString = topicsArray.join(", ");

    return normalize(topicsString.toString());
}

export default NoteContentFulltextExp;
