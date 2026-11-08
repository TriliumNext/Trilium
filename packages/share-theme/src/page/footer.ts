import "./footer.css";

/**
 * Writes the dates of the footer out again in the visitor's time zone, so that the day matches
 * theirs. The page's language and the long style keep the server's wording.
 */
export default function setupFooter() {
    const format = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
        dateStyle: "long"
    });
    for (const time of document.querySelectorAll<HTMLTimeElement>("#content-footer time[datetime]")) {
        const date = new Date(time.dateTime);
        if (!Number.isNaN(date.getTime())) {
            time.textContent = format.format(date);
        }
    }
}
