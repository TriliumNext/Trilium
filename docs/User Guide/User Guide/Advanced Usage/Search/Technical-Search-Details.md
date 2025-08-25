# Technical-Search-Details
## Technical Search Details

This guide provides technical information about Trilium's search implementation, performance characteristics, and optimization strategies for power users and administrators.

## Search Architecture Overview

### Three-Layer Search System

Trilium's search operates across three cache layers:

1.  **Becca (Backend Cache)**: Server-side entity cache containing notes, attributes, and relationships
2.  **Froca (Frontend Cache)**: Client-side mirror providing fast UI updates
3.  **Database Layer**: SQLite database with FTS (Full-Text Search) support

### Search Processing Pipeline

1.  **Lexical Analysis**: Query parsing and tokenization
2.  **Expression Building**: Converting tokens to executable expressions
3.  **Progressive Execution**: Exact search followed by optional fuzzy search
4.  **Result Scoring**: Relevance calculation and ranking
5.  **Result Presentation**: Formatting and highlighting

## Query Processing Details

### Lexical Analysis (Lex)

The lexer breaks down search queries into components:

```javascript
// Input: 'project #status=active note.dateCreated >= TODAY-7'
// Output:
{
  fulltextTokens: ['project'],
  expressionTokens: ['#status', '=', 'active', 'note', '.', 'dateCreated', '>=', 'TODAY-7']
}
```

#### Token Types

*   **Fulltext Tokens**: Regular search terms
*   **Expression Tokens**: Attributes, operators, and property references
*   **Quoted Strings**: Exact phrase matches
*   **Escaped Characters**: Literal special characters

### Expression Building (Parse)

Tokens are converted into executable expression trees:

```javascript
// Expression tree for: #book AND #author=Tolkien
AndExp([
  AttributeExistsExp('label', 'book'),
  LabelComparisonExp('label', 'author', equals('tolkien'))
])
```

#### Expression Types

*   `AndExp`, `OrExp`, `NotExp`: Boolean logic
*   `AttributeExistsExp`: Label/relation existence
*   `LabelComparisonExp`: Label value comparison
*   `RelationWhereExp`: Relation target queries
*   `PropertyComparisonExp`: Note property filtering
*   `NoteContentFulltextExp`: Content search
*   `OrderByAndLimitExp`: Result ordering and limiting

### Progressive Search Strategy

#### Phase 1: Exact Search

```javascript
// Fast exact matching
const exactResults = performSearch(expression, searchContext, false);
```

Characteristics:

*   Substring matching for text
*   Exact attribute matching
*   Property-based filtering
*   Handles 90%+ of searches
*   Sub-second response time

#### Phase 2: Fuzzy Fallback

```javascript
// Activated when exact results < 5 high-quality matches
if (highQualityResults.length < 5) {
  const fuzzyResults = performSearch(expression, searchContext, true);
  return mergeExactAndFuzzyResults(exactResults, fuzzyResults);
}
```

Characteristics:

*   Edit distance calculations
*   Phrase proximity matching
*   Typo tolerance
*   Performance safeguards
*   Exact matches always rank first

## Performance Characteristics

### Search Limits and Thresholds

| Parameter | Value | Purpose |
| --- | --- | --- |
| `MAX_SEARCH_CONTENT_SIZE` | 2MB | Database-level content filtering |
| `MIN_FUZZY_TOKEN_LENGTH` | 3 chars | Minimum length for fuzzy matching |
| `MAX_EDIT_DISTANCE` | 2 chars | Maximum character changes for fuzzy |
| `MAX_PHRASE_PROXIMITY` | 10 words | Maximum distance for phrase matching |
| `RESULT_SUFFICIENCY_THRESHOLD` | 5 results | Threshold for fuzzy activation |
| `ABSOLUTE_MAX_CONTENT_SIZE` | 100MB | Hard limit to prevent system crash |
| `ABSOLUTE_MAX_WORD_COUNT` | 2M words | Hard limit for word processing |

### Performance Optimization

#### Database-Level Optimizations

