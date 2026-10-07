import { describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";
import { ViewScope } from "../../services/link";

// The badge reads the note being shown and the view it is shown in, neither of which a rendered
// widget brings with it.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null, viewScope: undefined as ViewScope | undefined }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useNoteContext: () => ({
        note: shownNote.current,
        viewScope: shownNote.viewScope
    })
}));

// i18next is not initialized under test, where t() answers with an empty string; echoing the key
// back keeps the assertions about which wording the badge picks.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { getShareScope, OfficePreviewBadge } from "./NoteBadges";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

describe("getShareScope", () => {
    it("tells a public share from a local one, a standalone preview and one only an export publishes", () => {
        const syncServerHost = "https://sync.example.com";
        const platform = { isElectron: false, isStandalone: false, isMobileApp: false };

        expect(getShareScope({ ...platform, syncServerHost: "" })).toBe("public");
        expect(getShareScope({ ...platform, isElectron: true, syncServerHost: "" })).toBe("local");
        expect(getShareScope({ ...platform, isElectron: true, syncServerHost })).toBe("public");
        expect(getShareScope({ ...platform, isStandalone: true, syncServerHost: "" })).toBe("preview");
        expect(getShareScope({ ...platform, isStandalone: true, syncServerHost })).toBe("public");
        expect(getShareScope({ ...platform, isStandalone: true, isMobileApp: true, syncServerHost: "" })).toBe("export-only");
        expect(getShareScope({ ...platform, isStandalone: true, isMobileApp: true, syncServerHost })).toBe("public");
    });
});
