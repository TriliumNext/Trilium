---
name: writing-documentation
description: Use whenever a change is user-facing — a new feature, a moved or removed button, a label, a shortcut, an option, a default, a note type, a collection view, a dialog, an import format — or when asked to write, fix, restructure or audit Trilium's documentation ("document this", "update the User Guide", "add a page for X", "is X documented?", "which page describes X?", "the docs still say…", "rename/move this page", "add a screenshot", "which icon do I use?"). Covers the three docs trees (`docs/User Guide`, `docs/Developer Guide`, `docs/Release Notes`) and the generated in-app help they feed, the `!!!meta.json` note metadata (noteId, shareAlias, iconClass, attachments), the house style of the User Guide (register, page templates, reference-link pills, `<kbd>`, admonitions, figures, the `bx`/`cke` icon spans), and `docs.mjs`, which finds and shows pages, scaffolds a page with correct metadata, registers images, renames/moves/deletes pages, maps a code diff to the pages it affects, audits the trees, and regenerates the help HTML headless — so `!!!meta.json` and `apps/server/src/assets/doc_notes` never have to be read or hand-edited. A user-facing change is not finished until the User Guide describes it, in the same commit.
---

# Writing Trilium's documentation

Trilium's User Guide is a tree of Trilium notes, exported to Markdown under `docs/User Guide/` and
described by `docs/User Guide/!!!meta.json`. From that Markdown the repo generates the **in-app help**
(`apps/server/src/assets/doc_notes/en/User Guide/**/*.html` + a minified help meta, and
`apps/standalone/src/assets/help_meta.json`) and the public site (docs.triliumnotes.org). The Markdown
is the source; everything under `doc_notes` and `help_meta.json` is generated and never hand-edited.

Every mechanical step is [docs.mjs](docs.mjs):

```bash
D=.claude/skills/writing-documentation/docs.mjs
node $D find "kanban"                    # pages by title / alias / path; --content searches bodies
node $D show kanban-board                # metadata, URL, outline, inbound links, code that links it
node $D tree Collections --depth 1       # the note tree with aliases and icons
node $D impact --diff                    # pages a branch's code changes touch (also: impact "Print note")
node $D new Collections "Timeline" --icon bx-time-five --after Dashboard   # scaffold page + meta entry
node $D image timeline shot.png          # register a screenshot; prints the <figure> to paste
node $D icons quote --pack cke           # icon classes for a toolbar button / app control
node $D rename timeline "Timeline view"  # retitle; move <page> <parent>; delete <page>
node $D sync                             # regenerate Markdown, help HTML and help metas headless
node $D check                            # meta ↔ disk, links, images, icons, aliases, code refs, style
```

## The rule: a user-facing change ships with its documentation

A change is user-facing when it alters anything a user sees or does: a control added, moved, relabeled
or removed; a shortcut; an option, its default or where it lives; a note type, collection view, dialog,
import/export format, launcher, badge, tooltip; a behavior a page describes. **It is not done until the
User Guide describes the new state, in the same commit or PR as the code.** Docs are not a follow-up.

The workflow, every time:

1. `node $D impact --diff` — lists the pages that mention the UI strings the branch changed and the
   help pages wired from the touched components. Also run `impact "<feature name>" "<button label>"`
   for the names the diff cannot know. **Read every hit** — a page describing a control that moved,
   a label that changed or a default that flipped is wrong until edited.
2. Edit the Markdown (below), or `new` a page for a feature no page covers.
3. `node $D sync` — normalizes your Markdown the way the editor would and regenerates the help HTML
   and both help metas. Review `git diff -- docs` (what the round trip did to your text) and
   `git diff --stat -- apps/server/src/assets/doc_notes`.
4. `node $D check` — must report 0 errors (a handful are pre-existing, listed at the end).
5. Commit the code, the Markdown, `!!!meta.json`, the `doc_notes` HTML and `help_meta.json` together.

Two traps `CLAUDE.md` names still apply: verify **where a control actually mounts** by grepping the
component, not by inference; and a widened **capability gate** (a note type added to a list a widget
switches on) surfaces panels the change never mentioned — grep the gate's readers.

Do **not** write release notes on a branch: the maintainer writes `docs/Release Notes/Release
Notes/v<x>.md` from the merged commits at release time. Make the commit subject carry the bullet
("Area: what changed", issue keyword). The one per-version page a feature branch does touch is a
`Scripting/Breaking changes/v<next>.0 <title>` page for a scripting API break.

