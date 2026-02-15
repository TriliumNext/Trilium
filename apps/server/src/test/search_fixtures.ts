/**
 * Reusable test fixtures for search functionality
 *
 * This module provides predefined datasets for common search testing scenarios.
 * Each fixture is a function that sets up a specific test scenario and returns
 * references to the created notes for easy access in tests.
 */

import BNote from "../becca/entities/bnote.js";
import { NoteBuilder } from "./becca_mocking.js";
import {
    searchNote,
    bookNote,
    personNote,
    countryNote,
    contentNote,
    codeNote,
    protectedNote,
    archivedNote,
    SearchTestNoteBuilder,
    createHierarchy
} from "./search_test_helpers.js";

/**
 * Fixture: Basic European geography with countries and capitals
 */
export function createEuropeGeographyFixture(root: NoteBuilder): {
    europe: SearchTestNoteBuilder;
    austria: SearchTestNoteBuilder;
    czechRepublic: SearchTestNoteBuilder;
    hungary: SearchTestNoteBuilder;
    vienna: SearchTestNoteBuilder;
    prague: SearchTestNoteBuilder;
    budapest: SearchTestNoteBuilder;
} {
    const europe = searchNote("Europe");

    const austria = countryNote("Austria", {
        capital: "Vienna",
        population: 8859000,
        continent: "Europe",
        languageFamily: "germanic",
        established: "1955-07-27"
    });

    const czechRepublic = countryNote("Czech Republic", {
        capital: "Prague",
        population: 10650000,
        continent: "Europe",
        languageFamily: "slavic",
        established: "1993-01-01"
    });

    const hungary = countryNote("Hungary", {
        capital: "Budapest",
        population: 9775000,
        continent: "Europe",
        languageFamily: "finnougric",
        established: "1920-06-04"
    });

    const vienna = searchNote("Vienna").label("city", "", true).label("population", "1888776");
    const prague = searchNote("Prague").label("city", "", true).label("population", "1309000");
    const budapest = searchNote("Budapest").label("city", "", true).label("population", "1752000");

    root.child(europe.children(austria, czechRepublic, hungary));
    austria.child(vienna);
    czechRepublic.child(prague);
    hungary.child(budapest);

    return { europe, austria, czechRepublic, hungary, vienna, prague, budapest };
}

/**
 * Fixture: Library with books and authors
 */
export function createLibraryFixture(root: NoteBuilder): {
    library: SearchTestNoteBuilder;
    tolkien: SearchTestNoteBuilder;
    lotr: SearchTestNoteBuilder;
    hobbit: SearchTestNoteBuilder;
    silmarillion: SearchTestNoteBuilder;
    christopherTolkien: SearchTestNoteBuilder;
    rowling: SearchTestNoteBuilder;
    harryPotter1: SearchTestNoteBuilder;
} {
    const library = searchNote("Library");

    const tolkien = personNote("J. R. R. Tolkien", {
        birthYear: 1892,
        country: "England",
        profession: "author"
    });

    const christopherTolkien = personNote("Christopher Tolkien", {
        birthYear: 1924,
        country: "England",
        profession: "editor"
    });

    tolkien.relation("son", christopherTolkien.note);

    const lotr = bookNote("The Lord of the Rings", {
        author: tolkien.note,
        publicationYear: 1954,
        genre: "fantasy",
        publisher: "Allen & Unwin"
    });

    const hobbit = bookNote("The Hobbit", {
        author: tolkien.note,
        publicationYear: 1937,
        genre: "fantasy",
        publisher: "Allen & Unwin"
    });

    const silmarillion = bookNote("The Silmarillion", {
        author: tolkien.note,
        publicationYear: 1977,
        genre: "fantasy",
        publisher: "Allen & Unwin"
    });

    const rowling = personNote("J. K. Rowling", {
        birthYear: 1965,
        country: "England",
        profession: "author"
    });

    const harryPotter1 = bookNote("Harry Potter and the Philosopher's Stone", {
        author: rowling.note,
        publicationYear: 1997,
        genre: "fantasy",
        publisher: "Bloomsbury"
    });

    root.child(library.children(lotr, hobbit, silmarillion, harryPotter1, tolkien, christopherTolkien, rowling));

    return { library, tolkien, lotr, hobbit, silmarillion, christopherTolkien, rowling, harryPotter1 };
}

/**
 * Fixture: Tech notes with code samples
 */
