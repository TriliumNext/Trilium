/// <reference types="vite/client" />

/**
 * Ambient type declarations for the virtual modules available inside
 * Trilium user scripts (`trilium:preact` and `trilium:api`).
 *
 * These modules don't exist on disk — the server rewrites imports at
 * runtime — but providing declarations here gives us editor
 * intellisense and `tsc` checking for scripts in the `scripts/` dir.
 *
 * The frontend `api` surface comes from the shared public script-API module in
 * `@triliumnext/commons` — the same definition the in-editor language service
 * uses — so the deployer and the editor agree. It's kept honest against the real
 * implementation by drift guards in `frontend_script_api.ts`. The Preact API is
 * still pulled directly from its real implementation.
 */

type FrontendApi = import("@triliumnext/commons/src/lib/script_api").FrontendApi;

/**
 * `trilium:api` — destructured members of the frontend script API.
 *
 * At runtime the server rewrites `require("trilium:api")` to `api`,
 * which is the FrontendApi instance. Scripts destructure named
 * members from it: `import { runOnBackend, showMessage } from "trilium:api"`.
 */
declare module "trilium:api" {
    // Re-export every member of the frontend API as a named export. Kept in sync
    // with the editor's `trilium:api` declaration (packages/codemirror's
    // preact_types.ts); both destructure the shared `FrontendApi`.
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

/**
 * `trilium:preact` — the Preact API surface.
 *
 * At runtime the server rewrites `require("trilium:preact")` to `api.preact`
 * (the frozen `preactAPI` object). Scripts destructure from it:
 * `import { useState, h, Button } from "trilium:preact"`. Preact core + hooks
 * come straight from the real `preact` package; the Trilium components and
 * `defineWidget` come from the shared, drift-guarded surface in commons — the
 * same definition the in-editor language service uses.
 */
declare module "trilium:preact" {
    export * from "preact";
    export * from "preact/hooks";
    export * from "@triliumnext/commons/src/lib/script_api_preact";
}

/**
 * Global `api` object available inside `runOnBackend()` callbacks.
 * The function body is serialised and executed on the server where
 * Trilium injects this as a global.
 */
// eslint-disable-next-line no-var
declare var api: import("@triliumnext/commons/src/lib/script_api").BackendApi;
