# Why pull requests get closed here

Read from 151 closed-unmerged PRs (2024 → September 2026, 126 with a discussion). Each pattern:
how to spot it in a dossier or diff, and the maintainer's own words. Counts are PRs carrying the
pattern; one PR often carries several. Quotes are eliandoran's unless another login is given.

The headline numbers, because they set the priors:

- **The maintainer re-does it (29 + 4 duplicates).** The most common outcome is not "declined"
  but "superseded by my own smaller change at a different seam". The contributor's diagnosis is
  reused; the code is not, once it exceeds roughly a screen.
- **Size predicts the outcome.** 32 PRs exceeded 1000 lines; almost none landed except by being
  split (#9316 → six PRs, three merged) or rebuilt by a maintainer.
- **Specs and docs do not gate acceptance; fit does.** 40 closed PRs had specs, 17 touched the
  User Guide. What closed them was where the code belongs, app-wide consistency, the storage/sync
  model, and who gets to decide a design.
- **A correct, tested fix still closes** when it works around a library the maintainer would
  rather remove, fixes one surface of an app-wide behavior, or fixes a symptom whose cause the
  maintainer places elsewhere.

## 1. Superseded: the maintainer prefers a smaller change at a different seam (33)

Spot: a fix larger than the bug; a regex where a parser exists; a client-side computation the
server already does; a change to core behavior when the caller could adapt.

- #11406: "I would prefer a simpler approach that does not use regexes. I'll fix it in #11410."
- #10477: "thanks for your implementation, I've tried to simplify it a bit in #10481."
- #11553: "The 'proper' solution here is to not refresh the table at all when the change comes
  from the same editor."
- #11434: "The PR is conceptually good but I would prefer not to change the core behavior. Made a
  replacement PR here: #11668"
- #7757: "we prefer computation on the server (which already has rapid access to all notes)
  instead of the client."
- #11101 (287 lines, 7 rounds of self-review), #11247 (1065 lines), #7287 (37 files, 185
  comments, 11 months): all superseded by the maintainer's own implementation.

Review consequence: when the right fix is a third the size, the verdict is `REWORK` with the seam
named — the maintainer's habit is to write that smaller change himself, so pointing at it saves the
round trip.

## 2. Does not integrate: additions only, artifacts in the tree, bulk (17)

Spot: zero deletions; new modules beside existing ones that do the same job; planning documents,
playbooks, PR-description files or check scripts committed; a description longer than the diff;
English catalogue rewritten wholesale; i18n or conventions ignored.

- #8843: "The code does not integrate at all with the code base, which is evident from the fact
  that there are zero deletions and only additions. In reality, all feature changes require
  adjusting at least a few sources of code."
- #7139 (inline): "This file is an artifact of the LLM used to develop this functionality, so we
  should remove it." / "it describes a single pull request. These should most likely go in the PR
  description and not in the repo."
- #9716: "especially evident from the complete destruction of the English translations."
- #8878: "Why wouldn't you have a video recording of the app? I suppose the app was tested, yes?"
- #7441: "The initial work was severely lacking, without having any functional elements (e.g. a
  login screen, sync completely disregarded)."

Context: all 17 arrived in a ten-week window against four bounty issues; the project then refunded
the bounties. Agent-assisted PRs with house-style bodies and real specs merge routinely — the
pattern is bulk, not tooling.

## 3. A design decision made without the maintainers (9)

Spot: a first-time contributor's PR that establishes an architecture — a protocol, storage,
mobile, multi-user, a new note type, caching semantics — with no issue thread where a maintainer
agreed to the plan.

- #9244: "this does not meet our architectural criteria. Especially since you are a first time
  contributor to the Trilium code base and this was not discussed beforehand, this is a big design
  choice that we should ideally make on our side."
- #9708: "this kind of deep modification needs to be discussed beforehand as there are a lot of
  intricacies, for example the caching of values."
- #9707, #9712, #9714, #9715: "we'd like to implement this feature on our own since it needs to be
  done on an agreed-upon plan" / "Mobile is a topic we'd like to address on our side."
- #6918: "we need first to discuss why removing the title in a Markdown file is needed. We can
  reopen the PR if needed, until them let's continue the discussion over in the related issue."

Review consequence: `YOUR CALL`, with the design question stated in one sentence, never `MERGE`
on code quality alone.

## 4. Belongs in a script, widget or plugin (7)

Spot: a behavior that assumes one workflow; a UI addition useful to the author's setup; a
component "reusable" nowhere else; a render-widget-shaped feature.

- #10308: "better served as a custom widget instead of being part of the core."
- #11102: "better suited as a custom script instead."
- #9687: "I would suggest to try to extract this as a plugin if it's for personal use."
- #7704: "for a component to be useful, it has to be used in multiple places; which is currently
  not the case … If you maintain a custom fork, it's not a bad idea but we can't make decisions on
  the main repo based on that."
- #8474 / #5833 / #7270: "The work can be used as a plugin once we implement a proper plugin
  system."

## 5. One surface of an app-wide behavior, or the wrong layer (7)

Spot: a frequent action (open in split, ctrl+click, a progress badge) added to one view; a
client-only concern routed through the server; formatting logic inside a CKEditor plugin; a
customization mechanism unlike the launch bar's.

- #8677 (13 lines, correct): "We cannot introduce inconsistent behaviour when it comes to frequent
  user actions. I will take note of it and implement it globally at some point."
