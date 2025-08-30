# Saved-Searches
## Saved Searches

Saved searches in Trilium allow you to create dynamic collections of notes that automatically update based on search criteria. They appear as special notes in your tree and provide a powerful way to organize and access related content.

## Understanding Saved Searches

A saved search is a special note type that:

*   Stores search criteria and configuration
*   Dynamically displays matching notes as children
*   Updates automatically when notes change
*   Can be bookmarked and accessed like any other note
*   Supports all search features including ordering and limits

## Creating Saved Searches

### From Search Dialog

1.  Open the search dialog (Ctrl+S or search icon)
2.  Configure your search criteria and options
3.  Click "Save to note" button
4.  Choose a name and location for the saved search

### Manual Creation

1.  Create a new note and set its type to "Saved Search"
2.  Configure the search using labels:
    *   `#searchString` - The search query
    *   `#fastSearch` - Enable fast search mode
    *   `#includeArchivedNotes` - Include archived notes
    *   `#orderBy` - Sort field
    *   `#orderDirection` - "asc" or "desc"
    *   `#limit` - Maximum number of results

### Using Search Scripts

For complex logic, create a JavaScript note and link it:

*   `~searchScript` - Relation pointing to a backend script note

## Basic Saved Search Examples

### Simple Text Search

```
#searchString=project management
```

Finds all notes containing "project management".

### Tag-Based Collection

```
#searchString=#book #author=Tolkien
#orderBy=publicationYear
#orderDirection=desc
```

Creates a collection of Tolkien's books ordered by publication year.

### Task Dashboard

```
#searchString=#task #status!=completed #assignee=me
#orderBy=priority
#orderDirection=desc
#limit=20
```

Shows your top 20 incomplete tasks by priority.

### Recent Activity

```
#searchString=note.dateModified >= TODAY-7
#orderBy=dateModified
#orderDirection=desc
#limit=50
```

Shows the 50 most recently modified notes from the last week.

## Advanced Saved Search Patterns

### Dynamic Date-Based Collections

#### This Week's Content

```
#searchString=note.dateCreated >= TODAY-7 note.dateCreated < TODAY
#orderBy=dateCreated
#orderDirection=desc
```

#### Monthly Review Collection

```
#searchString=#reviewed=false note.dateCreated >= MONTH note.dateCreated < MONTH+1
#orderBy=dateCreated
```

#### Upcoming Deadlines

```
#searchString=#dueDate >= TODAY #dueDate <= TODAY+14 #status!=completed
#orderBy=dueDate
#orderDirection=asc
```

### Project-Specific Collections

#### Project Dashboard

```
#searchString=#project=alpha (#task OR #milestone OR #document)
#orderBy=priority
#orderDirection=desc
```

#### Project Health Monitor

```
#searchString=#project=alpha #status=blocked OR (#dueDate < TODAY #status!=completed)
#orderBy=dueDate
#orderDirection=asc
```

### Content Type Collections

#### Documentation Hub

```
#searchString=(#documentation OR #guide OR #manual) #product=api
#orderBy=dateModified
#orderDirection=desc
```

#### Learning Path

```
#searchString=#course #level=beginner #topic=programming
#orderBy=difficulty
#orderDirection=asc
```

## Search Script Examples

For complex logic that can't be expressed in search strings, use JavaScript:

### Custom Business Logic

```javascript
// Find notes that need attention based on complex criteria
const api = require('api');

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - 30);

const results = [];

// Find high-priority tasks overdue by more than a week
const overdueTasks = api.searchForNotes(`
    #task #priority=high #dueDate < TODAY-7 #status!=completed
`);

// Find projects with no recent activity
const staleProjets = api.searchForNotes(`
    #project #status=active note.dateModified < TODAY-30
`);

// Find notes with many attributes but no content
const overlabeledNotes = api.searchForNotes(`
    note.attributeCount > 5 note.contentSize < 100
`);

return [...overdueTasks, ...staleProjects, ...overlabeledNotes]
    .map(note => note.noteId);
```

### Dynamic Tag-Based Grouping

```javascript
// Group notes by quarter based on creation date
const api = require('api');

const currentYear = new Date().getFullYear();
const results = [];

for (let quarter = 1; quarter <= 4; quarter++) {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;
    
    const quarterNotes = api.searchForNotes(`
        note.dateCreated >= "${currentYear}-${String(startMonth).padStart(2, '0')}-01"
        note.dateCreated < "${currentYear}-${String(endMonth + 1).padStart(2, '0')}-01"
        #project
    `);
    
    results.push(...quarterNotes.map(note => note.noteId));
}

return results;
```

### Conditional Search Logic

