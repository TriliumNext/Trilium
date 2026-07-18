import { beforeEach, describe, expect, it, vi } from "vitest";

const openInNewTab = vi.fn();
vi.mock("../components/app_context.js", () => ({
    default: {
        tabManager: {
            openInNewTab: (...args: unknown[]) => openInNewTab(...args)
        }
    }
}));

import toast, { removeToastFromStore, showError, showErrorForScriptNote, toasts } from "./toast.js";

describe("toast store", () => {
    beforeEach(() => {
        toasts.value = [];
        vi.clearAllMocks();
    });

    it("showMessage adds a toast with defaults and custom values", () => {
        toast.showMessage("hello");
        expect(toasts.value).toHaveLength(1);
        expect(toasts.value[0]).toMatchObject({
            icon: "bx bx-check",
            message: "hello",
            timeout: 2000
        });
        expect(typeof toasts.value[0].id).toBe("string");

        toast.showMessage("custom", 500, "bx bx-star");
        expect(toasts.value).toHaveLength(2);
        expect(toasts.value[1]).toMatchObject({
            icon: "bx bx-star",
            message: "custom",
            timeout: 500
        });
    });

    it("showError adds an error toast with default and custom timeout", () => {
        showError("boom");
        expect(toasts.value[0]).toMatchObject({
            icon: "bx bx-error-circle",
            message: "boom",
            timeout: 10000
        });

        showError("boom2", 42);
        expect(toasts.value[1].timeout).toBe(42);
    });

    it("showErrorTitleAndMessage adds a titled error toast", () => {
        toast.showErrorTitleAndMessage("Title", "msg");
        expect(toasts.value[0]).toMatchObject({
            title: "Title",
            icon: "bx bx-error-circle",
            message: "msg",
            timeout: 10000
        });

        toast.showErrorTitleAndMessage("T2", "m2", 99);
        expect(toasts.value[1].timeout).toBe(99);
    });

    it("showPersistent adds a new toast then updates the existing one", () => {
        toast.showPersistent({ id: "persist-1", icon: "bx bx-info", message: "first" });
        expect(toasts.value).toHaveLength(1);
        expect(toasts.value[0]).toMatchObject({ id: "persist-1", message: "first" });

        // Add an unrelated toast to exercise the non-matching branch of updateToast.
        toast.showMessage("other");

        toast.showPersistent({ id: "persist-1", icon: "bx bx-info", message: "updated" });
        expect(toasts.value).toHaveLength(2);
        const updated = toasts.value.find(t => t.id === "persist-1");
        expect(updated?.message).toBe("updated");
        // The unrelated toast is unchanged.
        expect(toasts.value.find(t => t.message === "other")).toBeDefined();
    });

    it("closePersistent / removeToastFromStore removes by id and leaves others", () => {
        toast.showPersistent({ id: "a", icon: "i", message: "A" });
        toast.showPersistent({ id: "b", icon: "i", message: "B" });
        expect(toasts.value).toHaveLength(2);

        toast.closePersistent("a");
        expect(toasts.value.map(t => t.id)).toEqual(["b"]);

        // removeToastFromStore for a non-existent id is a no-op.
        removeToastFromStore("does-not-exist");
        expect(toasts.value.map(t => t.id)).toEqual(["b"]);

        removeToastFromStore("b");
        expect(toasts.value).toHaveLength(0);
    });

    it("fires onRemove exactly once when a toast is removed", () => {
        const onRemove = vi.fn();
        toast.showPersistent({ id: "with-callback", icon: "i", message: "M", onRemove });

        removeToastFromStore("with-callback");
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(toasts.value).toHaveLength(0);

        // A second removal for the same (now absent) id must not fire the callback again.
        removeToastFromStore("with-callback");
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it("does not require onRemove and skips it for toasts without one", () => {
        toast.showPersistent({ id: "no-callback", icon: "i", message: "M" });
        expect(() => removeToastFromStore("no-callback")).not.toThrow();
        expect(toasts.value).toHaveLength(0);
    });

    it("showErrorForScriptNote shows the script note as a reference link with a generic error icon", () => {
        showErrorForScriptNote("scriptNote1", "it failed");

        const created = toasts.value.find(t => t.id === "custom-widget-failure-scriptNote1");
        expect(created).toMatchObject({
            icon: "bx bx-error-circle",
            message: "it failed",
            timeout: 15000,
            // The script note is attached as a reference link instead of a bespoke open-note button.
            notes: [ "scriptNote1" ]
        });
        expect(created?.buttons).toBeUndefined();
    });

    it("showErrorForScriptNote renders the message monospace when requested", () => {
        showErrorForScriptNote("scriptNote2", "api.logg is not a function", { monospace: true });

        const created = toasts.value.find(t => t.id === "custom-widget-failure-scriptNote2");
        expect(created).toMatchObject({
            message: "api.logg is not a function",
            messageMonospace: true
        });
    });
});
