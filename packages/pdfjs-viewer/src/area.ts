interface AreaEntry {
    pageNumber: number;
    rect: { x: number; y: number; width: number; height: number };
    color?: string;
    attachmentId?: string;
    attributeId?: string;
    comment?: string;
}

const PERSISTENT_OVERLAY_CLASS = "trilium-area-overlay";

/** Persisted so pagerendered can re-draw overlays after virtual-scroll eviction. */
let storedAreas: AreaEntry[] = [];

/** Set when scrollToArea targets a page not yet rendered; cleared by pagerendered. */
let pendingScrollTarget: { pageNumber: number; rect: AreaEntry["rect"] } | null = null;

export function setupAreaAnnotation() {
    const toolbarRight = document.getElementById("toolbarViewerRight");
    if (!toolbarRight) return;

    const app = window.PDFViewerApplication;
    // container is only available after documentloaded — callers must ensure this
    const container = app?.pdfViewer?.container as HTMLElement | undefined;
    if (!container) return;

    // --- Toolbar button ---
    const spacer = document.createElement("div");
    spacer.className = "toolbarButtonSpacer";

    const button = document.createElement("button");
    button.id = "triliumAreaAnnotationButton";
    button.className = "toolbarButton";
    button.title = "Capture area as image annotation";
    button.setAttribute("aria-label", "Capture area");
    button.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="2" width="14" height="14" rx="1.5" stroke-dasharray="3 2"/>
        <line x1="9" y1="5" x2="9" y2="13" stroke-width="1" opacity="0.6"/>
        <line x1="5" y1="9" x2="13" y2="9" stroke-width="1" opacity="0.6"/>
    </svg>`;

    toolbarRight.prepend(spacer);
    toolbarRight.prepend(button);

    // --- Selection overlay ---
    const selectionBox = document.createElement("div");
    Object.assign(selectionBox.style, {
        position: "absolute",
        border: "2px dashed #4a90d9",
        background: "rgba(74, 144, 217, 0.1)",
        pointerEvents: "none",
        display: "none",
        zIndex: "9000",
        boxSizing: "border-box",
    } as CSSStyleDeclaration);
    container.style.position = "relative";
    container.appendChild(selectionBox);

    // --- State ---
    let active = false;
    let selecting = false;
    let startX = 0;
    let startY = 0;

    function activate() {
        active = true;
        button.style.background = "var(--toolbarButton-hover-bg, rgba(255,255,255,0.2))";
        container.style.cursor = "crosshair";
        (container.style as any).userSelect = "none";
    }

    function deactivate() {
        active = false;
        selecting = false;
        button.style.background = "";
        container.style.cursor = "";
        (container.style as any).userSelect = "";
        selectionBox.style.display = "none";
    }

    button.addEventListener("click", () => {
        if (active) deactivate();
        else activate();
    });

    container.addEventListener("mousedown", (e: MouseEvent) => {
        if (!active || e.button !== 0) return;
        e.preventDefault();
        selecting = true;

        const cr = container.getBoundingClientRect();
        startX = e.clientX - cr.left + container.scrollLeft;
        startY = e.clientY - cr.top + container.scrollTop;

        Object.assign(selectionBox.style, {
            display: "block",
            left: `${startX}px`,
            top: `${startY}px`,
            width: "0",
            height: "0",
        });
    });

    container.addEventListener("mousemove", (e: MouseEvent) => {
        if (!selecting) return;
        e.preventDefault();

        const cr = container.getBoundingClientRect();
        const curX = e.clientX - cr.left + container.scrollLeft;
        const curY = e.clientY - cr.top + container.scrollTop;

        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);

        Object.assign(selectionBox.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${Math.abs(curX - startX)}px`,
            height: `${Math.abs(curY - startY)}px`,
        });
    });

    container.addEventListener("mouseup", (e: MouseEvent) => {
        if (!selecting) return;

        const cr = container.getBoundingClientRect();
        const endX = e.clientX - cr.left + container.scrollLeft;
        const endY = e.clientY - cr.top + container.scrollTop;

        const left = Math.min(startX, endX);
        const top = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);

        deactivate();

        if (width < 10 || height < 10) return;

        captureAndSend(container, left, top, width, height);
    });

    // Re-draw overlays on every page render (PDF.js may have evicted the page div
    // via its virtual scroller, removing our overlay child elements with it).
    // Also: if a scroll-to-area was pending for this page, complete the precise
    // vertical centering now that the page dimensions are fully known.
    app.eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
        const areasForPage = storedAreas.filter((a) => a.pageNumber === pageNumber);

        const pageEl = container.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
        if (!pageEl) return;

        // Redraw overlays
        pageEl.querySelectorAll(`.${PERSISTENT_OVERLAY_CLASS}`).forEach((el) => el.remove());
        for (const area of areasForPage) {
            pageEl.appendChild(createOverlay(area));
        }

        // Precise scroll: if we were waiting for this page to render, centre on the rect.
        if (pendingScrollTarget?.pageNumber === pageNumber) {
            const { rect } = pendingScrollTarget;
            pendingScrollTarget = null;
            const areaTop = pageEl.offsetTop + rect.y * pageEl.offsetHeight;
            const areaCenter = areaTop + (rect.height * pageEl.offsetHeight) / 2;
            container.scrollTo({ top: areaCenter - container.clientHeight / 2, behavior: "smooth" });
        }
    });

    // Message handlers: scroll-to-area and set-area-overlays
    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-scroll-to-area") {
            const { pageNumber, rect } = event.data as {
                pageNumber: number;
                rect: { x: number; y: number; width: number; height: number };
            };
            scrollToArea(container, pageNumber, rect);
        }

        if (event.data?.type === "trilium-set-area-overlays") {
            const { areas } = event.data as { areas: AreaEntry[] };
            setAreaOverlays(container, areas);
        }
    });

    // Signal the parent that we are ready to receive overlay data.
    // This is a pull model: the parent may have sent trilium-set-area-overlays
    // before this listener was registered (the message would be silently dropped),
    // so we ask for it again now that we are ready.
    window.parent.postMessage(
        { type: "pdfjs-viewer-ready-for-overlays" },
        window.location.origin
    );
}

