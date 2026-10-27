import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import { ViewScope } from "../../services/link";

// The badge reads the note being shown and the view it is shown in, neither of which a rendered
// widget brings with it.
const shownNote = vi.hoisted(() => ({
    current: null as FNote | null,
    viewScope: undefined as ViewScope | undefined,
    parentComponent: { triggerEvent: vi.fn() }
}));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useNoteContext: () => ({
        note: shownNote.current,
        viewScope: shownNote.viewScope,
        parentComponent: shownNote.parentComponent
    })
}));

// i18next is not initialized under test, where t() answers with an empty string; echoing the key
// back keeps the assertions about which wording the badge picks.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

import appContext from "../../components/app_context";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import {
    ClippedNoteBadge, ExecuteBadge, OfficePreviewBadge, ReadOnlyBadge, TemplateBadge,
    toggleShareEdit, useShareEditState
} from "./NoteBadges";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("ReadOnlyBadge", () => {
    it("says a note that cannot be saved is read-only, without offering to edit it", () => {
        const note = buildNote({ title: "Help page", type: "text" });
        note.isContentWritable = false;
        shownNote.current = note;
        shownNote.viewScope = { viewMode: "default" };

        const badge = renderInto(<ReadOnlyBadge />).querySelector(".read-only-badge");
        expect(badge).toBeTruthy();
        expect(badge?.textContent).toBe("breadcrumb_badges.read_only_locked");
    });
});

describe("OfficePreviewBadge", () => {
    it("marks a file note that the office preview renders", () => {
        const badge = renderBadge({ type: "file", mime: DOCX_MIME });

        expect(badge?.textContent).toBe("breadcrumb_badges.office_preview");
        expect(badge?.querySelector(".bx-show")).not.toBeNull();
    });

    it("stays away from files without an office preview, and from office MIME types on other note types", () => {
        expect(renderBadge({ type: "file", mime: "application/pdf" })).toBeNull();
        // A text note keeps its own editor, whatever MIME it carries.
        expect(renderBadge({ type: "text", mime: DOCX_MIME })).toBeNull();
    });

    it("stays away from views that show something other than the preview", () => {
        expect(renderBadge({ type: "file", mime: DOCX_MIME }, { viewMode: "attachments" })).toBeNull();
        // A context without a view mode is on the note itself, which is where the preview renders.
        expect(renderBadge({ type: "file", mime: DOCX_MIME }, undefined)).not.toBeNull();
    });

    function renderBadge(noteDef: { type: "file" | "text", mime: string }, viewScope: ViewScope | undefined = { viewMode: "default" }) {
        shownNote.current = buildNote({ title: "Document", ...noteDef });
        shownNote.viewScope = viewScope;
        return renderInto(<OfficePreviewBadge />).querySelector(".office-preview-badge");
    }
});

describe("ExecuteBadge", () => {
    it("titles the button with #executeTitle or the value of #executeButton, falling back to the wording for the note's language", () => {
        expect(renderBadge({ "#executeButton": "", "#executeTitle": "Deploy" })?.textContent).toBe("Deploy");
        expect(renderBadge({ "#executeButton": "Create launcher" })?.textContent).toBe("Create launcher");
        expect(renderBadge({ "#executeButton": "true", "#executeTitle": "Deploy" })?.textContent).toBe("Deploy");
        expect(renderBadge({ "#executeButton": "true" })?.textContent).toBe("breadcrumb_badges.execute_script");
        expect(renderBadge({ "#executeButton": "" })?.textContent).toBe("breadcrumb_badges.execute_script");
        expect(renderBadge({ "#executeDescription": "Rebuilds the index" })?.textContent).toBe("breadcrumb_badges.execute_script");
        expect(renderBadge({})).toBeNull();
    });

    function renderBadge(labels: Record<`#${string}`, string>) {
        shownNote.current = buildNote({ title: "Script", type: "code", mime: "application/javascript;env=frontend", ...labels });
        return renderInto(<ExecuteBadge />).querySelector(".execute-badge .text");
    }
});

