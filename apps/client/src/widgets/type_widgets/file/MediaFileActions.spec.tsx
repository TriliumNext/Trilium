import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openService } = vi.hoisted(() => ({
    openService: {
        downloadFileNote: vi.fn(),
        downloadAttachment: vi.fn(),
        openNoteExternally: vi.fn(async () => {}),
        openAttachmentExternally: vi.fn(async () => {})
    }
}));
vi.mock("../../../services/open", () => ({ default: openService }));

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import MediaFileActions from "./MediaFileActions";

const note = { noteId: "snd1", title: "Podcast", mime: "audio/mpeg", isProtected: false } as FNote;
const attachment = { attachmentId: "att1", title: "Recording", mime: "audio/mpeg", isProtected: false } as FAttachment;

describe("MediaFileActions", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    const download = () => container.querySelector(".bx-download") as HTMLElement | null;
    const open = () => container.querySelector(".bx-link-external") as HTMLElement | null;

    it("downloads and opens a note", async () => {
        await act(async () => render(<MediaFileActions entity={note} />, container));

        await act(async () => download()?.click());
        // The parent component is passed as null: media never takes the customDownload path.
        expect(openService.downloadFileNote).toHaveBeenCalledWith(note, null, null);

        await act(async () => open()?.click());
        expect(openService.openNoteExternally).toHaveBeenCalledWith("snd1", "audio/mpeg");
    });

    it("downloads and opens an attachment, which the renderer's own footer cannot", async () => {
        await act(async () => render(<MediaFileActions entity={attachment} />, container));

        await act(async () => download()?.click());
        expect(openService.downloadAttachment).toHaveBeenCalledWith("att1");

        await act(async () => open()?.click());
        expect(openService.openAttachmentExternally).toHaveBeenCalledWith("att1", "audio/mpeg");
    });

    it("shows a spinner while the external open is in flight", async () => {
        let finishOpen = () => {};
        openService.openNoteExternally.mockImplementation(() => new Promise<void>((resolve) => { finishOpen = resolve; }));
        await act(async () => render(<MediaFileActions entity={note} />, container));

        await act(async () => open()?.click());
        expect(container.querySelector(".bx-loader")).not.toBeNull();
        expect(open()).toBeNull();

        await act(async () => { finishOpen(); });
        expect(container.querySelector(".bx-loader")).toBeNull();
        expect(open()).not.toBeNull();
    });

    it("hides Open for a protected note, which the browser can't open outside the protected session", async () => {
        await act(async () => render(<MediaFileActions entity={{ ...note, isProtected: true } as FNote} />, container));

        expect(download()).not.toBeNull();
        expect(open()).toBeNull();
    });
});