## Editing a page by hand

Hand-editing the Markdown is fine — `sync` is what makes it safe. What to know first:

- **Line 1 is `# <Title>`, body starts on line 2, no trailing newline.** The exporter writes that
  shape; the importer demotes a differing H1. `sync` normalizes whatever you wrote.
- **Links to other pages** are relative `.md` paths, `%20`-encoded (`&` → `%26`, parentheses escaped
  `\(` in Markdown links, literal in `href=`). On import they resolve to note IDs and are re-derived on
  export — so a renamed or moved target fixes every link on the next `sync`. A path that does not
  resolve imports as dead text; `check` catches it.
- **The HTML inside the Markdown is real** — reference-link pills, `<kbd>`, `<figure>`, icon spans,
  admonitions as `> [!NOTE]`. Reproduce them exactly as [references/style-guide.md](references/style-guide.md)
  shows; CKEditor is what reads them.
- **Images are attachments**, registered in `!!!meta.json` and named `<Page Title>_<name>` beside the
  page. Never drop a file in by hand: `image <page> <file>` copies it, registers it, and prints the
  `<figure>` with real dimensions. An attachment nothing references is erased by the next `sync`.
- **`sync` rewrites every tree from scratch** (`rm -rf` + export) — a file on disk that is in no
  `!!!meta.json` entry disappears, and a `.md` with no entry makes the import throw. Everything that
  touches the tree shape goes through `new` / `image` / `rename` / `move` / `delete`.
- After `sync`, HTML churn like reflow, `&nbsp;` shifted across a tag, `<li><p>` ↔ `<li>` or a
  `style` gaining a `;` is normal and is not mentioned in a commit. A changed `href`, a dropped
  `<img src>` or a paragraph that lost text is a defect: fix it before committing.
- `pnpm edit-docs:edit-docs` (the Electron editor) still works and is the better tool for heavy
  restructuring or for pasting screenshots; it exports 10 s after a change. `sync` is the headless
  twin of that export, so both leave the same files.

## Adding a page

```bash
node $D new "Note Types" "Timeline" --icon bx-time-five --after "Web View"
```

`new` writes `<Parent dir>/Timeline.md` with the H1, inserts a complete meta entry (fresh 12-char
noteId, `notePath`, `notePosition` a multiple of 10 among the siblings, `shareAlias`, `iconClass`,
`format: "markdown"`, `mime: "text/html"`), turns a leaf parent into a folder, and prints the pill to
paste into the parent page. Then write the body, `image` the screenshots, `sync`, `check`.

- **Alias** defaults to the kebab-case title; pass `--alias` to shorten (`setup`, `docker`, `mfa`,
  `and` for `&`). The public URL is the chain of ancestor aliases, so it only has to be unique among
  siblings; a page without one has no URL and is dropped from the standalone help. Once published, an
  alias is an external link (README ×41, website, web clipper, about dialog) — `show` lists who uses it.
- **Icon**: the feature's own icon — a note type's `NOTE_TYPE_ICONS` entry, a collection's template
  icon in `hidden_subtree_templates.ts`, otherwise `icons <query>`. Boxicons (`bx bx-…`) only for
  `iconClass`.
- **Title characters**: letters, digits, space, `_ - ( ) & . , \``. The in-app help refuses anything
  else (`doc_renderer.ts`), and `new` refuses too. `/`, `:` and `"` are dropped from the file name.
- **Wire it into the app** when the page documents a surface with a help affordance: `<HelpButton
  helpPage="<noteId>">` (settings panes, dialogs), `helpPageId` on a `Modal`, or the maps in
  `apps/client/src/services/in_app_help.ts` (`byNoteType`, `byBookType`, sidebar sections). The app
  links help by **noteId**, so those IDs are permanent: `show` reports them under "referenced from
  code", `delete` refuses while any exist, and `rename`/`move` keep the ID.
- Link the page from its parent and from the pages that mention the feature; a page nothing links to
  is only reachable from the tree.

## Renaming, moving, deleting

`rename` changes the title and H1 and keeps the noteId; `sync` then renames the file, its attachments
and its folder and rewrites every inbound link. `move` relocates the files and the meta entry
(`notePath` of the subtree included); the public URL changes, so `show` the page first for
hard-coded URLs. `delete` removes the entry and its files and refuses if the app links the noteId.
All three want a `sync` right after; `check` before committing.

