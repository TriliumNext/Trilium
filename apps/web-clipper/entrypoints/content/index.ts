import { type FloatingElementsStep, setFloatingElements } from "@/floating_elements.js";
import {
    createLink, descriptionLabels, getImages, getPageDescription, getPageLocationOrigin,
    makeLinksAbsolute, type Rect
} from "@/utils.js";

export default defineContentScript({
    matches: [
        "<all_urls>"
    ],
    main: () => {
        function pageTitle() {
            const titleElements = document.getElementsByTagName("title");

            return titleElements[0]?.text.trim() ?? document.title.trim();
        }

        function getRectangleArea() {
            return new Promise<Rect | null>((resolve) => {
                const overlay = document.createElement('div');
                overlay.style.opacity = '0.6';
                overlay.style.background = 'black';
                overlay.style.width = '100%';
                overlay.style.height = '100%';
                overlay.style.zIndex = "99999999";
                overlay.style.top = "0";
                overlay.style.left = "0";
                overlay.style.position = 'fixed';

                document.body.appendChild(overlay);

                const messageComp = document.createElement('div');

                const messageCompWidth = 300;
                messageComp.setAttribute("tabindex", "0"); // so that it can be focused
                messageComp.style.position = 'fixed';
                messageComp.style.opacity = '0.95';
                messageComp.style.fontSize = '14px';
                messageComp.style.width = `${messageCompWidth}px`;
                messageComp.style.maxWidth = `${messageCompWidth}px`;
                messageComp.style.border = '1px solid black';
                messageComp.style.background = 'white';
                messageComp.style.color = 'black';
                messageComp.style.top = '10px';
                messageComp.style.textAlign = 'center';
                messageComp.style.padding = '10px';
                messageComp.style.left = `${Math.round(document.body.clientWidth / 2 - messageCompWidth / 2)  }px`;
                messageComp.style.zIndex = overlay.style.zIndex + 1;

                messageComp.textContent = 'Drag and release to capture a screenshot';

                document.body.appendChild(messageComp);

                const selection = document.createElement('div');
                selection.style.opacity = '0.5';
                selection.style.border = '1px solid red';
                selection.style.background = 'white';
                selection.style.border = '2px solid black';
                selection.style.zIndex = String(parseInt(overlay.style.zIndex, 10) - 1);
                selection.style.top = "0";
                selection.style.left = "0";
                selection.style.position = 'fixed';

                document.body.appendChild(selection);

                messageComp.focus(); // we listen on keypresses on this element to cancel on escape

                let isDragging = false;
                let draggingStartPos: {x: number, y: number} | null = null;
                let selectionArea: Rect;

                function updateSelection() {
                    selection.style.left = `${selectionArea.x}px`;
                    selection.style.top = `${selectionArea.y}px`;
                    selection.style.width = `${selectionArea.width}px`;
                    selection.style.height = `${selectionArea.height}px`;
                }

                function setSelectionSizeFromMouse(event: MouseEvent) {
                    if (!draggingStartPos) return;

                    selectionArea.x = Math.min(event.clientX, draggingStartPos.x);
                    selectionArea.y = Math.min(event.clientY, draggingStartPos.y);
                    selectionArea.width = Math.max(1, Math.abs(event.clientX - draggingStartPos.x));
                    selectionArea.height = Math.max(1, Math.abs(event.clientY - draggingStartPos.y));
                    updateSelection();
                }

                function selection_mouseDown(event: MouseEvent) {
                    selectionArea = {x: event.clientX, y: event.clientY, width: 0, height: 0};
                    draggingStartPos = {x: event.clientX, y: event.clientY};
                    isDragging = true;
                    updateSelection();
                }

                function selection_mouseMove(event: MouseEvent) {
                    if (!isDragging) return;
                    setSelectionSizeFromMouse(event);
                }

                function removeOverlay() {
                    isDragging = false;

                    overlay.removeEventListener('mousedown', selection_mouseDown);
                    overlay.removeEventListener('mousemove', selection_mouseMove);
                    overlay.removeEventListener('mouseup', selection_mouseUp);

                    document.body.removeChild(overlay);
                    document.body.removeChild(selection);
                    document.body.removeChild(messageComp);
                }

                function selection_mouseUp(event: MouseEvent) {
                    setSelectionSizeFromMouse(event);

                    removeOverlay();

                    console.info('selectionArea:', selectionArea);

                    if (!selectionArea || !selectionArea.width || !selectionArea.height) {
                        resolve(null);
                        return;
                    }

                    // Need to wait a bit before taking the screenshot to make sure
                    // the overlays have been removed and don't appear in the
                    // screenshot. 10ms is not enough.
                    setTimeout(() => resolve(selectionArea), 100);
                }

                function cancel(event: KeyboardEvent) {
                    if (event.key === "Escape") {
                        removeOverlay();
                        resolve(null);
                    }
                }

                overlay.addEventListener('mousedown', selection_mouseDown);
                overlay.addEventListener('mousemove', selection_mouseMove);
                overlay.addEventListener('mouseup', selection_mouseUp);
                messageComp.addEventListener('keydown', cancel);
            });
        }

        async function prepareMessageResponse(message: {
            name: string, noteId?: string, message?: string, tabIds?: string[], x?: number, y?: number,
            step?: FloatingElementsStep
        }) {
            console.info(`Message: ${  message.name}`);

            if (message.name === "toast") {
                let messageText;

                if (message.noteId) {
                    messageText = document.createElement('p');
                    messageText.setAttribute("style", "padding: 0; margin: 0; font-size: larger;");
                    messageText.appendChild(document.createTextNode(`${message.message  } `));
                    messageText.appendChild(createLink(
                        {name: 'openNoteInTrilium', noteId: message.noteId},
                        "Open in Trilium."
                    ));

                    // only after saving tabs
                    if (message.tabIds) {
                        messageText.appendChild(document.createElement("br"));
                        messageText.appendChild(createLink(
                            {name: 'closeTabs', tabIds: message.tabIds},
                            "Close saved tabs.",
                            "tomato"
                        ));
                    }
                }
                else {
                    messageText = message.message;
                }

                await import("@/lib/toast");

                window.showToast(messageText, {
                    settings: {
                        duration: 7000
                    }
                });
            }
            else if (message.name === "trilium-save-selection") {
                const container = document.createElement('div');

                const selection = window.getSelection();
                // The popup asks on every opening, and Firefox reports no range after the page
                // loses focus, so an empty selection is an answer, not an error.
                if (!selection || selection.rangeCount === 0) {
                    return undefined;
                }

                for (let i = 0; i < selection.rangeCount; i++) {
                    const range = selection.getRangeAt(i);

                    container.appendChild(range.cloneContents());
                }

                makeLinksAbsolute(container);

                const images = getImages(container);

                return {
                    title: pageTitle(),
                    content: container.innerHTML,
                    images,
                    pageUrl: getPageLocationOrigin() + location.pathname + location.search
                        + location.hash,
                    labels: descriptionLabels()
                };

            }
            else if (message.name === 'trilium-get-rectangle-for-screenshot') {
                return {
                    rect: await getRectangleArea(),
                    devicePixelRatio: window.devicePixelRatio
                };
            }
            else if (message.name === "trilium-scroll-to") {
                if (message.y !== undefined) {
                    window.scrollTo({ left: message.x, top: message.y, behavior: "instant" });
                }
                return {
                    scrollX: window.scrollX,
                    scrollY: window.scrollY,
                    viewportHeight: window.innerHeight,
                    viewportWidth: window.innerWidth,
                    pageHeight: document.documentElement.scrollHeight,
                    devicePixelRatio: window.devicePixelRatio
                };
            }
            else if (message.name === "trilium-set-floating-elements" && message.step) {
                setFloatingElements(message.step);
                return true;
            }
            else if (message.name === "trilium-get-page-metadata") {
                return { description: getPageDescription() };
            }
            else {
                throw new Error(`Unknown command: ${  JSON.stringify(message)}`);
            }
        }

        browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            (async () => {
                try {
                    const response = await prepareMessageResponse(message);
                    sendResponse(response);
                } catch (err) {
                    console.error(err);
                    sendResponse(undefined);
                }
            })();

            // Critical for async responses in Chrome MV2
            return true;
        });

    }
});
