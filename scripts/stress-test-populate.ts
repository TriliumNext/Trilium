#!/usr/bin/env tsx
/**
 * Stress Test Database Population Script
 *
 * This script populates the Trilium database with a large number of diverse notes
 * for performance testing, search testing, and stress testing purposes.
 *
 * Usage:
 *   pnpm tsx scripts/stress-test-populate.ts [options]
 *
 * Options:
 *   --notes=N           Number of notes to create (default: 5000)
 *   --depth=N           Maximum hierarchy depth (default: 10)
 *   --max-relations=N   Maximum relations per note (default: 10)
 *   --max-labels=N      Maximum labels per note (default: 8)
 *   --help              Show this help message
 *
 * Note: This script requires an existing Trilium database. Run Trilium at least once
 * before running this script to initialize the database.
 */

// Set up environment variables like the server does
process.env.TRILIUM_ENV = "dev";
process.env.TRILIUM_DATA_DIR = process.env.TRILIUM_DATA_DIR || "trilium-data";

import { initializeTranslations } from "../apps/server/src/services/i18n.js";
import BNote from "../apps/server/src/becca/entities/bnote.js";
import BBranch from "../apps/server/src/becca/entities/bbranch.js";
import BAttribute from "../apps/server/src/becca/entities/battribute.js";
import becca from "../apps/server/src/becca/becca.js";
import { NoteBuilder, id, note } from "../apps/server/src/test/becca_mocking.js";
import type { NoteType } from "@triliumnext/commons";

// Parse command line arguments
const args = process.argv.slice(2);
const config = {
    noteCount: 5000,
    maxDepth: 10,
    maxRelations: 10,
    maxLabels: 8,
};

for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
        console.log(`
Stress Test Database Population Script

This script populates the Trilium database with a large number of diverse notes
for performance testing, search testing, and stress testing purposes.

Usage:
  pnpm tsx scripts/stress-test-populate.ts [options]

Options:
  --notes=N           Number of notes to create (default: ${config.noteCount})
  --depth=N           Maximum hierarchy depth (default: ${config.maxDepth})
  --max-relations=N   Maximum relations per note (default: ${config.maxRelations})
  --max-labels=N      Maximum labels per note (default: ${config.maxLabels})
  --help, -h          Show this help message

Examples:
  # Use defaults (5000 notes, depth 10)
  pnpm tsx scripts/stress-test-populate.ts

  # Create 10000 notes with depth 15
  pnpm tsx scripts/stress-test-populate.ts --notes=10000 --depth=15

  # Smaller test with 1000 notes and depth 5
  pnpm tsx scripts/stress-test-populate.ts --notes=1000 --depth=5
        `);
        process.exit(0);
    }

    const match = arg.match(/--(\w+)=(.+)/);
    if (match) {
        const [, key, value] = match;
        switch (key) {
            case "notes":
                config.noteCount = parseInt(value, 10);
                break;
            case "depth":
                config.maxDepth = parseInt(value, 10);
                break;
            case "max-relations":
                config.maxRelations = parseInt(value, 10);
                break;
            case "max-labels":
                config.maxLabels = parseInt(value, 10);
                break;
        }
    }
}

console.log("Stress Test Database Population");
console.log("================================");
console.log(`Target note count: ${config.noteCount}`);
console.log(`Maximum depth: ${config.maxDepth}`);
console.log(`Maximum relations per note: ${config.maxRelations}`);
console.log(`Maximum labels per note: ${config.maxLabels}`);
console.log("");

// Note type distribution (rough percentages)
const NOTE_TYPES: { type: NoteType; mime: string; weight: number }[] = [
    { type: "text", mime: "text/html", weight: 50 },
    { type: "code", mime: "text/javascript", weight: 15 },
    { type: "code", mime: "text/x-python", weight: 10 },
    { type: "code", mime: "application/json", weight: 5 },
    { type: "mermaid", mime: "text/mermaid", weight: 5 },
    { type: "book", mime: "text/html", weight: 5 },
    { type: "render", mime: "text/html", weight: 3 },
    { type: "relationMap", mime: "application/json", weight: 2 },
    { type: "search", mime: "application/json", weight: 2 },
    { type: "canvas", mime: "application/json", weight: 2 },
    { type: "doc", mime: "text/html", weight: 1 },
];

