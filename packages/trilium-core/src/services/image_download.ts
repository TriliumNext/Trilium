/**
 * Fetching the pictures a note's content names at a third party, and keeping them as its own.
 *
 * Note content arrives from places that reference pictures by URL rather than carrying them: a page
 * pasted from a browser, a clipping, an export from another app. Left alone those references keep
 * the note dependent on someone else's server — every reader fetches from it, and the picture
 * disappears the day the URL rots. So the bytes are fetched once, stored as attachments of the note,
 * and the references rewritten to point at them.
 *
 * Governed throughout by `downloadImagesAutomatically`: fetching is the note reaching out to a third
 * party on the reader's behalf, which is the user's decision rather than ours.
 *
 * A picture carried *inline*, as a base64 `data:` URI, is moved out here for the same reasons minus
 * the fetch: base64 costs a third more than the bytes it encodes, is copied into every revision of
 * the note, and repeats in full for each place the same picture appears.
 *
 * Two shapes of reference are handled, and {@link storePictureBytes} is the step they share — give
 * it bytes and it answers with the attachment URL that references them.
 */

import { type ImageAttachmentRole, imageExtensionForMime, isHttpUrl, linkPreviewImageName, safeHostname } from "@triliumnext/commons";
import url from "url";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import * as cls from "./context.js";
import imageService from "./image.js";
import { inspectImage, UNKNOWN_FORMAT } from "./image_inspect.js";
import { getLog } from "./log.js";
import noteService from "./notes.js";
import optionService from "./options.js";
import request from "./request.js";
import { getSql } from "./sql/index.js";
import { decodeBase64 } from "./utils/binary.js";
import { quoteRegex, unescapeHtml } from "./utils/index.js";
import { basename } from "./utils/path.js";

/**
 * Keeps a picture's bytes as an attachment of `noteId`, answering with the URL that references it —
 * or nothing when the bytes are not a picture at all.
 *
 * The bytes are asked what they are rather than the address, the server or the `data:` prefix being
 * taken for it, so a 404 page served where a picture should be is refused rather than stored.
 */
function storePictureBytes(
    noteId: string,
    bytes: Uint8Array,
    { role, title, shrink }: { role: ImageAttachmentRole; title: string; shrink: boolean }
): string | undefined {
    const { format, mime } = inspectImage(bytes);

    if (format === UNKNOWN_FORMAT) {
        return undefined;
    }

    const attachment = imageService.saveImageToAttachment(
        noteId,
        bytes,
        `${title}.${imageExtensionForMime(mime)}`,
        shrink,
        // The title is the key a deduplicated role is reused by, so it is never shortened.
        false,
        role
    );

    return attachment.attachmentId
        ? `api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}`
        : undefined;
}

/**
 * Fetches one picture and keeps it as an attachment of `noteId`, answering with the URL that
 * references it — or nothing when it could not be had, or is not a picture at all.
 *
 * The step both passes below share, and the one worth reaching for from anywhere else that finds a
 * picture named by an address: an importer, a clipper, a repair that fills in what a preview is
 * missing. The bytes are asked what they are rather than the address or its server being taken for
 * it, so a 404 page served where a picture should be is refused rather than stored.
 *
 * `title` is what the attachment is called, and for a role that deduplicates it is also the key a
 * second use of the same picture reuses it by — so it should say which thing this is rather than
 * describe it.
 */
export async function downloadPictureToAttachment(
    noteId: string,
    pictureUrl: string,
    { role, title, shrink = false }: { role: ImageAttachmentRole; title: string; shrink?: boolean }
): Promise<string | undefined> {
    if (!isHttpUrl(pictureUrl)) {
        return undefined;
    }

    try {
        const bytes = new Uint8Array(await request.getImage(pictureUrl));

        return storePictureBytes(noteId, bytes, { role, title, shrink });
    } catch (e: unknown) {
        // The address is deliberately left out of the line: it is a page the user was reading, and
        // the note it came from is enough to find this again.
        getLog().info(`Could not download a picture for note '${noteId}': ${e}`);
        return undefined;
    }
}

