# Releasing a new version
Releasing is mostly handled by the CI:

*   The version on GitHub is published automatically, including the description with the change log which is taken from the documentation.
*   A PR is created automatically on the Winget repository to update to the new version.

Releases are usually made directly from the `main` branch. For hot-fixes the process is the same but with a different branch, consult the <a class="reference-link" href="../Branching%20strategy.md">Branching strategy</a> for more information.

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