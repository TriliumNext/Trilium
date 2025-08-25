# Advanced-Search-Expressions
## Advanced Search Expressions

This guide covers complex search expressions that combine multiple criteria, use advanced operators, and leverage Trilium's relationship system for sophisticated queries.

## Complex Query Construction

### Boolean Logic with Parentheses

Use parentheses to group expressions and control evaluation order:

```
(#book OR #article) AND #author=Tolkien
```

Finds notes that are either books or articles, written by Tolkien.

```
#project AND (#status=active OR #status=pending)
```

Finds active or pending projects.

```
meeting AND (#priority=high OR #urgent) AND note.dateCreated >= TODAY-7
```

Finds recent high-priority or urgent meetings.

### Negation Patterns

Use `NOT` or the `not()` function to exclude certain criteria:

```
#book AND not(#genre=fiction)
```

Finds non-fiction books.

```
project AND not(note.isArchived=true)
```

Finds non-archived notes containing "project".

```
#!completed
```

Short syntax for notes without the "completed" label.

### Mixed Search Types

Combine full-text, attribute, and property searches:

```
development #category=work note.type=text note.dateModified >= TODAY-30
```

Finds text notes about development, categorized as work, modified in the last 30 days.

## Advanced Attribute Searches

### Fuzzy Attribute Matching

When fuzzy attribute search is enabled, you can use partial matches:

```
#lang
```

Matches labels like "language", "languages", "programming-lang", etc.

```
#category=prog
```

Matches categories like "programming", "progress", "program", etc.

### Multiple Attribute Conditions

```
#book #author=Tolkien #publicationYear>=1950 #publicationYear<1960
```

Finds Tolkien's books published in the 1950s.

```
#task #priority=high #status!=completed
```

Finds high-priority incomplete tasks.

### Complex Label Value Patterns

Use various operators for sophisticated label matching:

```
#isbn %= '978-[0-9-]+' 
```

Finds notes with ISBN labels matching the pattern (regex).

```
#email *=* @company.com
```

Finds notes with email labels containing "@company.com".

```
#version >= 2.0
```

Finds notes with version labels of 2.0 or higher (numeric comparison).

## Relationship Traversal

### Basic Relation Queries

```
~author.title *=* Tolkien
```

Finds notes with an "author" relation to notes containing "Tolkien" in the title.

```
~project.labels.status = active
```

Finds notes related to projects with active status.

### Multi-Level Relationships

```
~author.relations.publisher.title = "Penguin Books"
```

Finds notes authored by someone published by Penguin Books.

```
~project.children.title *=* documentation
```

Finds notes related to projects that have child notes about documentation.

### Relationship Direction

```
note.children.title = "Chapter 1"
```

Finds parent notes that have a child titled "Chapter 1".

```
note.parents.labels.category = book
```

Finds notes whose parents are categorized as books.

```
note.ancestors.title = "Literature"
```

Finds notes with "Literature" anywhere in their ancestor chain.

## Property-Based Searches

### Note Metadata Queries

```
note.type=code note.mime=text/javascript note.dateCreated >= MONTH
```

Finds JavaScript code notes created this month.

```
note.isProtected=true note.contentSize > 1000
```

Finds large protected notes.

```
note.childrenCount >= 10 note.type=text
```

Finds text notes with many children.

### Advanced Property Combinations

```
note.parentCount > 1 #template
```

Finds template notes that are cloned in multiple places.

```
note.attributeCount > 5 note.type=text note.contentSize < 500
```

Finds small text notes with many attributes (heavily tagged short notes).

```
note.revisionCount > 10 note.dateModified >= TODAY-7
```

Finds frequently edited notes modified recently.

## Date and Time Expressions

### Relative Date Calculations

```
#dueDate <= TODAY+7 #dueDate >= TODAY
```

Finds tasks due in the next week.

```
note.dateCreated >= MONTH-2 note.dateCreated < MONTH
```

Finds notes created in the past two months.

```
#eventDate = YEAR note.dateCreated >= YEAR-1
```

Finds events scheduled for this year that were planned last year.

### Complex Date Logic

```
(#startDate <= TODAY AND #endDate >= TODAY) OR #status=ongoing
```

Finds current events or ongoing items.

```
#reminderDate <= NOW+3600 #reminderDate > NOW
```

