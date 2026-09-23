# How search matches your text
The single most common source of confusion is that the `=` sign means two _different_ things depending on where it appears. Read this section once and the rest of search becomes predictable.

There are three matching modes:

| Mode | How you trigger it | What it matches | Substring? | Fuzzy (typos)? |
| --- | --- | --- | --- | --- |
| **Default** | type words with no prefix | whole words _and_ substrings, anywhere in title, content or attributes, relevance-ranked | Yes | Yes |
| **Exact full-text** | a leading `=` (e.g. `=sync`) | the exact whole word or phrase, ignoring surrounding punctuation | No | No |
| **Attribute / property equality** | `=` inside a `#label=value` or `note.property=value` clause | the _entire_ attribute or property value, exactly | No | No |

Every example below is backed 1:1 by an automated test, so the documentation cannot drift from the engine.

### Default matching (no prefix)

**Rule:** typing words with no prefix finds notes that contain those words anywhere in the title, content or attributes, as whole words or as substrings. The closest matches are ranked first.

| Query | Example note content | Matches? | Why |
| --- | --- | --- | --- |
| `sync` | `please sync the folders` | Yes (ranked higher) | contains the exact word `sync` |
| `sync` | `synchronize the database now` | Yes (ranked lower) | `sync` is a substring of `synchronize` |

### Exact match with the `=` prefix

**Rule:** a leading `=` switches the full-text search to exact matching. It finds the whole word or phrase only, ignoring surrounding punctuation, with **no** substring and **no** fuzzy matching. Use it when a normal search returns too many near-matches.

| Query | Example note content | Matches? | Why |
| --- | --- | --- | --- |
| `=sync` | `see (sync) mode` | Yes | `(sync)` is the whole word `sync`; punctuation is ignored |
| `=sync` | `in sync, then continue` | Yes | `sync,` is the whole word `sync` |
| `=sync` | `he said "sync" out loud` | Yes | `"sync"` is the whole word `sync` |
| `=sync` | `synchronize the database now` | No | `=` never matches substrings |
| `=sync` | `please send the file` | No | `=` never matches typos / fuzzy |

To match an exact **phrase**, quote it after the `=` (single, double or backtick quotes all work). The phrase must appear as consecutive words, but punctuation between or around them is ignored:

| Query | Example note (title or content) | Matches? | Why |
| --- | --- | --- | --- |
| `="project plan"` | title `Project Plan` | Yes | the title is exactly the phrase |
| `="project plan"` | `the (project plan) is ready to share` | Yes | the consecutive phrase appears; punctuation is ignored |
| `="project plan"` | `the plan for this project is late` | No | the words are present but not consecutive |

### Attribute and property equality (`=`, `!=`)

**Rule:** when `=` compares an attribute or property, as in `#label=value` or `note.title=value`, it is **strict full-value equality**: the _whole_ value must equal what you typed, ignoring case and diacritics. This is **not** word matching. `!=` inverts it.

The examples below assume four notes: _Austria_ (`#capital=Vienna`), _Somewhere_ (`#capital=Vienna Austria`), _Czech Republic_ (`#capital=Prague`) and _Switzerland_ (`#capital=Zürich`).

| Query | Example label value | Matches? | Why |
| --- | --- | --- | --- |
| `#capital=Vienna` | `Vienna` | Yes | the whole value equals `Vienna` |
| `#capital=Vienna` | `Vienna Austria` | No | the whole value is `Vienna Austria`, not `Vienna` |
| `#capital="Vienna Austria"` | `Vienna Austria` | Yes | quote a multi-word value to match it in full |
| `#capital=Zurich` | `Zürich` | Yes | equality ignores diacritics |
| `#capital!=Vienna` | `Prague` | Yes | `!=` matches every value that is not `Vienna` |
| `#capital!=Vienna` | `Vienna` | No | `!=` excludes the exact value |

> **Quick search relaxes this.** The [Quick search](../Quick%20search.md) bar and autocomplete treat an attribute `=` as "contains", so `#capital=Vienna` typed there also matches `Vienna Austria`. The strict full-value equality described here applies only in the full Search.

### Fuzzy operators (`~=` and `~*`)

