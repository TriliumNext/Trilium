# Search-Fundamentals
## Search Fundamentals

Trilium's search system is a powerful tool for finding and organizing notes. It supports multiple search modes, from simple text queries to complex expressions using attributes, relationships, and note properties.

## Search Types Overview

Trilium provides three main search approaches:

1.  **Full-text Search** - Searches within note titles and content
2.  **Attribute Search** - Searches based on labels and relations attached to notes
3.  **Property Search** - Searches based on note metadata (type, creation date, etc.)

These can be combined in powerful ways to create precise queries.

## Basic Search Syntax

### Simple Text Search

```
hello world
```

Finds notes containing both "hello" and "world" anywhere in the title or content.

### Quoted Text Search

```
"hello world"
```

Finds notes containing the exact phrase "hello world".

### Attribute Search

```
#tag
```

Finds notes with the label "tag".

```
#category=book
```

Finds notes with label "category" set to "book".

### Relation Search

```
~author
```

Finds notes with a relation named "author".

```
~author.title=Tolkien
```

Finds notes with an "author" relation pointing to a note titled "Tolkien".

## Search Operators

### Text Operators

*   `=` - Exact match
*   `!=` - Not equal
*   `*=*` - Contains (substring)
*   `=*` - Starts with
*   `*=` - Ends with
*   `%=` - Regular expression match
*   `~=` - Fuzzy exact match
*   `~*` - Fuzzy contains match

### Numeric Operators

*   `=` - Equal
*   `!=` - Not equal
*   `>` - Greater than
*   `>=` - Greater than or equal
*   `<` - Less than
*   `<=` - Less than or equal

### Boolean Operators

*   `AND` - Both conditions must be true
*   `OR` - Either condition must be true
*   `NOT` or `not()` - Condition must be false

## Search Context and Scope

### Search Scope

By default, search covers:

*   Note titles
*   Note content (for text-based note types)
*   Label names and values
*   Relation names
*   Note properties

### Fast Search Mode

When enabled, fast search:

*   Searches only titles and attributes
*   Skips note content
*   Provides faster results for large databases

### Archived Notes

*   Excluded by default
*   Can be included with "Include archived" option

## Case Sensitivity and Normalization

*   All searches are case-insensitive
*   Diacritics are normalized ("café" matches "cafe")
*   Unicode characters are properly handled

## Performance Considerations

### Content Size Limits

*   Note content is limited to 10MB for search processing
*   Larger notes are still searchable by title and attributes

### Progressive Search Strategy

1.  **Exact Search Phase**: Fast exact matching (handles 90%+ of searches)
2.  **Fuzzy Search Phase**: Activated when exact search returns fewer than 5 high-quality results
3.  **Result Ordering**: Exact matches always appear before fuzzy matches

### Search Optimization Tips

*   Use specific terms rather than very common words
*   Combine full-text with attribute searches for precision
*   Use fast search for large databases when content search isn't needed
*   Limit results when dealing with very large result sets

## Special Characters and Escaping

### Reserved Characters

These characters have special meaning in search queries:

*   `#` - Label indicator
*   `~` - Relation indicator
*   `()` - Grouping
*   `"` `'` `` ` `` - Quotes for exact phrases

### Escaping Special Characters

Use backslash to search for literal special characters:

```
\#hashtag
```

Searches for the literal text "#hashtag" instead of a label.

Use quotes to include special characters in phrases:

```
"note.txt file"
```

Searches for the exact phrase including the dot.

## Date and Time Values

### Special Date Keywords

*   `TODAY` - Current date
*   `NOW` - Current date and time
*   `MONTH` - Current month
*   `YEAR` - Current year

### Date Arithmetic

```
#dateCreated >= TODAY-30
```

Finds notes created in the last 30 days.

```
#eventDate = YEAR+1
```

Finds notes with eventDate set to next year.

## Search Results and Scoring

### Result Ranking

Results are ordered by:

1.  Relevance score (based on term frequency and position)
2.  Note depth (closer to root ranks higher)
3.  Alphabetical order for ties

### Progressive Search Behavior

*   Exact matches always rank before fuzzy matches
*   High-quality exact matches prevent fuzzy search activation
*   Fuzzy matches help find content with typos or variations

## Next Steps

*   [Advanced Search Expressions](Advanced-Search-Expressions.md) - Complex queries and combinations
*   [Search Examples and Use Cases](Search-Examples-and-Use-Cases.md) - Practical applications
*   [Saved Searches](Saved-Searches.md) - Creating dynamic collections
*   [Technical Search Details](Technical-Search-Details.md) - Under-the-hood implementation