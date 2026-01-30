let outlineMap: Map<string, any> | null = null;
let headingPositions: Array<{ id: string; pageIndex: number; y: number }> | null = null;

export async function extractAndSendToc() {
    const app = window.PDFViewerApplication;

    try {
        const outline = await app.pdfDocument.getOutline();

        if (!outline || outline.length === 0) {
            window.parent.postMessage({
                type: "pdfjs-viewer-toc",
                data: null
            } satisfies PdfViewerTocMessage, window.location.origin);
            return;
        }

        // Store outline items with their destinations for later scrolling
        outlineMap = new Map();
        headingPositions = [];
        const toc = convertOutlineToToc(outline, 0, outlineMap);

        // Build position mapping for active heading detection
        await buildPositionMapping(outlineMap);

        window.parent.postMessage({
            type: "pdfjs-viewer-toc",
            data: toc
        } satisfies PdfViewerTocMessage, window.location.origin);
    } catch (error) {
        window.parent.postMessage({
            type: "pdfjs-viewer-toc",
            data: null
        } satisfies PdfViewerTocMessage, window.location.origin);
    }
}

function convertOutlineToToc(outline: any[], level = 0, outlineMap?: Map<string, any>, parentId = ""): any[] {
    return outline.map((item, index) => {
        const id = parentId ? `${parentId}-${index}` : `pdf-outline-${index}`;

        if (outlineMap) {
            outlineMap.set(id, item);
        }

        return {
            title: item.title,
            level: level,
            dest: item.dest,
            id: id,
            items: item.items && item.items.length > 0 ? convertOutlineToToc(item.items, level + 1, outlineMap, id) : []
        };
    });
}

export function setupScrollToHeading() {
    window.addEventListener("message", async (event) => {
        // Only accept messages from the same origin to prevent malicious iframes
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-scroll-to-heading") {
            const headingId = event.data.headingId;

            if (!outlineMap) return;

            const outlineItem = outlineMap.get(headingId);
            if (!outlineItem || !outlineItem.dest) return;

            const app = window.PDFViewerApplication;

            // Navigate to the destination
            try {
                const dest = typeof outlineItem.dest === 'string'
                    ? await app.pdfDocument.getDestination(outlineItem.dest)
                    : outlineItem.dest;

                if (dest) {
                    app.pdfLinkService.goToDestination(dest);
                }
            } catch (error) {
                console.error("Error navigating to heading:", error);
            }
        }
    });
}

async function buildPositionMapping(outlineMap: Map<string, any>) {
    const app = window.PDFViewerApplication;

    for (const [id, item] of outlineMap.entries()) {
        if (!item.dest) continue;

        try {
            const dest = typeof item.dest === 'string'
                ? await app.pdfDocument.getDestination(item.dest)
                : item.dest;

            if (dest && dest[0]) {
                const pageRef = dest[0];
                const pageIndex = await app.pdfDocument.getPageIndex(pageRef);

                // Extract Y coordinate from destination (dest[3] is typically the y-coordinate)
                const y = typeof dest[3] === 'number' ? dest[3] : 0;

                headingPositions?.push({ id, pageIndex, y });
            }
        } catch (error) {
            // Skip items with invalid destinations
        }
    }

    // Sort by page and then by Y position (descending, since PDF coords are bottom-up)
    headingPositions?.sort((a, b) => {
        if (a.pageIndex !== b.pageIndex) {
            return a.pageIndex - b.pageIndex;
        }
        return b.y - a.y; // Higher Y comes first (top of page)
    });
}

export function setupActiveHeadingTracking() {
    const app = window.PDFViewerApplication;
    let lastActiveHeading: string | null = null;

    // Offset from top of viewport to consider a heading "active"
    // This makes the heading active when it's near the top, not when fully scrolled past
    const ACTIVE_HEADING_OFFSET = 100;

    function updateActiveHeading() {
        if (!headingPositions || headingPositions.length === 0) return;

        const viewer = app.pdfViewer;
        const container = viewer.container;
        const scrollTop = container.scrollTop;

        // Find the heading closest to the top of the viewport
        let activeHeadingId: string | null = null;
        let bestDistance = Infinity;

        for (const heading of headingPositions) {
            // Get the page view to calculate actual position
            const pageView = viewer.getPageView(heading.pageIndex);
            if (!pageView || !pageView.div) {
                continue;
            }

            const pageTop = pageView.div.offsetTop;
            const pageHeight = pageView.div.clientHeight;

            // Convert PDF Y coordinate (bottom-up) to screen position (top-down)
            const headingScreenY = pageTop + (pageHeight - heading.y);

            // Calculate distance from top of viewport
            const distance = Math.abs(headingScreenY - scrollTop);

            // If this heading is closer to the top of viewport, and it's not too far below
            if (headingScreenY <= scrollTop + ACTIVE_HEADING_OFFSET && distance < bestDistance) {
                activeHeadingId = heading.id;
                bestDistance = distance;
            }
        }

        if (activeHeadingId !== lastActiveHeading) {
            lastActiveHeading = activeHeadingId;
            window.parent.postMessage({
                type: "pdfjs-viewer-active-heading",
                headingId: activeHeadingId
            } satisfies PdfViewerActiveHeadingMessage, window.location.origin);
        }
    }

    // Debounced scroll handler
    let scrollTimeout: number | null = null;
    const debouncedUpdate = () => {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = window.setTimeout(updateActiveHeading, 100);
    };

    app.eventBus.on("pagechanging", debouncedUpdate);

    // Also listen to scroll events for more granular updates within a page
    const container = app.pdfViewer.container;
    container.addEventListener("scroll", debouncedUpdate);

    // Initial update
    updateActiveHeading();
}
