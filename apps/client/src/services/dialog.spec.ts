import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

// --- Mocks (hoisted above imports) ---

// Spies are created via vi.hoisted so the vi.mock factories (which are also
// hoisted) can safely reference them.
const { modalShow, modalHide, getOrCreateInstance, triggerCommand, saveFocusedElement, focusSavedElement, updateDisplayedShortcuts } = vi.hoisted(() => {
    const modalShow = vi.fn();
    const modalHide = vi.fn();
    return {
        modalShow,
        modalHide,
        getOrCreateInstance: vi.fn(() => ({ show: modalShow, hide: modalHide })),
        triggerCommand: vi.fn(),
        saveFocusedElement: vi.fn(),
        focusSavedElement: vi.fn(),
        updateDisplayedShortcuts: vi.fn()
    };
});

vi.mock("bootstrap", () => ({
    Modal: { getOrCreateInstance }
}));

vi.mock("../components/app_context.js", () => ({
    default: { triggerCommand }
}));

vi.mock("./focus.js", () => ({ saveFocusedElement, focusSavedElement }));

vi.mock("./keyboard_actions.js", () => ({
    default: { updateDisplayedShortcuts }
}));

// Imports AFTER vi.mock calls.
import dialogService, { closeActiveDialog, openDialog } from "./dialog.js";

function makeDialog() {
    // A real jQuery-wrapped element so `.on("hidden.bs.modal", ...)` works
    // and we can trigger the handler to exercise its body.
    return $("<div class='modal'></div>");
}

