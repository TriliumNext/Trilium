# User Guide house style

Extracted from the 276 pages under `docs/User Guide/User Guide/` (counts are from that tree). The
Markdown is an export of CKEditor notes, so the HTML fragments in it are part of the format, not
leftovers: a new page has to look exactly like what the exporter produces, and `docs.mjs sync`
normalizes what it can.

## Register and voice

- **Person.** Impersonal or passive by default ("The note can be toggled…", "It is possible to…");
  "you" where it reads naturally (759 uses). "The user" only in technical third-person descriptions.
  "We" (110) is the project team: "We do plan to increase the coverage…". **Never "I"** — the three
  pages that use it (FAQ, Patterns of personal knowledge, Scripting) are the original author's voice.
- **Mood and tense.** Present tense throughout. Steps are imperative inside bullets, usually opened by
  a purpose clause: "To create a new node at the same level as the current one, press
  <kbd>Enter</kbd>…", "To delete a column, right click on its title and select _Delete column_."
  "To do so," (54) bridges a description into its steps.
- **Formality.** Plain and semi-formal; contractions are fine ("it's possible" 41 vs "it is possible"
  43). Sentences of 15–30 words, paragraphs of 1–3 sentences, one idea each.
- **Recurring phrasings** (use them; they are the voice): "simply" (132), "e.g." with dots, usually in
  parentheses (199), "for example" (105), "Note that" (96), "It's (also) possible to" (123),
  "Generally" (57), "consider …" (49), "feel free to [report the issue](…)" (16), "Do note that" (12).
- **Recommendations are soft.** "Prefer this over other virtual PDF printers…", "it's generally a good
  idea to…", "Generally _Single_ is the desirable option." Strong statements go into an admonition.
- **Spelling is US**: color 211 / colour 1, center 53 / centre 0, organize, customize, behavior,
  synchronize. "synchronisation" (Quick Start) and "localisation" (FAQ) are outliers, not precedent.
- **Naming.** The product is "Trilium" (1283). "TriliumNext" (65) survives only in historical
  contexts ("Since TriliumNext 0.94.1", the theme name, GitHub paths). "Trilium Notes" (29) is the
  formal name in disclaimers and the privacy policy. "TriliumNext Notes" is never used. The original
  maintainer is "Zadam (original Trilium maintainer)".
- **Version facts** carry a `v`-prefixed full semver, never "since version": "Since v0.104.0, …" (40),
  "Starting with v0.104.0, …" (24), "Versions prior to v0.103.0 …" (8), "introduced in v0.103.0" (5).
  Layout-dependent facts say "in the <New Layout pill> only" / "the old layout".

## Page shape

- Line 1 is `# <Title>`, identical to the file name (270/276; the exceptions are titles with a colon,
  which the file name cannot carry). The body starts on **line 2 with no blank line**; there is no
  other H1; the file ends **without a trailing newline**. `sync` enforces all of this.
- Headings are `##` (840) and `###` (429), rarely `####` (24), in **sentence case** ("## Adjusting the
  text size instead", "## Creating a new collection"). Title Case and trailing colons ("### Grab the
  latest docker-compose.yml:") are legacy.
- **First sentence**: definitional in about 100 of 230 content pages — "Collections are a unique type
  of note that don't have content, but instead display their child notes…", "A label is an
  [attribute](../Attributes.md) of a note which has a name and optionally a value." Other openers:
  "The <X> …", "Trilium supports/allows …". 54 pages put a hero `<figure>` on line 2 before it.
  Going straight from the H1 to an `##` with no intro is tolerated, and weaker.
- **Section vocabulary** (H2/H3 counts): `Interaction` (~40, the signature section; keep it at H2),
  `Creating …` (36), `Configuration` (17), `Limitations` / `Known limitations` (20), `Features` /
  `Supported features` (14), `Keyboard shortcuts` (8), `Mobile` / `Mobile support` (7), `See also`
  (6), `Import process` (6), `How it works` (4), `Under the hood` (4), `Reporting issues` (5),
  `Terminology` (2). Not used: "Related", "Known issues", "Technical details".
- Closing a section: "See <pill>." / "See <pill> for more information."

## Cross references

| Form | Count | When |
| --- | --- | --- |
| `<a class="reference-link" href="…">Title</a>` | 1449 | the target note's title used as a noun in the sentence; renders as a note pill |
| `[phrase](../Rel/Path.md)` | 488 | an inline phrase in the running sentence: "see [clones](…)", "the `fullContentWidth` [label](…)" |
| `[text](https://…)` | 208 | external; descriptive text, never the bare URL as text |
| `#heading` anchors | 3 | practically unused |

- Pill text equals the target title in 1393 of 1414 cases; the text is HTML-escaped
  (`Import &amp; Export`). A pill is preceded by a **non-breaking space** (U+00A0; 1183 vs 181 with a
  plain space) — that is what CKEditor writes before an inline widget.
- Paths are relative to the current file (`../` as needed). Spaces `%20`, `&` `%26`, `,` `%2C`.
  Parentheses stay literal inside `href="…"` but are escaped in Markdown links:
  `Server%20Installation/HTTPS%20\(TLS\).md`.
- Links into hidden system notes stay as `#root/_hidden/_options/_optionsTextNotes` (17); the
  `_hidden/` segment is mandatory.
- Issues are reported via the internal page: "feel free to [report the
  issue](../../Troubleshooting/Reporting%20issues.md)", not a raw GitHub URL.
