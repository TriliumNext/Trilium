# Repo migration scripts

> [!NOTE]
> These scripts were designed to be single use only, since they took care of migrating between repos. As such, they are not actively maintained and are to be used for reference only.

These scripts were used in the process of migrating from the forked [Notes](https://github.com/TriliumNext/Notes) repo to the original [Trilium](https://github.com/TriliumNext/Trilium) repo.
Since Git only migrates the code and not the GitHub-specific data, we had to create scripts that handle the migration of:

* Issues, using the "Transfer" function for each issue (via `gh cli`).
  * The migration logs are available in `migrated-issues.txt`.
* Discussions, which transferred each discussion from the original repo. This one is a bit more complicated (and potentially flaky) since it works via playwright, by manually selecting the "Transfer" function (no API available at the time).
  * The migration logs are available in `migrated-discussions.txt`.
* Releases, by manually downloading the assets from the source repo and creating new releases into the destination repo.