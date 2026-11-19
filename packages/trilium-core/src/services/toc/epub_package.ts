import { MAX_TOC_HEADINGS, normalizeTocTitle } from "@triliumnext/commons";

import { createLevelTracker } from "./index.js";
import {
    childElements, findElement, findElements, isElement, parseXml, readText, type XmlElement,
    type XmlNode
} from "./xml.js";

/** An entry of a book's table of contents, as the book writes it. */
export interface BookTocEntry {
    title: string;
    level: number;
    /** The file and fragment that the entry names, percent-decoded. Absent for a `<span>` entry. */
    target?: { path: string; fragment: string };
}

/** The entries of a book's table of contents, and the chapters of its spine. */
export interface BookToc {
    entries: BookTocEntry[];
    isCut: boolean;
    /** The paths of the chapters of the spine, in order, each once. */
    chapters: string[];
}

/** An entry as a table of contents nests it, before empty titles are left out. */
interface RawEntry {
    title: string;
    depth: number;
    target?: { path: string; fragment: string };
}

/** The namespace of `epub:type`. */
const OPS_NAMESPACE = "http://www.idpf.org/2007/ops";

/**
 * The entries of the table of contents of an EPUB, from its navigation document, else its NCX. A
 * book without either has none: `null`. `names` are the paths of the archive, and `read` answers
 * the text of one of them.
 */
export async function readBookToc(
    names: readonly string[], read: (path: string) => Promise<string | undefined>
): Promise<BookToc | null> {
    const containerPath = names.find((name) => /META-INF\/container\.xml$/i.test(name));
    const container = containerPath === undefined ? undefined : await read(containerPath);
    const fullPath = container === undefined
        ? undefined
        : findElement(parseXml(container, false), "rootfile")?.attributes.get("full-path");
    const packagePath = (fullPath !== undefined && names.includes(fullPath) ? fullPath : undefined)
        ?? names.find((name) => /\.opf$/i.test(name));
    const packageText = packagePath === undefined ? undefined : await read(packagePath);
    if (packagePath === undefined || packageText === undefined) {
        return null;
    }

    const opf = parseXml(packageText, false);
    const packageFolder = folderOf(packagePath);
    const manifest = new Map<string, { path: string; mediaType: string; properties: string[] }>();
    for (const item of findElements(opf, "item")) {
        const id = item.attributes.get("id");
        const href = item.attributes.get("href");
        if (id && href) {
            manifest.set(id, {
                path: resolvePath(packageFolder, decodePath(href.split("#")[0])),
                mediaType: item.attributes.get("media-type") ?? "",
                properties: splitTokens(item.attributes.get("properties"))
            });
        }
    }
    const chapters = new Set<string>();
    for (const itemref of findElements(opf, "itemref")) {
        const item = manifest.get(itemref.attributes.get("idref") ?? "");
        if (item && /html/i.test(item.mediaType)) {
            chapters.add(item.path);
        }
    }

    const items = [ ...manifest.values() ];
    let raw: RawEntry[] | null = null;
    const nav = items.find(({ properties }) => properties.includes("nav"));
    const navText = nav && await read(nav.path);
    if (nav && navText !== undefined) {
        raw = readNavEntries(navText, nav.path);
    }
    if (!raw) {
        const tocId = findElement(opf, "spine")?.attributes.get("toc");
        const ncx = (tocId ? manifest.get(tocId) : undefined)
            ?? items.find(({ mediaType }) => mediaType === "application/x-dtbncx+xml");
        const ncxText = ncx && await read(ncx.path);
        if (ncx && ncxText !== undefined) {
            raw = readNcxEntries(ncxText, ncx.path);
        }
    }
    return raw ? { ...toOutline(raw), chapters: [ ...chapters ] } : null;
}

/** The entries of the `<nav>` typed `toc` of the navigation document `text` at `path`. */
function readNavEntries(text: string, path: string): RawEntry[] | null {
    const root = parseXml(text, true);
    const typeNames = readTypeAttributeNames(root);
    const nav = findElements(root, "nav").find((element) => typeNames.some((name) =>
        splitTokens(element.attributes.get(name)).includes("toc")));
    const list = nav && findElement(nav, "ol");
    if (!list) {
        return nav ? [] : null;
    }

    const entries: RawEntry[] = [];
    const stack = childElements(list, "li").toReversed().map((item) => ({ item, depth: 1 }));
    for (let next = stack.pop(); next; next = stack.pop()) {
        const { item, depth } = next;
        const label = item.children.find((child): child is XmlElement =>
            isElement(child) && (child.name === "a" || child.name === "span"));
        const href = label?.name === "a" ? label.attributes.get("href") : undefined;
        entries.push({
            title: label ? readLabel(label) : "",
            depth,
            target: href === undefined ? undefined : resolveTarget(path, href)
        });
        const sublist = childElements(item, "ol")[0];
        if (sublist) {
            stack.push(...childElements(sublist, "li").toReversed()
                .map((child) => ({ item: child, depth: depth + 1 })));
        }
    }
    return entries;
}

