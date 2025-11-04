/**
 * Custom assertion helpers for search result validation
 *
 * This module provides specialized assertion functions and matchers
 * for validating search results, making tests more readable and maintainable.
 */

import type SearchResult from "../services/search/search_result.js";
import type BNote from "../becca/entities/bnote.js";
import becca from "../becca/becca.js";
import { expect } from "vitest";

/**
 * Assert that search results contain a note with the given title
 */
export function assertContainsTitle(results: SearchResult[], title: string, message?: string): void {
    const found = results.some(result => {
        const note = becca.notes[result.noteId];
        return note && note.title === title;
    });

    expect(found, message || `Expected results to contain note with title "${title}"`).toBe(true);
}

/**
 * Assert that search results do NOT contain a note with the given title
 */
export function assertDoesNotContainTitle(results: SearchResult[], title: string, message?: string): void {
    const found = results.some(result => {
        const note = becca.notes[result.noteId];
        return note && note.title === title;
    });

    expect(found, message || `Expected results NOT to contain note with title "${title}"`).toBe(false);
}

/**
 * Assert that search results contain all specified titles
 */
export function assertContainsTitles(results: SearchResult[], titles: string[]): void {
    for (const title of titles) {
        assertContainsTitle(results, title);
    }
}

/**
 * Assert that search results contain exactly the specified titles
 */
export function assertExactTitles(results: SearchResult[], titles: string[]): void {
    const resultTitles = results.map(r => becca.notes[r.noteId]?.title).filter(Boolean).sort();
    const expectedTitles = [...titles].sort();

    expect(resultTitles).toEqual(expectedTitles);
}

/**
 * Assert that search results are in a specific order by title
 */
export function assertTitleOrder(results: SearchResult[], expectedOrder: string[]): void {
    const actualOrder = results.map(r => becca.notes[r.noteId]?.title).filter(Boolean);

    expect(actualOrder, `Expected title order: ${expectedOrder.join(", ")} but got: ${actualOrder.join(", ")}`).toEqual(expectedOrder);
}

/**
 * Assert result count matches expected
 */
export function assertResultCount(results: SearchResult[], expected: number, message?: string): void {
    expect(results.length, message || `Expected ${expected} results but got ${results.length}`).toBe(expected);
}

/**
 * Assert result count is at least the expected number
 */
export function assertMinResultCount(results: SearchResult[], min: number): void {
    expect(results.length).toBeGreaterThanOrEqual(min);
}

/**
 * Assert result count is at most the expected number
 */
export function assertMaxResultCount(results: SearchResult[], max: number): void {
    expect(results.length).toBeLessThanOrEqual(max);
}

/**
 * Assert all results have scores above threshold
 */
export function assertMinScore(results: SearchResult[], minScore: number): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        const noteTitle = note?.title || `[Note ${result.noteId} not found]`;
        expect(result.score, `Note "${noteTitle}" has score ${result.score}, expected >= ${minScore}`)
            .toBeGreaterThanOrEqual(minScore);
    }
}

/**
 * Assert results are sorted by score (descending)
 */
export function assertSortedByScore(results: SearchResult[]): void {
    for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score, `Result at index ${i} has lower score than next result`)
            .toBeGreaterThanOrEqual(results[i + 1].score);
    }
}

/**
 * Assert results are sorted by a note property
 */
export function assertSortedByProperty(
    results: SearchResult[],
    property: keyof BNote,
    ascending = true
): void {
    for (let i = 0; i < results.length - 1; i++) {
        const note1 = becca.notes[results[i].noteId];
        const note2 = becca.notes[results[i + 1].noteId];

        if (!note1 || !note2) continue;

        const val1 = note1[property];
        const val2 = note2[property];

        // Skip comparison if either value is null or undefined
        if (val1 == null || val2 == null) continue;

        if (ascending) {
            expect(val1 <= val2, `Results not sorted ascending by ${property}: ${val1} > ${val2}`).toBe(true);
        } else {
            expect(val1 >= val2, `Results not sorted descending by ${property}: ${val1} < ${val2}`).toBe(true);
        }
    }
}

/**
 * Assert all results have a specific label
 */
export function assertAllHaveLabel(results: SearchResult[], labelName: string, labelValue?: string): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        const labels = note.getOwnedLabels(labelName);
        expect(labels.length, `Note "${note.title}" missing label "${labelName}"`).toBeGreaterThan(0);

        if (labelValue !== undefined) {
            const hasValue = labels.some(label => label.value === labelValue);
            expect(hasValue, `Note "${note.title}" has label "${labelName}" but not with value "${labelValue}"`).toBe(true);
        }
    }
}

/**
 * Assert all results have a specific relation
 */
