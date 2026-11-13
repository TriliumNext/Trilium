import type { FUniver } from "@univerjs/presets";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
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

    async function mount() {
        const note = buildNote({ title: "Budget.xlsx", type: "file" });
        const univerAPI = {
            getActiveWorkbook: vi.fn(() => null),
            createWorkbook: vi.fn(() => ({})),
            disposeUnit: vi.fn()
        };
        const states: string[] = [];
        const noteContext = {
            setContextData(_key: string, value: { state: string }) {
                states.push(value.state);
            }
        } as unknown as NoteContext;
        const onError = vi.fn();

        await act(async () => {
            render(<Harness note={note} noteContext={noteContext} univerAPI={univerAPI as unknown as FUniver} onError={onError} />, container);
        });
        return { univerAPI, states, onError };
    }
});

function Harness({ note, noteContext, univerAPI, onError }: { note: FNote; noteContext: NoteContext; univerAPI: FUniver; onError: () => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<FUniver | undefined>(univerAPI);
    useWorkbookFile(note, noteContext, undefined, apiRef, containerRef, onError);
    return <div ref={containerRef} />;
}
