import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

// Uninitialized, the real `t` answers undefined for every key, which would drop the hint the strip
// stands in with entirely.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../../services/froca", () => ({
    default: {
        getNotes: async (noteIds: string[]) => noteIds.map((noteId) => ({ noteId, title: `title:${noteId}` }))
    }
}));

import SelectionStrip, { type SpaceUsageSelection } from "./selection";

let container: HTMLDivElement | undefined;

function renderStrip(selection: SpaceUsageSelection | null) {
    container = document.body.appendChild(document.createElement("div"));
    render(<SelectionStrip selection={selection} />, container);
    return container;
}

function textOf(probe: HTMLElement, selector: string) {
    return probe.querySelector(selector)?.textContent;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

describe("SelectionStrip", () => {
    it("names the chosen note: where it sits, what it is called, and how much it takes", async () => {
        const probe = renderStrip({
            markId: "n1",
            notePath: [ "root", "p1", "n1" ],
            size: 1024
        });

        // The strip draws first and picks the titles up once froca has answered.
        await vi.waitFor(() =>
            expect(textOf(probe, ".space-usage-selection-name")).toBe("title:n1"));

        // The note's own title is the name; everything above it is the location.
        expect(textOf(probe, ".space-usage-selection-path")).toBe("title:root › title:p1");
        expect(textOf(probe, ".space-usage-selection-size")).toBe("1 KiB");
    });

    it("stands in with the note IDs until the titles arrive", () => {
        const probe = renderStrip({ markId: "n1", notePath: [ "root", "p1", "n1" ], size: 10 });

        // Rendered before froca has answered: the strip draws rather than waiting, and what it draws
        // is the path it was given rather than nothing.
        expect(textOf(probe, ".space-usage-selection-name")).toBe("n1");
        expect(textOf(probe, ".space-usage-selection-path")).toBe("root › p1");
    });

    it("names a mark that stands for no note by its own label, with no location to show", () => {
        const probe = renderStrip({ markId: "/deleted-notes", label: "Deleted items", size: 2048 });

        expect(textOf(probe, ".space-usage-selection-name")).toBe("Deleted items");
        expect(textOf(probe, ".space-usage-selection-path")).toBe("");
        expect(textOf(probe, ".space-usage-selection-size")).toBe("2 KiB");
    });

    it("never names one mark with another's titles, however late they arrive", async () => {
        const probe = renderStrip({ markId: "n1", notePath: [ "root", "p1", "n1" ], size: 10 });

        await vi.waitFor(() =>
            expect(textOf(probe, ".space-usage-selection-name")).toBe("title:n1"));

        // A second mark, drawn before froca has answered for it: it stands in with its own note IDs
        // rather than wearing the last mark's name beside its own size.
        render(
            <SelectionStrip selection={{ markId: "n2", notePath: [ "root", "p2", "n2" ], size: 20 }} />,
            probe
        );

        expect(textOf(probe, ".space-usage-selection-name")).toBe("n2");
        expect(textOf(probe, ".space-usage-selection-path")).toBe("root › p2");

        await vi.waitFor(() =>
            expect(textOf(probe, ".space-usage-selection-name")).toBe("title:n2"));
    });

    it("leaves a mark that names no note without a path, whatever was named before it", async () => {
        const probe = renderStrip({ markId: "n1", notePath: [ "root", "p1", "n1" ], size: 10 });

        await vi.waitFor(() =>
            expect(textOf(probe, ".space-usage-selection-path")).toBe("title:root › title:p1"));

        render(
            <SelectionStrip selection={{ markId: "/deleted-notes", label: "Deleted items", size: 20 }} />,
            probe
        );

        // The crowd it stands for sits nowhere, so the line above its name is empty at once.
        expect(textOf(probe, ".space-usage-selection-path")).toBe("");
        expect(textOf(probe, ".space-usage-selection-name")).toBe("Deleted items");
    });

    it("says what to do while nothing is chosen, naming nothing", () => {
        const probe = renderStrip(null);

        expect(textOf(probe, ".space-usage-selection-hint")).toBe("space_usage.selection_hint");
        expect(probe.querySelector(".space-usage-selection-name")).toBeNull();
        expect(probe.querySelector(".space-usage-selection-actionable")).toBeNull();
    });

    it("raises the mark's own action on a tap, and stays inert for a mark with none", () => {
        const activate = vi.fn();
        const probe = renderStrip({ markId: "n1", notePath: [ "root", "n1" ], size: 10, onActivate: activate });

        const strip = probe.querySelector(".space-usage-selection");

        expect(strip?.classList.contains("space-usage-selection-actionable")).toBe(true);
        strip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(activate).toHaveBeenCalledTimes(1);

        render(<SelectionStrip selection={{ markId: "others", label: "3 more notes", size: 10 }} />, probe);
        probe.querySelector(".space-usage-selection")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(activate).toHaveBeenCalledTimes(1);
    });
});
