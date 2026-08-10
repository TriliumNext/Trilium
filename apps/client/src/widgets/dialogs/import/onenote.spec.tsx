import { type ComponentChildren, render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import * as i18n from "../../../services/i18n.js";
import type { OneNoteNotebook } from "../../../services/onenote_import.js";

// The service's default export is the API surface the panel drives; the named helpers
// (buildSectionSelections, collectSectionIds, …) stay real so the tree/selection logic under test
// is the production one.
const api = vi.hoisted(() => ({
    getStatus: vi.fn(),
    getNotebooks: vi.fn(),
    deviceLogin: vi.fn(),
    devicePoll: vi.fn(),
    disconnect: vi.fn(async () => ({})),
    runImport: vi.fn(async () => {})
}));
const showError = vi.hoisted(() => vi.fn());

vi.mock("../../../services/onenote_import.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/onenote_import.js")>()),
    default: api
}));
vi.mock("../../../services/toast.js", () => ({ default: { showError } }));
// The shrink-images preference; the panel only reads it, so a fixed "on" is enough.
vi.mock("../../react/hooks.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks.js")>()),
    useTriliumOptionBool: () => [true, vi.fn()]
}));

const { default: provider } = await import("./onenote.js");

const NOTEBOOKS: OneNoteNotebook[] = [{
    id: "nb1",
    title: "Notebook 1",
    createdDateTime: "2020-01-01T00:00:00Z",
    sections: [
        { id: "s1", title: "Section 1", createdDateTime: "2020-01-01T00:00:00Z" },
        { id: "s2", title: "Section 2", createdDateTime: "2020-02-01T00:00:00Z" }
    ],
    sectionGroups: []
}];

let container: HTMLDivElement;
let closeDialog: Mock<() => void>;
let footer: ComponentChildren;
let applyFooter: ((node: ComponentChildren) => void) | null = null;

/** Mirrors the dialog shell: the footer the panel pushes up is rendered through state, exactly as
 *  the production dialog does, so the panel's footer effect drives a live subtree. */
function FooterHost() {
    const [node, setNode] = useState<ComponentChildren>(null);
    applyFooter = setNode;
    return <div className="footer-host">{node}</div>;
}

beforeEach(() => {
    vi.clearAllMocks();
    api.getStatus.mockResolvedValue({ connected: true, account: { name: "Ada", email: "ada@example.com" } });
    api.getNotebooks.mockResolvedValue({ notebooks: NOTEBOOKS });
    closeDialog = vi.fn<() => void>();
    footer = null;
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    applyFooter = null;
});

async function mount() {
    const Panel = provider.Panel;
    await act(async () => {
        render(
            <div>
                <Panel
                    parentNoteId="root"
                    closeDialog={closeDialog}
                    setFooter={(node: ComponentChildren) => {
                        footer = node;
                        applyFooter?.(node);
                    }}
                />
                <FooterHost />
            </div>,
            container
        );
    });
    // The status → notebooks → ready chain spans several microtask hops; one extra flush lets the
    // footer effect settle before assertions.
    await act(async () => {});
    // The panel's footer effect can fire between act flushes, before FooterHost's setter processes
    // the update — sync the host with whatever the panel pushed last.
    await act(async () => {
        applyFooter?.(footer);
    });
}

async function click(button: Element | null | undefined) {
    expect(button).toBeTruthy();
    await act(async () => {
        (button as HTMLButtonElement).click();
    });
    await act(async () => {});
}

const importButton = () => container.querySelector<HTMLButtonElement>(".footer-host button");

/** The panel's account action buttons in DOM order: refresh, then disconnect. */
function accountButtons() {
    return [...container.querySelectorAll<HTMLButtonElement>(".onenote-account-actions button")];
}

