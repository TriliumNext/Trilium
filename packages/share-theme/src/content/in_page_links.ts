import { resolveBlockReference } from "@triliumnext/commons/src/lib/block_reference.js";

/**
 * Makes a link to blocks of the page, or to an element of it by `id` such as an anchor, scroll to
 * its target and flash it, as the app does. The address changes as for a link within the page.
 */
export default function setupInPageLinks() {
    document.getElementById("content")?.addEventListener("click", (event) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
        if (!link || event.defaultPrevented || event.button !== 0
            || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }

        const show = getInPageTarget(link);
        if (show) {
            event.preventDefault();
            if (link.href !== location.href) {
                history.pushState(null, "", link.href);
            }
            void loadBlockJump().then(show);
        }
    });
}

/** Loads the module, shared with the app, that scrolls to blocks and anchors and flashes them. */
function loadBlockJump() {
    return import("@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js");
}

type BlockJump = Awaited<ReturnType<typeof loadBlockJump>>;

/** What shows the target of `link` when it is on this page, or `null`. */
function getInPageTarget(link: HTMLAnchorElement): ((jump: BlockJump) => unknown) | null {
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) {
        return null;
    }

    // Checked first: a fragment link keeps the parameters of the page, `block` included.
    if (url.hash) {
        const name = decodeFragment(url.hash);
        return document.getElementById(name) ? (jump) => jump.showAnchor(document.body, name) : null;
    }

    const block = url.searchParams.get("block");
    if (!block) {
        return null;
    }

    // A broken range loads the page, which shows the block found.
    const { start, end } = resolveBlockReference(document.body, block);
    return start && end ? (jump) => jump.showBlockReference(document.body, block) : null;
}

/** The `id` that the fragment `hash` names, decoded as the browser does. */
function decodeFragment(hash: string) {
    try {
        return decodeURIComponent(hash.slice(1));
    } catch {
        return hash.slice(1);
    }
}
