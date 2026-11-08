import link from "../../../services/link";

/** Fills the reference links in `container`, which shows content of `hostNoteId` if given. */
export async function applyReferenceLinks(
    container: HTMLDivElement | HTMLElement,
    hostNoteId?: string
) {
    const referenceLinks = container.querySelectorAll<HTMLDivElement>("a.reference-link");
    for (const referenceLink of referenceLinks) {
        await link.loadReferenceLinkTitle($(referenceLink), null, hostNoteId,
            referenceLink.textContent ?? undefined);

        // Wrap in a <span> to match the design while in CKEditor.
        const spanEl = document.createElement("span");
        spanEl.replaceChildren(...referenceLink.childNodes);
        referenceLink.replaceChildren(spanEl);
    }
}
