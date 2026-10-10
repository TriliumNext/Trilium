import type { LOCALE_IDS } from "@triliumnext/commons";

import type { AppPayload } from "./app_host.js";

/** A module mounting an app view, which `setupAppView()` loads on demand. */
export interface AppViewModule {
    default(container: HTMLElement, payload: AppPayload): void;
}

/**
 * Mounts an app view on the page, if `#content` has its `container`, then shows the container,
 * which `app_view.css` hides until then on a page that runs scripts. It shows it as well when the
 * view cannot mount, so the content core rendered stays readable.
 */
export default async function setupAppView(container: string, load: () => Promise<AppViewModule>) {
    try {
        await mountAppView(container, load);
    } finally {
        document.documentElement.classList.add("app-view-shown");
    }
}

/**
 * Mounts the app view from the payload core embeds beside `container`. The view brings the app's
 * context along, which expects jQuery as a global, so `app_globals.ts` loads first.
 * `app_context.ts` then loads before the view's module, as in the app's entry: the modules it
 * reaches depend on that order, such as `tree.ts`, which uses `ws.ts` as it loads.
 */
async function mountAppView(container: string, load: () => Promise<AppViewModule>) {
    const element = document.querySelector<HTMLElement>(`#content ${container}`);
    const data = document.querySelector("#content .share-froca");
    if (!element || !data?.textContent) {
        return;
    }

    const payload = JSON.parse(data.textContent) as AppPayload;
    // The views behave as on desktop, `isMobile()` being false on a shared page, and the app's
    // stylesheets draw them so from this class.
    document.body.classList.add("desktop");
    await import("./app_globals.js");
    await import("@triliumnext/client/src/components/app_context.js");

    // The views' texts come from the app's catalogue, which `initLocale()` reads from the assets.
    if (window.glob) {
        window.glob.assetPath = payload.assetPath;
    }
    const { initLocale } = await import("@triliumnext/client/src/services/i18n.js");
    await initLocale((payload.options.locale as LOCALE_IDS | null) ?? "en");

    const { default: mount } = await load();
    mount(element, payload);
}
