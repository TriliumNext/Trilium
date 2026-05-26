import { t } from "../services/i18n.js";
import utils from "../services/utils.js";
import contextMenu from "./context_menu.js";
import imageService from "../services/image.js";

const PROP_NAME = "imageContextMenuInstalled";

function setupContextMenu($image: JQuery<HTMLElement>) {
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
                    imageService.copyImageReferenceToClipboard($image);
                } else if (command === "copyImageToClipboard") {
                    try {
                        const src = $image.attr("src");
                        if (!src) {
                            console.error("Missing src");
                            return;
                        }

                        const response = await fetch(src);
                        const buffer = new Uint8Array(await response.arrayBuffer());
                        window.electronApi?.clipboard.copyImageToClipboard(buffer);
                    } catch (error) {
                        console.error("Failed to copy image to clipboard:", error);
                    }
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
