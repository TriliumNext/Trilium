# Trilium's philosophy, as the maintainers apply it

The "fit" dimension of a review. Each principle: what it is, the question it turns into when a PR
is on the table, and the evidence — issue and PR numbers, with the maintainer's own words. The
numbers are TriliumNext/Trilium issues and PRs (`gh issue view N`, `gh pr view N`); migrated
zadam-era issues keep their original numbers. `CONTRIBUTING.md` is the closest thing to a charter
and says most of this in the maintainers' voice; this file adds how each rule is applied.

Read it as the maintainer's habits, not as a rulebook: a PR that breaks one principle with a good
reason is a `YOUR CALL`, a PR that breaks one without noticing is a `DECLINE` or `REWORK`.

## 1. A hierarchical *personal* knowledge base — not Word, not a Markdown editor, not a block editor, not a team wiki

Ask: does the PR pull Trilium toward another product's model (free-flow pages, pagination, a
Markdown dialect, per-block attributes, multi-user collaboration)?

- #6272: "Trilium will never be a full-fleged, general-purpose editor such as Microsoft Word."
- #6799: "You have to think of Trilium not as a WYSIWYG editor, but as a personal wiki system. That
  means it gets to have its own conventions that you might or might not agree with." The conflict
  (H1 handling) was resolved by adding a *separate Markdown note type*, not by changing the text
  note's convention.
- #9472: "Trilium is by design tree-based, changing this would go against its philosophy."
- Discussion #10967 (block-based features): block-level attributes "would be the largest change
  … Unless there is significant demand for it".
- `FAQ.md` on multi-user: "the assumption that only single person has access to the app simplifies
  many things, or just outright makes them possible."

## 2. The note is the only building block; structure lives in branches

Ask: does the PR invent a second kind of thing (a "container", a "block", a "user", a "folder")
that is not a note with attributes, or store placement on the note rather than in a branch?

- `Notes.md`: "In Trilium there's no specific 'folder' note type. Any note can have children."
- PR #7734: "you can just change the Note Type from Text to Collection. This more clearly specifies
  the intent of a container."
- PR #7441 (multi-user): "The user management doesn't seem to match Trilium's model for the becca,
  where each user is a model. How are the users synchronized across multiple instances?"

## 3. Attributes and templates are the configuration surface

Ask: could the behavior be a label, an inheritable label, a promoted attribute or a template, and
does the PR reach for a setting or new UI instead?

- #7290 (note color): "you can simply implement what you requested by using promoted attributes
  … `#label:color(inheritable)="promoted,alias=Color,single,color"`".
- #6494: "change `language=foo` to `#language(inheritable)=foo`".
- #9756: "Prefer using promoted attributes and just changing the label and keeping the attribute
  name the same."
- PR #9687 (checklist progress on board cards): "you could theoretically make use of promoted
  attributes to show the number of checked vs unchecked items."
- The other direction holds too — an attribute is not a substitute for UI on an app-level
  setting. PR #8880: "All new options/configurations in Trilium must also be exposed to the user
  through the UI, not just through attributes." PR #7878: existing attributes stay as they are
  "since at some point they'll become system attributes and mostly be used through the UI."

## 4. Workflow-specific needs go to scripts, custom widgets, render notes, `#appCss` or ETAPI — not core

The single most common decline, for issues and PRs alike. The maintainer routinely answers with a
working snippet.

Ask: does the feature assume a particular workflow, and would a script or widget serve the people
who want it?

- `CONTRIBUTING.md`: a feature "will likely be declined when it: can be built as a user script or
  custom widget instead."
- PR #10308 (`#openAtBottom`): "better served as a custom widget instead of being part of the
  core." (a full widget draft was pasted into the comment)
- PR #11102 (mouse-wheel tab switching): "better suited as a custom script instead … a Linux-only
  convention that has generated user complaints in various apps, especially if it's not
  toggleable."
- #9442 (auto-date notes under Calendar): "not something that should be part of Trilium because it
  assumes a particular workflow." → a `runOnChildNoteCreation` backend script.
- #5189: "We need to keep the code base as lean as possible, so we will not add a custom option for
  this."
- #7006, #715, #2485, #991, #9943, #1386, #8600, #9029, #11175, #8159, #9006, #242.
- The counterweight, #4269: features still land in core rather than as shipped scripts because
  "there's no distribution mechanism. Scripts can only come from the demo … Without a central
  plugin registry, scripts are fragmented". A *generally useful* behavior can be core; a
  *personal* one cannot.

## 5. No setting for a single use case; fix the default and stay opinionated

Ask: does the PR add an option, a toggle, a per-note switch? Every one is a branch to test forever.
The bar is "many users want opposite defaults", not "someone might".

- #5364: "toggles are quite expensive in terms of maintenance. From the moment you add it you now
  have two more branches in the application … we will have to start to get opinionated in order to
  get the project going."