/**
 * The names of the `epub:type` attribute in `root`: with the prefix `epub`, which readers accept
 * undeclared, and with each prefix that an `xmlns:` attribute binds to `OPS_NAMESPACE`.
 */
function readTypeAttributeNames(root: XmlElement) {
    const names = [ "epub:type" ];
    for (const element of findElements(root)) {
        for (const [ name, value ] of element.attributes) {
            if (name.startsWith("xmlns:") && value === OPS_NAMESPACE) {
                names.push(`${name.slice("xmlns:".length)}:type`);
            }
        }
    }
    return names;
}

/** The entries of the `navMap` of the NCX `text` at `path`. */
function readNcxEntries(text: string, path: string): RawEntry[] {
    const navMap = findElement(parseXml(text, false), "navmap");
    if (!navMap) {
        return [];
    }

    const entries: RawEntry[] = [];
    const stack = childElements(navMap, "navpoint").toReversed()
        .map((point) => ({ point, depth: 1 }));
    for (let next = stack.pop(); next; next = stack.pop()) {
        const { point, depth } = next;
        const label = childElements(point, "navlabel")[0];
        const labelText = label && childElements(label, "text")[0];
        const src = childElements(point, "content")[0]?.attributes.get("src");
        entries.push({
            title: labelText ? normalizeTocTitle(readText(labelText)) : "",
            depth,
            target: src === undefined ? undefined : resolveTarget(path, src)
        });
        stack.push(...childElements(point, "navpoint").toReversed()
            .map((child) => ({ point: child, depth: depth + 1 })));
    }
    return entries;
}

/**
 * The authored outline of `raw`: every entry with a title, nested by `createLevelTracker()` as if
 * the entries without one were absent. Stops at `MAX_TOC_HEADINGS`.
 */
function toOutline(raw: RawEntry[]): { entries: BookTocEntry[]; isCut: boolean } {
    const entries: BookTocEntry[] = [];
    const toLevel = createLevelTracker();
    for (const { title, depth, target } of raw) {
        if (title === "") {
            continue;
        }
        if (entries.length === MAX_TOC_HEADINGS) {
            return { entries, isCut: true };
        }
        const level = toLevel(depth);
        entries.push(target ? { title, level, target } : { title, level });
    }
    return { entries, isCut: false };
}

/**
 * The title of the label of a navigation entry: its text, with each image's `alt` and each MathML
 * formula's `alttext` in place, else its `title` attribute.
 */
function readLabel(label: XmlElement) {
    const parts: string[] = [];
    const stack: XmlNode[] = [ label ];
    for (let node = stack.pop(); node; node = stack.pop()) {
        const formula = isElement(node) && node.name === "math"
            ? node.attributes.get("alttext")
            : undefined;
        if (!isElement(node)) {
            parts.push(node.text);
        } else if (node.name === "img") {
            parts.push(node.attributes.get("alt") ?? "");
        } else if (formula !== undefined) {
            parts.push(formula);
        } else if (node.name === "br") {
            parts.push(" ");
        } else {
            stack.push(...node.children.toReversed());
        }
    }
    return normalizeTocTitle(parts.join(""))
        || normalizeTocTitle(label.attributes.get("title") ?? "");
}

/** The file and fragment of the archive that `href`, written in the file `base`, names. */
function resolveTarget(base: string, href: string) {
    const hashIndex = href.indexOf("#");
    const file = hashIndex < 0 ? href : href.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? "" : decodePath(href.slice(hashIndex + 1));
    const path = file === "" ? base : resolvePath(folderOf(base), decodePath(file));
    return { path, fragment };
}

/** `path` in `folder`, as `officeparser` resolves the paths of a book. */
function resolvePath(folder: string, path: string) {
    const resolved: string[] = [];
    for (const part of `${folder}${path}`.split("/")) {
        if (part === "..") {
            resolved.pop();
        } else if (part !== "." && part !== "") {
            resolved.push(part);
        }
    }
    return resolved.join("/");
}

/** The folder of the file `path`, with its trailing `/`, or `""` at the root. */
function folderOf(path: string) {
    return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}

/** `href` with its percent-escapes decoded, or as written when they do not decode. */
function decodePath(href: string) {
    try {
        return decodeURIComponent(href);
    } catch {
        return href;
    }
}

function splitTokens(value: string | undefined) {
    return (value ?? "").split(/\s+/).filter(Boolean);
}