/** Build and return an overlay div for a stored area. Includes right-click handler. */
function createOverlay(area: AreaEntry): HTMLElement {
    const hex = area.color ?? "#4a90d9";

    const overlay = document.createElement("div");
    overlay.className = PERSISTENT_OVERLAY_CLASS;
    if (area.comment) overlay.title = area.comment;

    Object.assign(overlay.style, {
        position: "absolute",
        left: `${area.rect.x * 100}%`,
        top: `${area.rect.y * 100}%`,
        width: `${area.rect.width * 100}%`,
        height: `${area.rect.height * 100}%`,
        border: `2px solid ${hex}cc`,
        background: `${hex}1a`,
        pointerEvents: "all",  // allow mouse events through the overlay
        zIndex: "8000",
        borderRadius: "2px",
        boxSizing: "border-box",
        cursor: "context-menu",
    } as CSSStyleDeclaration);

    overlay.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage(
            {
                type: "pdfjs-viewer-area-right-click",
                attachmentId: area.attachmentId,
                attributeId: area.attributeId,
                // clientX/Y relative to iframe viewport; parent converts to page coords
                clientX: e.clientX,
                clientY: e.clientY,
            },
            window.location.origin
        );
    });

    return overlay;
}

function setAreaOverlays(container: HTMLElement, areas: AreaEntry[]) {
    storedAreas = areas;

    container.querySelectorAll(`.${PERSISTENT_OVERLAY_CLASS}`).forEach((el) => el.remove());

    for (const area of areas) {
        const pageEl = container.querySelector<HTMLElement>(`.page[data-page-number="${area.pageNumber}"]`);
        if (!pageEl) continue;
        pageEl.appendChild(createOverlay(area));
    }
}

