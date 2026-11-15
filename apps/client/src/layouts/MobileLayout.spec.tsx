import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import NoteContext from "../components/note_context.js";
import options from "../services/options.js";
import server from "../services/server.js";
import { buildNote } from "../test/easy-froca.js";
import { renderInto } from "../test/render.js";
import { ParentComponent } from "../widgets/react/react_utils.js";
import MobileLayout from "./MobileLayout.js";

describe("MobileLayout", () => {
    let device: typeof window.glob.device;
    beforeEach(() => {
        device = window.glob.device;
        window.glob.device = "mobile";
        buildNote({ id: "_lbMobileVisibleLaunchers", title: "Visible Launchers" });
        options.set("experimentalFeatures", "[]");
        // A split shows an empty note, whose view searches for the workspaces, also after the case.
        if (!vi.isMockFunction(server.get)) {
            const get = server.get.bind(server);
            vi.spyOn(server, "get").mockImplementation((async (url: string) =>
                (url.startsWith("search?") ? [] : get(url))) as typeof server.get);
        }
    });
    afterEach(() => {
        window.glob.device = device;
    });

    it("gives each note split a title row with the icon, title and badges, and the inline title, content, note list and scroll padding in its scroller", async () => {
        let container: HTMLElement | undefined;
        act(() => { container = renderLayout(); });
        const splits = container?.querySelector("#mobile-rest-container > #detail-container > .split-note-container-widget");
        expect(splits).not.toBeNull();

        const noteContext = new NoteContext("main");
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = {
            noteContexts: [ noteContext ],
            getActiveMainContext: () => noteContext,
            getActiveContext: () => noteContext
        } as unknown as typeof appContext.tabManager;
        await act(async () => {
            await $(splits as HTMLElement).prop("component").handleEvent("newNoteContextCreated", { noteContext });
        });
        appContext.tabManager = originalTabManager;

        const split = container?.querySelector(".note-split[data-ntx-id=main]");
        const titleRow = split?.querySelector(":scope > .title-row");
        expect(titleRow?.firstElementChild?.querySelector("button.note-icon")).toBeInstanceOf(HTMLElement);
        expect(titleRow?.children[1]?.classList.contains("note-title-widget")).toBe(true);
        expect(titleRow?.children[2]?.classList.contains("note-badges")).toBe(true);
        const scroller = split?.querySelector(":scope > .scrolling-container");
        expect(scroller?.firstElementChild?.classList.contains("inline-title")).toBe(true);
        expect(scroller?.children[1]?.classList.contains("note-detail")).toBe(true);
        expect(scroller?.children[2]?.classList.contains("note-list-widget")).toBe(true);
        // The scroll padding ends the scroller; with no note open, it is an empty element.
        expect(scroller?.children).toHaveLength(4);
    });

    it("ends with the bottom bar, holding the launchers and then the global menu", () => {
        const container = renderLayout();
        const root = container.querySelector("#root-widget.mobile-layout");

        const bottomBar = root?.lastElementChild;
        expect(bottomBar?.id).toBe("mobile-bottom-bar");
        const launcherPane = bottomBar?.querySelector(":scope > #launcher-pane.horizontal");
        expect(launcherPane?.firstElementChild?.id).toBe("launcher-container");
        expect(launcherPane?.lastElementChild?.classList.contains("global-menu")).toBe(true);
        // The panes above it fill the rest of the screen.
        expect(bottomBar?.previousElementSibling?.id).toBe("mobile-rest-container");
    });
});

function renderLayout() {
    return renderInto(
        <ParentComponent.Provider value={appContext}>
            <MobileLayout />
        </ParentComponent.Provider>
    );
}
