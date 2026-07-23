# Quick search
<figure class="image image-style-align-center"><img style="aspect-ratio:659/256;" src="Quick search_image.png" width="659" height="256"></figure>

The _Quick search_ function does a full-text search (that is, it searches through the content of notes and not just the title of a note) and displays the result in an easy-to-access manner.

The alternative to the quick search is the <a class="reference-link" href="Search.md">Search</a> function, which opens in a dedicated tab and has support for advanced queries.

For even faster navigation, it's possible to use <a class="reference-link" href="Jump%20to%20%26%20command%20palette.md">Jump to...</a> which will only search through the note titles instead of the content.

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

Quick Search shares the same search engine as the full <a class="reference-link" href="Search.md">Search</a>, so the exact match operator (`=`) behaves identically in both. Start your query with `=` (no space after it) to switch from the default "contains" behavior to exact whole-word or phrase matching.

**What `=` actually does:** it finds notes where the title or content contains your term as a **whole word or phrase**, ignoring surrounding punctuation. It does **not** require the whole note to equal your term, and it does **not** do substring or fuzzy matching.

| Query | Example note content | Matches? | Why |
| --- | --- | --- | --- |
| `sync` | `synchronize the database now` | Yes | default search matches the substring |
| `=sync` | `see (sync) mode` | Yes | `=` matches the whole word `sync`, punctuation ignored |
| `=sync` | `synchronize the database now` | No | `=` never matches substrings |
| `="project plan"` | `the (project plan) is ready to share` | Yes | quote a multi-word phrase to match it exactly |

The search is case- and diacritic-insensitive. For the complete explanation of the three matching modes, fuzzy operators and relevance ranking, see [How search matches your text](Search.md) in the full Search documentation.

### Limitations

*   The `=` operator must be at the very beginning of the search query.
*   A space immediately after `=` is treated as a regular search.
*   Multiple `=` operators (like `==example`) are treated as regular text search.

### Related Features

*   For attribute, property, boolean and ordering queries, use the full [Search](Search.md) functionality.
*   For fuzzy matching (finding results despite typos), use the `~=` or `~*` operators in the full search.
*   For partial matches with wildcards, use operators like `*=*`, `=*`, or `*=` in the full search.