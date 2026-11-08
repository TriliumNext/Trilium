# Releasing a new version
Releasing is mostly handled by the CI:

*   The version on GitHub is published automatically, including the description with the change log which is taken from the documentation.
*   A PR is created automatically on the Winget repository to update to the new version.

Releases are usually made directly from the `main` branch. For hot-fixes the process is the same but with a different branch, consult the <a class="reference-link" href="../Branching%20strategy.md">Branching strategy</a> for more information.

## Using the release CLI

`pnpm chore:release` walks through the whole process interactively:

1.  Checks that the branch is not behind `origin` and that every changelog entry is valid.
2.  Proposes the version from the changelog entries: a major release (`0.106.1` → `0.107.0`) when they contain a breaking change, a highlight, a compatibility change or a new feature, when the sync or database version changed, or when there are many of them; otherwise a minor one (`0.106.1` → `0.106.2`). A release note already drafted for a newer version takes precedence.
3.  Drafts the release note if there is none, registers it in the Release Notes folder and warns about the changelog entries that changed after it. Once the note is final, it consumes the entries and commits the note.
4.  Sets the version in every `package.json`, commits it and runs the release pre-flight check.
5.  Tags the commit and pushes the branch and the tag, which starts the release workflow.
6.  Merges the tag into the `stable` branch and pushes it (not for pre-releases).

It asks before every commit and push, and each step skips what is already done, so a run that stopped halfway can be started again. `pnpm chore:release --dry-run` asks the same questions but prints the commands instead of running them.

## Manual process

The process is as follows:

1.  Edit the <a class="reference-link" href="../Documentation.md">Documentation</a> to add a corresponding entry in the _Release notes_ section.
2.  In the root `package.json`, set `version` to the new version to be released.
3.  Run `chore:update-version` to automatically update the version of the rest of the `package.json` files.
4.  Run `pnpm i` to update the package lock as well.
5.  Commit the changes to the `package.json` files and the `package-lock.json`. The commit message is usually `chore(release): prepare for v1.2.3`.
6.  Tag the newly created commit: `git tag v1.2.3`
7.  Push the commit and the newly created tag: `git push; git push --tags`.
8.  Wait for the CI to finish.
9.  When the release is automatically created in GitHub, download it to make sure it works OK.