const imageUrlToAttachmentIdMapping: Record<string, string> = {};

async function downloadImage(noteId: string, imageUrl: string) {
    const unescapedUrl = unescapeHtml(imageUrl);

    // SSRF protection: only allow http(s) URLs and block file:// and other schemes.
    try {
        const parsed = new URL(unescapedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            getLog().error(`Download of '${imageUrl}' for note '${noteId}' rejected: only http/https URLs are allowed.`);
            return;
        }
    } catch {
        getLog().error(`Download of '${imageUrl}' for note '${noteId}' rejected: invalid URL.`);
        return;
    }

    try {
        const imageBuffer = new Uint8Array(await request.getImage(unescapedUrl));

        const parsedUrl = url.parse(unescapedUrl);
        const title = basename(parsedUrl.pathname || "");

        const attachment = imageService.saveImageToAttachment(noteId, imageBuffer, title, true, true);

        if (attachment.attachmentId) {
            imageUrlToAttachmentIdMapping[imageUrl] = attachment.attachmentId;
        } else {
            getLog().error(`Download of '${imageUrl}' for note '${noteId}' failed due to no attachment ID.`);
        }

        getLog().info(`Download of '${imageUrl}' succeeded and was saved as image attachment '${attachment.attachmentId}' of note '${noteId}'`);
    } catch (e: any) {
        getLog().error(`Download of '${imageUrl}' for note '${noteId}' failed with error: ${e.message} ${e.stack}`);
    }
}

/** url => download promise */
const downloadImagePromises: Record<string, Promise<void>> = {};

/**
 * How far into an `<img>` tag to look for its `src`.
 *
 * Bounded because the content is whatever was pasted or imported, and an unbounded look costs a
 * scan from every `<img` in it — text that is nothing but `<img<img<img…` takes time in the square
 * of its length. What the bound gives up is a picture whose tag carries several KB of other
 * attributes before its `src`, which is not a tag anything writes: the bytes that make a tag long
 * are the picture's own, and those are in the `src` this is looking for.
 */
const MAX_ATTRIBUTES_BEFORE_SRC = 4096;

function replaceUrl(content: string, url: string, attachment: { attachmentId?: string; title: string }) {
    const quotedUrl = quoteRegex(url);

    return content.replace(new RegExp(`\\s+src=[\"']${quotedUrl}[\"']`, "ig"), ` src="api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}"`);
}