```mariadb
-- Content size filtering at database level
SELECT noteId, type, mime, content, isProtected
FROM notes JOIN blobs USING (blobId)
WHERE type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap') 
  AND isDeleted = 0 
  AND LENGTH(content) < 2097152  -- 2MB limit
```

#### Memory Management

*   Single-array edit distance calculation
*   Early termination for distant matches
*   Progressive content processing
*   Cached regular expressions

#### Search Context Optimization

```javascript
// Efficient search context configuration
const searchContext = new SearchContext({
  fastSearch: true,           // Skip content search
  limit: 50,                 // Reasonable result limit
  orderBy: 'dateCreated',    // Use indexed property
  includeArchivedNotes: false // Reduce search space
});
```

## Fuzzy Search Implementation

### Edit Distance Algorithm

Trilium uses an optimized Levenshtein distance calculation:

```javascript
// Optimized single-array implementation
function calculateOptimizedEditDistance(str1, str2, maxDistance) {
  // Early termination checks
  if (Math.abs(str1.length - str2.length) > maxDistance) {
    return maxDistance + 1;
  }
  
  // Single array optimization
  let previousRow = Array.from({ length: str2.length + 1 }, (_, i) => i);
  let currentRow = new Array(str2.length + 1);
  
  for (let i = 1; i <= str1.length; i++) {
    currentRow[0] = i;
    let minInRow = i;
    
    for (let j = 1; j <= str2.length; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j] + 1,        // deletion
        currentRow[j - 1] + 1,     // insertion
        previousRow[j - 1] + cost  // substitution
      );
      minInRow = Math.min(minInRow, currentRow[j]);
    }
    
    // Early termination if row minimum exceeds threshold
    if (minInRow > maxDistance) return maxDistance + 1;
    
    [previousRow, currentRow] = [currentRow, previousRow];
  }
  
  return previousRow[str2.length];
}
```

### Phrase Proximity Matching

For multi-token fuzzy searches:

```javascript
// Check if tokens appear within reasonable proximity
function hasProximityMatch(tokenPositions, maxDistance = 10) {
  // For 2 tokens, simple distance check
  if (tokenPositions.length === 2) {
    const [pos1, pos2] = tokenPositions;
    return pos1.some(p1 => pos2.some(p2 => Math.abs(p1 - p2) <= maxDistance));
  }
  
  // For multiple tokens, find sequence within range
  const findSequence = (remaining, currentPos) => {
    if (remaining.length === 0) return true;
    const [nextPositions, ...rest] = remaining;
    return nextPositions.some(pos => 
      Math.abs(pos - currentPos) <= maxDistance && 
      findSequence(rest, pos)
    );
  };
  
  const [firstPositions, ...rest] = tokenPositions;
  return firstPositions.some(startPos => findSequence(rest, startPos));
}
```

## Indexing and Storage

### Database Schema Optimization

```mariadb
-- Relevant indexes for search performance
CREATE INDEX idx_notes_type ON notes(type);
CREATE INDEX idx_notes_isDeleted ON notes(isDeleted);
CREATE INDEX idx_notes_dateCreated ON notes(dateCreated);
CREATE INDEX idx_notes_dateModified ON notes(dateModified);
CREATE INDEX idx_attributes_name ON attributes(name);
CREATE INDEX idx_attributes_type ON attributes(type);
CREATE INDEX idx_attributes_value ON attributes(value);
```

### Content Processing

Notes are processed differently based on type:

```javascript
// Content preprocessing by note type
function preprocessContent(content, type, mime) {
  content = normalize(content.toString());
  
  if (type === "text" && mime === "text/html") {
    content = stripTags(content);
    content = content.replace(/&nbsp;/g, " ");
  } else if (type === "mindMap" && mime === "application/json") {
    content = processMindmapContent(content);
  } else if (type === "canvas" && mime === "application/json") {
    const canvasData = JSON.parse(content);
    const textElements = canvasData.elements
      .filter(el => el.type === "text" && el.text)
      .map(el => el.text);
    content = normalize(textElements.join(" "));
  }
  
  return content.trim();
}
```

