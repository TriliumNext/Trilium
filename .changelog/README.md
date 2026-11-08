# Changelog entries

Each file here describes one change the way the next release note lists it. At release time,
`pnpm chore:release-notes <version>` collects them into
`docs/Release Notes/Release Notes/<version>.md`, and `pnpm chore:release-notes consume <version>`
deletes them in the release commit, once the note is final. For an rc or beta version, it moves
them to `pre-release/` instead, so the final release lists them again.

Between releases, the body of the [nightly release](https://github.com/TriliumNext/Trilium/releases/tag/nightly)
lists the entries the way the next note will, rebuilt by every nightly build
(`pnpm chore:release-notes unreleased` prints the same), so an entry can be read the day after it
lands.

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

## The overview

One entry per release has `type: overview` and nothing else in its frontmatter. Its text goes
above the first section, after the notices, as three or four paragraphs in the maintainer's
voice: what kind of release this is, which themes the highlights below belong to, and what to
know before upgrading. It is the one part of the note that is written rather than collected, so
write it last, once the entries are in.

A release requires it: `pnpm changelog:lint --release` (which `pnpm chore:release` runs first)
and `pnpm chore:release-notes <version>` fail without one, while the plain lint on a pull request
and the nightly's `unreleased` note do not. Two overview entries are an error everywhere.
`consume` removes it with the other entries, and moves it to `pre-release/` for an rc, so the
final release reuses it.

## Creating one

```sh
pnpm changelog:new <slug>
```

This writes `.changelog/<YYYYMMDDHHMMSS>_<slug>.md` from a template. The timestamp orders the
entries in the note and keeps two branches from writing the same file.

`pnpm changelog:lint` checks every entry: it must parse, and a fix or an improvement must name a
known area. The Changelog workflow runs it on each pull request and push to `main` that touches
`.changelog/`, and comments on the pull request or commit when it fails.

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
| `type` | yes | The release note section: `overview` (see below), `highlight`, `compatibility`, `breaking`, `mobile`, `fix`, `improvement`, `documentation`, `i18n`, `technical` or `security`. Compatibility also lists, by itself, a sync protocol or database version that differs from the previous release; a `compatibility` entry whose `closes` names the pull request or issue behind that bump is nested under it as the reason. `note`, `tip`, `important` and `warning` become a GitHub admonition above the first section instead, for a notice that concerns the whole release. |
| `title` | for `highlight` | The `###` heading of a Key highlights entry. The text below the frontmatter is written under it as it stands: paragraphs separated by blank lines, `*` lists, inline links on the feature names. Write it as a short story: what a user could not do, what they can do now, where to find it. No `(#N)` references are appended; put a link on the feature name instead. |
| `area` | for `fix` and `improvement` | Puts the entry in a collapsible block named after it, such as `LLM`, `Search` or `Table collection`, even when it is the only entry of that area. One of `AREAS` in `scripts/release-notes.mts`, which the template lists; a change that fits none adds its area there. |
| `closes` | no | Issue numbers or URLs. The note links the entry to them and leaves out the entries it would generate from their titles. It does not close the issue: that is still the `(closes #N)` in the commit subject. |
| `credits` | no | GitHub usernames to thank. Defaults to whoever fixed the issues in `closes`. Leave out maintainers. |
| `notable` | no | `true` lists the entry above the section's collapsible blocks, prefixed with its area, so a reader who opens none still sees it. For a change the reader is worse off missing: data loss or a security fix, a lost login, sync or startup, a crash, a regression since the previous release, a whole platform or locale broken, a rename or a changed default. Never for a new feature, however large: that competes for Key highlights instead. Aim for five to eight per section. |

After the frontmatter, the first line is the entry (for a highlight, its first paragraph). Describe what the user sees, not the code:
"Searching for a word containing `#` dropped everything after it", not "Stop splitting the
tokenizer input on `#`". Lines after the first are nested under the entry, for details or
sub-items.

The frontmatter is read by a small parser, not a full YAML one: keep to `key: value`,
`key: [a, b]` or a `- item` list per key, with `#` comments.