describe("TemplateBadge", () => {
    it("marks a template or a workspace template, and no other note", () => {
        for (const [ label, text ] of [
            [ "#template", "breadcrumb_badges.template" ],
            [ "#workspaceTemplate", "breadcrumb_badges.workspace_template" ]
        ] as const) {
            const badge = renderBadge({ [label]: "" });
            expect(badge?.textContent).toBe(text);
            expect(badge?.querySelector(".bx-copy-alt")).not.toBeNull();
        }

        expect(renderBadge({})).toBeNull();
        expect(renderBadge({ "#template": "false" })).toBeNull();
    });

    it("switches a template inside a workspace to the workspace only, adding the new label first", async () => {
        const setBoolean = vi.spyOn(attributes, "setBooleanWithInheritance").mockResolvedValue();
        shownNote.current = buildInWorkspace({ "#template": "" });

        const [ global, workspace ] = await openScopes();
        expect(global.getAttribute("aria-checked")).toBe("true");
        expect(workspace.getAttribute("aria-checked")).toBe("false");

        act(() => workspace.click());
        await vi.waitFor(() => expect(setBoolean).toHaveBeenCalledTimes(2));
        expect(setBoolean.mock.calls.map(([ , name, value ]) => [ name, value ])).toEqual([
            [ "workspaceTemplate", true ], [ "template", false ]
        ]);
        setBoolean.mockRestore();
    });

    it("disables the workspace scope outside a workspace, still letting a workspace template go global", async () => {
        for (const label of [ "#template", "#workspaceTemplate" ] as const) {
            shownNote.current = buildNote({ title: "Meeting", [label]: "" });

            const [ global, workspace ] = await openScopes();
            expect(global.getAttribute("aria-checked")).toBe(String(label === "#template"));
            expect(global.classList.contains("disabled")).toBe(false);
            expect(workspace.classList.contains("disabled")).toBe(true);
            document.body.replaceChildren();
        }
    });

    it("opens the template's properties dialog", async () => {
        shownNote.current = buildNote({ title: "Meeting", "#template": "" });
        await openScopes();

        const properties = [ ...document.querySelectorAll<HTMLElement>(".tn-popup .dropdown-item") ]
            .find((row) => row.textContent?.includes("breadcrumb_badges.template_properties"));
        expect(properties).toBeDefined();
        act(() => properties?.click());
        expect(shownNote.parentComponent.triggerEvent)
            .toHaveBeenCalledWith("showTemplateProperties", { noteId: shownNote.current.noteId });
        document.body.replaceChildren();
    });

    function renderBadge(labels: Record<`#${string}`, string>) {
        shownNote.current = buildNote({ title: "Meeting", ...labels });
        return renderInto(<TemplateBadge />).querySelector(".template-badge");
    }

    function buildInWorkspace(labels: Record<`#${string}`, string>) {
        const templateId = `tmpl${Math.random().toString(36).slice(2, 10)}`;
        buildNote({ title: "Project", "#workspace": "", children: [ { id: templateId, title: "Meeting", ...labels } ] });
        return froca.notes[templateId];
    }

    async function openScopes() {
        const toggle = renderInto(<TemplateBadge />).querySelector<HTMLButtonElement>(".dropdown-template-badge button");
        expect(toggle).not.toBeNull();
        act(() => {
            toggle?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            toggle?.click();
        });
        return await vi.waitFor(() => {
            const rows = [ ...document.querySelectorAll<HTMLElement>(".tn-popup .dropdown-item[aria-checked]") ];
            if (rows.length !== 2) throw new Error("expected the two scopes to be listed");
            return rows;
        });
    }
});

