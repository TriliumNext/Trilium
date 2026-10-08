import type { EditorWatchdog } from "@triliumnext/ckeditor5";
import { createRef, render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import link from "../../../services/link";
import CKEditorWithWatchdog, { type CKEditorApi } from "./CKEditorWithWatchdog";

const mocks = vi.hoisted(() => ({
    options: {} as Record<string, string | boolean>,
    create: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    note: undefined as { noteId: string; title: string } | undefined,
    handlers: {} as Record<string, (...args: unknown[]) => unknown>
}));

vi.mock("@triliumnext/ckeditor5", () => {
    class MockEditorWatchdog {
        setCreator() {}
        on() {}
        create() {
            return mocks.create();
        }
        destroy() {
            return mocks.destroy();
        }
    }

    return {
        CKTextEditor: class {},
        ClassicEditor: class {},
        EditorWatchdog: MockEditorWatchdog,
        PopupEditor: class {}
    };
});

vi.mock("../../react/hooks", () => ({
    useKeyboardShortcuts: () => {},
    useLegacyImperativeHandlers: (handlers: typeof mocks.handlers) => {
        mocks.handlers = handlers;
    },
    useNoteContext: () => ({
        parentComponent: undefined,
        ntxId: undefined,
        note: mocks.note,
        notePath: undefined
    }),
    useSyncedRef: (_externalRef: unknown, initialValue: unknown) => useRef(initialValue),
    useTriliumOption: (name: string) => [ String(mocks.options[name] ?? ""), vi.fn() ],
    useTriliumOptionBool: (name: string) => [ mocks.options[name] === true, vi.fn() ]
}));

vi.mock("./ai_quick_actions", () => ({
    useAiMenuFooter: () => undefined,
    useAiQuickActions: () => []
}));

vi.mock("./config", () => ({ buildConfig: vi.fn() }));

let host: HTMLElement;

beforeEach(() => {
    mocks.options = { locale: "en", mathFieldEnabled: true };
    mocks.note = undefined;
    mocks.create.mockClear();
    mocks.destroy.mockClear();
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
});

describe("CKEditorWithWatchdog", () => {
    it("rebuilds an open editor when the MathLive option changes", async () => {
        const watchdogRef = createRef<EditorWatchdog>();
        const editorApi = createRef<CKEditorApi>();
        const props = {
            contentLanguage: null,
            watchdogRef,
            onChange: vi.fn(),
            editorApi,
            templates: []
        };

        await act(async () => {
            render(<CKEditorWithWatchdog {...props} />, host);
        });
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

        mocks.options.mathFieldEnabled = false;
        await act(async () => {
            render(<CKEditorWithWatchdog {...props} className="force-rerender" />, host);
        });

        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
        expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });

    it("destroys its editor when it goes away", async () => {
        const props = {
            contentLanguage: null,
            watchdogRef: createRef<EditorWatchdog>(),
            onChange: vi.fn(),
            editorApi: createRef<CKEditorApi>(),
            templates: []
        };
        await act(async () => {
            render(<CKEditorWithWatchdog {...props} />, host);
        });
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());

        await act(async () => render(null, host));
        await vi.waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
        expect(props.watchdogRef.current).toBeNull();
    });

    it("labels its reference links as links in the note it edits", async () => {
        mocks.note = { noteId: "host1", title: "Host" };
        const loadReferenceLinkTitle = vi.spyOn(link, "loadReferenceLinkTitle")
            .mockResolvedValue(undefined);
        const props = {
            contentLanguage: null,
            watchdogRef: createRef<EditorWatchdog>(),
            onChange: vi.fn(),
            editorApi: createRef<CKEditorApi>(),
            templates: []
        };
        await act(async () => {
            render(<CKEditorWithWatchdog {...props} />, host);
        });

        const $el = $("<span>");
        await mocks.handlers.loadReferenceLinkTitle($el, "#root/host1?block=b1", "Stored");

        expect(loadReferenceLinkTitle)
            .toHaveBeenCalledWith($el, "#root/host1?block=b1", "host1", "Stored");
        loadReferenceLinkTitle.mockRestore();
    });
});