- #9584: "Adding a new option is a commitment, every single change branches off the logic of the
  application."
- #9682: "the fix is to simply **get rid of said recursion**, not make it user toggleable."
- #8368: "adding an option to various tweaks and preferences would explode our number of options."
- #1181 (zadam): "Having things configurable is very expensive in terms of effort and future
  maintenance, so I'm trying to avoid that wherever possible."
- Accepted counter-example #5309: a one-line CKEditor flag with no branching UI.

## 6. Everything works offline; libraries are embedded; no online services in core

Ask: does the PR load anything from a CDN, call a remote service, or need a network to work?
The LLM integration is the one opt-in, off-by-default exception, and it was removed once (v0.102.0)
when it could not be maintained.

- `CONTRIBUTING.md` constraint 1: "Everything must work offline. Features that need an online
  service cannot go into the core … libraries must always be embedded in the application, never
  loaded from a CDN."
- #10093 (draw.io): "everything in Trilium must work offline. Draw.io is a few hundred megabytes."
- #3865: "Bundling a third-party commercial handwriting API is out of scope for a local-first PKM
  tool." #6553: remote (S3) stores "we have no plan to implement".
- Discussion #10555 on cloud LLM providers: "people should be allowed to make their own decisions
  … it's pretty well contained in the project".

## 7. Bundle size and data longevity gate every dependency

Ask: does the PR add a dependency, and is it small, used in more than one place, and free of a
proprietary format? Where does it land — core (server, desktop *and* standalone's worker), the
client bundle, or a lazy chunk?

- `CONTRIBUTING.md` constraints 2–3: "A new dependency cannot be added without checking that it
  does not negatively impact the bundle size." / "We avoid dependencies with proprietary formats,
  unless the data can be fully imported or exported."
- #676 (zadam, draw.io): "I want to keep the data in Trilium usable for decades."
- #6710: per-locale fonts "would increase our binary size significantly."
- PR #9076: "Check the impact on the delivery size."
- PR #10825: "SQLite artifacts are **intentionally** trimmed … 4.4 MB for a piece of code that
  never gets executed."
- `Compression libraries.md`: fflate over jszip, "roughly 30 KB against ~95 KB, in a bundle where
  that matters".

## 8. Off-the-shelf components stay unmodified; their limits go upstream; no workarounds for a library

Ask: does the PR patch around CKEditor, Excalidraw, MindElixir, CodeMirror, FullCalendar,
Tabulator, Electron? Does it add a CKEditor plugin? Is it the third workaround for the same library?

- #8382: "We are already spending a huge amount of time maintaining the plugins we have to CKEditor
  … and we don't have the bandwidth to add more."
- #7848: "We have to use off-the-shelf solutions in order to avoid the maintenance burden."
- PR #11548 (a *working* mermaid fix): "this is already the third or the fourth workaround we
  needed to implement due to the underlying library. As such, I prefer to get rid of that library
  entirely."
- PR #9960: "If the diagram fails to render, then we must fix that issue instead of having a
  work-around." `CONTRIBUTING.md`: "a manual refresh button that hides a rendering bug will not be
  accepted."
- `Technologies used.md` (Excalidraw): "We are using an unmodified version of it."

## 9. SQLite plus entity-change sync is load-bearing

Ask: does the PR write outside becca (direct SQL, `localStorage`, files), skip `EntityChange`
records, add a note type without a sync-version bump, or assume one instance?

- PR #7056: "Trilium does not use the local storage feature at all. All data in Trilium is managed
  within the SQL database … we store it in an attachment inside the note. We must not break this
  functionality."
- PR #7879: "creating a new note type also implies increasing the sync version, because a sync with
  an old server (pretty common case) will transform the gallery into a File note type otherwise."
- PR #7441: "syncing does not work when multi-user is enabled? This is critical as the core of
  Trilium is based on this." deajan: "one of the goals of Trilium is to be able to work offline."
- #10035, #5347, #2654, #10085 (newest-wins, no merge), `CLAUDE.md` ("Always use cache methods").
- PR #7757: "we prefer computation on the server (which already has rapid access to all notes)
  instead of the client." PR #6764: "no need to have the server involved for a client-side-only
  affair (CKEditor)." — the layer follows where the data is.

## 10. The single user is the trust boundary; no security theatre

Ask: does the PR add friction that only protects the owner from themselves?

- `SECURITY.md`: "Users can intentionally create notes containing scripts, HTML, or other
  executable content. This is by design."
- #10453: "this would bring in a false sense of security. If someone gets temporary access to an
  already unlocked session, they can still do that through other means."
- #4995: a separate password for protected notes "would add too much complexity to the
  application without much of a benefit in security."
- PR #10013: the sync host on the About dialog "is a privacy breach" (screenshots in bug reports).

## 11. Defaults and conventions are deliberate, preferably at parity with an external standard

Ask: does the PR change a default, a shortcut, a convention, a menu? Was the current one a choice
(usually yes), and does the PR argue against the reason for it or just against the outcome?

- #5589: admonitions are "at 1:1 parity … with GitHub's admonitions support".
- #8219: font icon packs, not SVG/PNG: "The gap is intentional."
- #6799: single H1 → "If we allow h1 in imports, then we also have to allow them in the text
  editor … case in which it is a breaking change."
- #11522: "the menu itself is already quite a bit cluttered … Adding yet one more option is
  probably a step in the wrong direction."
- PR #6918: "this is a change in behaviour that many people will be surprised to see. We can't
  simply remove it."
- PR #9634: removing the default-shortcut column loses "the information on whether the user made
  changes … simply removing it is not a solution."
- `CONTRIBUTING.md`: easier to accept when it "keeps current behavior unchanged by default (new
  behavior is opt-in)".

