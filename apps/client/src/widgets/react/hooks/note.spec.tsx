import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import Component from "../../../components/component";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { ParentComponent } from "../react_utils";
import { useNoteIcon } from "./note";

describe("useNoteIcon", () => {
    it("follows the note's type, as converting a document to text changes it", async () => {
        const note = buildNote({
            title: "Review",
            type: "file",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        });
        const parentComponent = new Component();
        let icon: string | undefined;
        function Probe() {
            icon = useNoteIcon(note);
            return null;
        }

        await act(async () => {
            render(
                <ParentComponent.Provider value={parentComponent}><Probe /></ParentComponent.Provider>,
                renderInto(null)
            );
        });
        const documentIcon = icon;

        note.type = "text";
        note.mime = "text/html";
        const loadResults = new LoadResults([]);
        loadResults.addNote(note.noteId, "client");
        await act(async () => {
            await parentComponent.handleEvent("entitiesReloaded", { loadResults });
        });

        expect(icon).not.toBe(documentIcon);
        expect(icon).toBe(note.getIcon());
    });
});
