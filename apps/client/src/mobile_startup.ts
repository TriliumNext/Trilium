import { startAppAroundLayout } from "./components/app_startup.js";
import { setupClipboardImageEmbed } from "./services/clipboard_image_embed.js";
import glob from "./services/glob.js";
import { t } from "./services/i18n.js";
import { setupLinkHandlers } from "./services/link.js";
import toastService from "./services/toast.js";
import { preloadCommonNoteTypes } from "./widgets/note_types.js";

/**
 * The part of the mobile startup that `mobile.ts` runs after the first render of the layout: the
 * components that execute commands, the tabs, and the handlers of links and pasted images.
 */
export async function startMobile(root: HTMLElement) {
    glob.setupGlobs();
    const started = startAppAroundLayout(root);

    setupClipboardImageEmbed();
    setupLinkHandlers();

    try {
        await started;
    } catch (e) {
        toastService.showPersistent({
            id: "critical-error",
            title: t("toast.critical-error.title"),
            icon: "alert",
            message: t("toast.critical-error.message", { message: e instanceof Error ? e.message : String(e) })
        });
        console.error("Critical error occured", e);
        return;
    }

    preloadCommonNoteTypes();
}
