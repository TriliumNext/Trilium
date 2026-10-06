import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Renders Excalidraw's own entries by name, and ours as buttons. */
const MainMenu = vi.hoisted(() => Object.assign(
    ({ children }: { children: ComponentChildren }) => <div className="menu">{children}</div>,
    {
        Item: ({ onSelect, children }: { onSelect: () => void; children: ComponentChildren }) => (
            <button type="button" onClick={onSelect}>{children}</button>
        ),
        Separator: () => <hr />,
        DefaultItems: Object.fromEntries([ "LoadScene", "SaveAsImage", "SearchMenu", "Help" ]
            .map((name) => [ name, () => <span>{name}</span> ]))
    }
));
vi.mock("@excalidraw/excalidraw", () => ({
    MainMenu,
    useI18n: () => ({ t: (key: string) => `t:${key}`, langCode: "en" })
}));

const { default: CanvasDrawingMenu } = await import("./CanvasDrawingMenu");

describe("CanvasDrawingMenu", () => {
    let container: HTMLElement;
    let toggleSidebar: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        toggleSidebar = vi.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(isEditable: boolean) {
        const apiRef = { current: { toggleSidebar } as unknown as ExcalidrawImperativeAPI };
        await act(async () => {
            render(<CanvasDrawingMenu apiRef={apiRef} isEditable={isEditable} />, container);
        });
        return [ ...container.querySelector(".menu")?.children ?? [] ]
            .map((item) => item.tagName === "HR" ? "|" : item.textContent);
    }

    it("offers opening, exporting, finding, the library and help", async () => {
        expect(await mount(true)).toEqual([
            "LoadScene", "SaveAsImage", "|", "SearchMenu", "t:toolBar.library", "Help"
        ]);

        container.querySelector("button")?.click();
        expect(toggleSidebar).toHaveBeenCalledWith({ name: "default" });
    });

    it("leaves the library out of a drawing that cannot change", async () => {
        expect(await mount(false))
            .toEqual([ "LoadScene", "SaveAsImage", "|", "SearchMenu", "Help" ]);
    });
});
