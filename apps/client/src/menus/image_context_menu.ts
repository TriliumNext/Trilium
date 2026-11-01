import { t } from "../services/i18n.js";
import utils from "../services/utils.js";
import contextMenu from "./context_menu.js";
import imageService from "../services/image.js";

const PROP_NAME = "imageContextMenuInstalled";

/** Adds the Electron image menu to `$image`: an `<img>`, or the container of an image viewer. */
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
                // An image viewer passes its container: its <img> takes no pointer events.
                const isContainer = !$image.is("img");
                const $img = isContainer ? $image.find("img").first() : $image;
                if (command === "copyImageReferenceToClipboard") {
                    imageService.copyImageReferenceToClipboard(isContainer ? $img.parent() : $img);
                } else if (command === "copyImageToClipboard") {
                    const src = $img.attr("src");
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
