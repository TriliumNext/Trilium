/** Builds the books that the specs of the EPUB format read. */
import { EPUB_MIME_TYPES } from "@triliumnext/commons";
import { strToU8, type Zippable, zipSync } from "fflate";

const EPUB_MIME = EPUB_MIME_TYPES[0];
/** A fixed date for the entries of the archives, so that the same spec builds the same bytes. */
const MTIME = new Date("2026-01-01T00:00:00Z");

/** The container of a book, which names `OEBPS/content.opf` as its package document. */
export const CONTAINER = "<?xml version=\"1.0\"?><container version=\"1.0\" "
    + "xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles>"
    + "<rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>"
    + "</rootfiles></container>";

/**
 * An EPUB 3 of `chapters`, by file name in `OEBPS/`, in that order in the spine, with the
 * navigation `nav` (its `<li>` items) when given. A text chapter is a body, and a byte chapter is
 * the whole file. `encrypted` lists the chapters that `encryption.xml` names.
 */
export function buildEpub(
    chapters: Record<string, string | Uint8Array>,
    { nav, encrypted = [] }: { nav?: string; encrypted?: string[] } = {}
) {
    const files: Zippable = { mimetype: [ strToU8(EPUB_MIME), { level: 0, mtime: MTIME } ] };
    const add = (path: string, content: string | Uint8Array) => {
        const bytes = typeof content === "string" ? strToU8(content) : content;
        files[path] = [ bytes, { mtime: MTIME } ];
    };
    add("META-INF/container.xml", CONTAINER);
    if (encrypted.length > 0) {
        add("META-INF/encryption.xml",
            "<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\" "
            + "xmlns:enc=\"http://www.w3.org/2001/04/xmlenc#\">" + encrypted.map((path) =>
            "<enc:EncryptedData><enc:EncryptionMethod "
                + "Algorithm=\"http://www.w3.org/2001/04/xmlenc#aes256-cbc\"/>"
                + `<enc:CipherData><enc:CipherReference URI="${path}"/></enc:CipherData>`
                + "</enc:EncryptedData>")
            .join("") + "</encryption>");
    }
    const names = Object.keys(chapters);
    const manifest = names.map((name, index) =>
        `<item id="c${index}" href="${name}" media-type="application/xhtml+xml"/>`).join("")
        + (nav === undefined ? "" : "<item id=\"nav\" href=\"nav.xhtml\" "
            + "media-type=\"application/xhtml+xml\" properties=\"nav\"/>");
    const spine = names.map((_, index) => `<itemref idref="c${index}"/>`).join("");
    add("OEBPS/content.opf", packageDocument(manifest, "", spine));
    if (nav !== undefined) {
        add("OEBPS/nav.xhtml", nav === "" ? xhtml("<p>No navigation</p>") : navDocument(nav));
    }
    for (const [ name, body ] of Object.entries(chapters)) {
        add(`OEBPS/${name}`, typeof body === "string" ? xhtml(body) : body);
    }
    return zipSync(files);
}

export function packageDocument(manifest: string, spineAttributes: string, spine: string) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        + "<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" "
        + "unique-identifier=\"id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">"
        + "<dc:identifier id=\"id\">book</dc:identifier><dc:title>Book</dc:title></metadata>"
        + `<manifest>${manifest}</manifest><spine${spineAttributes}>${spine}</spine></package>`;
}

export function navDocument(items: string) {
    return xhtml(`<nav epub:type="toc"><h1>Contents</h1><ol>${items}</ol></nav>`);
}

export function xhtml(body: string, bodyStart = "") {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE html>"
        + "<html xmlns=\"http://www.w3.org/1999/xhtml\" "
        + "xmlns:epub=\"http://www.idpf.org/2007/ops\">"
        + `<head><title>Chapter</title></head><body>${bodyStart}${body}</body></html>`;
}
