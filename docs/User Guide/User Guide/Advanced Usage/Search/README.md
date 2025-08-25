# README
## Trilium Search Documentation

Welcome to the comprehensive guide for Trilium's powerful search capabilities. This documentation covers everything from basic text searches to advanced query expressions and performance optimization.

## Quick Start

New to Trilium search? Start here:

*   **[Search Fundamentals](Search-Fundamentals.md)** - Basic concepts, syntax, and operators

## Documentation Sections

### Core Search Features

*   **[Search Fundamentals](Search-Fundamentals.md)** - Basic search syntax, operators, and concepts
*   **[Advanced Search Expressions](Advanced-Search-Expressions.md)** - Complex queries, boolean logic, and relationship traversal

### Practical Applications

*   **[Search Examples and Use Cases](Search-Examples-and-Use-Cases.md)** - Real-world examples for common workflows
*   **[Saved Searches](Saved-Searches.md)** - Creating dynamic collections and dashboards

### Technical Reference

*   **[Technical Search Details](Technical-Search-Details.md)** - Performance, implementation, and optimization

## Key Search Capabilities

### Full-Text Search

*   Search note titles and content
*   Exact phrase matching with quotes
*   Case-insensitive with diacritic normalization
*   Support for multiple note types (text, code, mermaid, canvas)

### Attribute-Based Search

*   Label searches: `#tag`, `#category=book`
*   Relation searches: `~author`, `~author.title=Tolkien`
*   Complex attribute combinations
*   Fuzzy attribute matching

### Property Search

*   Note metadata: `note.type=text`, `note.dateCreated >= TODAY-7`
*   Hierarchical queries: `note.parents.title=Books`
*   Relationship traversal: `note.children.labels.status=active`

### Advanced Features

*   **Progressive Search**: Exact matching first, fuzzy fallback when needed
*   **Fuzzy Search**: Typo tolerance and spelling variations
*   **Boolean Logic**: Complex AND/OR/NOT combinations
*   **Date Arithmetic**: Dynamic date calculations (TODAY-30, YEAR+1)
*   **Regular Expressions**: Pattern matching with `%=` operator
*   **Ordering and Limiting**: Custom sort orders and result limits

## Search Operators Quick Reference

### Text Operators

*   `=` - Exact match
*   `!=` - Not equal
*   `*=*` - Contains
*   `=*` - Starts with
*   `*=` - Ends with
*   `%=` - Regular expression
*   `~=` - Fuzzy exact match
*   `~*` - Fuzzy contains match

### Numeric Operators

*   `=`, `!=`, `>`, `>=`, `<`, `<=`

### Boolean Operators

*   `AND`, `OR`, `NOT`

### Special Syntax

*   `#labelName` - Label exists
*   `#labelName=value` - Label equals value
*   `~relationName` - Relation exists
*   `~relationName.property` - Relation target property
*   `note.property` - Note property access
*   `"exact phrase"` - Quoted phrase search

## Common Search Patterns

### Simple Searches

```
hello world          # Find notes containing both words
"project management" # Find exact phrase
#task               # Find notes with "task" label
~author             # Find notes with "author" relation
```

### Attribute Searches

```
#book #author=Tolkien           # Books by Tolkien
#task #priority=high #status!=completed  # High-priority incomplete tasks
~project.title *=* alpha        # Notes related to projects with "alpha" in title
```

### Date-Based Searches

```
note.dateCreated >= TODAY-7     # Notes created in last week
#dueDate <= TODAY+30            # Items due in next 30 days
#eventDate = YEAR               # Events scheduled for this year
```

### Complex Queries

```
(#book OR #article) AND #topic=programming AND note.dateModified >= MONTH
#project AND (#status=active OR #status=pending) AND not(note.isArchived=true)
```

## Getting Started Checklist

1.  **Learn Basic Syntax** - Start with simple text and tag searches
2.  **Understand Operators** - Master the core operators (`=`, `*=*`, etc.)
3.  **Practice Attributes** - Use `#` for labels and `~` for relations
4.  **Try Boolean Logic** - Combine searches with AND/OR/NOT
5.  **Explore Properties** - Use `note.` prefix for metadata searches
6.  **Create Saved Searches** - Turn useful queries into dynamic collections
7.  **Optimize Performance** - Learn about fast search and limits

## Performance Tips

*   **Use Fast Search** for attribute-only queries
*   **Set Reasonable Limits** to prevent large result sets
*   **Start Specific** with the most selective criteria first
*   **Leverage Attributes** instead of content search when possible
*   **Cache Common Queries** as saved searches

## Need Help?

*   **Examples**: Check [Search Examples and Use Cases](Search-Examples-and-Use-Cases.md) for practical patterns
*   **Complex Queries**: See [Advanced Search Expressions](Advanced-Search-Expressions.md) for sophisticated techniques
*   **Performance Issues**: Review [Technical Search Details](Technical-Search-Details.md) for optimization
*   **Dynamic Collections**: Learn about [Saved Searches](Saved-Searches.md) for automated organization

## Search Workflow Integration

Trilium's search integrates seamlessly with your note-taking workflow:

*   **Quick Search** (Ctrl+S) for instant access
*   **Saved Searches** for dynamic organization
*   **Search from Subtree** for focused queries
*   **Auto-complete** suggestions in search dialogs
*   **URL-triggered searches** for bookmarkable queries

Start with the fundamentals and gradually explore advanced features as your needs grow. Trilium's search system is designed to scale from simple text queries to sophisticated knowledge management systems.

Happy searching! 🔍