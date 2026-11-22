import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import froca from "../../services/froca";
import protectedSession from "../../services/protected_session";
import protectedSessionHolder from "../../services/protected_session_holder";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import ProtectSubtreeDialog from "./protect_subtree";

vi.mock("../../services/i18n", () => ({
    t: (key: string, values?: object) => (values ? `${key}:${JSON.stringify(values)}` : key)
}));

describe("ProtectSubtreeDialog", () => {
    let host: Component;
    let container: HTMLElement;
    let sessionAvailable: boolean;
    let setup: ReturnType<typeof vi.spyOn>;
    let protectNote: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        sessionAvailable = false;
        vi.spyOn(protectedSessionHolder, "isProtectedSessionAvailable").mockImplementation(() => sessionAvailable);
        setup = vi.spyOn(protectedSession, "setupProtectedSession");
        protectNote = vi.spyOn(protectedSession, "protectNote").mockResolvedValue(undefined);
        buildNote({ id: "journal", title: "Journal" });
        froca.notes["journal"].isProtected = true;
        buildNote({ id: "drafts", title: "Drafts" });

        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <ProtectSubtreeDialog />
            </ParentComponent.Provider>
        );
    });

    async function open(noteId: string, protect: boolean) {
        await act(async () => {
            void host.handleEventInChildren("showProtectSubtreeDialog", { noteId, protect });
        });
    }

    function passwordField() {
        return container.querySelector<HTMLInputElement>("input[type=password]");
    }

    function intro() {
        return container.querySelector(".modal-body > p")?.textContent;
    }

    function target() {
        return container.querySelector(".protect-subtree-target .tn-card-option-title")?.textContent;
    }

    async function type(value: string) {
        const input = passwordField();
        if (!input) throw new Error("The dialog asks for no password.");
        await act(async () => {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    async function submit() {
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
    }

    it("names the action and the note instead of the generic protected session prompt", async () => {
        sessionAvailable = true;
        await open("journal", false);

        expect(container.querySelector(".modal-title")?.textContent).toBe("tree-context-menu.unprotect-subtree");
        expect(intro()).toBe("protect_subtree.unprotect_intro");
        expect(target()).toBe("Journal");
        expect(container.textContent).not.toContain("protected_session_password");
        expect(container.querySelector("button[type=submit]")?.textContent?.trim())
            .toBe("tree-context-menu.unprotect-subtree");
    });

    it("only confirms unprotecting when a protected session is already running", async () => {
        sessionAvailable = true;
        await open("journal", false);

        expect(passwordField()).toBeNull();
        expect(protectNote).not.toHaveBeenCalled();

        await submit();

        expect(setup).not.toHaveBeenCalled();
        expect(protectNote).toHaveBeenCalledWith("journal", false, true);
    });

    it("asks for the password and unprotects nothing until it is right", async () => {
        await open("journal", false);
        expect(passwordField()).not.toBeNull();
        // Without a session the title of a protected note is not readable, so the dialog does not show it.
        expect(target()).toBe("protect_subtree.untitled");

        setup.mockResolvedValueOnce(false);
        await type("wrong");
        await submit();

        expect(setup).toHaveBeenLastCalledWith("wrong");
        expect(protectNote).not.toHaveBeenCalled();

        setup.mockResolvedValueOnce(true);
        await type("secret");
        await submit();

        expect(setup).toHaveBeenLastCalledWith("secret");
        expect(protectNote).toHaveBeenCalledWith("journal", false, true);
    });

    it("protects behind the same password step, labeled as protecting", async () => {
        await open("drafts", true);

        expect(container.querySelector(".modal-title")?.textContent).toBe("tree-context-menu.protect-subtree");
        expect(intro()).toBe("protect_subtree.protect_intro");
        expect(target()).toBe("Drafts");
        expect(container.querySelector("button[type=submit]")?.textContent?.trim())
            .toBe("tree-context-menu.protect-subtree");

        setup.mockResolvedValueOnce(true);
        await type("secret");
        await submit();

        expect(protectNote).toHaveBeenCalledWith("drafts", true, true);
    });
});
