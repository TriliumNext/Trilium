# Quick search
<figure class="image image-style-align-center"><img style="aspect-ratio:659/256;" src="Quick search_image.png" width="659" height="256"></figure>

The _Quick search_ function does a full-text search (that is, it searches through the content of notes and not just the title of a note) and displays the result in an easy-to-access manner.

The alternative to the quick search is the <a class="reference-link" href="Search.md">Search</a> function, which opens in a dedicated tab and has support for advanced queries.

For even faster navigation, it's possible to use <a class="reference-link" href="Jump%20to.md">Jump to...</a> which will only search through the note titles instead of the content.

## Layout

Based on the <a class="reference-link" href="../UI%20Elements/Vertical%20and%20horizontal%20layout.md">Vertical and horizontal layout</a>, the quick search is placed:

*   On the vertical layout, it is displayed right above the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>.
*   On the horizontal layout, it is displayed in the <a class="reference-link" href="../UI%20Elements/Launch%20Bar.md">Launch Bar</a>, where it can be positioned just like any other icon.

## Search Features

Quick search includes the following features:

### Content Previews

Search results now display a 200-character preview of the note content below the note title. This preview shows the context where your search terms appear, making it easier to identify the right note without opening it.

### Infinite Scrolling

Results are loaded progressively as you scroll:

*   Initial display shows 15 results
*   Scrolling near the bottom automatically loads 10 more results
*   Continue scrolling to load all matching notes

### Visual Features

*   **Highlighting**: Search terms appear in bold with accent colors
*   **Separation**: Results are separated with dividers
*   **Theme Support**: Highlighting colors adapt to light/dark themes

### Search Behavior

Quick search uses progressive search:

1.  Shows exact matches first
2.  Includes fuzzy matches when exact results are fewer than 5
3.  Exact matches appear before fuzzy matches

### Keyboard Navigation

*   Press `Enter` to open the first result
*   Use arrow keys to navigate through results
*   Press `Escape` to close the quick search

## Using Quick Search

1.  **Typo tolerance**: Search finds results despite minor typos
2.  **Content previews**: 200-character snippets show match context
3.  **Infinite scrolling**: Additional results load on scroll
4.  **Specific terms**: Specific search terms return more focused results
5.  **Match locations**: Bold text indicates where matches occur

## Quick Search - Exact Match Operator

Quick Search now supports the exact match operator (`=`) at the beginning of your search query. This allows you to search for notes where the title or content exactly matches your search term, rather than just containing it.

### Usage

To use exact match in Quick Search:

1.  Start your search query with the `=` operator
2.  Follow it immediately with your search term (no space after `=`)

#### Examples

*   `=example` - Finds notes with title exactly "example" or content exactly "example"
*   `=Project Plan` - Finds notes with title exactly "Project Plan" or content exactly "Project Plan"
*   `='hello world'` - Use quotes for multi-word exact matches

#### Comparison with Regular Search

| Query | Behavior |
| --- | --- |
| `example` | Finds all notes containing "example" anywhere in title or content |
| `=example` | Finds only notes where the title equals "example" or content equals "example" exactly |

### Technical Details

When you use the `=` operator:

*   The search performs an exact match on note titles
*   For note content, it looks for exact matches of the entire content
*   Partial word matches are excluded
*   The search is case-insensitive

### Limitations

*   The `=` operator must be at the very beginning of the search query
*   Spaces after `=` will treat it as a regular search
*   Multiple `=` operators (like `==example`) are treated as regular text search

### Use Cases

This feature is particularly useful when:

*   You know the exact title of a note
*   You want to find notes with specific, complete content
*   You need to distinguish between notes with similar but not identical titles
*   You want to avoid false positives from partial matches

### Related Features

*   For more complex exact matching queries, use the full [Search](Search.md) functionality
*   For fuzzy matching (finding results despite typos), use the `~=` operator in the full search
*   For partial matches with wildcards, use operators like `*=*`, `=*`, or `*=` in the full search