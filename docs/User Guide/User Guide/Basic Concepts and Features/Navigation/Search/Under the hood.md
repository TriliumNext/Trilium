# Under the hood
## Progressive Search Strategy

Trilium uses a progressive search strategy that performs exact matching first, then adds fuzzy matching when needed.

The search has three phases:

1.  **Phase 1 - Exact Matching**: When you search, Trilium first looks for exact matches of your search terms. This handles the vast majority of searches (90%+) and returns results almost instantly.
2.  **Phase 2 - Fuzzy Fallback**: If Phase 1 doesn't find enough high-quality results (fewer than 5 results with good relevance scores), Trilium automatically adds fuzzy matching to find results with typos or spelling variations.
3.  **Result Ordering**: Exact matches always appear before fuzzy matches, regardless of individual scores. This ensures that when you search for "project", notes containing the exact word "project" will appear before notes containing similar words like "projects" or "projection".

### Progressive Search Behavior

*   **Speed**: Most searches complete using only exact matching
*   **Ordering**: Exact matches appear before fuzzy matches
*   **Fallback**: Fuzzy matching activates when exact matches return fewer than 5 results
*   **Identification**: Results indicate whether they are exact or fuzzy matches

## Search Performance

Search system specifications:

*   Content size limit: 10MB per note (previously 50KB)
*   Edit distance calculations for fuzzy matching
*   Infinite scrolling in Quick Search

## Label and Relation Shortcuts

The "full" syntax for searching by labels is:

```
note.labels.publicationYear = 1954
```

For relations:

```
note.relations.author.title *=* Tolkien
```

However, common label and relation searches have shortcut syntax:

```
#publicationYear = 1954
~author.title *=* Tolkien
```

## Separating Full-Text and Attribute Parts

Search syntax allows combining full-text search with attribute-based search. For example, `tolkien #book` contains:

1.  Full-text tokens - `tolkien`
2.  Attribute expressions - `#book`

Trilium detects the separation between full text search and attribute/property search by looking for certain special characters or words that denote attributes and properties (e.g., #, ~, note.). If you need to include these in full-text search, escape them with a backslash so they are processed as regular text:

```
"note.txt" 
\#hash 
#myLabel = 'Say "Hello World"'
```

## Escaping Special Characters

Special characters can be enclosed in quotes or escaped with a backslash to be used in full-text search:

```
"note.txt"
\#hash
#myLabel = 'Say "Hello World"'
```

Three types of quotes are supported: single, double, and backtick.

## Type Coercion

Label values are technically strings but can be coerced for numeric comparisons:

```
note.dateCreated =* '2019-05'
```

This finds notes created in May 2019. Numeric operators like `#publicationYear >= 1960` convert string values to numbers for comparison.