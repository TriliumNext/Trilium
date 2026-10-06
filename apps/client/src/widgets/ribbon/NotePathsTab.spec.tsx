import { describe, expect, it, vi } from "vitest";

import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { NotePathsWidget } from "./NotePathsTab";

describe("NotePathsWidget", () => {
    it("shows the root note as its icon, titled with the root note's name", async () => {
        buildNote({
            id: "root",
            title: "My Knowledge Base",
            children: [ { id: "calendar", title: "Calendar", children: [ { id: "leaf", title: "Leaf" } ] } ]
        });
        const rootIcon = froca.getNoteFromCache("root")?.getIcon();

        const container = renderInto(
            <NotePathsWidget
                cloneButton={false}
                currentNotePath="root/calendar/leaf"
                sortedNotePaths={[ {
                    notePath: [ "root", "calendar", "leaf" ],
                    isArchived: false,
                    isInHoistedSubTree: true,
                    isHidden: false
                } ]}
            />
        );
        const path = container.querySelector(".note-path-list li");
        await vi.waitFor(() => expect(path?.textContent).toContain("Leaf"));

        const rootLink = path?.querySelector("a.tn-link");
        expect(rootLink?.getAttribute("href")).toBe("#root");
        expect(rootLink?.getAttribute("aria-label")).toBe("My Knowledge Base");
        expect(rootLink?.getAttribute("title")).toBe("My Knowledge Base");
        expect(rootLink?.textContent).toBe("");
        expect(rootLink?.querySelector(".note-link-icon")?.className).toContain(rootIcon);
        expect(path?.textContent).not.toContain("My Knowledge Base");
        expect(path?.textContent).toContain("› Calendar › Leaf");
    });
});
