/**
 * Mounts the app's geo map view on the page, if it shows a geo map collection. The view brings the
 * app's context along, which expects jQuery as a global, so `app_globals.ts` loads first.
 */
export default async function setupGeoMap() {
    const container = document.querySelector<HTMLElement>("#content .share-geomap");
    const data = document.querySelector("#content .share-froca");
    if (!container || !data?.textContent) {
        return;
    }

    await import("./app_globals.js");
    const { default: mountGeoMap } = await import("./geomap_view.js");
    mountGeoMap(container, JSON.parse(data.textContent));
}