## Search Result Processing

### Scoring Algorithm

Results are scored based on multiple factors:

```javascript
function computeScore(fulltextQuery, highlightedTokens, enableFuzzyMatching) {
  let score = 0;
  
  // Title matches get higher score
  if (this.noteTitle.toLowerCase().includes(fulltextQuery.toLowerCase())) {
    score += 10;
  }
  
  // Path matches (hierarchical context)
  const pathMatch = this.notePathArray.some(pathNote => 
    pathNote.title.toLowerCase().includes(fulltextQuery.toLowerCase())
  );
  if (pathMatch) score += 5;
  
  // Attribute matches
  score += this.attributeMatches * 3;
  
  // Content snippet quality
  if (this.contentSnippet && this.contentSnippet.length > 0) {
    score += 2;
  }
  
  // Fuzzy match penalty
  if (enableFuzzyMatching && this.isFuzzyMatch) {
    score *= 0.8; // 20% penalty for fuzzy matches
  }
  
  return score;
}
```

### Result Merging

Exact and fuzzy results are carefully merged:

```javascript
function mergeExactAndFuzzyResults(exactResults, fuzzyResults) {
  // Deduplicate - exact results take precedence
  const exactNoteIds = new Set(exactResults.map(r => r.noteId));
  const additionalFuzzyResults = fuzzyResults.filter(r => 
    !exactNoteIds.has(r.noteId)
  );
  
  // Sort within each category
  exactResults.sort(byScoreAndDepth);
  additionalFuzzyResults.sort(byScoreAndDepth);
  
  // CRITICAL: Exact matches always come first
  return [...exactResults, ...additionalFuzzyResults];
}
```

## Performance Monitoring

### Search Metrics

Monitor these performance indicators:

```javascript
// Performance tracking
const searchMetrics = {
  totalQueries: 0,
  exactSearchTime: 0,
  fuzzySearchTime: 0,
  resultCount: 0,
  cacheHitRate: 0,
  slowQueries: [] // queries taking > 1 second
};
```

### Memory Usage

Track memory consumption:

```javascript
// Memory monitoring
const memoryMetrics = {
  searchCacheSize: 0,
  activeSearchContexts: 0,
  largeContentNotes: 0, // notes > 1MB
  indexSize: 0
};
```

### Query Complexity Analysis

Identify expensive queries:

```javascript
// Query complexity factors
const complexityFactors = {
  tokenCount: query.split(' ').length,
  hasRegex: query.includes('%='),
  hasFuzzy: query.includes('~=') || query.includes('~*'),
  hasRelationTraversal: query.includes('.relations.'),
  hasNestedProperties: (query.match(/\./g) || []).length > 2,
  hasOrderBy: query.includes('orderBy'),
  estimatedResultSize: 'unknown'
};
```

## Troubleshooting Performance Issues

### Common Performance Problems

#### Slow Full-Text Search

```javascript
// Diagnosis
- Check note content sizes
- Verify content type filtering
- Monitor regex usage
- Review fuzzy search activation

// Solutions
- Enable fast search for attribute-only queries
- Add content size limits
- Optimize regex patterns
- Tune fuzzy search thresholds
```

#### Memory Issues

```javascript
// Diagnosis
- Monitor result set sizes
- Check for large content processing
- Review search context caching
- Identify memory leaks

// Solutions
- Add result limits
- Implement progressive loading
- Clear unused search contexts
- Optimize content preprocessing
```

#### High CPU Usage

```javascript
// Diagnosis
- Profile fuzzy search operations
- Check edit distance calculations
- Monitor regex compilation
- Review phrase proximity matching

// Solutions
- Increase minimum fuzzy token length
- Reduce maximum edit distance
- Cache compiled regexes
- Limit phrase proximity distance
```

### Debugging Tools

#### Debug Mode

Enable search debugging:

```javascript
// Search context with debugging
const searchContext = new SearchContext({
  debug: true // Logs expression parsing and execution
});
```