## 12. Frequent-action behavior is app-wide or nowhere

Ask: does the PR add a behavior (ctrl+click, drag, a badge, a shortcut) to one surface when the
same action exists in the tree, collections, the geo map, the note map?

- PR #8677 (13 lines, correct): "if we add support for this feature of opening in a split we have to
  add support for it everywhere (tree, geo map, list/grid collections). We cannot introduce
  inconsistent behaviour when it comes to frequent user actions."
- PR #9687: "specific to the board collection, which means that the user cannot benefit from it
  anywhere else."
- PR #8864 (drag-and-drop toolbar editor): "it would align with the rest of the application" beats
  "more user-friendly".
- PR #9680: light/dark "can't be treated as a separate theme because that would limit the user
  selection".

## 13. Big designs are made on the maintainers' side, after a discussion

Ask: is this a first-time contributor landing an architecture (a protocol, storage, sync, mobile,
multi-user, a new note type) that no issue thread agreed on?

- `CONTRIBUTING.md`: "Some areas are maintainer-led … the mobile apps, sync and encryption
  architecture, the `trilium://` protocol, the storage model, and areas under active maintainer
  redesign." And: "first open or find a feature request or idea and wait for maintainer feedback."
- PR #9244: "Especially since you are a first time contributor to the Trilium code base and this
  was not discussed beforehand, this is a big design choice that we should ideally make on our
  side."
- PR #7828: "please take the time to discuss first the request and perhaps even the
  implementation … it also decreases the chances of being rejected after the work has already been
  done." / "I would also appreciate it if we keep the PRs minimal."
- PR #7879: "For big features such as this, I would appreciate it if we can have a discussion
  about it beforehand."
- #6799: "open-source does not mean open governance, or decision by committee."
- PR #11064 (the `CONTRIBUTING.md` review): "Feature implementations should ALWAYS be discussed
  in a feature request or idea first … there are perfectly valid PRs that we have to let go just
  because they don't fit the philosophy of Trilium. Discussing first avoids that risk … Bugfixes
  and documentation changes are OK." A bugfix needs no prior discussion; a feature does.

## 14. Maintainer bandwidth decides scope; maintenance cost is a first-class reason

Ask: who maintains this in two years? Does it add a parallel mechanism to one that exists?

- PR #7828: "Why have three different mechanisms in place for content accessors? This creates a
  maintenance burden … choose one and stick to it."
- PR #6839: "I would remove the old search mechanism to avoid having two big parallel
  implementations."
- PR #6867: "I would prefer not to have the maintenance burden of handling this edge case."
- PR #10649 (the maintainer's own spike): "Conceptually nice, but a lot of work to do for
  something that was not even requested."
- #6804, #5574, #5813, #2637: "the effort outweighs the demand" / "if the request gains a
  significant traction".
- Whole subsystems go when unmaintainable: the LLM integration (v0.102.0), then back once a
  library carried the provider differences (v0.103.0).
- No surface is added for a hypothetical consumer. PR #10526: "We don't expose additional widgets
  to the front end API, only widgets that are actually used by Trilium." PR #7704: "for a component
  to be useful, it has to be used in multiple places."
- The counterweight: work in the right direction merges imperfect. PR #9104: "OK as a first
  implementation, although the long-term fix is to get rid of the jQuery and use a custom dialog."
  PR #8484: "I will merge this because I appreciate some of the features … this will not be the
  final form." The maintainer then polishes on `main` rather than holding the PR.

## 15. Environment problems are solved in the environment

Ask: is this a reverse-proxy, Electron, OS, theme or plugin problem dressed as a Trilium fix?

- #7968: a Traefik breaking change → "won't fix. I've documented the necessary changes … in the
  User Guide".
- #8401: "Adding an empty search would be an incorrect solution since it would return a different
  set of results."