export function downloadImages(noteId: string, content: string) {
    const imageRe = new RegExp(`<img[^>]{0,${MAX_ATTRIBUTES_BEFORE_SRC}}?\\ssrc=['"]([^'">]+)['"]`, "gi");
    let imageMatch;

    while ((imageMatch = imageRe.exec(content))) {
        const url = imageMatch[1];
        const inlineImageMatch = /^data:image\/[a-z]+;base64,/.exec(url);

        if (inlineImageMatch) {
            const imageBase64 = url.substring(inlineImageMatch[0].length);
            const imageBuffer = decodeBase64(imageBase64);

            const attachment = imageService.saveImageToAttachment(noteId, imageBuffer, "inline image", true, true);

            const encodedTitle = encodeURIComponent(attachment.title);

            content = `${content.substring(0, imageMatch.index)}<img src="api/attachments/${attachment.attachmentId}/image/${encodedTitle}"${content.substring(imageMatch.index + imageMatch[0].length)}`;
        } else if (
            !url.includes("api/images/") &&
            // The id between the two is one path segment, so it is matched as one. Written `.+` it
            // could stand for any part of any URL, which costs a scan back from every `/image` for
            // an address that turns out not to be an attachment's.
            !/api\/attachments\/[^/]+\/image/.test(url) &&
            // this is an exception for the web clipper's "imageId"
            (url.length !== 20 || url.toLowerCase().startsWith("http"))
        ) {
            if (!optionService.getOptionBool("downloadImagesAutomatically")) {
                continue;
            }

            if (url in imageUrlToAttachmentIdMapping) {
                const attachment = becca.getAttachment(imageUrlToAttachmentIdMapping[url]);

                if (!attachment) {
                    delete imageUrlToAttachmentIdMapping[url];
                } else {
                    content = replaceUrl(content, url, attachment);
                    continue;
                }
            }

            if (url in downloadImagePromises) {
                // download is already in progress
                continue;
            }

            // this is done asynchronously, it would be too slow to wait for the download
            // given that save can be triggered very often
            downloadImagePromises[url] = downloadImage(noteId, url);
        }
    }

    Promise.all(Object.values(downloadImagePromises)).then(() => {
        setTimeout(() => {
            // the normal expected flow of the offline image saving is that users will paste the image(s)
            // which will get asynchronously downloaded, during that time they keep editing the note
            // once the download is finished, the image note representing the downloaded image will be used
            // to replace the IMG link.
            // However, there's another flow where the user pastes the image and leaves the note before the images
            // are downloaded and the IMG references are not updated. For this occasion we have this code
            // which upon the download of all the images will update the note if the links have not been fixed before

            cls.getContext().init(() => {
                getSql().transactional(() => {
                const imageNotes = becca.getNotes(Object.values(imageUrlToAttachmentIdMapping), true);
                    const log = getLog();

                const origNote = becca.getNote(noteId);

                if (!origNote) {
                    log.error(`Cannot find note '${noteId}' to replace image link.`);
                    return;
                }

                const origContent = origNote.getContent();
                let updatedContent = origContent;

                if (typeof updatedContent !== "string") {
                    log.error(`Note '${noteId}' has a non-string content, cannot replace image link.`);
                    return;
                }

                for (const url in imageUrlToAttachmentIdMapping) {
                    const imageNote = imageNotes.find((note) => note.noteId === imageUrlToAttachmentIdMapping[url]);

                    if (imageNote) {
                        updatedContent = replaceUrl(updatedContent, url, imageNote);
                    }
                }

                // update only if the links have not been already fixed.
                if (updatedContent !== origContent) {
                    origNote.setContent(updatedContent);

                    void noteService.asyncPostProcessContent(origNote, updatedContent);

                    console.log(`Fixed the image links for note '${noteId}' to the offline saved.`);
                }
                });
            });
        }, 5000);
    });

    return content;
}

/** Which of a link preview's picture attributes holds what, and under which role it is stored. */
const PREVIEW_PICTURE_ROLES = [
    [ "data-favicon", "favicon" ],
    [ "data-image", "coverImage" ]
] as const;

