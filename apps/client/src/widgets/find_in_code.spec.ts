import type VanillaCodeMirror from "@triliumnext/codemirror";
import { describe, expect, it, vi } from "vitest";

import type FindWidget from "./find";
import FindInCode from "./find_in_code";

describe("FindInCode", () => {
    it("checks again once it holds the editor, before a step, a write or the focus", async () => {
        const { handler, editor, release } = setUp({ isHeld: true });

        const step = handler.findNext(1, 0, 1, { check: () => false });
        const write = handler.replaceAll("pin", { start: () => false, show: () => true });
        const close = handler.findBoxClosed(() => false);
        release();

        expect(await step).toBe(false);
        expect(await write).toEqual({ isDropped: true, result: null });
        await close;
        expect(editor.findNext).not.toHaveBeenCalled();
        expect(editor.replaceAll).not.toHaveBeenCalled();
        expect(editor.cleanSearch).toHaveBeenCalledOnce();
        expect(editor.focus).not.toHaveBeenCalled();

        expect(await handler.findNext(1, 0, 1, { check: () => true })).toBe(true);
        expect(editor.findNext).toHaveBeenCalledWith(1, 0, 1);
        await handler.findBoxClosed(() => true);
        expect(editor.focus).toHaveBeenCalledOnce();
    });

    it("turns the results stale on every edit of the document, until the bar closes", async () => {
        const { handler, editor, parent } = setUp();
        expect(await handler.performFind("needle", false, false))
            .toEqual({ totalFound: 2, currentFound: 1 });

        editor.emitUpdate(false);
        expect(parent.invalidateResults).not.toHaveBeenCalled();
        editor.emitUpdate(true);
        expect(parent.invalidateResults).toHaveBeenCalledExactlyOnceWith("content");

        await handler.findBoxClosed(() => true);
        editor.emitUpdate(true);
        expect(parent.invalidateResults).toHaveBeenCalledOnce();
        expect(editor.listeners.size).toBe(0);
    });

    it("awaits a search after a write, with the write's check; returns its result", async () => {
        const { handler, editor } = setUp();
        await handler.performFind("needle", true, false);
        const show = vi.fn(() => true);

        expect(await handler.replaceAll("pin", { start: () => true, show })).toEqual({
            isDropped: false, result: { totalFound: 2, currentFound: 1 }
        });
        expect(editor.replaceAll).toHaveBeenCalledWith("pin");
        expect(editor.performFind).toHaveBeenLastCalledWith("needle", true, false, true, show);

        show.mockReturnValue(false);
        expect(await handler.replace("pin", { start: () => true, show })).toEqual({
            isDropped: false, result: null
        });
        // A search whose check fails once its editor arrives runs nothing in it.
        expect(await handler.performFind("needle", false, false, () => false)).toBeNull();
        expect(editor.performFind).toHaveBeenCalledTimes(2);
    });
});

function setUp({ isHeld = false } = {}) {
    const listeners = new Set<(update: { docChanged: boolean }) => void>();
    const editor = {
        listeners,
        performFind: vi.fn(async (..._args: unknown[]) => ({ totalFound: 2, currentFound: 1 })),
        findNext: vi.fn(async (..._args: unknown[]) => {}),
        replace: vi.fn(async (_text: string) => {}),
        replaceAll: vi.fn(async (_text: string) => {}),
        cleanSearch: vi.fn(),
        focus: vi.fn(),
        addUpdateListener: (listener: (update: { docChanged: boolean }) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emitUpdate(docChanged: boolean) {
            for (const listener of listeners) listener({ docChanged });
        }
    };
    let release: () => void = () => {};
    const arrival = isHeld
        ? new Promise<void>((resolve) => {
            release = resolve;
        })
        : Promise.resolve();
    const parent = {
        noteContext: {
            getCodeEditor: async () => {
                await arrival;
                return editor as unknown as VanillaCodeMirror;
            }
        },
        invalidateResults: vi.fn()
    };
    return { handler: new FindInCode(parent as unknown as FindWidget), editor, parent, release };
}
