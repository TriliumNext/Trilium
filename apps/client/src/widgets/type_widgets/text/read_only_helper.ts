import link from "../../../services/link";

export async function applyReferenceLinks(container: HTMLDivElement | HTMLElement) {
    const referenceLinks = container.querySelectorAll<HTMLDivElement>("a.reference-link");
    for (const referenceLink of referenceLinks) {
        await link.loadReferenceLinkTitle($(referenceLink));

        // Wrap in a <span> to match the design while in CKEditor.
        const spanEl = document.createElement("span");
        spanEl.replaceChildren(...referenceLink.childNodes);
        referenceLink.replaceChildren(spanEl);
    }
}
