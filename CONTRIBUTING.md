# Contributing to Trilium Notes

Thank you for wanting to help. Trilium is maintained by a small team, and
small, focused contributions are the easiest to review and merge.

This guide is about code contributions. To help translate Trilium, use
[Weblate](https://hosted.weblate.org/engage/trilium/). To work on the
documentation, see the
[Documentation guide](./docs/Developer%20Guide/Developer%20Guide/Documentation.md).

## Before you start

- Search existing issues and pull requests first, so the work is not done
  twice.
- For a bug fix or a documentation change, you can open a pull request
  directly.
- For a feature of any size, first open or find a feature request or idea
  and wait for maintainer feedback before you start coding. Some well-made
  pull requests must be declined only because they do not fit the
  philosophy of Trilium; discussing first avoids that risk and saves
  effort on both sides.
- To set up a build, see
  [Environment Setup](./docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
  and
  [Project Structure](./docs/Developer%20Guide/Developer%20Guide/Project%20Structure.md).

## Project constraints

Trilium is a hierarchical note-taking application for building large
*personal* knowledge bases. Keep these constraints in mind:

1. **Everything must work offline.** Features that need an online service
   cannot go into the core. A few features fetch external data, such as
   map tiles for geo maps or OCR data, but libraries must always be
   embedded in the application, never loaded from a CDN.
2. **Bundle size is very important.** A new dependency cannot be added
   without checking that it does not negatively impact the bundle size.
3. **User data must stay usable for decades.** We avoid dependencies with
   proprietary formats, unless the data can be fully imported or
   exported, as with the XLSX and CSV interoperability of spreadsheets.
4. **Protect existing user data.** Discuss changes to storage, sync, or
   encryption with maintainers before coding, because these changes can put
   existing databases at risk.

## Bug fixes

- Check whether the bug still occurs on the latest
  [nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly).
  If you cannot run nightly, say which version you tested.
- Give reproduction steps, relevant logs, or a failing test. Fixes are much
  easier to accept when reviewers can verify the problem.
- Fix the underlying cause rather than hiding the symptom. For example, a
  manual refresh button that hides a rendering bug will not be accepted.

## Features

A feature is easier to review and accept when it:

- implements an existing feature request that other users also want;
- keeps current behavior unchanged by default (new behavior is opt-in);
- reuses components that already exist in the application;
- adds no new dependency, or only a small one that is useful in more places.

A feature idea will likely be declined when it:

- can be built as a user script or custom widget instead. Trilium is very
  scriptable, and specialized needs fit well there;
- duplicates something the application can already do;
- adds a setting for a single use case. Each setting adds long-term
  maintenance and testing work;
- is better handled outside Trilium, for example HTTP Basic Authentication
  at a reverse proxy, or packaging-only concerns.

Discuss every feature in a feature request or idea before implementation,
especially changes to default behavior, visible UI defaults, or new
settings.

Some areas are maintainer-led because they involve many architectural
decisions: the mobile apps, sync and encryption architecture, the
`trilium://` protocol, the storage model, and areas under active
maintainer redesign. Discuss these first; implementations without an
agreed plan are unlikely to be reviewed.

For a large feature, agree on the design and the delivery phases before
implementation. Explain how partial work will avoid disrupting existing
users.

## Pull requests

- Keep the pull request small and focused on one problem. Split unrelated
  changes.
- Link the related issue. Use a GitHub closing keyword only when the pull
  request fully resolves it.
- Add or update tests for the behavior you change. See the
  [Testing guide](./docs/Developer%20Guide/Developer%20Guide/Testing.md).
- Include a screenshot or short recording when the user interface changes.
- When behavior changes, update the User Guide with
  `pnpm edit-docs:edit-docs`; do not edit those Markdown files directly.
  The Developer Guide can be edited directly.
- Every pull request is manually tested and reviewed by a maintainer.
  Review can take time, especially for large changes. Update the branch
  when it conflicts with `main` or when a maintainer asks.

## AI-assisted contributions

You are responsible for everything you submit, whether or not you used AI
tools. Review and test generated changes, and be ready to explain them.

Bulk or unverified submissions may be closed without detailed review. For
architecture-scale work, agree with a maintainer on the design and on
expectations for AI use before coding.

## Conduct

Please treat each other with respect and understanding.