export function createTechNotesFixture(root: NoteBuilder): {
    tech: SearchTestNoteBuilder;
    javascript: SearchTestNoteBuilder;
    python: SearchTestNoteBuilder;
    kubernetes: SearchTestNoteBuilder;
    docker: SearchTestNoteBuilder;
} {
    const tech = searchNote("Tech Documentation");

    const javascript = codeNote(
        "JavaScript Basics",
        `function hello() {
    console.log("Hello, world!");
}`,
        "text/javascript"
    ).label("language", "javascript").label("level", "beginner");

    const python = codeNote(
        "Python Tutorial",
        `def hello():
    print("Hello, world!")`,
        "text/x-python"
    ).label("language", "python").label("level", "beginner");

    const kubernetes = contentNote(
        "Kubernetes Guide",
        `Kubernetes is a container orchestration platform.
Key concepts:
- Pods
- Services
- Deployments
- ConfigMaps`
    ).label("technology", "kubernetes").label("category", "devops");

    const docker = contentNote(
        "Docker Basics",
        `Docker containers provide isolated environments.
Common commands:
- docker run
- docker build
- docker ps
- docker stop`
    ).label("technology", "docker").label("category", "devops");

    root.child(tech.children(javascript, python, kubernetes, docker));

    return { tech, javascript, python, kubernetes, docker };
}

/**
 * Fixture: Notes with various content for full-text search testing
 */
export function createFullTextSearchFixture(root: NoteBuilder): {
    articles: SearchTestNoteBuilder;
    longForm: SearchTestNoteBuilder;
    shortNote: SearchTestNoteBuilder;
    codeSnippet: SearchTestNoteBuilder;
    mixed: SearchTestNoteBuilder;
} {
    const articles = searchNote("Articles");

    const longForm = contentNote(
        "Deep Dive into Search Algorithms",
        `Search algorithms are fundamental to computer science.

Binary search is one of the most efficient algorithms for finding an element in a sorted array.
It works by repeatedly dividing the search interval in half. If the value of the search key is
less than the item in the middle of the interval, narrow the interval to the lower half.
Otherwise narrow it to the upper half. The algorithm continues until the value is found or
the interval is empty.

Linear search, on the other hand, checks each element sequentially until the desired element
is found or all elements have been searched. While simple, it is less efficient for large datasets.

More advanced search techniques include:
- Depth-first search (DFS)
- Breadth-first search (BFS)
- A* search algorithm
- Binary tree search

Each has its own use cases and performance characteristics.`
    );

    const shortNote = contentNote(
        "Quick Note",
        "Remember to implement search functionality in the new feature."
    );

    const codeSnippet = codeNote(
        "Binary Search Implementation",
        `function binarySearch(arr, target) {
    let left = 0;
    let right = arr.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);

        if (arr[mid] === target) {
            return mid;
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return -1;
}`,
        "text/javascript"
    );

    const mixed = contentNote(
        "Mixed Content Note",
        `This note contains various elements:

1. Code: <code>const result = search(data);</code>
2. Links: [Search Documentation](https://example.com)
3. Lists and formatting
4. Multiple paragraphs with the word search appearing multiple times

Search is important. We search for many things. The search function is powerful.`
    );

    root.child(articles.children(longForm, shortNote, codeSnippet, mixed));

    return { articles, longForm, shortNote, codeSnippet, mixed };
}

/**
 * Fixture: Protected and archived notes
 */
export function createProtectedArchivedFixture(root: NoteBuilder): {
    sensitive: SearchTestNoteBuilder;
    protectedNote1: SearchTestNoteBuilder;
    protectedNote2: SearchTestNoteBuilder;
    archive: SearchTestNoteBuilder;
    archivedNote1: SearchTestNoteBuilder;
    archivedNote2: SearchTestNoteBuilder;
} {
    const sensitive = searchNote("Sensitive Information");

    const protectedNote1 = protectedNote("Secret Document", "This contains confidential information about the project.");
    const protectedNote2 = protectedNote("Password List", "admin:secret123\nuser:pass456");

    sensitive.children(protectedNote1, protectedNote2);

    const archive = searchNote("Archive");
    const archivedNote1 = archivedNote("Old Project Notes");
    const archivedNote2 = archivedNote("Deprecated Features");

    archive.children(archivedNote1, archivedNote2);

    root.child(sensitive);
    root.child(archive);

    return { sensitive, protectedNote1, protectedNote2, archive, archivedNote1, archivedNote2 };
}

/**
 * Fixture: Relation chains for multi-hop testing
 */
