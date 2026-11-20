import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import type NoteContext from "../../../components/note_context";
import { renderInto } from "../../../test/render";
import { useContentElement, useGetContextDataFrom, useTextEditor } from "./note_context";

describe("per-context hooks", () => {
    it("useTextEditor() returns null for an editor resolved for another context", async () => {
        const editorA = { name: "A" } as unknown as CKTextEditor;
        const editorB = { name: "B" } as unknown as CKTextEditor;
        const a = createNoteContext("a", { editor: editorA });
        const b = createNoteContext("b", { editor: editorB, isPending: true });
        const renders = await renderSwitch(a, b, (noteContext) => useTextEditor(noteContext));

        expect(renders.before.at(-1)).toBe(editorA);
        expect(renders.after.length).toBeGreaterThan(0);
        expect(renders.after.every((value) => value === null)).toBe(true);

        b.resolve();
        await settle();
        expect(renders.after.at(-1)).toBe(editorB);
    });

    it("useContentElement() returns null for an element resolved for another context", async () => {
        const elementA = document.createElement("div");
        const elementB = document.createElement("div");
        const a = createNoteContext("a", { contentElement: elementA });
        const b = createNoteContext("b", { contentElement: elementB, isPending: true });
        const renders = await renderSwitch(a, b, (noteContext) => useContentElement(noteContext));

        expect(renders.before.at(-1)).toBe(elementA);
        expect(renders.after.length).toBeGreaterThan(0);
        expect(renders.after.every((value) => value === null)).toBe(true);

        b.resolve();
        await settle();
        expect(renders.after.at(-1)).toBe(elementB);
    });

    it("useGetContextDataFrom() reads the new context's data in the render that switches", async () => {
        const dataA: unknown = { headings: [ "A" ] };
        const dataB: unknown = { headings: [ "B" ] };
        const a = createNoteContext("a", { data: dataA });
        const b = createNoteContext("b", { data: dataB });
        const renders = await renderSwitch(a, b,
            (noteContext) => useGetContextDataFrom(noteContext, "toc"));

        expect(renders.before.at(-1)).toBe(dataA);
        expect(renders.after.length).toBeGreaterThan(0);
        expect(renders.after.every((value) => value === dataB)).toBe(true);
    });
});

interface FakeNoteContextOptions {
    editor?: CKTextEditor;
    contentElement?: HTMLElement;
    data?: unknown;
    /** Whether the editor and content element lookups wait for `resolve()`. */
    isPending?: boolean;
}

interface FakeNoteContext {
    noteContext: NoteContext;
    /** Answers the pending lookups. */
    resolve(): void;
}

function createNoteContext(ntxId: string, options: FakeNoteContextOptions) {
    const pending: (() => void)[] = [];
    const answer = (callback: () => void) => {
        if (options.isPending) {
            pending.push(callback);
        } else {
            callback();
        }
    };
    const noteContext = {
        ntxId,
        getTextEditor(callback: (editor: CKTextEditor | undefined) => void) {
            answer(() => callback(options.editor));
        },
        getContentElement() {
            return new Promise((resolve) => {
                answer(() => resolve(options.contentElement ? [ options.contentElement ] : null));
            });
        },
        getContextData: () => options.data
    } as unknown as NoteContext;

    return {
        noteContext,
        resolve() {
            for (const callback of pending.splice(0)) {
                callback();
            }
        }
    } satisfies FakeNoteContext;
}

/**
 * Renders `useValue` under `a`, then under `b`, and returns what each render read: `before` under
 * `a`, `after` under `b`.
 */
async function renderSwitch<T>(
    a: FakeNoteContext, b: FakeNoteContext,
    useValue: (noteContext: NoteContext) => T
) {
    const renders = { before: [] as T[], after: [] as T[] };
    let target = renders.before;
    function Harness({ noteContext }: { noteContext: NoteContext }) {
        target.push(useValue(noteContext));
        return null;
    }

    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<Harness noteContext={a.noteContext} />);
    });
    await settle();
    target = renders.after;
    await act(async () => {
        if (container) {
            render(<Harness noteContext={b.noteContext} />, container);
        }
    });
    await settle();
    return renders;
}

/** Lets the lookups answer and the renders they cause run. */
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}
