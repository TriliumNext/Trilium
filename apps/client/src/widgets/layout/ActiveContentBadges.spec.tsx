import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
vi.mock("../react/hooks/note_context", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks/note_context")>()),
    useNoteContext: () => ({ note: shownNote.current })
}));

// i18next is not initialized under test, where t() answers with an empty string; echoing the key
// back lets the assertions name the menu item. The translations are loaded after this module is, as
// a layout that imports the badges statically loads it before `initLocale()` has run.
const i18n = vi.hoisted(() => ({ isLoaded: false }));
vi.mock("../../services/i18n", () => ({
    t: (key: string) => (i18n.isLoaded ? key : "")
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
    beforeAll(() => {
        i18n.isLoaded = true;
    });

    it("words the badge and its menu in the translations loaded after its module", async () => {
        const { title, items } = await openBadge({});
        expect(title).toBe("active_content_badges.type_frontend_script");
        expect(items).toEqual(expect.arrayContaining([
            "active_content_badges.menu_execute_now",
            "active_content_badges.menu_run",
            "active_content_badges.menu_change_to_widget"
        ]));
    });

    it("links the API docs from every script that runs in the frontend, widgets included", async () => {
        expect(await menuItems({})).toEqual(expect.arrayContaining([ TRILIUM_API_DOCS, ELECTRON_API_DOCS ]));
        expect(await menuItems({ "#widget": "" })).toEqual(expect.arrayContaining([ TRILIUM_API_DOCS, ELECTRON_API_DOCS ]));

        const backendItems = await menuItems({}, "backend");
        expect(backendItems).toContain(TRILIUM_API_DOCS);
        expect(backendItems).not.toContain(ELECTRON_API_DOCS);
    });

    async function menuItems(...args: Parameters<typeof openBadge>) {
        return (await openBadge(...args)).items;
    }

    async function openBadge(labels: Record<`#${string}`, string>, env: "frontend" | "backend" = "frontend") {
        shownNote.current = buildNote({ title: "Script", type: "code", mime: `application/javascript;env=${env}`, ...labels });
        const host = document.createElement("div");
        document.body.appendChild(host);
        act(() => render(<ActiveContentBadges />, host));

        const toggle = host.querySelector<HTMLButtonElement>(".dropdown-active-content-badge button");
        if (!toggle) throw new Error("expected the badge's toggle to render");
        const title = toggle.textContent?.trim();
        act(() => {
            toggle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            toggle.click();
        });
        // The items of the type itself load on demand, above the links to the docs.
        const items = await vi.waitFor(() => {
            const items = [ ...document.querySelectorAll(".tn-popup .dropdown-item") ].map((item) => item.textContent?.trim());
            expect(items.indexOf("active_content_badges.menu_docs")).toBeGreaterThan(0);
            return items;
        });

        act(() => render(null, host));
        host.remove();
        return { title, items };
    }
});
