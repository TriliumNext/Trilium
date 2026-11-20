import { t } from "./i18n.js";
import toast from "./toast.js";
import utils from "./utils.js";

/** What `copyWhenReady()` copies: the plain text, and the HTML of a rich copy. */
export interface CopiedContent {
    text: string;
    html?: string;
}

export function copyText(text: string) {
    if (!text) {
        return;
    }
    try {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            return true;
        }
        return copyTextByCommand(text);
    } catch (e) {
        console.warn(e);
        return false;
    }
}

/** Copies `text` once the browser accepted the write, and reports the outcome as a toast. */
export async function copyTextWithToast(text: string) {
    if (await writeText(text)) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}

/**
 * Copies `content` once it resolves, and reports the outcome as a toast. The write starts at once,
 * while the user's action still allows it, so the types of the write are set before `content`
 * resolves: `isHtml` tells whether it has `html`. `null` content copies and shows nothing, since
 * its producer reported why there is none.
 */
export async function copyWhenReady(
    content: Promise<CopiedContent | null>, { isHtml }: { isHtml: boolean }
) {
    const hasAsyncApi = !!navigator.clipboard?.write && typeof ClipboardItem !== "undefined";
    if (hasAsyncApi && await writeWhenReady(content, isHtml)) {
        toast.showMessage(t("clipboard.copy_success"));
        return;
    }

    let ready: CopiedContent | null;
    try {
        ready = await content;
    } catch (e) {
        console.error(e);
        toast.showError(t("block_reference.copy_failed"));
        return;
    }
    if (!ready) {
        return;
    }
    if (!hasAsyncApi && copyByCommand(ready)) {
        toast.showMessage(t("clipboard.copy_success"));
        return;
    }
    showCopyReadyToast(ready);
}

/**
 * Copies rich HTML — so it pastes with formatting into a note or another rich editor — with
 * `plainText` as the plain-text alternative. Returns whether the clipboard was written.
 *
 * `navigator.clipboard.write()` is the richer path but browsers expose it only in secure contexts,
 * and Trilium is routinely served over plain HTTP on a LAN, where the API is simply undefined
 * (#10723). The copy event is the fallback there, and also when the write is denied.
 */
export async function copyHtml(html: string, plainText: string = html) {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/html": new Blob([html], { type: "text/html" }),
                    "text/plain": new Blob([plainText], { type: "text/plain" })
                })
            ]);

            return true;
        } catch (e) {
            // A denied permission or an unfocused document still leaves the copy event to try.
            console.warn(e);
        }
    }

    try {
        return utils.copyHtmlToClipboard(html, plainText);
    } catch (e) {
        console.warn(e);
        return false;
    }
}

/**
 * Copies rich HTML as {@link copyHtml} does and reports the outcome as a toast.
 */
export async function copyHtmlWithToast(html: string, plainText: string = html) {
    if (await copyHtml(html, plainText)) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}

/**
 * Copies `href` as an `<a class="reference-link">`, which a text note renders as the title, icon
 * and colour of the note it points at. Reports the outcome as a toast.
 *
 * The plain-text flavour is `href` itself, for a Markdown or code note. `ReferenceLink` upcasts
 * only the `href` and resolves the rest through `link.loadReferenceLinkTitle()`, so the markup
 * written here reaches non-Trilium targets alone. The write starts before the label is loaded.
 */
export function copyReferenceWithToast(href: string) {
    return copyWhenReady(loadReferenceLink(href), { isHtml: true });
}

/** The HTML of an `<a class="reference-link">` to `href` whose text is `text`. */
export function toReferenceLinkHtml(href: string, text: string) {
    const link = document.createElement("a");
    link.className = "reference-link";
    link.setAttribute("href", href);
    link.textContent = text;
    return link.outerHTML;
}

async function loadReferenceLink(href: string): Promise<CopiedContent> {
    const { default: link } = await import("./link.js");
    const $link = $("<a>").addClass("reference-link").attr("href", href);
    await link.loadReferenceLinkTitle($link, href);
    return { html: $link[0].outerHTML, text: href };
}