- The Script API is linked through `Scripting/Script%20API.md`; nothing links into the Developer Guide.

## Emphasis and UI names

- **UI labels, menu items, options, tabs, dialog sections in `_italics_`** (741): "select _Insert
  child note_ and look for _Grid View_", "the _Save_ button must be pressed", "the _Owned Attributes_
  section". Curly or straight quotes around UI names are the older style; don't add more.
- **Bold** (404) for defined terms in lists ("A **node** is a single idea…", "**Launcher**: a button…")
  and inline emphasis ("**will not** be visible"). `**Note:**` / `**Rule:**` inline labels are legacy —
  use an admonition.
- **Menu paths** use `→` (U+2192, 180): `<Options pill>&nbsp;→ _Appearance_ → _Fonts_`, every segment
  italic; `_Export note_ → _This note and all of its descendants_ → _HTML in ZIP archive_`. Bold paths
  (`**Settings → Backup**`) and ` -> ` are legacy. Settings are named by their UI path and label,
  never by the option key (`options_interface.ts` names appear nowhere in the docs).
- **Keys**: one `<kbd>` per key, joined by `+` without spaces (417 tags in 59 pages):
  `<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>`; macOS `<kbd>⌘</kbd>`; arrows `<kbd>→</kbd>`;
  `<kbd>Right click</kbd>` exists. Plain "Ctrl+X" (37 places) is the inconsistency `check` warns
  about. Shortcut *action names* are italic (`_Create New Split_`) or backticked command ids
  (`toggleZenMode`).
- **Labels and relations** always in backticks with their prefix (277 `#`, 49 `~`, zero bare):
  `` `#searchHome` ``, `` `#board:groupBy` ``, `` `~status` ``, `` `#iconClass="bx bx-calendar"` ``.
  A label name followed by the word "label" is also backticked: "the `fullContentWidth` [label](…)".
- **Inline code** (2142) for env vars, file names (`docker-compose.yml`), values (`1px`), API calls
  (`api.log`), URLs and search syntax.

## Admonitions

GitHub alerts in the Markdown (`> [!NOTE]` on its own line, then `> ` body lines, `> ` as the blank
separator inside); CKEditor stores them as `<aside class="admonition note">`.

| Type | Count | Content |
| --- | --- | --- |
| NOTE | 98 | technical aside, background, history ("Versions prior to v0.103.0 had…"), relocation notices |
| IMPORTANT | 30 | beta/experimental status, third-party disclaimer ("These solutions are third-party and thus not endorsed…"), hard requirement, scope limitation |
| TIP | 28 | an optional better way ("If you prefer keyboard shortcuts, press…", "consider using [backups]…") |
| WARNING | 17 | data or security risk, version-gated behavior change ("Since v0.104.0, LAN access needs to be enabled…") |
| CAUTION | 0 | not used |

An admonition can open with a bold title line: `> **Icon packs are third-party content**`, `> `, body.

## Images and figures

- Files sit beside the `.md`, named `<Page Title>_<attachment title>` — `Mind Map_image.png`, then
  `1_Mind Map_image.png`, `2_…` for more (the exporter numbers duplicates). 210 png, 13 gif (demos),
  5 webp, 2 svg. `docs.mjs image` registers a file with that name and its meta entry.
- **Modern form** (122): a single-line CKEditor figure with real pixel size and aspect ratio:
  `<figure class="image image-style-align-center"><img style="aspect-ratio:892/675;" src="Mind Map_image.png" width="892" height="675"></figure>`.
  The `src` is **not** URL-encoded (`&` as `&amp;`, spaces literal). Variants: `image` (49),
  `image image-style-align-right` (25), `image image-style-align-right image_resized` with
  `style="width:48.4%;"` on the **figure** (19, floats beside a list), `image image-style-align-center`
  (10), `image image_resized` (8). Resized widths run 28–100 %, mostly about 50 %.