```javascript
// Smart dashboard that changes based on day of week
const api = require('api');

const today = new Date();
const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.

let searchQuery;

if (dayOfWeek === 1) { // Monday - weekly planning
    searchQuery = '#task #status=planned #week=' + getWeekNumber(today);
} else if (dayOfWeek === 5) { // Friday - weekly review
    searchQuery = '#task #completed=true #week=' + getWeekNumber(today);
} else { // Regular days - focus on today's work
    searchQuery = '#task #dueDate=TODAY #status!=completed';
}

const notes = api.searchForNotes(searchQuery);
return notes.map(note => note.noteId);

function getWeekNumber(date) {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const pastDays = Math.floor((date - firstDay) / 86400000);
    return Math.ceil((pastDays + firstDay.getDay() + 1) / 7);
}
```

## Performance Optimization

### Fast Search for Large Collections

For collections that don't need content search:

```
#searchString=#category=reference #type=article
#fastSearch=true
#limit=100
```

### Efficient Ordering

Use indexed properties for better performance:

```
#orderBy=dateCreated
#orderBy=title
#orderBy=noteId
```

Avoid complex calculated orderings in large collections.

### Result Limiting

Always set reasonable limits for large collections:

```
#limit=50
```

For very large result sets, consider breaking into multiple saved searches.

## Saved Search Organization

### Hierarchical Organization

Create a folder structure for saved searches:

```
📁 Searches
├── 📁 Projects
│   ├── 🔍 Active Projects
│   ├── 🔍 Overdue Tasks  
│   └── 🔍 Project Archive
├── 📁 Content
│   ├── 🔍 Recent Drafts
│   ├── 🔍 Published Articles
│   └── 🔍 Review Queue
└── 📁 Maintenance
    ├── 🔍 Untagged Notes
    ├── 🔍 Cleanup Candidates
    └── 🔍 Orphaned Notes
```

### Search Naming Conventions

Use clear, descriptive names:

*   "Active High-Priority Tasks"
*   "This Month's Meeting Notes"
*   "Unprocessed Inbox Items"
*   "Literature Review Papers"

### Search Labels

Tag saved searches for organization:

```
#searchType=dashboard
#searchType=maintenance  
#searchType=archive
#frequency=daily
#frequency=weekly
```

## Dashboard Creation

### Personal Dashboard

Combine multiple saved searches in a parent note:

```
📋 My Dashboard
├── 🔍 Today's Tasks
├── 🔍 Urgent Items
├── 🔍 Recent Notes
├── 🔍 Upcoming Deadlines
└── 🔍 Weekly Review Items
```

### Project Dashboard

```
📋 Project Alpha Dashboard  
├── 🔍 Active Tasks
├── 🔍 Blocked Items
├── 🔍 Recent Updates
├── 🔍 Milestones
└── 🔍 Team Notes
```

### Content Dashboard

```
📋 Content Management
├── 🔍 Draft Articles
├── 🔍 Review Queue
├── 🔍 Published This Month
├── 🔍 High-Engagement Posts
└── 🔍 Content Ideas
```

## Maintenance and Updates

### Regular Review

Periodically review saved searches for:

*   Outdated search criteria
*   Performance issues
*   Unused collections
*   Scope creep

### Search Evolution

As your note-taking evolves, update searches:

*   Add new tags to existing searches
*   Refine criteria based on usage patterns
*   Split large collections into smaller ones
*   Merge rarely-used collections

### Performance Monitoring

Watch for performance issues:

*   Slow-loading saved searches
*   Memory usage with large result sets
*   Search timeout errors

## Troubleshooting

### Common Issues

#### Empty Results

*   Check search syntax
*   Verify tag spellings
*   Ensure notes have required attributes
*   Test search components individually

#### Performance Problems

*   Add `#fastSearch=true` for attribute-only searches
*   Reduce result limits
*   Simplify complex criteria
*   Use indexed properties for ordering

#### Unexpected Results

*   Enable debug mode to see query parsing
*   Test search in search dialog first
*   Check for case sensitivity issues
*   Verify date formats and ranges

### Best Practices

#### Search Design

*   Start simple and add complexity gradually
*   Test searches thoroughly before saving
*   Document complex search logic
*   Use meaningful names and descriptions

#### Performance

*   Set appropriate limits
*   Use fast search when possible
*   Avoid overly complex expressions
*   Monitor search execution time

#### Organization

*   Group related searches
*   Use consistent naming conventions
*   Archive unused searches
*   Regular cleanup and maintenance

## Next Steps

*   [Technical Search Details](Technical-Search-Details.md) - Understanding search performance and implementation
*   [Search Examples and Use Cases](Search-Examples-and-Use-Cases.md) - More practical examples
*   [Advanced Search Expressions](Advanced-Search-Expressions.md) - Complex query construction