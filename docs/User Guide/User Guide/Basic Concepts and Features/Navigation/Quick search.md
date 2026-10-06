# Quick search
<figure class="image image-style-align-center"><img style="aspect-ratio:659/256;" src="Quick search_image.png" width="659" height="256"></figure>

The _Quick search_ function does a full-text search (that is, it searches through the content of notes and not just the title of a note) and displays the result in an easy-to-access manner.

The alternative to the quick search is the <a class="reference-link" href="Search.md">Search</a> function, which opens in a dedicated tab and has support for advanced queries.

For even faster navigation, it's possible to use <a class="reference-link" href="Jump%20to%20%26%20command%20palette.md">Jump to &amp; command palette</a> which will only search through the note titles instead of the content.

## Layout

Based on the <a class="reference-link" href="../UI%20Elements/Vertical%20and%20horizontal%20layout.md">Vertical and horizontal layout</a>, the quick search is placed:

*   On the vertical layout, it is displayed right above the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>.
*   On the horizontal layout, it is displayed in the <a class="reference-link" href="../UI%20Elements/Launch%20Bar.md">Launch Bar</a>, where it can be positioned just like any other icon.

## Search Features

Quick search includes the following features:

### Content Previews

Search results now display a 200-character preview of the note content below the note title. This preview shows the context where your search terms appear, making it easier to identify the right note without opening it.

### All results in one list

Quick search lists up to 200 matching notes in a single scrollable list, so the scrollbar shows how many results there are and how far through them you are.

### Continuing in the full search

To refine a query with the options of the full <a class="reference-link" href="Search.md">Search</a>, click _Show in full search_ below the results, or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> in the search field. The full search opens in a new tab with the same query. The button stays below the list, however far the results are scrolled.

### Visual Features

*   **Highlighting**: Search terms appear in bold with accent colors
*   **Separation**: Results are separated with dividers
*   **Theme Support**: Highlighting colors adapt to light/dark themes

### Search Behavior

Quick search uses progressive search:

1.  Shows exact matches first
2.  Includes fuzzy matches when exact results are fewer than 5
3.  Exact matches appear before fuzzy matches

### Search Scope

Quick search covers only the subtree you are currently working in:

*   Without hoisting, it covers the whole note tree.
*   Under a [hoisted note](Note%20Hoisting.md) or inside a [workspace](Workspaces.md), it covers only that subtree.
*   Notes that exist only in the hidden tree, such as the built-in help pages and the launch bar configuration, are not returned. Hoist into the help to search it, or use [Jump to…](Jump%20to%20%26%20command%20palette.md), which searches titles across the hidden tree.

To search the whole database while hoisted, use the full <a class="reference-link" href="Search.md">Search</a> and leave _Ancestor_ field empty.

### Keyboard Navigation

*   Press <kbd>Enter</kbd> in the search field to search, or to refresh the results already shown.
*   Press <kbd>Down</kbd> in the search field to move to the first result, then <kbd>Up</kbd> and <kbd>Down</kbd> to move between results. <kbd>Up</kbd> on the first result returns to the search field.
*   Press <kbd>Page Down</kbd> and <kbd>Page Up</kbd> to move through the results a page at a time.
*   Press <kbd>Enter</kbd> on a result to open it.
*   Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to open the query in the full search.
*   Press <kbd>Escape</kbd> to close the results.

To see these shortcuts on screen, click the <kbd>?</kbd> button below the results, or press <kbd>Alt</kbd>+<kbd>F1</kbd> while the search field is focused.

## Using Quick Search

1.  **Typo tolerance**: Search finds results despite minor typos
2.  **Content previews**: 200-character snippets show match context
3.  **Specific terms**: Specific search terms return more focused results
4.  **Match locations**: Bold text indicates where matches occur

## Quick Search - Exact Match Operator

Quick Search shares the same search engine as the full <a class="reference-link" href="Search.md">Search</a>, so the exact match operator (`=`) behaves identically in both. Start your query with `=` (no space after it) to switch from the default "contains" behavior to exact whole-word or phrase matching.

**What** `**=**` **actually does:** it finds notes where the title or content contains your term as a **whole word or phrase**, ignoring surrounding punctuation. It does **not** require the whole note to equal your term, and it does **not** do substring or fuzzy matching.

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