- **Older form** (87): `![](Global%20menu_image.png)` — URL-encoded, empty alt. Don't add new ones.
- Captions are rare (9 `<figcaption>`): "Screenshot of the Print preview functionality introduced in
  v0.103.0." Alt text is not set (one `alt="grafik"` is a paste artifact).
- Screenshots: light theme, the current layout, cropped tightly to the widget, no arrows or boxes
  ("marked by red circle" in Scripting.md is legacy). A hero screenshot goes right after the H1.
- Two-column layout tables pair a screenshot with a sentence: an empty header row `|  |  |`
  (Collections.md, Creating a custom theme.md).

## Icons

A button, menu or toolbar control is named by its icon, never by a cropped screenshot (there are no
`<img>` under 100 px any more):

```html
<span class="tn-icon bx bx-history"></span>            <!-- app UI: Boxicons v2 -->
<span class="tn-icon cke cke-three-vertical-dots"></span>   <!-- text editor toolbar: Text Editor Icons -->
```

- 106 icons on 36 pages (55 `bx`, 51 `cke`), almost all under Note Types and Basic Concepts. Class is
  always `tn-icon <pack> <pack>-<name>`; solid boxicons are `bx bxs-…`, modifiers append
  (`bx-flip-horizontal`). In the HTML the span follows `&nbsp;` (64 vs 35 plain spaces).
- Placement: right before "button" / "icon" / "menu" ("press the <bx-dock-right> button to the right
  of a note's title"); in parentheses after the italic name ("select the _Table properties_ option
  (<cke-table-properties>)"); as the head of a bullet in a list of buttons ("*   <bx-history> displays
  the [Note Revisions]…"); nested groups ("press the <cke-trilium-kbd> button in <bx-text> group from
  the <Formatting toolbar pill>").
- `cke` (235 glyphs) is the editor's own icon set built into a font (`packages/trilium-core/src/
  services/icon_pack_text_editor.json`); upstream `IconTableMergeCell` → `cke-table-merge-cell`,
  Trilium's own SVGs → `cke-trilium-<file>` (`cke-trilium-kbd`, `cke-trilium-ai`). `bx` is
  `icon_pack_boxicons-v2.json` (1635). `docs.mjs icons <terms>` searches both; `icons --check`
  validates every class in the docs. `iconClass` in the meta uses `bx` only.

## Lists, tables, code

- Bullets `*   ` (asterisk + three spaces, 2584; `- ` is legacy), ordered `1.  ` (two spaces, 567),
  nesting by four spaces (`    *   `, `    1.  `). Bullets are full sentences with a period; short
  feature lists ("Filtering", "Sorting") have none. A lead-in with a colon introduces a list ("Each
  tile contains:", "Of note:"). Numbered lists are for sequences; alternatives are bullets.
- Tables: 64 GFM tables `| Note Type | Description |` / `| --- | --- |`, first cell a pill or a
  backticked label; `<br>` for line breaks inside a cell. Raw `<table class="ck-table-resized">` with
  `<colgroup>` is what CKEditor writes for merged cells or sized columns — only when needed.
- Code fences carry a language tag when one applies (javascript, jsx, css, yaml, html, sh, powershell,
  nginx, diff); attribute snippets and error strings are bare fences. Tabs indent CSS/JS samples.

## HTML that must be reproduced exactly (outside code fences)

`<a class="reference-link">` 1448 · `<kbd>` 417 · `<span class="tn-icon …">` 105 · `<figure
class="image …"><img style="aspect-ratio:W/H;" …>` 122 · `<figcaption>` 9 · CKEditor tables
(`<table>`, `<colgroup>`, `<col style="width:…%">`, `<td>`, `<th>`) · `<code>` inside HTML tables
(backticks don't work there) · `<br>` in cells · `<details><summary>` (1) · footnotes as
`[<sup>[1]</sup>](#fn…)` with `1.  [**<sup>^</sup>**](#fnref…)` (CKEditor footnote plugin) · one
`<span style="color:hsl(0,0%,60%);">` wrapping a grey icon. Not used: `<mark>`, `<u>`, `<s>`,
`<sub>`, mermaid fences, math in prose.

The non-breaking space (U+00A0, 2202 occurrences) is a character in the Markdown, written before
pills, arrows and icon spans; a literal `&nbsp;` (45) appears only inside code samples.

## Legacy patterns not to copy

First-person voice; `**Note:**` inline; bold or plain menu paths; curly-quoted UI names; Title Case
headings and headings ending in a colon; `[https://…](https://…)` self-labelled URLs; "Available since
Trilium v0.52."; plain-text shortcuts; ` + ` with spaces between keys; `alt="grafik"`; a plain
paragraph used as a caption; `- ` bullets; untagged code fences where a language applies; pill text
that differs from the target title (21 cases); an `##` followed immediately by an `###` with no intro.