describe("dialog service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        glob.activeDialog = null;
    });

    describe("openDialog", () => {
        it("closes the active dialog, sets the new one, saves focus, shows the modal and updates shortcuts", async () => {
            const previous = makeDialog();
            glob.activeDialog = previous;

            const $dialog = makeDialog();
            const config = { backdrop: false };
            const result = await openDialog($dialog, true, config);

            // previous active dialog hidden via closeActiveDialog
            expect(modalHide).toHaveBeenCalledTimes(1);
            // new dialog becomes the active one
            expect(glob.activeDialog).toBe($dialog);
            expect(saveFocusedElement).toHaveBeenCalledTimes(1);
            // modal created with the provided config and shown
            expect(getOrCreateInstance).toHaveBeenCalledWith($dialog[0], config);
            expect(modalShow).toHaveBeenCalledTimes(1);
            expect(updateDisplayedShortcuts).toHaveBeenCalledWith($dialog);
            expect(result).toBe($dialog);
        });

        it("does not close or replace the active dialog when closeActDialog is false", async () => {
            const existing = makeDialog();
            glob.activeDialog = existing;

            const $dialog = makeDialog();
            await openDialog($dialog, false);

            // closeActiveDialog branch skipped
            expect(modalHide).not.toHaveBeenCalled();
            expect(glob.activeDialog).toBe(existing);
            // config omitted -> getOrCreateInstance called with undefined config
            expect(getOrCreateInstance).toHaveBeenCalledWith($dialog[0], undefined);
            expect(saveFocusedElement).toHaveBeenCalledTimes(1);
        });

        it("refocuses the saved element on hide when there is no active dialog", async () => {
            const $dialog = makeDialog();
            await openDialog($dialog, false);

            // glob.activeDialog is null -> first part of the OR is truthy
            $dialog.trigger("hidden.bs.modal");

            expect(focusSavedElement).toHaveBeenCalledTimes(1);
        });

        it("refocuses on hide when the hidden dialog is the active dialog", async () => {
            const $dialog = makeDialog();
            // closeActDialog=true makes this dialog the active one
            await openDialog($dialog, true);
            expect(glob.activeDialog).toBe($dialog);

            $dialog.trigger("hidden.bs.modal");

            expect(focusSavedElement).toHaveBeenCalledTimes(1);
        });

        it("does NOT refocus on hide when a different dialog is active", async () => {
            const $dialog = makeDialog();
            await openDialog($dialog, false);

            // a different dialog is the active one -> both OR conditions false
            glob.activeDialog = makeDialog();
            $dialog.trigger("hidden.bs.modal");

            expect(focusSavedElement).not.toHaveBeenCalled();
        });

        it("closes the autocomplete dropdown on hide", async () => {
            const $dialog = makeDialog();
            await openDialog($dialog, false);

            // `"autocomplete" in $autocompleteEl` is true for a jQuery object only if the
            // autocomplete plugin is registered. Register a stub on the jQuery prototype so
            // the branch is taken and the plugin is invoked.
            const autocomplete = vi.fn();
            ($.fn as any).autocomplete = autocomplete;

            $dialog.trigger("hidden.bs.modal");

            expect(autocomplete).toHaveBeenCalledWith("close");

            delete ($.fn as any).autocomplete;
        });

        it("skips closing autocomplete when the plugin is not registered", async () => {
            const $dialog = makeDialog();
            await openDialog($dialog, false);

            // Ensure no autocomplete plugin is present so the `in` check is false.
            delete ($.fn as any).autocomplete;

            // Should not throw.
            expect(() => $dialog.trigger("hidden.bs.modal")).not.toThrow();
        });
    });

    describe("lifting dialogs above a stacked popup", () => {
        afterEach(() => {
            document.body.className = "";
            document.body.innerHTML = "";
        });

        function openStackedPopup(zIndex = "1100") {
            const popup = document.createElement("div");
            popup.className = "modal show tree-popup-editor-dialog";
            popup.style.zIndex = zIndex;
            document.body.appendChild(popup);
            return popup;
        }

        it("lifts the dialog above the stacked popup and raises its backdrop just below it", async () => {
            document.body.classList.add("tree-popup-stacked");
            openStackedPopup("1100");
            // The backdrop Bootstrap would append during show() (show is mocked, so pre-place it).
            const backdrop = document.createElement("div");
            backdrop.className = "modal-backdrop";
            document.body.appendChild(backdrop);

            const $dialog = makeDialog().appendTo(document.body);
            await openDialog($dialog, true);

            expect($dialog[0].style.zIndex).toBe("1110");
            expect(backdrop.style.zIndex).toBe("1109");
        });

        it("clears a stale backdrop z-index left by a prior lift when reopened without a popup", async () => {
            // Bootstrap reuses the same backdrop element across shows; simulate one carrying the inline
            // z-index a previous lift assigned.
            const backdrop = document.createElement("div");
            backdrop.className = "modal-backdrop";
            backdrop.style.zIndex = "1109";
            document.body.appendChild(backdrop);

            const $dialog = makeDialog().appendTo(document.body);
            await openDialog($dialog, true); // no stacked popup this time

            expect($dialog[0].style.zIndex).toBe("");
            expect(backdrop.style.zIndex).toBe("");
        });

        it("does not touch backdrops when the dialog itself has none", async () => {
            const backdrop = document.createElement("div");
            backdrop.className = "modal-backdrop";
            backdrop.style.zIndex = "1109";
            document.body.appendChild(backdrop);

            const $dialog = makeDialog().appendTo(document.body);
            await openDialog($dialog, true, { backdrop: false });

            // Another modal's backdrop must be left alone.
            expect(backdrop.style.zIndex).toBe("1109");
        });

        it("does not lift when no popup is stacked", async () => {
            openStackedPopup("999"); // popup present but body lacks the -stacked class (non-stacked case)

            const $dialog = makeDialog().appendTo(document.body);
            await openDialog($dialog, true);

            expect($dialog[0].style.zIndex).toBe("");
        });

        it("treats popups without a numeric z-index as layer 0 and excludes the dialog itself from the scan", async () => {
            document.body.classList.add("tree-popup-stacked");
            // No inline z-index -> getComputedStyle returns a non-numeric value -> parseInt NaN -> 0.
            openStackedPopup("");

            // The dialog itself matches `.modal.show`; it must be filtered out of the max-z scan.
            const $dialog = makeDialog().addClass("show").appendTo(document.body);
            await openDialog($dialog, true);

            expect($dialog[0].style.zIndex).toBe("10"); // max(0) + 10
        });

        it("never lifts a self-managed popup dialog, even while another popup is stacked", async () => {
            document.body.classList.add("tree-popup-stacked");
            openStackedPopup("1100");

            const $popup = $("<div class='modal tree-popup-editor-dialog'></div>").appendTo(document.body);
            await openDialog($popup, false);

            expect($popup[0].style.zIndex).toBe("");
        });

        it("clears a stale inline z-index when reopened without a stacked popup", async () => {
            const $dialog = makeDialog().appendTo(document.body);
            $dialog[0].style.zIndex = "1110"; // leftover from a previous stacked open

            await openDialog($dialog, true);

            expect($dialog[0].style.zIndex).toBe("");
        });
    });

    describe("closeActiveDialog", () => {
        it("hides the active dialog and clears the reference", () => {
            const $dialog = makeDialog();
            glob.activeDialog = $dialog;

            closeActiveDialog();

            expect(getOrCreateInstance).toHaveBeenCalledWith($dialog[0]);
            expect(modalHide).toHaveBeenCalledTimes(1);
            expect(glob.activeDialog).toBeNull();
        });

        it("does nothing when there is no active dialog", () => {
            glob.activeDialog = null;

            closeActiveDialog();

            expect(getOrCreateInstance).not.toHaveBeenCalled();
            expect(modalHide).not.toHaveBeenCalled();
        });
    });

    describe("dialog command wrappers", () => {
        it("info triggers showInfoDialog and resolves with the callback value, merging extra props", async () => {
            triggerCommand.mockImplementation((_name, data: any) => data.callback("info-result"));

            const promise = dialogService.info("hello", { okLabel: "Got it" } as any);
            await expect(promise).resolves.toBe("info-result");

            expect(triggerCommand).toHaveBeenCalledTimes(1);
            const [name, data] = triggerCommand.mock.calls[0];
            expect(name).toBe("showInfoDialog");
            expect(data.message).toBe("hello");
            expect(data.okLabel).toBe("Got it");
            expect(typeof data.callback).toBe("function");
        });

        it("info works without extra props", async () => {
            triggerCommand.mockImplementation((_name, data: any) => data.callback(undefined));

            await expect(dialogService.info("plain")).resolves.toBeUndefined();
            const [, data] = triggerCommand.mock.calls[0];
            expect(data.message).toBe("plain");
        });

        it("confirm resolves true only when the result is confirmed", async () => {
            // Confirmed result
            triggerCommand.mockImplementationOnce((_name, data: any) => data.callback({ confirmed: true, isDeleteNoteChecked: false }));
            await expect(dialogService.confirm("sure?")).resolves.toBe(true);

            const [name, data] = triggerCommand.mock.calls[0];
            expect(name).toBe("showConfirmDialog");
            expect(data.message).toBe("sure?");

            // Not-confirmed object result
            triggerCommand.mockImplementationOnce((_name, d: any) => d.callback({ confirmed: false, isDeleteNoteChecked: true }));
            await expect(dialogService.confirm("sure?")).resolves.toBe(false);

            // Falsy result (dialog dismissed) -> x && x.confirmed short-circuits to the falsy value
            triggerCommand.mockImplementationOnce((_name, d: any) => d.callback(false));
            await expect(dialogService.confirm("sure?")).resolves.toBe(false);
        });

        it("confirmDeleteNoteBoxWithNote triggers the delete-box command and resolves with the callback value", async () => {
            const callbackResult = { confirmed: true, isDeleteNoteChecked: true };
            triggerCommand.mockImplementation((_name, data: any) => data.callback(callbackResult));

            await expect(dialogService.confirmDeleteNoteBoxWithNote("My note")).resolves.toBe(callbackResult);

            const [name, data] = triggerCommand.mock.calls[0];
            expect(name).toBe("showConfirmDeleteNoteBoxWithNoteDialog");
            expect(data.title).toBe("My note");
            expect(typeof data.callback).toBe("function");
        });

        it("prompt triggers showPromptDialog with merged props and resolves with the callback value", async () => {
            triggerCommand.mockImplementation((_name, data: any) => data.callback("typed text"));

            await expect(dialogService.prompt({ title: "Name?", defaultValue: "x" } as any)).resolves.toBe("typed text");

            const [name, data] = triggerCommand.mock.calls[0];
            expect(name).toBe("showPromptDialog");
            expect(data.title).toBe("Name?");
            expect(data.defaultValue).toBe("x");
            expect(typeof data.callback).toBe("function");
        });
    });
});