describe("ClippedNoteBadge", () => {
    const PAGE_URL = "https://www.example.com/articles/1";

    it("links straight to the page when the clipping carries nothing more about it", () => {
        const badge = renderBadge({ "#pageUrl": PAGE_URL });

        expect(badge.querySelector(".clipped-note-badge a")?.getAttribute("href")).toBe(PAGE_URL);
        expect(badge.querySelector(".dropdown-clipped-note-badge")).toBeNull();
    });

    it("opens the details of the page it was clipped from, leaving out what the page did not give", async () => {
        const details = await openDetails({
            "#pageUrl": PAGE_URL,
            "#pageDescription": "First line\nSecond line",
            "#pageAuthor": "Ada Lovelace",
            "#publishedDate": "2024-05-01"
        });

        const source = details.querySelector<HTMLAnchorElement>(".clipped-note-source a");
        expect(source?.getAttribute("href")).toBe(PAGE_URL);
        expect(source?.target).toBe("_blank");
        expect(source?.textContent).toBe("www.example.com");
        expect(details.querySelector(".clipped-note-description")?.textContent).toBe("First line\nSecond line");
        expect(fields(details)).toEqual([
            [ "breadcrumb_badges.clipped_note_author", "Ada Lovelace" ],
            [ "breadcrumb_badges.clipped_note_published", "2024-05-01" ]
        ]);
    });

    it("stays open for a click inside, so its text can be selected", async () => {
        const details = await openDetails({ "#pageUrl": PAGE_URL, "#pageAuthor": "Ada Lovelace" });

        act(() => details.querySelector("dd")?.click());
        await new Promise((resolve) => setTimeout(resolve));
        expect(document.querySelector(".tn-popup .clipped-note-details")).not.toBeNull();
    });

    it("lists the dates of a page that has no description", async () => {
        const details = await openDetails({ "#pageUrl": PAGE_URL, "#modifiedDate": "2024-06-12" });

        expect(details.querySelector(".clipped-note-description")).toBeNull();
        expect(fields(details)).toEqual([ [ "breadcrumb_badges.clipped_note_modified", "2024-06-12" ] ]);
    });

    function renderBadge(labels: Record<`#${string}`, string>) {
        shownNote.current = buildNote({ title: "Clipping", ...labels });
        shownNote.viewScope = undefined;
        return renderInto(<ClippedNoteBadge />);
    }

    async function openDetails(labels: Record<`#${string}`, string>) {
        const toggle = renderBadge(labels).querySelector<HTMLButtonElement>(".dropdown-clipped-note-badge button");
        expect(toggle).not.toBeNull();
        act(() => {
            toggle?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            toggle?.click();
        });
        return await vi.waitFor(() => {
            const details = document.querySelector<HTMLElement>(".tn-popup .clipped-note-details");
            if (!details) throw new Error("expected the details panel to open");
            return details;
        });
    }

    function fields(details: HTMLElement) {
        return [ ...details.querySelectorAll(".clipped-note-fields > div") ].map((field) => [
            field.querySelector("dt")?.textContent,
            field.querySelector("dd")?.textContent
        ]);
    }
});

describe("useShareEditState", () => {
    it("reads whether guests edit the note, upload into it and need a password, from its labels", () => {
        const states: ReturnType<typeof useShareEditState>[] = [];
        function Reader({ note }: { note: FNote }) {
            states.push(useShareEditState(note));
            return null;
        }

        renderInto(<Reader note={buildNote({ title: "Plain" })} />);
        renderInto(<Reader note={buildNote({
            "title": "Open", "#shareEdit": "", "#shareAttachments": ""
        })} />);
        renderInto(<Reader note={buildNote({
            "title": "Locked", "#shareEdit": "", "#shareEditPassword": "salt$hash"
        })} />);

        const read = states.map(({ canEdit, attachments, needsPassword }) =>
            [ canEdit, attachments, needsPassword ]);
        expect(read).toEqual([
            [ false, false, false ], [ true, true, false ], [ true, false, true ]
        ]);
    });

    it("tells a branch closed below an editable note, and one opened below a locked one", () => {
        const states: ReturnType<typeof useShareEditState>[] = [];
        function Reader({ note }: { note: FNote }) {
            states.push(useShareEditState(note));
            return null;
        }
        const editable = "#shareEdit(inheritable)";
        const password = "#shareEditPassword(inheritable)";
        const site = buildNote({
            "title": "Site", [editable]: "", [password]: "salt$hash",
            "children": [
                { "title": "Closed", [editable]: "false" },
                { "title": "Open", [editable]: "", [password]: "" },
                { title: "Inherits" }
            ]
        });
        for (const childId of site.children) {
            const child = froca.getNoteFromCache(childId);
            if (child) {
                renderInto(<Reader note={child} />);
            }
        }
        renderInto(<Reader note={buildNote({ "title": "Alone", [editable]: "false" })} />);

        const read = states.map(({ canEdit, needsPassword, reopensFromParent }) =>
            [ canEdit, needsPassword, reopensFromParent ]);
        expect(read).toEqual([
            [ false, true, true ],
            [ true, false, false ],
            [ true, true, false ],
            [ false, false, false ]
        ]);
    });
});

describe("toggleShareEdit", () => {
    it("turns editing off, back to the ancestor's on a closed branch, else by dialog", async () => {
        const put = vi.spyOn(server, "put").mockResolvedValue({});
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const note = buildNote({ title: "Branch" });

        await toggleShareEdit(note, false, false);
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/share-edit`, { enabled: false });
        await toggleShareEdit(note, true, true);
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/share-edit`, { enabled: true });
        expect(triggerCommand).not.toHaveBeenCalled();
        await toggleShareEdit(note, true, false);
        expect(triggerCommand).toHaveBeenCalledWith("showShareEditDialog", { note });
        expect(put).toHaveBeenCalledTimes(2);
    });
});