export function createRelationChainFixture(root: NoteBuilder): {
    countries: SearchTestNoteBuilder;
    usa: SearchTestNoteBuilder;
    uk: SearchTestNoteBuilder;
    france: SearchTestNoteBuilder;
    washington: SearchTestNoteBuilder;
    london: SearchTestNoteBuilder;
    paris: SearchTestNoteBuilder;
} {
    const countries = searchNote("Countries");

    const usa = countryNote("United States", { capital: "Washington D.C." });
    const uk = countryNote("United Kingdom", { capital: "London" });
    const france = countryNote("France", { capital: "Paris" });

    const washington = searchNote("Washington D.C.").label("city", "", true);
    const london = searchNote("London").label("city", "", true);
    const paris = searchNote("Paris").label("city", "", true);

    // Create relation chains
    usa.relation("capital", washington.note);
    uk.relation("capital", london.note);
    france.relation("capital", paris.note);

    // Add ally relations
    usa.relation("ally", uk.note);
    uk.relation("ally", france.note);
    france.relation("ally", usa.note);

    root.child(countries.children(usa, uk, france, washington, london, paris));

    return { countries, usa, uk, france, washington, london, paris };
}

/**
 * Fixture: Notes with special characters and edge cases
 */
export function createSpecialCharactersFixture(root: NoteBuilder): {
    special: SearchTestNoteBuilder;
    quotes: SearchTestNoteBuilder;
    symbols: SearchTestNoteBuilder;
    unicode: SearchTestNoteBuilder;
    emojis: SearchTestNoteBuilder;
} {
    const special = searchNote("Special Characters");

    const quotes = contentNote(
        "Quotes Test",
        `Single quotes: 'hello'
Double quotes: "world"
Backticks: \`code\`
Mixed: "He said 'hello' to me"`
    );

    const symbols = contentNote(
        "Symbols Test",
        `#hashtag @mention $price €currency ©copyright
Operators: < > <= >= != ===
Math: 2+2=4, 10%5=0
Special: note.txt, file_name.md, #!shebang`
    );

    const unicode = contentNote(
        "Unicode Test",
        `Chinese: 中文测试
Japanese: 日本語テスト
Korean: 한국어 테스트
Arabic: اختبار عربي
Greek: Ελληνική δοκιμή
Accents: café, naïve, résumé`
    );

    const emojis = contentNote(
        "Emojis Test",
        `Faces: 😀 😃 😄 😁 😆
Symbols: ❤️ 💯 ✅ ⭐ 🔥
Objects: 📱 💻 📧 🔍 📝
Animals: 🐶 🐱 🐭 🐹 🦊`
    );

    root.child(special.children(quotes, symbols, unicode, emojis));

    return { special, quotes, symbols, unicode, emojis };
}

/**
 * Fixture: Hierarchical structure for ancestor/descendant testing
 */
export function createDeepHierarchyFixture(root: NoteBuilder): {
    level0: SearchTestNoteBuilder;
    level1a: SearchTestNoteBuilder;
    level1b: SearchTestNoteBuilder;
    level2a: SearchTestNoteBuilder;
    level2b: SearchTestNoteBuilder;
    level3: SearchTestNoteBuilder;
} {
    const level0 = searchNote("Level 0 Root").label("depth", "0");

    const level1a = searchNote("Level 1 A").label("depth", "1");
    const level1b = searchNote("Level 1 B").label("depth", "1");

    const level2a = searchNote("Level 2 A").label("depth", "2");
    const level2b = searchNote("Level 2 B").label("depth", "2");

    const level3 = searchNote("Level 3 Leaf").label("depth", "3");

    root.child(level0);
    level0.children(level1a, level1b);
    level1a.child(level2a);
    level1b.child(level2b);
    level2a.child(level3);

    return { level0, level1a, level1b, level2a, level2b, level3 };
}

/**
 * Fixture: Numeric comparison testing
 */
export function createNumericComparisonFixture(root: NoteBuilder): {
    data: SearchTestNoteBuilder;
    low: SearchTestNoteBuilder;
    medium: SearchTestNoteBuilder;
    high: SearchTestNoteBuilder;
    negative: SearchTestNoteBuilder;
    decimal: SearchTestNoteBuilder;
} {
    const data = searchNote("Numeric Data");

    const low = searchNote("Low Value").labels({
        score: "10",
        rank: "100",
        value: "5.5"
    });

    const medium = searchNote("Medium Value").labels({
        score: "50",
        rank: "50",
        value: "25.75"
    });

    const high = searchNote("High Value").labels({
        score: "90",
        rank: "10",
        value: "99.99"
    });

    const negative = searchNote("Negative Value").labels({
        score: "-10",
        rank: "1000",
        value: "-5.5"
    });

    const decimal = searchNote("Decimal Value").labels({
        score: "33.33",
        rank: "66.67",
        value: "0.123"
    });

    root.child(data.children(low, medium, high, negative, decimal));

    return { data, low, medium, high, negative, decimal };
}

/**
 * Fixture: Date comparison testing
 * Uses fixed dates for deterministic testing
 */