// Sample content generators
const LOREM_IPSUM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`;

const CODE_SAMPLES = {
    "text/javascript": `function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));`,

    "text/x-python": `def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

print(quicksort([3, 6, 8, 10, 1, 2, 1]))`,

    "application/json": `{
  "name": "example",
  "version": "1.0.0",
  "description": "A sample JSON document",
  "keywords": ["example", "test", "stress"]
}`,
};

const MERMAID_SAMPLE = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process]
    B -->|No| D[Alternative]
    C --> E[End]
    D --> E`;

// Common label names and value patterns
const LABEL_NAMES = [
    "priority", "status", "category", "tag", "project", "version", "author",
    "reviewed", "archived", "published", "draft", "language", "framework",
    "difficulty", "rating", "year", "month", "country", "city", "department"
];

const LABEL_VALUES = {
    priority: ["high", "medium", "low", "critical"],
    status: ["active", "completed", "pending", "archived", "draft"],
    category: ["personal", "work", "reference", "project", "research"],
    rating: ["1", "2", "3", "4", "5"],
    difficulty: ["beginner", "intermediate", "advanced", "expert"],
    language: ["javascript", "python", "typescript", "rust", "go", "java"],
    framework: ["react", "vue", "angular", "express", "django", "flask"],
};

// Relation names
const RELATION_NAMES = [
    "relatedTo", "dependsOn", "references", "implements", "extends",
    "baseOn", "contains", "partOf", "author", "reviewer", "assignedTo",
    "linkedWith", "similarTo", "contradicts", "supports"
];

// Title prefixes for different categories
const TITLE_PREFIXES = [
    "Documentation", "Tutorial", "Guide", "Reference", "API", "Concept",
    "Example", "Pattern", "Architecture", "Design", "Implementation",
    "Analysis", "Research", "Note", "Idea", "Project", "Task", "Feature",
    "Bug", "Issue", "Discussion", "Meeting", "Review", "Proposal", "Spec"
];

const TITLE_SUBJECTS = [
    "Authentication", "Database", "API", "Frontend", "Backend", "Security",
    "Performance", "Testing", "Deployment", "Configuration", "Monitoring",
    "Logging", "Caching", "Scaling", "Optimization", "Refactoring",
    "Integration", "Migration", "Upgrade", "Architecture", "Infrastructure"
];

/**
 * Select a random item from array based on weights
 */
function weightedRandom<T extends { weight: number }>(items: T[]): T {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;

    for (const item of items) {
        random -= item.weight;
        if (random <= 0) {
            return item;
        }
    }

    return items[items.length - 1];
}

/**
 * Generate random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a random title
 */
function generateTitle(index: number): string {
    if (Math.random() < 0.3) {
        // Use structured title
        const prefix = TITLE_PREFIXES[randomInt(0, TITLE_PREFIXES.length - 1)];
        const subject = TITLE_SUBJECTS[randomInt(0, TITLE_SUBJECTS.length - 1)];
        return `${prefix}: ${subject} #${index}`;
    } else {
        // Use simple title
        return `Note ${index}`;
    }
}

/**
 * Generate content based on note type
 */
function generateContent(type: NoteType, mime: string): string {
    if (type === "code" && CODE_SAMPLES[mime as keyof typeof CODE_SAMPLES]) {
        return CODE_SAMPLES[mime as keyof typeof CODE_SAMPLES];
    } else if (type === "mermaid") {
        return MERMAID_SAMPLE;
    } else if (type === "text" || type === "book" || type === "doc") {
        // Generate multiple paragraphs
        const paragraphs = randomInt(1, 5);
        return Array(paragraphs).fill(LOREM_IPSUM).join("\n\n");
    } else if (mime === "application/json") {
        return CODE_SAMPLES["application/json"];
    }
    return "";
}