export function assertAllHaveRelation(results: SearchResult[], relationName: string, targetNoteId?: string): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        const relations = note.getRelations(relationName);
        expect(relations.length, `Note "${note.title}" missing relation "${relationName}"`).toBeGreaterThan(0);

        if (targetNoteId !== undefined) {
            const hasTarget = relations.some(rel => rel.value === targetNoteId);
            expect(hasTarget, `Note "${note.title}" has relation "${relationName}" but not pointing to "${targetNoteId}"`).toBe(true);
        }
    }
}

/**
 * Assert no results are protected notes
 */
export function assertNoProtectedNotes(results: SearchResult[]): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        expect(note.isProtected, `Result contains protected note "${note.title}"`).toBe(false);
    }
}

/**
 * Assert no results are archived notes
 */
export function assertNoArchivedNotes(results: SearchResult[]): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        expect(note.isArchived, `Result contains archived note "${note.title}"`).toBe(false);
    }
}

/**
 * Assert all results are of a specific note type
 */
export function assertAllOfType(results: SearchResult[], type: string): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        expect(note.type, `Note "${note.title}" has type "${note.type}", expected "${type}"`).toBe(type);
    }
}

/**
 * Assert results contain no duplicates
 */
export function assertNoDuplicates(results: SearchResult[]): void {
    const noteIds = results.map(r => r.noteId);
    const uniqueNoteIds = new Set(noteIds);

    expect(noteIds.length, `Results contain duplicates: ${noteIds.length} results but ${uniqueNoteIds.size} unique IDs`).toBe(uniqueNoteIds.size);
}

/**
 * Assert exact matches come before fuzzy matches
 */
export function assertExactBeforeFuzzy(results: SearchResult[], searchTerm: string): void {
    const lowerSearchTerm = searchTerm.toLowerCase();
    let lastExactIndex = -1;
    let firstFuzzyIndex = results.length;

    for (let i = 0; i < results.length; i++) {
        const note = becca.notes[results[i].noteId];
        if (!note) continue;

        const titleLower = note.title.toLowerCase();
        const isExactMatch = titleLower.includes(lowerSearchTerm);

        if (isExactMatch) {
            lastExactIndex = i;
        } else {
            if (firstFuzzyIndex === results.length) {
                firstFuzzyIndex = i;
            }
        }
    }

    if (lastExactIndex !== -1 && firstFuzzyIndex !== results.length) {
        expect(lastExactIndex, `Fuzzy matches found before exact matches: last exact at ${lastExactIndex}, first fuzzy at ${firstFuzzyIndex}`)
            .toBeLessThan(firstFuzzyIndex);
    }
}

/**
 * Assert results match a predicate function
 */
export function assertAllMatch(
    results: SearchResult[],
    predicate: (note: BNote) => boolean,
    message?: string
): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        expect(predicate(note), message || `Note "${note.title}" does not match predicate`).toBe(true);
    }
}

/**
 * Assert results are all ancestors/descendants of a specific note
 */
export function assertAllAncestorsOf(results: SearchResult[], ancestorNoteId: string): void {
    const ancestorNote = becca.notes[ancestorNoteId];
    expect(ancestorNote, `Ancestor note with ID "${ancestorNoteId}" not found`).toBeDefined();

    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        const hasAncestor = note.getAncestors().some(ancestor => ancestor.noteId === ancestorNoteId);
        const ancestorTitle = ancestorNote?.title || `[Note ${ancestorNoteId}]`;
        expect(hasAncestor, `Note "${note.title}" is not a descendant of "${ancestorTitle}"`).toBe(true);
    }
}

/**
 * Assert results are all descendants of a specific note
 */
export function assertAllDescendantsOf(results: SearchResult[], ancestorNoteId: string): void {
    assertAllAncestorsOf(results, ancestorNoteId); // Same check
}

/**
 * Assert results are all children of a specific note
 */
export function assertAllChildrenOf(results: SearchResult[], parentNoteId: string): void {
    const parentNote = becca.notes[parentNoteId];
    expect(parentNote, `Parent note with ID "${parentNoteId}" not found`).toBeDefined();

    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        const isChild = note.getParentNotes().some(parent => parent.noteId === parentNoteId);
        const parentTitle = parentNote?.title || `[Note ${parentNoteId}]`;
        expect(isChild, `Note "${note.title}" is not a child of "${parentTitle}"`).toBe(true);
    }
}

/**
 * Assert results all have a note property matching a value
 */
export function assertAllHaveProperty<K extends keyof BNote>(
    results: SearchResult[],
    property: K,
    value: BNote[K]
): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        if (!note) continue;

        expect(note[property], `Note "${note.title}" has ${property}="${note[property]}", expected "${value}"`)
            .toEqual(value);
    }
}

/**
 * Assert result scores are within expected ranges
 */
