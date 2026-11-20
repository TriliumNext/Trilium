import { existsSync } from "node:fs";
import path from "node:path";

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import server from "../../../services/server";
import PdfViewer, { getFontFaceCss, getPdfUrl, type PdfLinkTarget, type PdfTocDocument } from "./PdfViewer";

describe("PdfViewer", () => {
    function viewerUrl(props: {
        noteId?: string; ntxId?: string | null; loadToken?: string; pdfUrl?: string
    }) {
        const container = document.createElement("div");
        render(<PdfViewer pdfUrl="/api/notes/abc123/open" {...props} />, container);
        const src = container.querySelector("iframe")?.getAttribute("src");
        render(null, container);
        return new URL(src ?? "", "http://localhost").searchParams;
    }

    it("addresses the viewer in its URL, so it can post before the frame loads", () => {
        const params = viewerUrl({ noteId: "abc123", ntxId: "ntx 1" });
        expect(params.get("noteId")).toBe("abc123");
        expect(params.get("ntxId")).toBe("ntx 1");
        expect(params.get("file")).toBe("/api/notes/abc123/open");

        // A viewer outside a note (print preview, lightbox, revisions) reports to no one.
        expect(viewerUrl({}).has("noteId")).toBe(false);
        expect(viewerUrl({}).has("position")).toBe(false);
        expect(viewerUrl({ noteId: "abc123", ntxId: null }).has("ntxId")).toBe(false);
    });

    it("names its load and the blob it asks for in its URL", () => {
        const params = viewerUrl({ pdfUrl: "/api/notes/abc123/open?blobId=blobA", loadToken: "7" });
        expect(params.get("file")).toBe("/api/notes/abc123/open?blobId=blobA");
        expect(params.get("loadToken")).toBe("7");
        expect(viewerUrl({}).has("loadToken")).toBe(false);
    });

    it("hides pdf.js' own sidebar, since the right panel lists the document's contents", () => {
        expect(viewerUrl({}).get("sidebar")).toBe("0");
    });
});

describe("PdfViewer for a document of its own", () => {
    let container: HTMLDivElement;

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        vi.restoreAllMocks();
    });

    /** Renders a viewer, again with the same frame when called again. */
    function show(target?: PdfLinkTarget, tocDocument?: PdfTocDocument) {
        act(() => render(
            <PdfViewer pdfUrl="/api/attachments/att1/open" target={target} tocDocument={tocDocument} />,
            container));
        const iframe = container.querySelector("iframe") as HTMLIFrameElement;
        if (!Object.hasOwn(iframe, "contentWindow")) {
            const frameWindow = Object.assign(new EventTarget(), { postMessage: vi.fn() });
            Object.defineProperty(iframe, "contentWindow", { value: frameWindow });
        }
        return { iframe, posted: vi.mocked((iframe.contentWindow as Window).postMessage) };
    }

    function load(iframe: HTMLIFrameElement) {
        act(() => { iframe.dispatchEvent(new Event("load")); });
    }

    it("opens at the target it is given, once the frame has loaded, and at each later target once", () => {
        container = document.createElement("div");
        document.body.append(container);
        const heading = { page: 3, heading: "0k3x9aa1h7q2mz" };
        const { iframe, posted } = show(heading);
        expect(posted).not.toHaveBeenCalled();

        load(iframe);
        expect(posted).toHaveBeenCalledExactlyOnceWith(
            { type: "trilium-scroll-to-heading", headingId: "0k3x9aa1h7q2mz", pageNumber: 3 }, window.location.origin);

        // The same target is not posted again, a reload of the frame included.
        show(heading);
        load(iframe);
        expect(posted).toHaveBeenCalledOnce();

        show({ page: 5, annotation: "12R" });
        expect(posted).toHaveBeenLastCalledWith(
            { type: "trilium-scroll-to-annotation", annotationId: "12R", pageNumber: 5 }, window.location.origin);
        show(undefined);
        expect(posted).toHaveBeenCalledTimes(2);
    });

    it("builds the ToC cache of its document, and saves only the answers of its own frame", async () => {
        container = document.createElement("div");
        document.body.append(container);
        vi.spyOn(server, "getWithSilentErrors")
            .mockResolvedValue({ status: "missing", pendingToc: { format: "pdf" } });
        const put = vi.spyOn(server, "put").mockResolvedValue({ status: "ready", blobId: "b", headings: [] });
        const { iframe, posted } = show(undefined, { tocUrl: "attachments/att1/toc", isProtected: true });

        load(iframe);
        await vi.waitFor(() => expect(posted).toHaveBeenCalledWith({
            type: "trilium-build-toc", requestId: 1, isProtected: true, data: undefined
        }, window.location.origin, []));

        const answer = { type: "pdfjs-viewer-toc-build", requestId: 1, blobId: "b", headings: [], properties: {}, elapsedMs: 1 };
        window.dispatchEvent(new MessageEvent("message", { data: answer }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(put).not.toHaveBeenCalled();

        window.dispatchEvent(new MessageEvent("message", {
            data: answer, source: iframe.contentWindow as unknown as MessageEventSource
        }));
        await vi.waitFor(() => expect(put).toHaveBeenCalledWith("attachments/att1/toc", {
            targetBlobHash: "b", headings: [], properties: {}, elapsedMs: 1
        }, undefined, { silentConflict: true }));
    });

    it("asks its frame where it reads, and reports each reading of its own load", () => {
        container = document.createElement("div");
        document.body.append(container);
        const onReadingChange = vi.fn();
        act(() => render(
            <PdfViewer pdfUrl="/api/attachments/att1/open" loadToken="5"
                onReadingChange={onReadingChange} />,
            container));
        const iframe = container.querySelector("iframe") as HTMLIFrameElement;
        const frameWindow = new EventTarget();
        Object.defineProperty(iframe, "contentWindow", { value: frameWindow });
        const src = new URL(iframe.getAttribute("src") ?? "", "http://localhost");
        expect(src.searchParams.get("position")).toBe("1");

        function fromFrame(data: object, source: unknown = frameWindow) {
            window.dispatchEvent(new MessageEvent("message", {
                data: { loadToken: "5", ...data }, source: source as MessageEventSource
            }));
        }
        fromFrame({ type: "pdfjs-viewer-rotations", rotations: [ 0, 90 ] });
        fromFrame({ type: "pdfjs-viewer-position", pageNumber: 2, x: 10, y: 20 });
        fromFrame({ type: "pdfjs-viewer-page-rotation", pageNumber: 1, rotation: 180 });
        expect(onReadingChange.mock.calls.map(([ reading ]) => reading)).toStrictEqual([
            { position: null, rotations: [ 0, 90 ] },
            { position: { pageNumber: 2, x: 10, y: 20 }, rotations: [ 0, 90 ] },
            { position: { pageNumber: 2, x: 10, y: 20 }, rotations: [ 180, 90 ] }
        ]);

        // Another load, another frame and another message report nothing.
        fromFrame({ type: "pdfjs-viewer-position", pageNumber: 1, x: 0, y: 0, loadToken: "4" });
        fromFrame({ type: "pdfjs-viewer-position", pageNumber: 1, x: 0, y: 0 }, window);
        fromFrame({ type: "pdfjs-viewer-current-page", currentPage: 1 });
        expect(onReadingChange).toHaveBeenCalledTimes(3);
    });

    it("builds nothing without a document to build for", async () => {
        container = document.createElement("div");
        document.body.append(container);
        const get = vi.spyOn(server, "getWithSilentErrors");
        const { iframe } = show();

        load(iframe);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(get).not.toHaveBeenCalled();
    });
});

