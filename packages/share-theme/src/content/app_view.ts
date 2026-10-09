import type { AppPayload } from "./app_host.js";

/** A module mounting an app view, which `setupAppView()` loads on demand. */
export interface AppViewModule {
    default(container: HTMLElement, payload: AppPayload): void;
}

/**
 * Mounts an app view on the page, if `#content` has its `container`, from the payload core embeds
 * beside it. The view brings the app's context along, which expects jQuery as a global, so
 * `app_globals.ts` loads first. `app_context.ts` then loads before the view's module, as in the
 * app's entry: the modules it reaches depend on that order, such as `tree.ts`, which uses `ws.ts`
 * as it loads.
 */
export default async function setupAppView(container: string, load: () => Promise<AppViewModule>) {
    const element = document.querySelector<HTMLElement>(`#content ${container}`);
    const data = document.querySelector("#content .share-froca");
    if (!element || !data?.textContent) {
        return;
    }

    await import("./app_globals.js");
    await import("@triliumnext/client/src/components/app_context.js");
    const { default: mount } = await load();
    mount(element, JSON.parse(data.textContent));
}
