# Branching strategy
## Main branch

The main development branch is conveniently called `main`. This branch contains all the merged features and is considered semi-stable.

## Development

Every new development must be done in a separate branch (usually prefixed with `feature/`). The PR must then be reviewed.

## Reviewing

Each PR must be tested manually and reviewed by a maintainer. For PRs that are made by the maintainers themselves, an LLM review from Copilot or Gemini are also accepted.

After a PR is approved, it is merged into the `main` branch and the change log draft is updated.

## Releasing

[Releasing a new version](Building/Releasing%20a%20new%20version.md) is done straight from the `main` branch once it's deemed stable enough for production.

## Hot-fixing

After releasing a new version, it's sometimes desirable to create a hotfix in order to fix some issues with the production version without introducing many changes that might have already been merged in `main`.

To do so, the procedure is as follows:

1.  A `hotfix` branch is created, from the tag of the release.
2.  If fixes/features from the `main` branch are needed, they are cherry-picked directly onto the branch.
3.  New fixes/features are either developed directly on the `hotfix` branch or an a PR that targets this branch, depending on the complexity.
4.  A new version is released from the `hotfix` version.
5.  The `hotfix` version is merged back into `main`, via a PR.