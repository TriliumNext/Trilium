import type { FUniver } from "@univerjs/presets";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { useWorkbookFile } from "./loading";

describe("useWorkbookFile", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        // Univer cannot lay out a hidden container, so the loader waits for a size.
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
    });

    it("shows the workbook the server parsed from the file", async () => {
        const workbook = { sheetOrder: [ "s1" ], name: "Budget", sheets: {} };
        vi.spyOn(server, "getWithSilentErrors").mockResolvedValue(JSON.stringify({ version: 1, workbook }));
        const { univerAPI, states, onError } = await mount();

        await vi.waitFor(() => expect(univerAPI.createWorkbook).toHaveBeenCalledOnce());
        expect(univerAPI.createWorkbook).toHaveBeenCalledWith(expect.objectContaining({ name: "Budget", sheetOrder: [ "s1" ] }));
        expect(server.getWithSilentErrors).toHaveBeenCalledWith(expect.stringMatching(/\/spreadsheet-workbook$/), undefined, true);
        expect(states).toEqual([ "loading", "loaded" ]);
        expect(onError).not.toHaveBeenCalled();
    });

    it("leaves a file that is no workbook to the caller's fallback, without a load error", async () => {
        vi.spyOn(server, "getWithSilentErrors").mockRejectedValue("400");
        const { univerAPI, states, onError } = await mount();

        await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
        expect(univerAPI.createWorkbook).not.toHaveBeenCalled();
        expect(states).toEqual([ "loading", "loaded" ]);
    });

    it("loads an attachment's workbook from the attachment, leaving the note detail's state alone", async () => {
        const workbook = { sheetOrder: [ "s1" ], name: "Attached", sheets: {} };
        vi.spyOn(server, "getWithSilentErrors").mockResolvedValue(JSON.stringify({ version: 1, workbook }));
        const attachment = { attachmentId: "att1", title: "Attached.xlsx" } as unknown as FAttachment;
        const { univerAPI, states } = await mount(attachment);

        await vi.waitFor(() => expect(univerAPI.createWorkbook).toHaveBeenCalledOnce());
        expect(univerAPI.createWorkbook).toHaveBeenCalledWith(expect.objectContaining({ name: "Attached" }));
        expect(server.getWithSilentErrors).toHaveBeenCalledWith("attachments/att1/spreadsheet-workbook", undefined, true);
        expect(states).toEqual([]);
    });

    it("makes every workbook it shows read-only, not only the first", async () => {
        vi.spyOn(server, "getWithSilentErrors").mockImplementation(async (url: string) =>
            JSON.stringify({ version: 1, workbook: { name: url, sheets: {} } }));
        const { univerAPI, rerender } = await mount();
        await vi.waitFor(() => expect(univerAPI.createWorkbook).toHaveBeenCalledOnce());

        await rerender(buildNote({ title: "Other.xlsx", type: "file" }));
        await vi.waitFor(() => expect(univerAPI.createWorkbook).toHaveBeenCalledTimes(2));

        const workbooks = univerAPI.createWorkbook.mock.results.map((result) => result.value as MockWorkbook);
        for (const workbook of workbooks) {
            expect(workbook.disableSelection).toHaveBeenCalledOnce();
            expect(workbook.setReadOnly).toHaveBeenCalledOnce();
        }
    });

    it("waits for Univer to render before making the first workbook read-only", async () => {
        vi.spyOn(server, "getWithSilentErrors").mockResolvedValue(JSON.stringify({ version: 1, workbook: {} }));
        const { univerAPI, enterStage } = await mount(undefined, { stage: LIFECYCLE_STAGES.Ready });
        await vi.waitFor(() => expect(univerAPI.createWorkbook).toHaveBeenCalledOnce());
        const workbook = univerAPI.createWorkbook.mock.results[0]?.value as MockWorkbook;
        expect(workbook.setReadOnly).not.toHaveBeenCalled();

        enterStage(LIFECYCLE_STAGES.Ready);
        expect(workbook.setReadOnly).not.toHaveBeenCalled();
        univerAPI.getActiveWorkbook.mockReturnValue(workbook);
        enterStage(LIFECYCLE_STAGES.Rendered);
        expect(workbook.setReadOnly).toHaveBeenCalledOnce();
        expect(workbook.disableSelection).toHaveBeenCalledOnce();
        enterStage(LIFECYCLE_STAGES.Steady);
        expect(workbook.setReadOnly).toHaveBeenCalledOnce();
    });

    it("leaves the note detail's load state alone while the viewer is hidden", async () => {
        vi.spyOn(server, "getWithSilentErrors").mockResolvedValue(JSON.stringify({ version: 1, workbook: {} }));
        const { univerAPI, states } = await mount(undefined, { isVisible: false });

        await vi.waitFor(() => expect(univerAPI.createWorkbook).toHaveBeenCalledOnce());
        expect(states).toEqual([]);
    });

    async function mount(entity: FNote | FAttachment = buildNote({ title: "Budget.xlsx", type: "file" }),
        { isVisible = true, stage = LIFECYCLE_STAGES.Rendered }: { isVisible?: boolean; stage?: number } = {}) {
        let currentStage = stage;
        const stageListeners = new Set<(event: { stage: number }) => void>();
        const univerAPI = {
            getActiveWorkbook: vi.fn<() => MockWorkbook | null>(() => null),
            createWorkbook: vi.fn(() => mockWorkbook()),
            disposeUnit: vi.fn(),
            getCurrentLifecycleStage: () => currentStage,
            addEvent: vi.fn((_event: string, listener: (event: { stage: number }) => void) => {
                stageListeners.add(listener);
                return { dispose: () => stageListeners.delete(listener) };
            }),
            Event: { LifeCycleChanged: "LifeCycleChanged" },
            Enum: { LifecycleStages: LIFECYCLE_STAGES }
        };
        const enterStage = (next: number) => {
            currentStage = next;
            for (const listener of [ ...stageListeners ]) listener({ stage: next });
        };
        const states: string[] = [];
        const noteContext = {
            setContextData(_key: string, value: { state: string }) {
                states.push(value.state);
            }
        } as unknown as NoteContext;
        const onError = vi.fn();

        const show = async (shown: FNote | FAttachment) => {
            await act(async () => {
                render(<Harness entity={shown} noteContext={noteContext} isVisible={isVisible}
                    univerAPI={univerAPI as unknown as FUniver} onError={onError} />, container);
            });
        };
        await show(entity);
        return { univerAPI, states, onError, enterStage, rerender: show };
    }
});

const LIFECYCLE_STAGES = { Starting: 0, Ready: 1, Rendered: 2, Steady: 3 };

type MockWorkbook = ReturnType<typeof mockWorkbook>;

function mockWorkbook() {
    const setReadOnly = vi.fn();
    return {
        disableSelection: vi.fn(),
        getWorkbookPermission: () => ({ setReadOnly }),
        setReadOnly
    };
}

function Harness({ entity, noteContext, isVisible, univerAPI, onError }: {
    entity: FNote | FAttachment; noteContext: NoteContext; isVisible: boolean; univerAPI: FUniver; onError: () => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<FUniver | undefined>(univerAPI);
    useWorkbookFile({ entity, noteContext, componentId: undefined, isVisible }, apiRef, containerRef, onError);
    return <div ref={containerRef} />;
}
