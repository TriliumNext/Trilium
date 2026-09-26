import type { EditorWatchdog } from "@triliumnext/ckeditor5";
import { createRef, render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CKEditorWithWatchdog, { type CKEditorApi } from "./CKEditorWithWatchdog";

const mocks = vi.hoisted(() => ({
    options: {} as Record<string, string | boolean>,
    create: vi.fn(async () => {}),
    destroy: vi.fn(async () => {})
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
    useLegacyImperativeHandlers: () => {},
    useNoteContext: () => ({
        parentComponent: undefined,
        ntxId: undefined,
        note: undefined,
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
});