/**
 * Generate random labels for a note
 */
function generateLabels(noteBuilder: NoteBuilder, count: number): void {
    const labelsToAdd = Math.min(count, randomInt(0, config.maxLabels));

    for (let i = 0; i < labelsToAdd; i++) {
        const labelName = LABEL_NAMES[randomInt(0, LABEL_NAMES.length - 1)];
        let labelValue = "";

        // Use predefined values if available
        if (LABEL_VALUES[labelName as keyof typeof LABEL_VALUES]) {
            const values = LABEL_VALUES[labelName as keyof typeof LABEL_VALUES];
            labelValue = values[randomInt(0, values.length - 1)];
        } else {
            labelValue = `value${randomInt(1, 100)}`;
        }

        const isInheritable = Math.random() < 0.2; // 20% chance of inheritable
        noteBuilder.label(labelName, labelValue, isInheritable);
    }
}

/**
 * Generate random relations for a note
 */
function generateRelations(
    noteBuilder: NoteBuilder,
    allNotes: BNote[],
    maxRelations: number
): void {
    if (allNotes.length === 0) return;

    const relationsToAdd = Math.min(
        maxRelations,
        randomInt(0, config.maxRelations)
    );

    for (let i = 0; i < relationsToAdd; i++) {
        const relationName = RELATION_NAMES[randomInt(0, RELATION_NAMES.length - 1)];
        const targetNote = allNotes[randomInt(0, allNotes.length - 1)];

        // Avoid self-relations
        if (targetNote.noteId !== noteBuilder.note.noteId) {
            noteBuilder.relation(relationName, targetNote);
        }
    }
}

/**
 * Create a note with random attributes
 */
function createRandomNote(
    index: number,
    allNotes: BNote[]
): NoteBuilder {
    const noteType = weightedRandom(NOTE_TYPES);
    const title = generateTitle(index);

    const noteBuilder = note(title, {
        noteId: id(),
        type: noteType.type,
        mime: noteType.mime,
    });

    // Set content
    const content = generateContent(noteType.type, noteType.mime);
    if (content) {
        noteBuilder.note.setContent(content, { forceSave: true });
    }

    // Add labels
    generateLabels(noteBuilder, randomInt(0, config.maxLabels));

    // Add relations (limit based on available notes)
    const maxPossibleRelations = Math.min(
        config.maxRelations,
        Math.floor(allNotes.length / 10) // Limit to avoid too dense graphs
    );
    generateRelations(noteBuilder, allNotes, maxPossibleRelations);

    // 5% chance of protected note
    if (Math.random() < 0.05) {
        noteBuilder.note.isProtected = true;
    }

    // 10% chance of archived note
    if (Math.random() < 0.1) {
        noteBuilder.label("archived", "", true);
    }

    return noteBuilder;
}

/**
 * Create notes recursively to build hierarchy
 */
function createNotesRecursively(
    parent: NoteBuilder,
    depth: number,
    targetCount: number,
    allNotes: BNote[]
): number {
    let created = 0;

    if (depth >= config.maxDepth || targetCount <= 0) {
        return 0;
    }

    // Determine how many children at this level
    // Decrease children count as depth increases to create pyramid structure
    const maxChildrenAtDepth = Math.max(1, Math.floor(20 / (depth + 1)));
    const childrenCount = Math.min(
        targetCount,
        randomInt(1, maxChildrenAtDepth)
    );

    for (let i = 0; i < childrenCount && created < targetCount; i++) {
        const noteBuilder = createRandomNote(allNotes.length + 1, allNotes);
        parent.child(noteBuilder);
        allNotes.push(noteBuilder.note);
        created++;

        // Log progress every 100 notes
        if (allNotes.length % 100 === 0) {
            console.log(`  Created ${allNotes.length} notes...`);
        }

        // Recursively create children
        const remainingForSubtree = Math.floor((targetCount - created) / (childrenCount - i));
        const createdInSubtree = createNotesRecursively(
            noteBuilder,
            depth + 1,
            remainingForSubtree,
            allNotes
        );
        created += createdInSubtree;
    }

    return created;
}

