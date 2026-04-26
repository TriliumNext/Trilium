import type { FunctionComponent } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AddLinkDialogTestState,createAddLinkDialogTestState, setupAddLinkDialogMocks } from "./add_link.spec_utils";

describe("AddLinkDialog", () => {
    let container: HTMLDivElement;
    let AddLinkDialog: FunctionComponent;
    let state: AddLinkDialogTestState;

    beforeEach(async () => {
        vi.resetModules();
        state = createAddLinkDialogTestState();
        vi.clearAllMocks();
        setupAddLinkDialogMocks(state);

        ({ default: AddLinkDialog } = await import("./add_link"));

        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
    });

    it("submits the selected note when Enter picks an autocomplete suggestion", async () => {
        act(() => {
            render(<AddLinkDialog />, container);
        });

        const showDialog = state.triliumEventHandlers.get("showAddLinkDialog");
        if (!showDialog) {
            throw new Error("showAddLinkDialog handler was not registered");
        }

        await act(async () => {
            showDialog({
                text: "",
                hasSelection: false,
                addLink: state.addLinkSpy
            });
        });

        act(() => {
            state.latestNoteAutocompletePropsRef.current.onKeyDownCapture({
                key: "Enter",
                ctrlKey: false,
                metaKey: false,
                shiftKey: false,
                altKey: false,
                isComposing: false
            });
            state.latestNoteAutocompletePropsRef.current.onChange({
                notePath: "root/target-note"
            });
        });

        await act(async () => {
            state.latestModalPropsRef.current.onHidden();
        });

        expect(state.addLinkSpy).toHaveBeenCalledWith("root/target-note", null);
    });
});