Output includes:

*   Token parsing results
*   Expression tree structure
*   Execution timing
*   Result scoring details

#### Performance Profiling

```javascript
// Manual performance measurement
const startTime = Date.now();
const results = searchService.findResultsWithQuery(query, searchContext);
const endTime = Date.now();
console.log(`Search took ${endTime - startTime}ms for ${results.length} results`);
```

#### Query Analysis

```javascript
// Analyze query complexity
function analyzeQuery(query) {
  return {
    tokenCount: query.split(/\s+/).length,
    hasAttributes: /#|\~/.test(query),
    hasProperties: /note\./.test(query),
    hasRegex: /%=/.test(query),
    hasFuzzy: /~[=*]/.test(query),
    complexity: calculateComplexityScore(query)
  };
}
```

## Configuration and Tuning

### Server Configuration

Relevant settings in `config.ini`:

```toml
# Search-related settings
[Search]
maxContentSize=2097152          # 2MB content limit
minFuzzyTokenLength=3          # Minimum chars for fuzzy
maxEditDistance=2              # Edit distance limit
resultSufficiencyThreshold=5   # Fuzzy activation threshold
enableProgressiveSearch=true   # Enable progressive strategy
cacheSearchResults=true        # Cache frequent searches

# Performance settings
[Performance]
searchTimeoutMs=30000         # 30 second search timeout
maxSearchResults=1000         # Hard limit on results
enableSearchProfiling=false   # Performance logging
```

### Runtime Tuning

Adjust search behavior programmatically:

```javascript
// Dynamic configuration
const searchConfig = {
  maxContentSize: 1024 * 1024,  // 1MB for faster processing
  enableFuzzySearch: false,      // Exact only for speed
  resultLimit: 50,               // Smaller result sets
  useIndexedPropertiesOnly: true // Skip expensive calculations
};
```

## Best Practices for Performance

### Query Design

1.  **Start Specific**: Use selective criteria first
2.  **Limit Results**: Always set reasonable limits
3.  **Use Indexes**: Prefer indexed properties for ordering
4.  **Avoid Regex**: Use simple operators when possible
5.  **Cache Common Queries**: Save frequently used searches

### System Administration

1.  **Monitor Performance**: Track slow queries and memory usage
2.  **Regular Maintenance**: Clean up unused notes and attributes
3.  **Index Optimization**: Ensure database indexes are current
4.  **Content Management**: Archive or compress large content

### Development Guidelines

1.  **Test Performance**: Benchmark complex queries
2.  **Profile Regularly**: Identify performance regressions
3.  **Optimize Incrementally**: Make small, measured improvements
4.  **Document Complexity**: Note expensive operations

## Advanced Configuration

### Custom Search Extensions

Extend search functionality with custom expressions:

```javascript
// Custom expression example
class CustomDateRangeExp extends Expression {
  constructor(dateField, startDate, endDate) {
    super();
    this.dateField = dateField;
    this.startDate = startDate;
    this.endDate = endDate;
  }
  
  execute(inputNoteSet, executionContext, searchContext) {
    // Custom logic for date range filtering
    // with optimized performance characteristics
  }
}
```

### Search Result Caching

Implement result caching for frequent queries:

```javascript
// Simple LRU cache for search results
class SearchResultCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  get(queryKey) {
    if (this.cache.has(queryKey)) {
      // Move to end (most recently used)
      const value = this.cache.get(queryKey);
      this.cache.delete(queryKey);
      this.cache.set(queryKey, value);
      return value;
    }
    return null;
  }
  
  set(queryKey, results) {
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(queryKey, results);
  }
}
```

## Next Steps

*   [Search Fundamentals](Search-Fundamentals.md) - Basic concepts and syntax
*   [Advanced Search Expressions](Advanced-Search-Expressions.md) - Complex query construction
*   [Search Examples and Use Cases](Search-Examples-and-Use-Cases.md) - Practical applications
*   [Saved Searches](Saved-Searches.md) - Creating dynamic collections