import { ALLOWED_PROTOCOLS, parseMindMapNoteLink } from "@triliumnext/commons";

import type { Suggestion } from "../../../services/note_autocomplete";
import { normalizeExternalUrl } from "../../../utils/url";

/**
 * The link a node carries is Mind Elixir's own `NodeObj.hyperLink`: one string per node, which its
 * topic renderer puts straight into an anchor.
 *
 * A link to a note is therefore written the way a note link is written everywhere else in Trilium,
 * as the in-app address `#root/…`. The delegated handler in `link.ts` picks a click up off any
 * anchor on the page, so a note opens with nothing else to wire up. Anything else is an address
 * outside Trilium. What makes an address one or the other is `parseMindMapNoteLink`'s to say, which
 * lives with the rest of the note logic both ends share: the map is written here and read by the
 * scan that relates it to the notes it points at.
 */

/** The link to store for what was picked in the note autocomplete, or `null` if nothing was. */
export function linkFromSuggestion(suggestion: Suggestion | null | undefined): string | null {
    if (suggestion?.notePath) {
        return `#${suggestion.notePath}`;
    }

    // The autocomplete hands over what was typed; an address is only stored once it is one we could
    // follow, and a bare host gets the scheme an address bar would give it.
    return (suggestion?.externalLink ? normalizeExternalUrl(suggestion.externalLink) : null);
}

/**
 * What a link a node already carries reads as to the picker it is changed in — the inverse of the
 * above, for opening that picker on what is already there.
 */
export function suggestionFromLink(link: string | null | undefined): Suggestion | undefined {
    if (!link) {
        return undefined;
    }

    const notePath = parseMindMapNoteLink(link)?.notePath;
    return (notePath ? { notePath } : { externalLink: link });
}

/** The address a link may be followed to, or `null` where it may not be followed at all. */
export function getNodeLinkHref(link: string | null | undefined): string | null {
    if (!link) {
        return null;
    }

    if (parseMindMapNoteLink(link)) {
        return link;
    }

    const url = normalizeExternalUrl(link);
    if (url) {
        return url;
    }

    // A scheme Trilium knows how to open is kept as it stands, so a map made elsewhere keeps its
    // `mailto:` and `file:` links. `data:` is left out: `goToLinkExt` refuses it anyway, and it
    // would still be live in an exported map opened outside Trilium.
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link)?.[1].toLowerCase();
    return (scheme && scheme !== "data" && ALLOWED_PROTOCOLS.includes(scheme)) ? link : null;
}

/** What an external link reads as where there is only room for a few words: the host it points at. */
export function describeExternalLink(link: string): string {
    const url = normalizeExternalUrl(link);
    return (url ? new URL(url).host || link : link);
}

/**
 * Dresses the anchors Mind Elixir builds for the links a map's nodes carry.
 *
 * It puts the stored value into `href` as it stands and opens every link in a tab of its own, which
 * for a note means leaving the map behind for no reason; and a map that arrived by import or sync
 * can carry an address that should not be followed at all. Since the anchor is built anew from the
 * node's own data, this is applied again after every layout.
 *
 * @param container the element holding the rendered nodes.
 */
export function renderNodeLinks(container: HTMLElement) {
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>("a.hyper-link")) {
        const link = anchor.getAttribute("href") ?? "";
        const href = getNodeLinkHref(link);

        // An address we may not follow is rendered inert rather than dropped, so that the node goes
        // on saying it carries a link — as the share view does with a hostile scheme.
        anchor.setAttribute("href", href ?? "about:blank");
        anchor.rel = "noopener noreferrer";

        if (parseMindMapNoteLink(link)) {
            // A note opens where the map is, as it does from anywhere else; `_blank` would force a
            // tab of its own (see `goToLinkExt`), leaving the map for a click that meant to follow
            // a thought.
            anchor.removeAttribute("target");
            anchor.removeAttribute("title");
        } else {
            anchor.title = href ?? link;
        }
    }
}
