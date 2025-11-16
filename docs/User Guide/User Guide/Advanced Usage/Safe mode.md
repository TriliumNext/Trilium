# Safe mode
Safe mode is triggered by setting the `TRILIUM_SAFE_MODE` environment variable to a truthy value, usually `1`.

In each artifact there is a `trilium-safe-mode.sh` (or `.bat`) script to enable it.

What it does:

*   Disables `customWidget` launcher types in `app/widgets/containers/launcher.js`.
*   Disables the running of `mobileStartup` or `frontendStartup` scripts.
*   Displays the root note instead of the previously saved session.
*   Disables the running of `backendStartup`, `hourly`, `daily` scripts and checks for the hidden subtree.