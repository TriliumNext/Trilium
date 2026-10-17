import type { InlineEmbedSource } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SourceEmbedProps } from "../../../services/source_embeds";
import { createInlineSourceEditor, InlineSourceEmbed } from "./SourceEmbed";

/** An inline source as the text editor hands it over, which notifies its listeners on writes. */
function createSource(initial: string, isReadOnly = false): InlineEmbedSource {
    let source = initial;
    const listeners = new Set<() => void>();
    return {
        language: "mermaid",
        getSource: () => source,
        setSource: vi.fn((value: string) => {
            source = value;
            for (const listener of listeners) listener();
        }),
        subscribe: (callback) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        isReadOnly: () => isReadOnly
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("createInlineSourceEditor", () => {
    it("writes the latest content once it stops changing, and keeps it unsaved until then", () => {
        vi.useFakeTimers();
        const source = createSource("a");
        const editor = createInlineSourceEditor(source);
        const onSaved = vi.fn();

        expect(editor.canEdit()).toBe(true);
        expect(editor.getUnsavedContent()).toBeUndefined();

        editor.scheduleSave(() => "ab");
        editor.scheduleSave(() => "abc", onSaved);
        expect(editor.getUnsavedContent()).toBe("abc");
        expect(source.setSource).not.toHaveBeenCalled();

        vi.advanceTimersByTime(500);
        expect(source.setSource).toHaveBeenCalledExactlyOnceWith("abc");
        expect(onSaved).toHaveBeenCalledWith("abc");
        expect(editor.getUnsavedContent()).toBeUndefined();
    });

    it("writes pending content at once when released, and nothing when there is none", () => {
        vi.useFakeTimers();
        const source = createSource("a");
        const editor = createInlineSourceEditor(source);

        editor.release();
        expect(source.setSource).not.toHaveBeenCalled();

        editor.scheduleSave(() => "b");
        editor.release();
        expect(source.setSource).toHaveBeenCalledExactlyOnceWith("b");

        vi.advanceTimersByTime(500);
        expect(source.setSource).toHaveBeenCalledOnce();
    });

    it("cannot edit the source of a read-only text editor", () => {
        expect(createInlineSourceEditor(createSource("a", true)).canEdit()).toBe(false);
    });
});

describe("InlineSourceEmbed", () => {
    it("passes the source and its editor to the component, and the source again once it changes", () => {
        const container = document.createElement("div");
        const source = createSource("graph TD;");
        const shown: SourceEmbedProps[] = [];
        const Probe = (props: SourceEmbedProps) => {
            shown.push(props);
            return null;
        };

        act(() => render(<InlineSourceEmbed source={source} component={Probe} />, container));
        expect(shown.at(-1)?.content).toBe("graph TD;");
        expect(shown.at(-1)?.editor?.canEdit()).toBe(true);

        // As an undo in the text editor changes the source.
        act(() => source.setSource("graph LR;"));
        expect(shown.at(-1)?.content).toBe("graph LR;");

        act(() => render(null, container));
    });

    it("writes the unsaved content when it goes away", () => {
        vi.useFakeTimers();
        const container = document.createElement("div");
        const source = createSource("a");
        let editor: SourceEmbedProps["editor"];
        const Probe = (props: SourceEmbedProps) => {
            editor = props.editor;
            return null;
        };

        act(() => render(<InlineSourceEmbed source={source} component={Probe} />, container));
        editor?.scheduleSave(() => "b");
        act(() => render(null, container));

        expect(source.setSource).toHaveBeenCalledExactlyOnceWith("b");
    });
});
