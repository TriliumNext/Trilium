import { t } from "../services/i18n.js";
import imageService from "../services/image.js";
import utils from "../services/utils.js";
import contextMenu from "./context_menu.js";

const PROP_NAME = "imageContextMenuInstalled";

interface ImageContextMenuHandlers {
    /**
     * Resolves the image URL for "copy image". Required when the menu is attached to a container
     * rather than the `<img>` itself (a container has no `src` of its own — reading it there was
     * how "copy image" used to silently fail from the image viewer).
     */
    getSrc?: () => string | undefined;
    /** Overrides "copy reference"; defaults to copying the target element's contents. */
    copyReference?: () => void;
}

function setupContextMenu($image: JQuery<HTMLElement>, handlers: ImageContextMenuHandlers = {}) {
    if (!utils.isElectron() || $image.prop(PROP_NAME)) {
        return;
    }

    $image.prop(PROP_NAME, true);
    $image.on("contextmenu", (e) => {
        e.preventDefault();

        contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items: [
                {
                    title: t("image_context_menu.copy_reference_to_clipboard"),
                    command: "copyImageReferenceToClipboard",
                    uiIcon: "bx bx-directions"
                },
                {
                    title: t("image_context_menu.copy_image_to_clipboard"),
                    command: "copyImageToClipboard",
                    uiIcon: "bx bx-copy"
                }
            ],
            selectMenuItemHandler: async ({ command }) => {
                if (command === "copyImageReferenceToClipboard") {
                    if (handlers.copyReference) handlers.copyReference();
                    else imageService.copyImageReferenceToClipboard($image);
                } else if (command === "copyImageToClipboard") {
                    const src = handlers.getSrc?.() ?? $image.attr("src");
                    if (!src) {
                        console.error("Missing src");
                        return;
                    }

                    await imageService.copyImageToClipboard(src);
                } else {
                    throw new Error(`Unrecognized command '${command}'`);
                }
            }
        });
    });
}

export default {
    setupContextMenu
};