Finds reminders due in the next hour (using seconds offset).

## Fuzzy Search Techniques

### Fuzzy Exact Matching

```
#title ~= managment
```

Finds notes with titles like "management" even with typos.

```
~category.title ~= progaming
```

Finds notes related to categories like "programming" with misspellings.

### Fuzzy Contains Matching

```
note.content ~* algoritm
```

Finds notes containing words like "algorithm" with spelling variations.

```
#description ~* recieve
```

Finds notes with descriptions containing "receive" despite the common misspelling.

### Progressive Fuzzy Strategy

By default, Trilium uses exact matching first, then fuzzy as fallback:

```
development project
```

First finds exact matches for "development" and "project", then adds fuzzy matches if needed.

To force fuzzy behavior:

```
#title ~= development #category ~= projet
```

## Ordering and Limiting

### Multiple Sort Criteria

```
#book orderBy #publicationYear desc, note.title asc limit 20
```

Orders books by publication year (newest first), then by title alphabetically, limited to 20 results.

```
#task orderBy #priority desc, #dueDate asc
```

Orders tasks by priority (high first), then by due date (earliest first).

### Dynamic Ordering

```
#meeting note.dateCreated >= TODAY-30 orderBy note.dateModified desc
```

Finds recent meetings ordered by last modification.

```
#project #status=active orderBy note.childrenCount desc limit 10
```

Finds the 10 most complex active projects (by number of sub-notes).

## Performance Optimization Patterns

### Efficient Query Structure

Start with the most selective criteria:

```
#book #author=Tolkien note.dateCreated >= 1950-01-01
```

Better than:

```
note.dateCreated >= 1950-01-01 #book #author=Tolkien
```

### Fast Search for Large Datasets

```
#category=project #status=active
```

With fast search enabled, this searches only attributes, not content.

### Limiting Expensive Operations

```
note.content *=* "complex search term" limit 50
```

Limits content search to prevent performance issues.

## Error Handling and Debugging

### Syntax Validation

Invalid syntax produces helpful error messages:

```
#book AND OR #author=Tolkien
```

Error: "Mixed usage of AND/OR - always use parentheses to group AND/OR expressions."

### Debug Mode

Enable debug mode to see how queries are parsed:

```
#book #author=Tolkien
```

With debug enabled, shows the internal expression tree structure.

### Common Pitfalls

*   Unescaped special characters: Use quotes or backslashes
*   Missing parentheses in complex boolean expressions
*   Incorrect property names: Use `note.title` not `title`
*   Case sensitivity assumptions: All searches are case-insensitive

## Expression Shortcuts

### Label Shortcuts

Full syntax:

```
note.labels.category = book
```

Shortcut:

```
#category = book
```

### Relation Shortcuts

Full syntax:

```
note.relations.author.title *=* Tolkien
```

Shortcut:

```
~author.title *=* Tolkien
```

### Property Shortcuts

Some properties have convenient shortcuts:

```
note.text *=* content
```

Searches both title and content for "content".

## Real-World Complex Examples

### Project Management

```
(#project OR #task) AND #status!=completed AND 
(#priority=high OR #dueDate <= TODAY+7) AND 
not(note.isArchived=true) 
orderBy #priority desc, #dueDate asc
```

### Research Organization

```
(#paper OR #article OR #book) AND 
~author.title *=* smith AND 
#topic *=* "machine learning" AND 
note.dateCreated >= YEAR-2 
orderBy #citationCount desc limit 25
```

### Content Management

```
note.type=text AND note.contentSize > 5000 AND 
#category=documentation AND note.childrenCount >= 3 AND 
note.dateModified >= MONTH-1 
orderBy note.dateModified desc
```

### Knowledge Base Maintenance

```
note.attributeCount = 0 AND note.childrenCount = 0 AND 
note.parentCount = 1 AND note.contentSize < 100 AND 
note.dateModified < TODAY-90
```

Finds potential cleanup candidates: small, untagged, isolated notes not modified in 90 days.

## Next Steps

*   [Search Examples and Use Cases](Search-Examples-and-Use-Cases.md) - Practical applications
*   [Saved Searches](Saved-Searches.md) - Creating reusable search configurations
*   [Technical Search Details](Technical-Search-Details.md) - Implementation details and performance tuning