/**
 * Whether {@link readClipboardText} can work here: always on desktop, and in a browser that has
 * `navigator.clipboard.readText()` (a secure context) unless the `clipboard-read` permission is
 * denied.
 */
export async function canReadClipboardText() {
    if (window.electronApi) return true;
    if (!navigator.clipboard?.readText) return false;

    try {
        // The DOM typings do not list `clipboard-read`, which only Chromium knows.
        const name = "clipboard-read" as unknown as PermissionName;
        const { state } = await navigator.permissions.query({ name });
        return state !== "denied";
    } catch {
        // Firefox and Safari have no `clipboard-read` permission and ask on each read.
        return true;
    }
}

/**
 * Reads the text on the clipboard, through the main process on desktop. Rejects when the read is
 * not allowed.
 */
export async function readClipboardText() {
    if (window.electronApi) {
        return window.electronApi.clipboard.readText();
    }

    return navigator.clipboard.readText();
}

/** Writes `text` through `navigator.clipboard`, else through a text area. Returns success. */
async function writeText(text: string) {
    if (!text) {
        return false;
    }
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.warn(e);
        }
    }
    try {
        return copyTextByCommand(text);
    } catch (e) {
        console.warn(e);
        return false;
    }
}

/**
 * Writes `content` through `navigator.clipboard.write()`, called before `content` resolves.
 * Returns whether the write succeeded. `null` content makes the write fail.
 */
async function writeWhenReady(content: Promise<CopiedContent | null>, isHtml: boolean) {
    const ready = content.then((value) => value ?? Promise.reject(new Error("Nothing to copy.")));
    const toBlob = (type: string, read: (value: CopiedContent) => string) =>
        ready.then((value) => new Blob([ read(value) ], { type }));
    const data: Record<string, Promise<Blob>> = {
        "text/plain": toBlob("text/plain", (value) => value.text)
    };
    if (isHtml) {
        data["text/html"] = toBlob("text/html", (value) => value.html ?? value.text);
    }
    // A write refused before it reads the data leaves their rejections to nothing else.
    for (const promise of [ ready, ...Object.values(data) ]) {
        promise.catch(() => {});
    }

    try {
        await navigator.clipboard.write([ new ClipboardItem(data) ]);
        return true;
    } catch {
        return false;
    }
}

/** Copies `content` through `execCommand("copy")`, which works only during a user action. */
function copyByCommand({ html, text }: CopiedContent) {
    try {
        return html === undefined
            ? copyTextByCommand(text)
            : utils.copyHtmlToClipboard(html, text);
    } catch (e) {
        console.warn(e);
        return false;
    }
}

/** Copies `text` from a hidden text area: https://stackoverflow.com/a/72239825 */
function copyTextByCommand(text: string) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    // An open Bootstrap modal traps focus, so the textarea goes inside it to keep its selection.
    const previouslyFocused = document.activeElement;
    const container = previouslyFocused?.closest(".modal.show") ?? document.body;
    try {
        container.appendChild(textArea);
        textArea.focus();
        textArea.select();
        return document.execCommand("copy");
    } finally {
        textArea.remove();
        if (previouslyFocused instanceof HTMLElement) {
            previouslyFocused.focus();
        }
    }
}

/** A toast whose button copies `content`: the click is a new user action, which a copy needs. */
function showCopyReadyToast(content: CopiedContent) {
    toast.showPersistent({
        id: "clipboard-copy-ready",
        icon: "bx bx-clipboard",
        message: t("clipboard.copy_ready"),
        timeout: 15_000,
        buttons: [ {
            text: t("clipboard.copy_button"),
            onClick: ({ dismissToast }) => {
                const isCopied = copyByCommand(content);
                dismissToast();
                if (isCopied) {
                    toast.showMessage(t("clipboard.copy_success"));
                } else {
                    toast.showError(t("clipboard.copy_failed"));
                }
            }
        } ]
    });
}
