import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isMobileMock } = vi.hoisted(() => ({ isMobileMock: vi.fn(() => false) }));

vi.mock("../hooks", () => ({ useStaticTooltip: () => {} }));
vi.mock("../../../services/image", () => ({
    downloadImage: vi.fn(),
    copyImageToClipboard: vi.fn(),
    isImageCopySupported: vi.fn(() => true)
}));
vi.mock("../../../services/open", () => ({
    default: { openNoteExternally: vi.fn(), openAttachmentExternally: vi.fn() }
}));
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    isMobile: isMobileMock
}));

import { copyImageToClipboard, downloadImage, isImageCopySupported } from "../../../services/image";
import openService from "../../../services/open";
import type { MediaGallery, MediaViewerItem } from "./gallery";
import type { MediaViewerApi } from "./MediaViewer";
import MediaViewerToolbar from "./MediaViewerToolbar";

function makeApi(): MediaViewerApi {
    return {
        zoomBy: vi.fn(),
        zoomTo: vi.fn(),
        fitToWindow: vi.fn(),
        actualSize: vi.fn(),
        reset: vi.fn(),
        rotate: vi.fn(),
        flipHorizontal: vi.fn(),
        moveBy: vi.fn(),
        toggleFullscreen: vi.fn(),
        isFullscreen: () => false,
        isAtFit: () => true,
        zoomPercent: () => 100
    };
}

function makeItem(id: string, kind: MediaViewerItem["kind"] = "note"): MediaViewerItem {
    return { id, title: id, src: `api/x/${id}?v=1`, kind, mime: "image/png" };
}

function makeGallery(items: MediaViewerItem[], currentIndex = 0): MediaGallery {
    return {
        items,
        currentIndex,
        surfaceKey: "s",
        navigateToIndex: vi.fn(),
        navigatePrevious: vi.fn(),
        navigateNext: vi.fn(),
        navigateFirst: vi.fn(),
        navigateLast: vi.fn()
    };
}

type ToolbarProps = Parameters<typeof MediaViewerToolbar>[0];

function renderToolbar(props: Partial<ToolbarProps> & { gallery: MediaGallery }) {
    const container = document.createElement("div");
    render(
        <MediaViewerToolbar api={props.api ?? makeApi()} zoomPercent={props.zoomPercent ?? 100} fullscreen={props.fullscreen ?? false} onCopyReference={props.onCopyReference} gallery={props.gallery} />,
        container
    );
    const click = (selector: string) => {
        const button = container.querySelector<HTMLButtonElement>(selector);
        if (!button) throw new Error(`no button for ${selector}`);
        button.click();
    };
    return { container, click };
}

describe("MediaViewerToolbar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isMobileMock.mockReturnValue(false);
    });
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("drives the viewer api from the zoom/fit/rotate/flip cluster and shows the zoom percentage", () => {
        const api = makeApi();
        const { container, click } = renderToolbar({ api, gallery: makeGallery([ makeItem("a") ]), zoomPercent: 150 });

        expect(container.querySelector(".media-viewer-zoom-level")?.textContent).toBe("150%");
        click(".media-viewer-zoom-level");
        expect(api.reset).toHaveBeenCalled();
        click(".bx-plus-circle");
        click(".bx-minus-circle");
        const zoomBy = api.zoomBy as ReturnType<typeof vi.fn>;
        expect(zoomBy.mock.calls[0][0]).toBeGreaterThan(0);
        expect(zoomBy.mock.calls[1][0]).toBeLessThan(0);
        click(".media-viewer-fit");
        expect(api.fitToWindow).toHaveBeenCalled();
        click(".media-viewer-actual-size");
        expect(api.actualSize).toHaveBeenCalled();
        click(".bx-rotate-left");
        click(".bx-rotate-right");
        const rotate = api.rotate as ReturnType<typeof vi.fn>;
        expect(rotate).toHaveBeenNthCalledWith(1, -90);
        expect(rotate).toHaveBeenNthCalledWith(2, 90);
        click(".media-viewer-flip");
        expect(api.flipHorizontal).toHaveBeenCalled();
        click(".bx-fullscreen");
        expect(api.toggleFullscreen).toHaveBeenCalled();
    });

    it("shows the gallery cluster with a position counter only when there is more than one image", () => {
        const gallery = makeGallery([ makeItem("a"), makeItem("b"), makeItem("c") ], 1);
        const { container, click } = renderToolbar({ gallery });

        expect(container.querySelector(".media-viewer-position")?.textContent).toBe("2/3");
        click(".bx-chevron-left");
        expect(gallery.navigatePrevious).toHaveBeenCalled();
        click(".bx-chevron-right");
        expect(gallery.navigateNext).toHaveBeenCalled();

        const single = renderToolbar({ gallery: makeGallery([ makeItem("a") ]) });
        expect(single.container.querySelector(".media-viewer-position")).toBeNull();
        expect(single.container.querySelector(".bx-chevron-left")).toBeNull();
    });

    it("downloads the current image and opens it externally routed by its kind", () => {
        const noteGallery = makeGallery([ makeItem("n1", "note") ]);
        const note = renderToolbar({ gallery: noteGallery });
        note.click(".bx-download");
        expect(downloadImage).toHaveBeenCalledWith("api/x/n1?v=1");
        note.click(".media-viewer-open-externally");
        expect(openService.openNoteExternally).toHaveBeenCalledWith("n1", "image/png");

        const attachment = renderToolbar({ gallery: makeGallery([ makeItem("a1", "attachment") ]) });
        attachment.click(".media-viewer-open-externally");
        expect(openService.openAttachmentExternally).toHaveBeenCalledWith("a1", "image/png");
    });

    it("offers copy-image only where supported, and copy-reference only when the caller provides it", () => {
        vi.mocked(isImageCopySupported).mockReturnValue(false);
        const without = renderToolbar({ gallery: makeGallery([ makeItem("a") ]) });
        expect(without.container.querySelector(".media-viewer-copy-image")).toBeNull();
        expect(without.container.querySelector(".media-viewer-copy-reference")).toBeNull();

        vi.mocked(isImageCopySupported).mockReturnValue(true);
        const onCopyReference = vi.fn();
        const withBoth = renderToolbar({ gallery: makeGallery([ makeItem("a") ]), onCopyReference });
        withBoth.click(".media-viewer-copy-image");
        expect(copyImageToClipboard).toHaveBeenCalledWith("api/x/a?v=1");
        withBoth.click(".media-viewer-copy-reference");
        expect(onCopyReference).toHaveBeenCalled();
    });

    it("switches the fullscreen button icon when fullscreen", () => {
        const { container } = renderToolbar({ gallery: makeGallery([ makeItem("a") ]), fullscreen: true });
        expect(container.querySelector(".bx-exit-fullscreen")).not.toBeNull();
        expect(container.querySelector(".bx-fullscreen")).toBeNull();
    });

    it("reduces to navigation + fullscreen on mobile (gestures cover zoom/pan)", () => {
        isMobileMock.mockReturnValue(true);
        const { container } = renderToolbar({ gallery: makeGallery([ makeItem("a"), makeItem("b") ]) });
        expect(container.querySelector(".bx-chevron-left")).not.toBeNull();
        expect(container.querySelector(".media-viewer-position")).not.toBeNull();
        expect(container.querySelector(".bx-chevron-right")).not.toBeNull();
        expect(container.querySelector(".bx-fullscreen")).not.toBeNull();
        expect(container.querySelector(".bx-download")).toBeNull();
        expect(container.querySelector(".media-viewer-zoom-level")).toBeNull();
        expect(container.querySelector(".bx-rotate-left")).toBeNull();
    });
});