describe("getPdfUrl", () => {
    afterEach(() => history.replaceState({}, "", "/"));

    it("resolves an API path against the deployment root, never relative to the viewer", () => {
        expect(getPdfUrl("attachments/abc123/open")).toBe("/api/attachments/abc123/open");

        // Trilium behind a reverse proxy on a subpath: the URL keeps the prefix, so pdf.js still
        // reaches the API without `../../` — which a proxy filtering traversal would reject (#8877).
        history.replaceState({}, "", "/trilium/#root/abc123");
        expect(getPdfUrl("notes/abc123/open")).toBe("/trilium/api/notes/abc123/open");

        expect(getPdfUrl("revisions/rev1/download")).not.toContain("..");
    });
});

describe("getFontFaceCss", () => {
    const originalAssetPath = window.glob.assetPath;

    afterEach(() => {
        window.glob.assetPath = originalAssetPath;
        history.replaceState({}, "", "/");
    });

    it("resolves every face against the deployment root, never relative to the viewer", () => {
        // Standalone serves the client from the root, so its asset path is a bare `.`.
        window.glob.assetPath = ".";
        expect(getFontFaceCss()).toContain("url('/fonts/Inter/Inter-VariableFont_opsz,wght.woff2')");

        // The server version-stamps the prefix, and keeps it relative so a subpath deployment works.
        window.glob.assetPath = "assets/v1.2.3";
        history.replaceState({}, "", "/trilium/#root/abc123");
        expect(getFontFaceCss()).toContain("url('/trilium/assets/v1.2.3/fonts/Inter/");

        expect(getFontFaceCss()).not.toContain("..");
    });

    it("names files the client actually ships", () => {
        window.glob.assetPath = ".";

        const fontsDir = path.join(__dirname, "../../../fonts");
        const files = [...getFontFaceCss().matchAll(/url\('\/fonts\/([^']+)'\)/g)].map(([, file]) => file);

        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(existsSync(path.join(fontsDir, file)), `${file} is missing from ${fontsDir}`).toBe(true);
        }
    });
});