export function createDateComparisonFixture(root: NoteBuilder): {
    events: SearchTestNoteBuilder;
    past: SearchTestNoteBuilder;
    recent: SearchTestNoteBuilder;
    today: SearchTestNoteBuilder;
    future: SearchTestNoteBuilder;
} {
    const events = searchNote("Events");

    // Use fixed dates for deterministic testing
    const past = searchNote("Past Event").labels({
        date: "2020-01-01",
        year: "2020",
        month: "2020-01"
    });

    // Recent event from a fixed date (7 days before a reference date)
    const recent = searchNote("Recent Event").labels({
        date: "2024-01-24", // Fixed date for deterministic testing
        year: "2024",
        month: "2024-01"
    });

    // "Today" as a fixed reference date for deterministic testing
    const today = searchNote("Today's Event").labels({
        date: "2024-01-31", // Fixed "today" reference
        year: "2024",
        month: "2024-01"
    });

    const future = searchNote("Future Event").labels({
        date: "2030-12-31",
        year: "2030",
        month: "2030-12"
    });

    root.child(events.children(past, recent, today, future));

    return { events, past, recent, today, future };
}

/**
 * Fixture: Notes with typos for fuzzy search testing
 */
export function createTypoFixture(root: NoteBuilder): {
    documents: SearchTestNoteBuilder;
    exactMatch1: SearchTestNoteBuilder;
    exactMatch2: SearchTestNoteBuilder;
    typo1: SearchTestNoteBuilder;
    typo2: SearchTestNoteBuilder;
    typo3: SearchTestNoteBuilder;
} {
    const documents = searchNote("Documents");

    const exactMatch1 = contentNote("Analysis Report", "This document contains analysis of the data.");
    const exactMatch2 = contentNote("Data Analysis", "Performing thorough analysis.");

    const typo1 = contentNote("Anaylsis Document", "This has a typo in the title.");
    const typo2 = contentNote("Statistical Anlaysis", "Another typo variation.");
    const typo3 = contentNote("Project Analisis", "Yet another spelling variant.");

    root.child(documents.children(exactMatch1, exactMatch2, typo1, typo2, typo3));

    return { documents, exactMatch1, exactMatch2, typo1, typo2, typo3 };
}

/**
 * Fixture: Large dataset for performance testing
 */
export function createPerformanceTestFixture(root: NoteBuilder, noteCount = 1000): {
    container: SearchTestNoteBuilder;
    allNotes: SearchTestNoteBuilder[];
} {
    const container = searchNote("Performance Test Container");
    const allNotes: SearchTestNoteBuilder[] = [];

    const categories = ["Tech", "Science", "History", "Art", "Literature", "Music", "Sports", "Travel"];
    const tags = ["important", "draft", "reviewed", "archived", "featured", "popular"];

    for (let i = 0; i < noteCount; i++) {
        const category = categories[i % categories.length];
        const tag = tags[i % tags.length];

        const note = searchNote(`${category} Note ${i}`)
            .label("category", category)
            .label("tag", tag)
            .label("index", i.toString())
            .content(`This is content for note number ${i} in category ${category}.`);

        if (i % 10 === 0) {
            note.label("milestone", "true");
        }

        container.child(note);
        allNotes.push(note);
    }

    root.child(container);

    return { container, allNotes };
}

/**
 * Fixture: Multiple parents (cloning) testing
 */
export function createMultipleParentsFixture(root: NoteBuilder): {
    folder1: SearchTestNoteBuilder;
    folder2: SearchTestNoteBuilder;
    sharedNote: SearchTestNoteBuilder;
} {
    const folder1 = searchNote("Folder 1");
    const folder2 = searchNote("Folder 2");
    const sharedNote = searchNote("Shared Note").label("shared", "true");

    // Add sharedNote as child of both folders
    folder1.child(sharedNote);
    folder2.child(sharedNote);

    root.child(folder1);
    root.child(folder2);

    return { folder1, folder2, sharedNote };
}

/**
 * Complete test environment with multiple fixtures
 */
export function createCompleteTestEnvironment(root: NoteBuilder) {
    return {
        geography: createEuropeGeographyFixture(root),
        library: createLibraryFixture(root),
        tech: createTechNotesFixture(root),
        fullText: createFullTextSearchFixture(root),
        protectedArchived: createProtectedArchivedFixture(root),
        relations: createRelationChainFixture(root),
        specialChars: createSpecialCharactersFixture(root),
        hierarchy: createDeepHierarchyFixture(root),
        numeric: createNumericComparisonFixture(root),
        dates: createDateComparisonFixture(root),
        typos: createTypoFixture(root)
    };
}