**Rule:** the fuzzy operators tolerate typos. `~=` (fuzzy-equals) matches a value that is a close whole-word variant of your term. `~*` (fuzzy-contains) matches when your term appears anywhere inside the value, either as a fragment or as a near-miss. Both work on note properties such as `note.title` and `note.content`, and on labels (`#label`). Fuzzy operators accept terms of at least 3 characters, though how many typos each term tolerates depends on its length — see _Fuzzy tolerance_ below.

The examples assume a note titled `Books` carrying the label `#author=Tolkien`, and a note whose content is `learn programming today`.

| Query | Example value | Matches? | Why |
| --- | --- | --- | --- |
| `note.title ~= boks` | title `Books` | Yes | one edit away from `books` |
| `#author ~= tolkein` | author `Tolkien` | Yes | `tolkein` is a typo of `tolkien` |
| `note.content ~* progr` | `learn programming today` | Yes | `progr` is a fragment of `programming` |
| `note.content ~* programing` | `learn programming today` | Yes | `programing` is one edit from `programming` |

### Fuzzy tolerance

**Rule:** how many typos are tolerated depends on the **length** of your search term. Short terms must match exactly, because a single edit is enough to turn one short word into an unrelated one; longer terms tolerate more.

| Term length | Edits allowed |
| --- | --- |
| 1–3 characters | 0 (exact only) |
| 4–6 characters | 1 |
| 7+ characters | 2 |

| Query | Term length | Example note content | Matches? | Why |
| --- | --- | --- | --- | --- |
| `cat` | 3 | `a bright red car` | No | No edits are allowed below 4 characters, so `cat` does not reach `car` |
| `carr` | 4 | `a blue debit card` | Yes | 1 edit is within budget for 4–6 character terms |
| `ceck` | 4 | `the latest tech trends` | No | `ceck`→`tech` needs 2 edits; only 1 is allowed at this length |
| `combinef` | 8 | `the values were combined together` | Yes | `combinef`→`combined` is 1 edit; up to 2 are allowed at 7+ characters |

### Relevance ranking

**Rule:** results are ordered by _how well_ they match, not merely whether they match. Exact whole-word and phrase matches rank above substring and fuzzy matches, and a note where your words appear as a consecutive phrase outranks one where they are scattered.

| Query | Ranked higher | Ranked lower | Why |
| --- | --- | --- | --- |
| `sync` | `please sync the folders` | `synchronize the database now` | exact word beats substring |
| `you and me` | `I like you and me as a phrase` | `the menu is here and you know it` | consecutive phrase beats scattered words |

### What is searchable

A search looks at more than the visible body text. All of the following are indexed and searchable:

*   note titles,
*   note body content,
*   labels and relations ([attributes](../../../Advanced%20Usage/Attributes.md)),
*   link URLs and the titles/descriptions of link previews,
*   the titles of notes that a note reference-links to.

The last point is the least obvious: if a note's only content is a reference link to another note, searching for that other note's **title** still finds the linking note.

| Query | Setup | Matches? | Why |
| --- | --- | --- | --- |
| `special topic` | a note whose only content is a reference link to a note titled `Special Topic` | Yes, and the linked target ranks first | the target's title is indexed into the linking note's searchable text |
| `special` | the same note (only a reference link to `Special Topic`) | Yes, one word from the target's title is enough | the indexed title is normalized just like body text, so even one lowercased word matches |
| `zurich` | a note whose only content is a reference link to a note titled `Zürich` | Yes | the indexed title has its accents normalized, so the plain form matches the accented title |

### Diacritics

**Rule:** accents are normalized on both sides, so an accented word and its plain form match each other.

| Query | Example note content | Matches? |
| --- | --- | --- |
| `ktory` | `slovo ktorý znamena nieco` | Yes |
| `ktorý` | `the word ktory appears here` | Yes |

### Regular expressions (`%=`)

**Rule:** the `%=` operator matches a property or label value against a regular expression.

| Query | Example note content | Matches? |
| --- | --- | --- |
| `note.content %= 'colou?r'` | `my favorite color of all` | Yes |
| `note.content %= 'colou?r'` | `my favourite colour of all` | Yes |