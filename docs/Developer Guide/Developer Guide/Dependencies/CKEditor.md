# CKEditor
*   We migrated away from the legacy CKEditor builds using Webpack and instead use the prebuilt npm binaries.
*   The role of the `packages/ckeditor5` is to gather the CKEditor for consumption by the client, which includes plugin definitions.
*   The internal Trilium plugins (e.g. cut to note, include note) are present in `packages/ckeditor5/src/plugins`.
*   External CKEditor plugins that needed adjustments are present in `packages/ckeditor5-*`.
    *   To integrate a new plugin, see <a class="reference-link" href="CKEditor/Plugin%20migration%20guide.md">Plugin migration guide</a>.