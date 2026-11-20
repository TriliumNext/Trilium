import type { Injector } from "@univerjs/core";
import { SheetsHyperLinkResolverService } from "@univerjs/preset-sheets-hyper-link";
import type { FUniver } from "@univerjs/presets";

import { t } from "../../../services/i18n";
import { showError } from "../../../services/toast";

/**
 * Opens `file:` hyperlinks of the workbook in the application that handles the file.
 *
 * Univer navigates a hyperlink through `SheetsHyperLinkResolverService.navigateToOtherWebsite()`,
 * which drops every URL that `isSafeUrl()` does not list (http, https, mailto) before the preset's
 * `urlHandler` runs, so a `file:` link does nothing on desktop. Overriding the method on the
 * resolver instance hands `file:` URLs to the desktop bridge that text-note links use, which
 * rejects UNC paths and confirms executables (`validateOpenFileUrl`). Every other URL goes back
 * to Univer unchanged.
 */
export function installFileLinkHandler(univerAPI: FUniver) {
    const injector = (univerAPI as unknown as { _injector: Injector })._injector;
    let installed = false;

    const patch = () => {
        if (installed || !injector.has(SheetsHyperLinkResolverService)) {
            return;
        }
        installed = true;

        const resolver = injector.get(SheetsHyperLinkResolverService);
        const navigateToOtherWebsite = resolver.navigateToOtherWebsite.bind(resolver);

        resolver.navigateToOtherWebsite = async (url: string) => {
            if (!url.toLowerCase().startsWith("file:")) {
                return navigateToOtherWebsite(url);
            }

            if (!window.electronApi) {
                window.open(url, "_blank", "noopener,noreferrer");
                return;
            }

            try {
                const failure = await window.electronApi.shell.openFileUrl(url);
                if (failure) {
                    showError(t("link.failed_to_open", { href: url, message: failure }));
                }
            } catch (e) {
                showError(t("link.failed_to_open", {
                    href: url,
                    message: e instanceof Error ? e.message : String(e)
                }));
            }
        };
    };

    // The hyperlink service is registered when its plugin starts, which needs a workbook, so
    // install now if it is already there and otherwise when the editor reaches the rendered stage.
    patch();
    const disposable = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
        if (stage === univerAPI.Enum.LifecycleStages.Rendered) {
            patch();
        }
    });
    return () => disposable.dispose();
}
