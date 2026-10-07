import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useNoteContext: () => ({ note: shownNote.current })
}));

// i18next is not initialized under test, where t() answers with an empty string; echoing the key
// back lets the assertions name the menu item.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isElectron: () => true
}));

import { buildNote } from "../../test/easy-froca";
import { ActiveContentBadges } from "./ActiveContentBadges";

const TRILIUM_API_DOCS = "code_buttons.trilium_api_docs_button_title";
const ELECTRON_API_DOCS = "code_buttons.electron_api_docs_button_title";

describe("ActiveContentBadges", () => {
    it("links the API docs from every script that runs in the frontend, widgets included", async () => {
        expect(await menuItems({})).toEqual(expect.arrayContaining([ TRILIUM_API_DOCS, ELECTRON_API_DOCS ]));
        expect(await menuItems({ "#widget": "" })).toEqual(expect.arrayContaining([ TRILIUM_API_DOCS, ELECTRON_API_DOCS ]));

        const backendItems = await menuItems({}, "backend");
        expect(backendItems).toContain(TRILIUM_API_DOCS);
        expect(backendItems).not.toContain(ELECTRON_API_DOCS);
    });

    async function menuItems(labels: Record<`#${string}`, string>, env: "frontend" | "backend" = "frontend") {
        shownNote.current = buildNote({ title: "Script", type: "code", mime: `application/javascript;env=${env}`, ...labels });
        const host = document.createElement("div");
        document.body.appendChild(host);
        act(() => render(<ActiveContentBadges />, host));

        const toggle = host.querySelector<HTMLButtonElement>(".dropdown-active-content-badge button");
        if (!toggle) throw new Error("expected the badge's toggle to render");
        act(() => {
            toggle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            toggle.click();
        });
        await vi.waitFor(() => expect(document.querySelector(".tn-popup")).not.toBeNull());

        const items = [ ...document.querySelectorAll(".tn-popup .dropdown-item") ].map((item) => item.textContent?.trim());
        expect(items).toContain("active_content_badges.menu_docs");

        act(() => render(null, host));
        host.remove();
        return items;
    }
});