export function assertScoreRange(results: SearchResult[], min: number, max: number): void {
    for (const result of results) {
        const note = becca.notes[result.noteId];
        expect(result.score, `Score for "${note?.title}" is ${result.score}, expected between ${min} and ${max}`)
            .toBeGreaterThanOrEqual(min);
        expect(result.score).toBeLessThanOrEqual(max);
    }
}

/**
 * Assert search results have expected highlights/snippets
 * TODO: Implement this when SearchResult structure includes highlight/snippet information
 * For now, this is a placeholder that validates the result exists
 */
export function assertHasHighlight(result: SearchResult, searchTerm: string): void {
    expect(result).toBeDefined();
    expect(result.noteId).toBeDefined();

    // When SearchResult includes highlight/snippet data, implement:
    // - Check if result has snippet property
    // - Verify snippet contains highlight markers
    // - Validate searchTerm appears in highlighted sections
    // Example future implementation:
    // if ('snippet' in result && result.snippet) {
    //     expect(result.snippet.toLowerCase()).toContain(searchTerm.toLowerCase());
    // }
}

/**
 * Get result by note title (for convenience)
 */
export function getResultByTitle(results: SearchResult[], title: string): SearchResult | undefined {
    return results.find(result => {
        const note = becca.notes[result.noteId];
        return note && note.title === title;
    });
}

/**
 * Assert a specific note has a higher score than another
 */
export function assertScoreHigherThan(
    results: SearchResult[],
    higherTitle: string,
    lowerTitle: string
): void {
    const higherResult = getResultByTitle(results, higherTitle);
    const lowerResult = getResultByTitle(results, lowerTitle);

    expect(higherResult, `Note "${higherTitle}" not found in results`).toBeDefined();
    expect(lowerResult, `Note "${lowerTitle}" not found in results`).toBeDefined();

    expect(
        higherResult!.score,
        `"${higherTitle}" (score: ${higherResult!.score}) does not have higher score than "${lowerTitle}" (score: ${lowerResult!.score})`
    ).toBeGreaterThan(lowerResult!.score);
}

/**
 * Assert results match expected count and contain all specified titles
 */
export function assertResultsMatch(
    results: SearchResult[],
    expectedCount: number,
    expectedTitles: string[]
): void {
    assertResultCount(results, expectedCount);
    assertContainsTitles(results, expectedTitles);
}

/**
 * Assert search returns empty results
 */
export function assertEmpty(results: SearchResult[]): void {
    expect(results).toHaveLength(0);
}

/**
 * Assert search returns non-empty results
 */
export function assertNotEmpty(results: SearchResult[]): void {
    expect(results.length).toBeGreaterThan(0);
}

/**
 * Create a custom matcher for title containment (fluent interface)
 */
export class SearchResultMatcher {
    constructor(private results: SearchResult[]) {}

    hasTitle(title: string): this {
        assertContainsTitle(this.results, title);
        return this;
    }

    doesNotHaveTitle(title: string): this {
        assertDoesNotContainTitle(this.results, title);
        return this;
    }

    hasCount(count: number): this {
        assertResultCount(this.results, count);
        return this;
    }

    hasMinCount(min: number): this {
        assertMinResultCount(this.results, min);
        return this;
    }

    hasMaxCount(max: number): this {
        assertMaxResultCount(this.results, max);
        return this;
    }

    isEmpty(): this {
        assertEmpty(this.results);
        return this;
    }

    isNotEmpty(): this {
        assertNotEmpty(this.results);
        return this;
    }

    isSortedByScore(): this {
        assertSortedByScore(this.results);
        return this;
    }

    hasNoDuplicates(): this {
        assertNoDuplicates(this.results);
        return this;
    }

    allHaveLabel(labelName: string, labelValue?: string): this {
        assertAllHaveLabel(this.results, labelName, labelValue);
        return this;
    }

    allHaveType(type: string): this {
        assertAllOfType(this.results, type);
        return this;
    }

    noProtectedNotes(): this {
        assertNoProtectedNotes(this.results);
        return this;
    }

    noArchivedNotes(): this {
        assertNoArchivedNotes(this.results);
        return this;
    }

    exactBeforeFuzzy(searchTerm: string): this {
        assertExactBeforeFuzzy(this.results, searchTerm);
        return this;
    }
}

/**
 * Create a fluent matcher for search results
 */
export function expectResults(results: SearchResult[]): SearchResultMatcher {
    return new SearchResultMatcher(results);
}

/**
 * Helper to print search results for debugging
 */
export function debugPrintResults(results: SearchResult[], label = "Search Results"): void {
    console.log(`\n=== ${label} (${results.length} results) ===`);
    results.forEach((result, index) => {
        const note = becca.notes[result.noteId];
        if (note) {
            console.log(`${index + 1}. "${note.title}" (ID: ${result.noteId}, Score: ${result.score})`);
        }
    });
    console.log("===\n");
}
