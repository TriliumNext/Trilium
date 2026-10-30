import "./footer.css";

/**
 * Writes the dates of the note header and the footer out again in the visitor's time zone, so
 * that the day matches theirs. The page's language and each one's style keep the server's wording.
 */
export default function setupFooter() {
    formatDates("#note-header time[datetime]", "medium");
    formatDates("#content-footer time[datetime]", "long");
}

function formatDates(selector: string, dateStyle: "long" | "medium") {
    const format = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle });
    for (const time of document.querySelectorAll<HTMLTimeElement>(selector)) {
        const date = new Date(time.dateTime);
        if (!Number.isNaN(date.getTime())) {
            time.textContent = format.format(date);
        }
    }
}
