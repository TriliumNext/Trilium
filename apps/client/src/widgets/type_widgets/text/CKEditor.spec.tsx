import type {
    CKEditorError, CKTextEditor, DocumentHeading, ModelElement
} from "@triliumnext/ckeditor5";
import { createRef, render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CKEditor, { type CKEditorApi } from "./CKEditor";
import { buildConfig } from "./config";

const mocks = vi.hoisted(() => ({
    options: {} as Record<string, string | boolean>,
    create: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    stopReportingErrors: vi.fn(),
    reportError: undefined as ((error: Error) => void) | undefined,
    reportingEditor: undefined as unknown,
    note: undefined as { noteId: string; title: string } | undefined,
    getHeadings: vi.fn((_editor: unknown): DocumentHeading[] => []),
    assignBlockId: vi.fn((_model: unknown, _element: unknown) => "new")
}));

vi.mock("@triliumnext/ckeditor5", () => {
    class MockEditor {
        plugins = { has: () => false };
        model = { document: { on() {}, off() {} } };

        static async create() {
            await mocks.create();
            return new MockEditor();
        }

        destroy() {
            return mocks.destroy();
        }
    }

    return {
        CKTextEditor: class {},
        ClassicEditor: MockEditor,
        PopupEditor: MockEditor,
        getHeadings: mocks.getHeadings,
        assignBlockId: mocks.assignBlockId,
        onTextEditorError: (editor: unknown, callback: (error: Error) => void) => {
            mocks.reportingEditor = editor;
            mocks.reportError = callback;
            return mocks.stopReportingErrors;
        }
    };
});

vi.mock("../../react/hooks", () => ({
    useKeyboardShortcuts: () => {},
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
    mocks.stopReportingErrors.mockClear();
    mocks.reportError = undefined;
    mocks.reportingEditor = undefined;
    mocks.getHeadings.mockReset();
    mocks.assignBlockId.mockReset();
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(async () => {
    // The unmount cleanup runs after paint and destroys the editor on the build queue, so both
    // are flushed before the next test counts calls.
    await act(async () => render(null, host));
    await new Promise((resolve) => setTimeout(resolve));
    document.body.innerHTML = "";
});

describe("CKEditor", () => {
    it("rebuilds an open editor when the MathLive option changes", async () => {
        const props = {
            contentLanguage: null,
            editorRef: createRef<CKTextEditor>(),
            onChange: vi.fn(),
            editorApi: createRef<CKEditorApi>(),
            templates: []
        };

        await act(async () => {
            render(<CKEditor {...props} />, host);
        });
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
        const firstEditor = props.editorRef.current;

        mocks.options.mathFieldEnabled = false;
        await act(async () => {
            render(<CKEditor {...props} className="force-rerender" />, host);
        });

        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
        expect(mocks.destroy).toHaveBeenCalledTimes(1);
        expect(mocks.stopReportingErrors).toHaveBeenCalledTimes(1);
        expect(props.editorRef.current).not.toBe(firstEditor);
        expect(mocks.reportingEditor).toBe(props.editorRef.current);
    });

    it("rebuilds the editor for a new rebuildKey, even when destroying the old one fails", async () => {
        const props = {
            contentLanguage: null,
            editorRef: createRef<CKTextEditor>(),
            onChange: vi.fn(),
            editorApi: createRef<CKEditorApi>(),
            templates: []
        };
        await act(async () => {
            render(<CKEditor {...props} rebuildKey={0} />, host);
        });
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
        const crashedEditor = props.editorRef.current;

        mocks.destroy.mockRejectedValueOnce(new Error("destroy failed"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await act(async () => {
            render(<CKEditor {...props} rebuildKey={1} />, host);
        });

        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
        expect(mocks.destroy).toHaveBeenCalledOnce();
        expect(props.editorRef.current).not.toBeNull();
        expect(props.editorRef.current).not.toBe(crashedEditor);
        expect(warn).toHaveBeenCalledWith("CKEditor destroy failed", expect.any(Error));
        warn.mockRestore();
    });

    it("hands the errors of its editor to onEditorError, until it destroys the editor", async () => {
        const onEditorError = vi.fn();
        const props = {
            contentLanguage: null,
            editorRef: createRef<CKTextEditor>(),
            onChange: vi.fn(),
            onEditorError,
            editorApi: createRef<CKEditorApi>(),
            templates: []
        };
        await act(async () => {
            render(<CKEditor {...props} />, host);
        });
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());

        expect(props.editorRef.current).not.toBeNull();
        expect(mocks.reportingEditor).toBe(props.editorRef.current);
        const error = new Error("editor-error") as CKEditorError;
        mocks.reportError?.(error);
        expect(onEditorError).toHaveBeenCalledExactlyOnceWith(error);

        await act(async () => render(null, host));
        await vi.waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
        expect(mocks.stopReportingErrors).toHaveBeenCalledOnce();
        expect(props.editorRef.current).toBeNull();
    });

    it("tells the editor config which note it edits, as the note changes", async () => {
        mocks.note = { noteId: "host1", title: "Host" };
        const props = {
            contentLanguage: null,
            editorRef: createRef<CKTextEditor>(),
            onChange: vi.fn(),
            editorApi: createRef<CKEditorApi>(),
            templates: []
        };
        await act(async () => {
            render(<CKEditor {...props} />, host);
        });

        await vi.waitFor(() => expect(buildConfig).toHaveBeenCalled());
        const opts = vi.mocked(buildConfig).mock.lastCall?.[0];
        expect(opts?.getNoteId?.()).toBe("host1");
        expect(opts?.isExcerpt?.()).toBe(false);

        mocks.note = { noteId: "host2", title: "Other" };
        await act(async () => {
            render(<CKEditor {...props} className="force-rerender" isExcerpt />, host);
        });

        expect(opts?.getNoteId?.()).toBe("host2");
        expect(opts?.isExcerpt?.()).toBe(true);
    });

    it("lists the headings of its editor and gives one a block id, while it has one", async () => {
        const props = {
            contentLanguage: null,
            editorRef: createRef<CKTextEditor>(),
            onChange: vi.fn(),
            editorApi: createRef<CKEditorApi>(),
            templates: []
        };
        await act(async () => {
            render(<CKEditor {...props} />, host);
        });
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
        const api = props.editorApi.current;
        const editor = props.editorRef.current;
        const heading = { element: {} as ModelElement, level: 2, text: "Intro" };
        mocks.getHeadings.mockReturnValue([ heading ]);

        expect(api?.getHeadings()).toEqual([ heading ]);
        expect(mocks.getHeadings).toHaveBeenCalledExactlyOnceWith(editor);
        expect(api?.assignBlockId(heading)).toBe("new");
        expect(mocks.assignBlockId)
            .toHaveBeenCalledExactlyOnceWith(editor?.model, heading.element);

        await act(async () => render(null, host));
        await vi.waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
        expect(api?.getHeadings()).toEqual([]);
        expect(api?.assignBlockId(heading)).toBeUndefined();
    });
});
