// Global jQuery type declarations injected into the FRONTEND script-note vfs so
// `$(…)` and the `JQuery` type resolve.
//
// `@types/jquery@4` is a module (`export = jQuery`) whose `exports` map hides its
// internal .d.ts subpaths, so a *bare* import (`@types/jquery/JQuery.d.ts`) is
// blocked. A *relative* path into node_modules is resolved as a plain file and
// bypasses `exports`, so we read the four global-declaring files as raw text at
// build time — content tracks the installed @types/jquery, no vendored snapshot.
// (index.d.ts is the module wrapper; these four are the files it references.)
import jqLegacy from "../../../../node_modules/@types/jquery/legacy.d.ts?raw";
import jqMisc from "../../../../node_modules/@types/jquery/misc.d.ts?raw";
import jq from "../../../../node_modules/@types/jquery/JQuery.d.ts?raw";
import jqStatic from "../../../../node_modules/@types/jquery/JQueryStatic.d.ts?raw";

/**
 * The four files plus the `$` / `jQuery` global declarations Trilium exposes
 * (mirroring the client's `types.d.ts`), concatenated into one ambient .d.ts.
 * The files don't reference each other, so concatenation order is irrelevant.
 */
export const jqueryGlobals = [
    jqStatic,
    jq,
    jqMisc,
    jqLegacy,
    "declare const $: JQueryStatic;",
    "declare const jQuery: JQueryStatic;"
].join("\n");
