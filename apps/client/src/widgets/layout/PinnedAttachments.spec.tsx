import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import type FAttachment from "../../entities/fattachment";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import PinnedAttachments from "./PinnedAttachments";

vi.mock("../type_widgets/transcript/TranscriptView", () => ({
    default: ({ attachment }: { attachment: FAttachment }) =>
        <div className="transcript-stub">{attachment.attachmentId}</div>,
    TranscriptRecordingLevels: ({ attachment }: { attachment: FAttachment }) =>
        <span className="levels-stub">{attachment.attachmentId}</span>
}));

function attachment(attachmentId: string, role: string, title: string) {
    return { attachmentId, role, title } as FAttachment;
}

async function renderWith(attachments: FAttachment[]) {
    const note = buildNote({ title: "Meeting", type: "text" });
    vi.spyOn(note, "getAttachments").mockResolvedValue(attachments);
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<PinnedAttachments note={note} />);
    });
    if (!container) {
        throw new Error("nothing rendered");
    }
    return container;
}

describe("PinnedAttachments", () => {
    it("shows the attachments of a pinned role, expanded and titled, and no others", async () => {
        const container = await renderWith([
            attachment("image1", "image", "photo.png"),
            attachment("transcript1", "transcript", "Transcript")
        ]);

        const sections = container.querySelectorAll(".pinned-attachment");
        expect(sections).toHaveLength(1);
        const [ section ] = sections;
        expect(section.classList.contains("collapsible-card")).toBe(true);
        expect(section.textContent).toContain("Transcript");
        expect(section.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
        expect(section.querySelector(".transcript-stub")?.textContent).toBe("transcript1");
    });

    it("shows a transcript's level meters in its header, also while collapsed", async () => {
        const container = await renderWith([
            attachment("transcript1", "transcript", "Transcript")
        ]);
        const levels = () => container.querySelector(".collapsible-header .levels-stub");
        const title = container.querySelector<HTMLButtonElement>(".collapsible-title");

        expect(levels()?.textContent).toBe("transcript1");
        expect(container.querySelector(".collapsible-body .levels-stub")).toBeNull();
        act(() => title?.click());
        expect(title?.getAttribute("aria-expanded")).toBe("false");
        expect(levels()).not.toBeNull();
    });

    it("renders nothing for a note without one", async () => {
        const container = await renderWith([ attachment("image1", "image", "photo.png") ]);
        expect(container.querySelector(".pinned-attachment")).toBeNull();
    });
});
