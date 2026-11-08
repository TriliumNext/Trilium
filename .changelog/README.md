# Changelog entries

Each file here describes one change the way the next release note lists it. At release time,
`pnpm chore:release-notes <version>` collects them into
`docs/Release Notes/Release Notes/<version>.md`, and `pnpm chore:release-notes consume <version>`
deletes them in the release commit, once the note is final. For an rc or beta version, it moves
them to `pre-release/` instead, so the final release lists them again.

## When to add one

Add an entry for every change a user can notice: a fixed bug, a new or changed feature, a moved
control, a breaking change, a security fix. One change can need several entries (a branch that
fixes three unrelated things), and several commits can share one (a feature built over twenty
commits).

Skip the entry when:

- the change closes an issue and the issue's title reads well as the entry: the script lists
  closed issues by itself;
- the change only fixes something introduced since the last release;
- the change is internal: tests, tooling, CI, dependencies, refactoring, the website, the web
  clipper (which ships on its own).

## Creating one

```sh
pnpm changelog:new <slug>
```

This writes `.changelog/<YYYYMMDDHHMMSS>_<slug>.md` from a template. The timestamp orders the
entries in the note and keeps two branches from writing the same file.

## Format

```markdown
---
type: fix
area: Search
closes: [11204]
credits: [maphew]
---

Tree Quick Search failed when `/` was in the middle of the query on some reverse proxies.
```

| Key | Required | Value |
|---|---|---|
| `type` | yes | The release note section: `highlight`, `breaking`, `mobile`, `fix`, `improvement`, `documentation`, `i18n`, `technical` or `security`. `tip`, `important` and `warning` become a GitHub admonition above the first section instead, for a notice that concerns the whole release. |
| `area` | no | Groups entries under one item named after it, such as `LLM`, `Search` or `Table collection`. A lone entry is prefixed with it instead (`Search: …`). Spell it the same way as the other entries of that area. |
| `closes` | no | Issue numbers or URLs. The note links the entry to them and leaves out the entries it would generate from their titles. It does not close the issue: that is still the `(closes #N)` in the commit subject. |
| `credits` | no | GitHub usernames to thank. Defaults to whoever fixed the issues in `closes`. Leave out maintainers. |

After the frontmatter, the first line is the entry. Describe what the user sees, not the code:
"Searching for a word containing `#` dropped everything after it", not "Stop splitting the
tokenizer input on `#`". Lines after the first are nested under the entry, for details or
sub-items.

The frontmatter is read by a small parser, not a full YAML one: keep to `key: value`,
`key: [a, b]` or a `- item` list per key, with `#` comments.
