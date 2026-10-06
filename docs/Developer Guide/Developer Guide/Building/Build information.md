# Build information
*   Provides context about when the build was made and the corresponding Git revision.
*   The information is displayed to the client when going in the about dialog.
*   The build information is hard-coded in `packages/trilium-core/src/services/build.ts`. This file is generated automatically via `chore:update-build-info` which itself is run automatically whenever making a build in the CI.
*   Passing `--from-commit` stamps the commit's date instead of the current time, so that two builds of the same source agree. The Flathub build uses it, since it rebuilds published tags.