function captureAndSend(container: HTMLElement, left: number, top: number, width: number, height: number) {
    const pages = Array.from(
        container.querySelectorAll<HTMLElement>(".page[data-page-number]")
    );

    const centerY = top + height / 2;
    let targetPage: HTMLElement | null = null;
    let pageNumber = 0;

    for (const page of pages) {
        const pageTop = page.offsetTop;
        const pageBottom = pageTop + page.offsetHeight;
        if (centerY >= pageTop && centerY < pageBottom) {
            targetPage = page;
            pageNumber = parseInt(page.getAttribute("data-page-number") ?? "1", 10);
            break;
        }
    }

    if (!targetPage || !pageNumber) return;

    const canvas = targetPage.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return;

    const relLeft = Math.max(0, left - targetPage.offsetLeft);
    const relTop = Math.max(0, top - targetPage.offsetTop);
    const relWidth = Math.min(width, targetPage.offsetWidth - relLeft);
    const relHeight = Math.min(height, targetPage.offsetHeight - relTop);

    const scaleX = canvas.width / targetPage.offsetWidth;
    const scaleY = canvas.height / targetPage.offsetHeight;

    const cx = Math.round(relLeft * scaleX);
    const cy = Math.round(relTop * scaleY);
    const cw = Math.round(relWidth * scaleX);
    const ch = Math.round(relHeight * scaleY);

    if (cw <= 0 || ch <= 0) return;

    const tmp = document.createElement("canvas");
    tmp.width = cw;
    tmp.height = ch;
    const ctx = tmp.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);

    window.parent.postMessage(
        {
            type: "pdfjs-viewer-area-capture",
            imageData: tmp.toDataURL("image/png"),
            pageNumber,
            rect: {
                x: relLeft / targetPage.offsetWidth,
                y: relTop / targetPage.offsetHeight,
                width: relWidth / targetPage.offsetWidth,
                height: relHeight / targetPage.offsetHeight,
            },
        },
        window.location.origin
    );
}

function scrollToArea(
    container: HTMLElement,
    pageNumber: number,
    rect: { x: number; y: number; width: number; height: number }
) {
    const pages = Array.from(
        container.querySelectorAll<HTMLElement>(".page[data-page-number]")
    );

    const targetPage = pages.find(
        (p) => parseInt(p.getAttribute("data-page-number") ?? "0", 10) === pageNumber
    );

    if (targetPage) {
        const areaTop = targetPage.offsetTop + rect.y * targetPage.offsetHeight;
        const areaCenter = areaTop + (rect.height * targetPage.offsetHeight) / 2;
        container.scrollTo({
            top: areaCenter - container.clientHeight / 2,
            behavior: "smooth",
        });
        flashArea(targetPage, rect);
    } else {
        // Page not rendered yet — scroll to estimated position and record a pending
        // target so the pagerendered handler can perform a precise centre once the
        // page's dimensions are actually known.
        pendingScrollTarget = { pageNumber, rect };
        const numPages = window.PDFViewerApplication?.pdfDocument?.numPages ?? 1;
        const estimatedTop = (container.scrollHeight / numPages) * (pageNumber - 1);
        container.scrollTo({ top: estimatedTop, behavior: "smooth" });
    }
}

function flashArea(
    page: HTMLElement,
    rect: { x: number; y: number; width: number; height: number }
) {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "absolute",
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
        border: "2px solid #4a90d9",
        background: "rgba(74, 144, 217, 0.25)",
        pointerEvents: "none",
        zIndex: "9000",
        borderRadius: "2px",
        boxSizing: "border-box",
    } as CSSStyleDeclaration);

    page.appendChild(overlay);
    setTimeout(() => overlay.remove(), 1500);
}