/** The opening tag of a link preview, block or inline. Its attributes are read and rewritten in place. */
const PREVIEW_TAG_REGEX = /<(?:section|span)\b[^>]*\bclass="[^"]*link-(?:embed|mention)[^"]*"[^>]*>/gi;

/**
 * Makes a link preview's two pictures attachments of the note, wherever they currently are.
 *
 * A preview made here already has both stored server-side, so this is entirely about content that
 * arrived from elsewhere, and such content carries its pictures one of two ways:
 *
 * - **named at a third party**, which is what a Notion export ships — the origin's addresses and no
 *   bytes at all. Fetching them is the note reaching out on the reader's behalf, so it is governed
 *   by `downloadImagesAutomatically`, the same setting that decides whether a remote `<img>` in note
 *   content is fetched. They belong to that question and were only ever outside it by accident: they
 *   arrive in an export as ordinary `<img>` elements and become attributes when the importer
 *   rewrites the card, which took them out of the pass that would have handled them.
 * - **carried inline**, as a base64 `data:` URI. Our own single-file export writes them that way (it
 *   has nowhere else to put them), as did every preview made before the pictures became attachments.
 *   Nothing is fetched to unpack one, so the setting above has no say — the bytes are already here,
 *   and the only question is whether they sit in the content or beside it.
 *
 * Both are worth undoing, for the same reason the pictures became attachments in the first place. An
 * inline picture is base64 in the note's content, a third again larger than the bytes it encodes,
 * duplicated into every revision of the note and reread on every load. A site linked a dozen times
 * inlines its icon a dozen times; stored under a deduplicating role, those dozen become one.
 */
export async function storeLinkPreviewPictures(note: BNote) {
    if (note.type !== "text") {
        return;
    }

    const content = note.getContent();

    // Cheap guard: parse nothing for the overwhelming majority of notes, which hold no preview.
    if (typeof content !== "string" || !content.includes("link-embed") && !content.includes("link-mention")) {
        return;
    }

    const tags = [ ...content.matchAll(PREVIEW_TAG_REGEX) ];
    let rewritten = "";
    let cursor = 0;

    for (const tag of tags) {
        rewritten += content.slice(cursor, tag.index) + await storePicturesOf(note.noteId, tag[0]);
        cursor = tag.index + tag[0].length;
    }

    rewritten += content.slice(cursor);

    if (rewritten !== content) {
        getSql().transactional(() => note.setContent(rewritten));
    }
}

/** One preview's opening tag, with each picture it holds or names stored and pointed at. */
async function storePicturesOf(noteId: string, tag: string): Promise<string> {
    const cardUrl = unescapeHtml(attributeOf(tag, "data-url") ?? "");
    let rewritten = tag;

    for (const [ attribute, role ] of PREVIEW_PICTURE_ROLES) {
        const stored = attributeOf(tag, attribute);

        if (!stored) {
            continue;
        }

        const value = unescapeHtml(stored);
        // Named and roled exactly as a preview fetched here would be, so an imported card ends up
        // indistinguishable from a made one — and a site named by several cards keeps one icon
        // between them, the title being what a deduplicated role reuses an attachment by.
        const title = role === "favicon" ? safeHostname(cardUrl) : linkPreviewImageName(cardUrl);
        let reference: string | undefined;

        if (isHttpUrl(value)) {
            if (!optionService.getOptionBool("downloadImagesAutomatically")) {
                continue;
            }

            reference = await downloadPictureToAttachment(noteId, value, {
                role,
                title,
                // An icon is a few KB of flat colour with nothing for the compression pipeline to
                // find; a cover may be a full-size social image.
                shrink: role === "coverImage"
            });
        } else {
            // Anything that is neither inline nor remote — an attachment of this note already — is
            // left alone by `storeInlinePicture` answering with nothing.
            reference = storeInlinePicture(noteId, value, { role, title });
        }

        if (reference) {
            rewritten = rewritten.replace(`${attribute}="${stored}"`, `${attribute}="${reference}"`);
        }
    }

    return rewritten;
}

/**
 * Lifts a picture carried inline in the content out into an attachment, answering with the URL that
 * replaces it — or nothing when the value is not an inline picture to begin with.
 *
 * Only base64 is read. A `data:` URI may also carry its payload percent-encoded, but nothing that
 * reaches here writes one that way: it is the form for short text, and our own exporter, the old
 * preview pipeline and every browser encoding a picture all use base64.
 */
function storeInlinePicture(
    noteId: string,
    value: string,
    { role, title }: { role: ImageAttachmentRole; title: string }
): string | undefined {
    const inline = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(value.trim());

    if (!inline) {
        return undefined;
    }

    try {
        // The picture was sized by whoever made the preview — ours are stored at an icon's and a
        // thumbnail's size already — so this only moves bytes, and recompressing them would be a
        // second lossy pass over a picture that has had one.
        return storePictureBytes(noteId, decodeBase64(inline[1]), { role, title, shrink: false });
    } catch (e: unknown) {
        getLog().info(`Could not store an inline preview picture of note '${noteId}': ${e}`);
        return undefined;
    }
}

function attributeOf(tag: string, name: string): string | undefined {
    return new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag)?.[1];
}
