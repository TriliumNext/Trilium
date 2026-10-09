/**
 * Draws the calendar collection on the page, if there is one, with the app's own calendar. The
 * view and FullCalendar load on demand, as only a calendar page needs them.
 */
export default async function setupCalendar() {
    const container = document.querySelector<HTMLElement>("#content .share-calendar");
    const data = document.querySelector("#content .share-froca");
    if (!container || !data?.textContent) {
        return;
    }

    const { default: mountCalendar } = await import("./calendar_view.js");
    await mountCalendar(container, JSON.parse(data.textContent));
}