- #9687: "specific to the board collection … The value is not cached in anyway, which means that
  for big boards this can be awfully slow as it needs to download the blobs of all the notes. For
  reference, my Trilium board has 581 tasks in it."
- #9076: "Handling the actual formatting should not be the responsibility of the CKEditor plugin."
- #6764: "there's no need to have the server involved for a client-side-only affair (CKEditor).
  This seems like it could be a service inside the client."
- #7879: "Since it supports child notes, I think it would make more sense to implement it as a
  Collection instead of a new note type … creating a new note type also implies increasing the
  sync version."
- #8864: "it would align with the rest of the application" over "more user-friendly".

## 6. Data or storage model violated (3, each severe)

Spot: `localStorage`; writes that bypass becca; a model that does not sync; a feature that only
works online.

- #7056: "Trilium does not use the local storage feature at all. All data in Trilium is managed
  within the SQL database." / "we store it in an attachment inside the note. We must not break this
  functionality." / "There are many debug logs inside the PR, please get rid of them."
- #7441: "How are the users synchronized across multiple instances?" deajan: "multi user support
  still needs to work with sync".

## 7. Maintenance burden, workaround, not worth it (9)

Spot: a third mechanism beside two existing ones; a guard around a library bug; a refresh/retry
button; a runtime check for a pinned version; tooling nobody asked for; parallel implementations
left in place.

- #11548 (the fix worked): "this is already the third or the fourth workaround we needed to
  implement due to the underlying library. As such, I prefer to get rid of that library entirely."
- #9960: "The Mermaid diagram is supposed to re-render on change, so what case would there big to
  manually refresh? If the diagram fails to render, then we must fix that issue."
- #7828: "Why have three different mechanisms in place for content accessors?"
- #6839 (inline): "Do we really need this performance monitoring mechanism?" / "I would remove the
  old search mechanism to avoid having two big parallel implementations." / "Our server uses pinned
  versions so as long as the version is correct, there's no need for runtime check."
- #11386: "Our workflows are generally hand-maintained so we don't see much of a benefit in
  automating it."
- #6736 (21.6k lines of docs): "it adds more complexity and verbosity to the documentation than I
  believe is necessary. There are also subtle things that are hard to validate."

## 8. Not needed, already possible, use case unconvincing (11)

Spot: the PR's own description states a problem the app already solves; the feature removes
information (a default column) rather than reorganizing it; a URL that will stop meaning anything.

- #9634: "this is **already** supported … simply removing it is not a solution."
- #11211: "PUT /etapi/attachments/{id}/content with Content-Type: application/octet-stream already
  stores binary content."
- #7704: "Can't this be replicated with already existing functionality such as Saved Search?"
- #9119: "the only reason why the desktop exposes a port is ETAPI and the web clipper API."
- #9963: "we have already had an attempt at implementing full-text search using FTS5 and we
  haven't seen a significant improvement."

## 9. Bundled changes; split it (5)

Spot: several features in one PR; labels or options beyond what the feature needs; a "while I was
here" refactor next to a fix.

- #9316 (33 files): "could you please try to separate the features into multiple PRs? There are
  quite a few overlapping concerns … perhaps not all features can go into Trilium without further
  changes." → split into #9338–#9343; three merged.
- #7828: "in this PR there's also 5 different new labels that were introduced, with only 2 of
  them actually relating to the work at hand." Inline ×4: "This is part of #7828 and should not be
  present in this PR."
- #9960: "we might want to pick out only a few of them."

## 10. Behavior change users will notice; breaking; privacy (3)

Spot: a removed default, a changed URL format, data shown in a dialog users screenshot.

- #6918: "this is a change in behaviour that many people will be surprised to see."
- #7759: "it's best to avoid breaking changes. We have to balance the benefit of the change versus
  the impact." / "we are not going to change the sharing path twice."
- #10013: "Having the sync server show up is a privacy breach."

## 11. Wrong root cause (3)

Spot: the subject names a symptom the diff does not touch; a fix in event handling for a bug that
is really two competing elements; a value-level fix for a structural gap.

- #11176: "the PR title mentions infinite scrolling but nothing is done about that and the root
  cause appears incorrect."
- #11296: "the issue in #11244 lies somewhere else: it's not the event handling or focus stealing,
  it's the the fact that we have two titles."

## 12. Process: docs, translations, third parties (7)

Spot: generated help HTML edited by hand or Markdown edited without regenerating; non-English
catalogues touched; a hosting provider added to a list.

- #9719: "the HTML files also need to be regenerated (using `edit-docs` instead of manually
  modifying the Markdown file)."
- #7766: "I would prefer to keep the reference link notation since it renders better in the in-app
  help."
- #6539: translations go through Weblate.
- #10837: "Trilium works based on trust and we would need to build that trust first."

## 13. Stale after change requests (10)

What the maintainer asked for before a PR could proceed, and the contributor never delivered:
unit tests (#9203 "Please add unit tests. Make sure to cover the case indicated by the Copilot
comment"), the User Guide (#9203 "And most important, add documentation in the user guide."; #7704;
#9076), functional completeness (#7441 "as a user I can't use it to create users or to log in"),
evidence of testing (#9316 "Did you test it thoroughly? Which models were used to test Ollama?").

#6677 (external blobs, 50 files, four months) is the cautionary case: two CHANGES_REQUESTED rounds
("There are two bugs: The first is a critical one (data loss)"), then the author: "the long gaps
between review cycles have made it hard to keep the branch up to date". A large PR that needs
rounds of review is at risk from its size alone.