describe("OneNotePanel", () => {
    it("shows the connect screen and no footer when the session is not connected", async () => {
        api.getStatus.mockResolvedValue({ connected: false, account: null });
        await mount();

        expect(container.querySelector(".onenote-account")).toBeNull();
        expect(container.querySelector(".bxl-microsoft")).not.toBeNull();
        expect(footer).toBeNull();
    });

    it("reports a failed status check via toast (server reason first) and falls back to connect", async () => {
        api.getStatus.mockRejectedValue(new Error("status check exploded"));
        await mount();

        expect(showError).toHaveBeenCalledWith("status check exploded");
        expect(container.querySelector(".bxl-microsoft")).not.toBeNull();
    });

    it("lists the connected account's notebooks as a section picker with an import footer", async () => {
        await mount();

        expect(container.querySelector(".checkbox-tree")).not.toBeNull();
        expect(container.querySelectorAll(".checkbox-tree input[type=checkbox]").length).toBeGreaterThanOrEqual(2);
        // Nothing selected yet: the footer import button exists but is disabled.
        expect(importButton()?.disabled).toBe(true);
    });

    it("imports the selected sections and reports an upfront failure with the server's reason", async () => {
        api.runImport.mockRejectedValue(new Error('{"message":"Not connected to OneNote."}'));
        await mount();

        // Select one section leaf, which enables the footer button.
        await click(container.querySelector(".checkbox-tree-leaf input[type=checkbox]"));
        expect(importButton()?.disabled).toBe(false);

        await click(importButton());
        expect(closeDialog).toHaveBeenCalled();
        expect(api.runImport).toHaveBeenCalledWith(expect.objectContaining({
            parentNoteId: "root",
            sections: [expect.objectContaining({ id: "s1" })],
            shrinkImages: true
        }));
        expect(showError).toHaveBeenCalledWith("Not connected to OneNote.");

        // A rejection carrying no usable text is stringified as the last resort.
        api.runImport.mockRejectedValueOnce(42);
        await click(importButton());
        expect(showError).toHaveBeenCalledWith("42");
    });

    it("shows a listing failure inline with the server's reason, and recovers via retry", async () => {
        api.getNotebooks
            .mockRejectedValueOnce(new Error('{"message":"The OneNote connection has expired."}'))
            .mockResolvedValueOnce({ notebooks: NOTEBOOKS });
        await mount();

        // The failure is inline (no toast) and the stale/empty tree is not offered.
        const inlineError = container.querySelector(".no-items");
        expect(inlineError?.textContent).toContain("The OneNote connection has expired.");
        expect(container.querySelector(".checkbox-tree")).toBeNull();
        expect(showError).not.toHaveBeenCalled();

        await click(inlineError?.querySelector("button"));
        expect(container.querySelector(".no-items")).toBeNull();
        expect(container.querySelector(".checkbox-tree")).not.toBeNull();
    });

    it("prunes selected ids that no longer exist when the list is refreshed", async () => {
        await mount();
        await click(container.querySelector(".checkbox-tree-leaf input[type=checkbox]"));
        expect(importButton()?.disabled).toBe(false);

        // The refresh returns a list without the selected section — the selection must not keep
        // counting the phantom id, so the import button drops back to disabled.
        api.getNotebooks.mockResolvedValue({ notebooks: [{ ...NOTEBOOKS[0], sections: [NOTEBOOKS[0].sections[1]] }] });
        await click(accountButtons()[0]);
        expect(importButton()?.disabled).toBe(true);
    });

    it("shows the empty-account hint when the connected account has no notebooks", async () => {
        api.getNotebooks.mockResolvedValue({ notebooks: [] });
        await mount();

        expect(container.querySelector(".onenote-hint")).not.toBeNull();
        expect(container.querySelector(".checkbox-tree")).toBeNull();
    });

    it("clears the account, notebooks and selection on disconnect", async () => {
        await mount();
        await click(accountButtons()[1]);

        expect(api.disconnect).toHaveBeenCalled();
        expect(container.querySelector(".onenote-account")).toBeNull();
        expect(container.querySelector(".bxl-microsoft")).not.toBeNull();
        expect(footer).toBeNull();
    });

    it("surfaces a failed sign-in start with the server's reason and stays disconnected", async () => {
        api.getStatus.mockResolvedValue({ connected: false, account: null });
        api.deviceLogin.mockRejectedValue(new Error('{"message":"Sign-in could not be started."}'));
        await mount();

        await click(container.querySelector(".bxl-microsoft")?.closest("button"));
        expect(showError).toHaveBeenCalledWith("Sign-in could not be started.");
        expect(container.querySelector(".bxl-microsoft")).not.toBeNull();

        // A rejection carrying no usable text is stringified as the last resort.
        api.deviceLogin.mockRejectedValueOnce(42);
        await click(container.querySelector(".bxl-microsoft")?.closest("button"));
        expect(showError).toHaveBeenCalledWith("42");
    });

    it("falls back to generic wording when a failure carries no server message", async () => {
        // i18next is uninitialised under test, so pin t() to return its key — asserting the key
        // proves the fallback path was taken without depending on the wording.
        const tSpy = vi.spyOn(i18n, "t").mockImplementation(((key: string) => key) as typeof i18n.t);
        try {
            api.getStatus.mockRejectedValue(new Error(""));
            await mount();
            expect(showError).toHaveBeenCalledWith("onenote_import.load_failed");

            // The same fallback feeds the inline listing error.
            render(null, container);
            api.getStatus.mockResolvedValue({ connected: true, account: { name: "Ada", email: "ada@example.com" } });
            api.getNotebooks.mockRejectedValue(new Error(""));
            await mount();
            expect(container.querySelector(".no-items")?.textContent).toContain("onenote_import.load_failed");
        } finally {
            tSpy.mockRestore();
        }
    });
});