- #5768: base URL "The proper way is to handle it via the reverse proxy".
- `CONTRIBUTING.md`: "better handled outside Trilium, for example HTTP Basic Authentication at a
  reverse proxy, or packaging-only concerns."

## 16. Mobile means the mobile layout on the shared code base

Ask: does the PR add a desktop-view fix for phones, or a native path where the standalone/worker
architecture is the strategy?

- #5325: "Using the desktop view on mobile is not supported."
- #7447: "We can't afford the cost of maintaining both a Node.js + TypeScript and a Kotlin
  implementation."

## 17. A fix fixes the cause, in the layer that owns it

Ask: does the diff change the place that produces the symptom, or the place where it is seen?
Would the maintainer name a different root cause?

- PR #11553: "The 'proper' solution here is to not refresh the table at all when the change comes
  from the same editor."
- PR #11296: "the issue in #11244 lies somewhere else: it's not the event handling or focus
  stealing, it's the the fact that we have two titles."
- PR #11176: "the PR title mentions infinite scrolling but nothing is done about that and the root
  cause appears incorrect."
- PR #9076: "Handling the actual formatting should not be the responsibility of the CKEditor plugin
  … move the formatting part into the client and provide an API."

## 17b. Bad input never crashes; the untested branch is the one that breaks

The maintainer tests every PR by hand, and the most common substantive review comment is about
what he saw: a crash, a theme, a platform, an older sync peer, a big database.

- PR #8880: "**Always validate user data.** If I enter `#calendar:slotLabelInterval="00:aa:00"`,
  the calendar crashes."
- PR #8799: "Report invalid values via toast, without crashing and without affecting other valid
  calendar events. Make sure to write tests for this scenario."
- PR #11321: "It doesn't seem to work, at least on the Trilium Next theme." PR #8668: "This is not
  platform-agnostic since it will fail on Windows."
- PR #9687: "for big boards this can be awfully slow as it needs to download the blobs of all the
  notes. For reference, my Trilium board has 581 tasks in it." PR #9419: "For big databases, this
  can be quite a cost for the user with not that great of a benefit."
- PR #10856: "Heuristics can produce false positives, and I feel that the value vs risk is not high
  enough."

## 18. Agent-assisted is fine; bulk that does not integrate is not

Ask: does the diff delete anything? Does it reuse the codebase's helpers, components and
conventions, or sit beside them? Are there planning artifacts, playbooks or PR-description files
in the tree? Is the description longer than the diff?

- PR #8843: "The code does not integrate at all with the code base, which is evident from the fact
  that there are zero deletions and only additions. In reality, all feature changes require
  adjusting at least a few sources of code."
- PR #7441: "It is my expectation to be discussing with a human."
- PR #7139: "This file is an artifact of the LLM used to develop this functionality, so we should
  remove it."
- `CONTRIBUTING.md`: "Bulk or unverified submissions may be closed without detailed review."
- The other side: 13 PRs by one contributor carry `Agent-Signature:` trailers with house-style
  bodies (cause / fix / verification / remainder); 9 merged with a single APPROVED and no maintainer
  commits. #10924 (a Claude-made Turkish translation) merged once the author described the quality
  check. The bar is the body and the spec, not the tool.

## "Yes, but" — the shape an accepted request takes

When the idea is fine and the shape is not, the verdict is `REWORK` and this table says toward what.

| Request | Accepted shape | Ref |
|---|---|---|
| Note color / per-note property | A promoted attribute now; a menu entry "at some point" | #7290 |
| Behavior inherited by children | An inheritable label, not a setting | #6494 |
| A different key for an action | The existing keyboard-shortcut settings, not a new option | #5684 |
| Auto-apply on child creation | A backend script (`runOnChildNoteCreation`) | #9442 |
| Longer labels in a map | Support more characters; no option | #5656 |
| Stop nested include-notes | Remove the recursion; no toggle | #9682, #10340 |
| A new heavyweight editor (spreadsheet) | A note type, maintained library, no lock-in, sync version bumped, disclaimer | #1841 |
| Syntax highlighting for a language | Only where an off-the-shelf grammar exists | #7848 |
| Custom icons | Font-based icon packs only | #8219, #5145 |
| Fonts | Custom fonts synced across instances; never system fonts | #8590, #9443 |
| Trigger sync from a script | `fetch("api/sync/now", { method: "POST" })`, no new API | #10085 |
| External attachment storage | Local external store yes, remote no | #6553 |
| Share-page customization | CSS/JS first, templates as a last resort | #3429 |
| Draw.io | A third-party widget, never core | #10093 |
| Dependency for scripting (Day.js plugin) | Accepted by size and by use inside Trilium itself | `Day.js.md` |
| A behavior change users will notice | Opt-in, with the old default kept | `CONTRIBUTING.md`, #6918 |
