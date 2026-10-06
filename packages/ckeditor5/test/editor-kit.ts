import { ClassicEditor, type Editor } from "ckeditor5";

/**
 * Shared editor lifecycle helpers for the spec suite.
 *
 * Every spec used to repeat the same `document.createElement("div")` +
 * `document.body.appendChild(...)` + `ClassicEditor.create({ licenseKey: "GPL", ... })`
 * scaffold in a `beforeEach`, plus a matching `editorElement.remove()` + `editor.destroy()`
 * in an `afterEach`. `createTestEditor()` collapses the setup to a single call and records
 * the editor so the global `afterEach` in `setup.ts` can tear it down — so specs no longer
 * need an `afterEach` for editor cleanup at all.
 *
 * This file lives outside `src/`, so it is excluded from both the production build
 * (tsconfig.lib.json compiles `src/**`) and the 100% coverage gate (coverage instruments
 * `src/**` only) without any config carve-out.
 */

type EditorCreateConfig = NonNullable<Parameters<typeof ClassicEditor.create>[1]>;

interface TrackedEditor {
    editor: Editor;
    editorElement: HTMLDivElement;
}

/** An editor class as the kit reaches for it: `ClassicEditor`, `BalloonEditor`, and the rest. */
interface EditorClass<T extends Editor> {
    create(sourceElement: HTMLElement, config: EditorCreateConfig): Promise<T>;
}

const trackedEditors: TrackedEditor[] = [];

/**
 * Create a real `ClassicEditor` over a fresh host element, with `licenseKey: "GPL"` and the
 * given plugins. Any extra editor config (e.g. `balloonToolbar`, `toolbar`) can be passed via
 * `extraConfig`. The editor is tracked for automatic teardown; use {@link getEditorElement} to
 * retrieve the host element for the spec that needs it.
 */
export async function createTestEditor(
    plugins: EditorCreateConfig["plugins"],
    extraConfig: Omit<EditorCreateConfig, "plugins"> = {}
): Promise<ClassicEditor> {
    return createTestEditorOf(ClassicEditor, plugins, extraConfig);
}

/**
 * The same, over the editor class the spec names — for a spec whose subject is what a given
 * editor builds around it, such as the toolbar a `BalloonEditor` has instead of a fixed bar.
 */
export async function createTestEditorOf<T extends Editor>(
    EditorClass: EditorClass<T>,
    plugins: EditorCreateConfig["plugins"],
    extraConfig: Omit<EditorCreateConfig, "plugins"> = {}
): Promise<T> {
    const editorElement = document.createElement("div");
    document.body.appendChild(editorElement);

    const editor = await EditorClass.create(editorElement, {
        licenseKey: "GPL",
        plugins,
        ...extraConfig
    });

    trackedEditors.push({ editor, editorElement });
    return editor;
}

/**
 * Return the host `<div>` an editor was created over via {@link createTestEditor}. Throws if the
 * editor was not created through the kit, so callers narrow the element without a non-null `!`.
 */
export function getEditorElement(editor: Editor): HTMLDivElement {
    const tracked = trackedEditors.find((entry) => entry.editor === editor);
    if (!tracked) {
        throw new Error("Editor was not created via createTestEditor(); no host element is tracked.");
    }
    return tracked.editorElement;
}

/**
 * Destroy every editor created via {@link createTestEditor} and remove its host element.
 * Called from the global `afterEach` in `setup.ts`; safe to call when nothing is tracked.
 */
export async function destroyTrackedEditors(): Promise<void> {
    const editors = trackedEditors.splice(0);
    for (const { editor, editorElement } of editors) {
        try {
            await editor.destroy();
        } finally {
            editorElement.remove();
        }
    }
}