Which pages is the app itself attached to? `show <page>` → "referenced from code", or `check`, which
fails when a `helpPage` literal or a `docs.triliumnotes.org/user-guide/…` URL in code points nowhere.

## House style, the short version

The full guide with counts and examples is [references/style-guide.md](references/style-guide.md);
skeletons per page kind are [references/page-templates.md](references/page-templates.md).

1. Product is **Trilium** (not TriliumNext, not "Trilium Notes" outside legal text). US spelling.
2. Present tense, impersonal or "you"; "we" only for the project. Never "I". Plain, semi-formal,
   contractions fine. Recommendations are soft ("Generally…", "consider…", "Prefer…").
3. One definitional first sentence ("X is/are …", "Trilium allows …"), optionally after a hero figure.
   Headings `##`/`###` in sentence case. Sections in this order when they apply: Creating → Interaction
   → Configuration → Limitations → Mobile support → Under the hood → See also.
4. Steps: "To <goal>, <imperative>." bullets (`*   `, three spaces); numbered `1.  ` only for strict
   sequences; nest with four spaces.
5. Other pages by title as a pill, preceded by a non-breaking space:
   `&nbsp;<a class="reference-link" href="../Rel/Path%20Name.md">Path Name</a>` (text = target title).
   Inline phrases as `[phrase](../Rel/Path.md)`. Issues go to "[report the issue](…/Troubleshooting/Reporting%20issues.md)".
6. UI labels and menu items in _italics_; paths with `→`: `<Options pill> → _Appearance_ → _Fonts_`.
   Settings by their UI path, never by option key.
7. Keys: `<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>`, no spaces. Labels/relations in backticks with
   prefix: `` `#board:groupBy` ``, `` `~template` ``. Files, values, env vars, syntax in backticks.
8. A button is shown by its icon: `<span class="tn-icon cke cke-<name>"></span>` for a text-editor
   toolbar button, `<span class="tn-icon bx bx-<name>"></span>` for the rest of the app, followed by
   "button"/"icon"/"menu". Never a cropped screenshot of a button. `icons` finds the class.
9. Callouts: `> [!NOTE]` context/history · `> [!TIP]` a better way · `> [!IMPORTANT]` beta status,
   requirement, third-party disclaimer · `> [!WARNING]` data/security risk or a version-gated break.
10. Version facts: "Since v0.104.0, …", "Starting with v0.104.0, …", "Versions prior to v0.103.0 …".
11. Figures: `<figure class="image image-style-align-center"><img style="aspect-ratio:W/H;" src="Title_image.png" width="W" height="H"></figure>`
    (`image` prints it); light theme, tight crop, no annotations; `image-style-align-right image_resized`
    + `style="width:50%;"` on the figure to float beside a list.
12. Tables are GFM `| a | b |` with a pill or a backticked label in the first cell; code fences carry
    a language tag when one applies.

## Known warnings in the trees today

`check` reports 0 errors; its ~70 warnings predate any current work and are listed so nobody
rediscovers them. Fix what you pass by; none blocks a change:

- Four User Guide pages without a `shareAlias` (AI chat tab, Office documents, Privacy, Text Snippets)
  and ~40 without an `iconClass`; four Developer Guide pages that are empty (`Backlinks`, `Branch
  prefixes`, `Deleted notes`, `Integration testing`).
- ~20 pills whose text differs from the target's title, ~35 plain-text shortcuts, two unreferenced
  attachments, a handful of British spellings.
- Typos: "togged" (Canvas, Mind Map), "belwo" (Presentation), "Triliumin" (Troubleshooting), "to the
  to the" (Kanban Board), "expect printer" (Printing & Exporting as PDF).

## Related

- **building-client-ui** — `HelpButton` / `HelpTooltipButton` / `HelpDropdown` are the in-app help
  affordances; wire a new page through them.
- **working-with-translations** — the English strings `impact --diff` reads come from those catalogues.
- **ckeditor5-plugin-development** — the `cke` icon pack: an editor icon added, renamed or removed
  means regenerating the font and grepping the docs for the old `cke-<name>` class.
- [references/pipeline.md](references/pipeline.md) — how the trees, the meta files, the in-app help and
  the docs site are produced and consumed, and which identifiers are load-bearing.
