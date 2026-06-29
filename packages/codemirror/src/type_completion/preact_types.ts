// Real Preact type declarations injected into the JSX script-note vfs so the
// `trilium:preact` import (and JSX intrinsic elements) resolve to actual types
// rather than `any`.
//
// JSX render notes run Preact's classic `h`/`Fragment` transform at runtime
// (see `buildJsx` in `packages/trilium-core/src/services/script.ts`), but the
// language service only *type-checks* — it never emits. So for checking we use
// the modern automatic runtime (`jsx: ReactJSX`, `jsxImportSource: "preact"`),
// which resolves the full `JSX.IntrinsicElements` namespace from
// `preact/jsx-runtime`. This avoids hand-authoring every HTML element's props.
//
// Like `jquery_types.ts`, the .d.ts text is read with relative `?raw` imports at
// build time, so it tracks the installed `preact` version with no vendored
// snapshot and lands in the lazy script-editor chunk (loaded only when a JSX
// note opens).
import hooksIndex from "../../../../node_modules/preact/hooks/src/index.d.ts?raw";
import jsxRuntime from "../../../../node_modules/preact/jsx-runtime/src/index.d.ts?raw";
import preactDom from "../../../../node_modules/preact/src/dom.d.ts?raw";
import preactIndex from "../../../../node_modules/preact/src/index.d.ts?raw";
import preactJsx from "../../../../node_modules/preact/src/jsx.d.ts?raw";
// The Trilium-specific `trilium:preact` surface (components + defineWidget) is the
// shared single source of truth in commons — the same definition the script-deployer
// uses, drift-guarded against the real `preactAPI`.
import triliumPreactSurface from "../../../commons/src/lib/script_api_preact.ts?raw";

/**
 * Minimal `package.json` shims so the vfs's node10 module resolution finds each
 * subpath's `types` entry (`exports` maps are ignored under node10). The four
 * `.d.ts` files reference each other via the bare `preact` / `preact/...`
 * specifiers and relative paths, so the directory layout must match the real
 * package.
 */
function typesPackageJson(): string {
    return JSON.stringify({ types: "src/index.d.ts" });
}

/**
 * Virtual files placed under `/node_modules/preact` so `import … from "preact"`,
 * `"preact/hooks"` and `"preact/jsx-runtime"` resolve. Keyed by absolute vfs
 * path. Merge into the JSX env's file map.
 */
export const preactVfsFiles: Record<string, string> = {
    "/node_modules/preact/package.json": typesPackageJson(),
    "/node_modules/preact/src/index.d.ts": preactIndex,
    "/node_modules/preact/src/jsx.d.ts": preactJsx,
    "/node_modules/preact/src/dom.d.ts": preactDom,
    "/node_modules/preact/hooks/package.json": typesPackageJson(),
    "/node_modules/preact/hooks/src/index.d.ts": hooksIndex,
    "/node_modules/preact/jsx-runtime/package.json": typesPackageJson(),
    "/node_modules/preact/jsx-runtime/src/index.d.ts": jsxRuntime
};

// The shared surface uses `export declare const`/`function` (valid as a standalone
// module). Inside an ambient `declare module` block the `declare` modifier is
// redundant and disallowed, so strip it when wrapping.
const triliumPreactBody = triliumPreactSurface.replace(/^export declare /gm, "export ");

/**
 * Ambient declarations for the bare-specifier imports a JSX render note uses:
 *  - `trilium:preact` re-exports Preact core + all hooks from the real package,
 *    plus the shared Trilium component surface (`@triliumnext/commons`).
 *  - `trilium:api` exposes the same object as the `api` global.
 */
export const triliumModulesDts = `
declare module "trilium:preact" {
    export * from "preact";
    export * from "preact/hooks";
${triliumPreactBody}
}

declare module "trilium:api" {
    import type { FrontendApi } from "./trilium-script-api";
    // Render notes import members by name (\`import { showMessage } from "trilium:api"\`),
    // which the server rewrites to property access on the \`api\` global at runtime.
    // A destructuring export is the only declaration form that exposes named members
    // (a default/\`export =\` of the object does not).
    export const {
        $container, startNote, currentNote, originEntity, dayjs,
        RightPanelWidget, NoteContextAwareWidget, BasicWidget,
        activateNote, activateNewNote, openTabWithNote, openSplitWithNote,
        runOnBackend, runAsyncOnBackendWithManualTransactionHandling,
        searchForNotes, searchForNote, getNote, getNotes, reloadNotes, getInstanceName,
        addTextToActiveContextEditor, getActiveContextNote, getActiveContext, getActiveMainContext,
        getNoteContexts, getMainNoteContexts, getActiveContextTextEditor, getActiveContextCodeEditor,
        getActiveNoteDetailWidget, getActiveContextNotePath, getComponentByEl,
        showMessage, showError, showInfoDialog, showConfirmDialog, showPromptDialog,
        createLink, createNoteLink, triggerCommand, triggerEvent, setupElementTooltip,
        protectNote, protectSubTree,
        getTodayNote, getDayNote, getWeekFirstDayNote, getWeekNote, getMonthNote, getQuarterNote, getYearNote,
        setHoistedNoteId, bindGlobalShortcut, waitUntilSynced, refreshIncludedNote,
        randomString, formatSize, formatNoteSize, formatDateISO, parseDate,
        logMessages, logSpacedUpdates, log, preact,
    }: FrontendApi;
}
`;