/**
 * Main execution
 */
async function main() {
    console.log("Initializing translations...");
    await initializeTranslations();

    console.log("Loading becca (backend cache)...");

    // Directly load becca instead of waiting for beccaLoaded promise
    // (beccaLoaded depends on dbReady which won't resolve in this script context)
    const becca_loader = (await import("../apps/server/src/becca/becca_loader.js")).default;
    const cls = (await import("../apps/server/src/services/cls.js")).default;

    // Load becca and run the population inside CLS context
    cls.init(() => {
        becca_loader.load();
        console.log("Becca loaded successfully.");

        populateNotes();
    });
}

function populateNotes() {
    const rootNote = becca.getNote("root");
    if (!rootNote) {
        throw new Error("Root note not found!");
    }

    // Create a container note for all stress test notes
    const containerNote = note("Stress Test Notes", {
        noteId: id(),
        type: "book",
        mime: "text/html",
    });
    containerNote.note.setContent(
        `<p>This note contains ${config.noteCount} notes generated for stress testing.</p>` +
        `<p>Generated on: ${new Date().toISOString()}</p>` +
        `<p>Configuration: depth=${config.maxDepth}, maxRelations=${config.maxRelations}, maxLabels=${config.maxLabels}</p>`,
        { forceSave: true }
    );

    const rootBuilder = new NoteBuilder(rootNote);
    rootBuilder.child(containerNote);

    console.log("\nCreating notes...");
    const startTime = Date.now();

    const allNotes: BNote[] = [containerNote.note];

    // Create notes recursively
    const created = createNotesRecursively(
        containerNote,
        0,
        config.noteCount - 1, // -1 because we already created container
        allNotes
    );

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log("\n================================");
    console.log("Stress Test Population Complete!");
    console.log("================================");
    console.log(`Total notes created: ${allNotes.length}`);
    console.log(`Time taken: ${duration.toFixed(2)} seconds`);
    console.log(`Notes per second: ${(allNotes.length / duration).toFixed(2)}`);
    console.log(`Container note ID: ${containerNote.note.noteId}`);
    console.log("");

    // Print statistics
    const noteTypeCount: Record<string, number> = {};
    const labelCount: Record<string, number> = {};
    let totalRelations = 0;
    let protectedCount = 0;
    let archivedCount = 0;

    for (const note of allNotes) {
        // Count note types
        noteTypeCount[note.type] = (noteTypeCount[note.type] || 0) + 1;

        // Count labels
        for (const attr of note.getOwnedAttributes()) {
            if (attr.type === "label") {
                labelCount[attr.name] = (labelCount[attr.name] || 0) + 1;
                if (attr.name === "archived") archivedCount++;
            } else if (attr.type === "relation") {
                totalRelations++;
            }
        }

        if (note.isProtected) protectedCount++;
    }

    console.log("Note Type Distribution:");
    for (const [type, count] of Object.entries(noteTypeCount).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type}: ${count}`);
    }

    console.log("\nTop 10 Label Names:");
    const sortedLabels = Object.entries(labelCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    for (const [name, count] of sortedLabels) {
        console.log(`  ${name}: ${count}`);
    }

    console.log("\nOther Statistics:");
    console.log(`  Total relations: ${totalRelations}`);
    console.log(`  Protected notes: ${protectedCount}`);
    console.log(`  Archived notes: ${archivedCount}`);
    console.log("");
    console.log("You can find all generated notes under the 'Stress Test Notes' note in the tree.");
}

// Run the script
main().catch((error) => {
    console.error("Error during stress test population:");
    console.error(error);
    process.exit(1);
});
