import attribute_parser, { Attribute } from "./attribute_parser.js";
import { formatValue } from "./attribute_renderer.js";
import froca from "./froca.js";

/**
 * Attributes travel through the clipboard as the text the attributes editor spells them out in —
 * `#author=Elian ~parent=#root/abc123 #tag(inheritable)`. That is Trilium's one written form for them
 * and it loses nothing: the kind, the name, the value, whether the attribute is inheritable, and the
 * note a relation points at (as the note path the editor holds behind its links, not as the title the
 * rows show). So nothing here is a format of its own — what is copied out of a row pastes into the
 * attributes editor, into a note, or into anything else that takes text, and what is copied from any
 * of those pastes back into the rows.
 *
 * Two flavours are written: that text, and the HTML the editor holds it as — the same thing with the
 * relations as reference links, so a paste into a note keeps them clickable and reading a paste back
 * keeps the target's title readable. The HTML is preferred when reading, being the richer of the two;
 * {@link getPreprocessedData} takes it back down to the text the parser reads.
 */

/**
 * What was last copied, kept here as well as on the system clipboard — which is what a menu pastes
 * from, the note tree's own clipboard working the same way (see clipboard.ts): reading the system
 * clipboard outside of a paste key press is withheld outside a secure context and asks a permission
 * besides, where what Trilium copied itself is simply still here.
 *
 * It follows from that that this and the system clipboard can drift apart — something else copied in
 * another window leaves this untouched — which is the note tree's behaviour too: a menu pastes what
 * Trilium last copied, and the paste key pastes what the system clipboard holds.
 */
let held: Attribute[] = [];

/** What a menu pastes: the attributes last copied out of a panel, or none if none were. */
export function getHeldAttributes(): Attribute[] {
    return held;
}

/** Reads whichever flavour the clipboard offers. Throws what the parser throws over text that is not
 *  attributes, which the caller is the one to put to the user. */
export function readAttributes(data: DataTransfer | null): Attribute[] {
    // Preferred over the plain text because it is the flavour a relation survives in: the editor
    // writes its target as a link, whose text is the note's title and whose href is the path.
    const html = data?.getData("text/html");
    const source = html ? getPreprocessedData(html) : data?.getData("text/plain");

    if (!source?.trim()) {
        return [];
    }

    return attribute_parser.lexAndParse(source);
}

/** Writes both flavours of the attributes onto a clipboard event's data, and holds on to them. */
export function writeAttributes(data: DataTransfer | null, attributes: Attribute[]) {
    held = [ ...attributes ];

    if (!data) {
        return;
    }

    data.setData("text/plain", serializeAttributes(attributes));
    data.setData("text/html", serializeAttributesAsHtml(attributes));
}

/**
 * Puts the attributes on the system clipboard outside of a copy key press — from a menu, that is,
 * where there is no event to write onto. Only the text flavour goes across: the richer one is a
 * convenience for pasting into a note (the relations staying clickable) and the text loses nothing.
 *
 * The clipboard API where it is to be had, and the old command where it is not: it is withheld
 * outside a secure context, and Trilium is served over plain HTTP as readily as over TLS. The
 * command needs something selected to copy, hence the field held off-screen for the moment it takes.
 */
export async function copyAttributesToClipboard(attributes: Attribute[]) {
    held = [ ...attributes ];
    const text = serializeAttributes(attributes);

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch {
        // Withheld after all — a permission refused, or a window that had lost the focus. Below.
    }

    const field = document.createElement("textarea");
    field.value = text;
    // Off-screen rather than hidden: what is not rendered cannot hold a selection to be copied.
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);

    const previouslyFocused = document.activeElement;
    field.select();
    document.execCommand("copy");
    field.remove();

    // The panel had the focus and needs it back: it is what the paste key reaches the panel through.
    if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus({ preventScroll: true });
    }
}

/**
 * The attributes as the one line of text the editor spells them out in. A relation is written as the
 * path of the note it points at rather than that note's title: the title is what a link shows, and a
 * paste is read by the parser, which resolves a path and could only guess at a title.
 *
 * A relation with no target yet is left out — there is nothing to write down for it, and the parser
 * would refuse the line over it.
 */
export function serializeAttributes(attributes: Attribute[]): string {
    return attributes
        .map(serializeAttribute)
        .filter((text) => text !== null)
        .join(" ");
}

/**
 * The same, as the HTML the attributes editor holds: the relations as the reference links it renders
 * them into, so a paste into a note lands as a link to the target and a paste back reads the path out
 * of it again. Built as DOM rather than as a string, so a title with a `<` in it stays a title.
 */
export function serializeAttributesAsHtml(attributes: Attribute[]): string {
    const $container = $("<span>");

    for (const attribute of attributes) {
        const text = serializeAttribute(attribute);
        if (text === null) {
            continue;
        }

        if ($container.contents().length > 0) {
            $container.append(document.createTextNode(" "));
        }

        if (attribute.type === "relation" && attribute.value) {
            $container.append(document.createTextNode(`~${attribute.name}${inheritableSuffix(attribute)}=`));
            $container.append($("<a>", {
                href: `#root/${attribute.value}`,
                class: "reference-link"
                // The title where the note is one the client already holds, and the id where it is
                // not: the href is what a paste reads, so the text is free to be the readable half.
            }).text(froca.getNoteFromCache(attribute.value)?.title ?? attribute.value));
        } else {
            $container.append(document.createTextNode(text));
        }
    }

    return $container.html();
}

/** One attribute written out, or `null` where there is nothing to write (a relation with no target). */
function serializeAttribute(attribute: Attribute): string | null {
    const head = `${attribute.type === "relation" ? "~" : "#"}${attribute.name}${inheritableSuffix(attribute)}`;

    if (attribute.type === "relation") {
        return attribute.value ? `${head}=#root/${attribute.value}` : null;
    }

    // A label with no value is its name alone: `#archived=` would not parse, and `#archived` is what
    // a bare label means anyway.
    return attribute.value ? `${head}=${formatValue(attribute.value)}` : head;
}

/** Written between the name and the value, which is where the parser looks for it. */
function inheritableSuffix(attribute: Attribute) {
    return attribute.isInheritable ? "(inheritable)" : "";
}

export interface PasteResult {
    /** The note's owned attributes with the pasted ones folded in. */
    attributes: Attribute[];
    /** How many joined the list, and how many were an existing attribute given another value. */
    added: number;
    replaced: number;
}

/**
 * The pasted attributes folded into the ones the note already owns. What happens where a name is
 * already taken depends on what the name is defined as: a field holding a set takes another entry
 * (unless it already holds that very one — pasting the same thing twice is not two of it), while a
 * field holding one value has that value replaced, the attribute itself staying the one it was.
 *
 * Nothing is carried over from the attribute a paste came from beyond what is written down: the
 * parser builds its attributes out of text alone, so none of them arrives with an id, and pasting is
 * always a note being given an attribute rather than one being moved across from somewhere else.
 */
export function mergePastedAttributes(
    existing: Attribute[],
    pasted: Attribute[],
    isMultiValued: (attribute: Attribute) => boolean
): PasteResult {
    const attributes = [ ...existing ];
    let added = 0;
    let replaced = 0;

    for (const incoming of pasted) {
        const candidate: Attribute = {
            type: incoming.type,
            name: incoming.name,
            value: incoming.value ?? "",
            isInheritable: incoming.isInheritable ?? false
        };
        const matches = (attribute: Attribute) => attribute.type === candidate.type && attribute.name === candidate.name;

        if (isMultiValued(candidate)) {
            if (!attributes.some((attribute) => matches(attribute) && (attribute.value ?? "") === candidate.value)) {
                attributes.push(candidate);
                added++;
            }
            continue;
        }

        const index = attributes.findIndex(matches);
        if (index >= 0) {
            attributes[index] = {
                ...attributes[index],
                value: candidate.value,
                isInheritable: candidate.isInheritable
            };
            replaced++;
        } else {
            attributes.push(candidate);
            added++;
        }
    }

    return { attributes, added, replaced };
}

/** The attributes as plain text: reference links back down to their note path, entities resolved. */
export function getPreprocessedData(currentValue: string) {
    const str = currentValue
        .replace(/<a[^>]+href="(#[A-Za-z0-9_/]*)"[^>]*>[^<]*<\/a>/g, "$1")
        .replace(/&nbsp;/g, " "); // otherwise .text() below outputs non-breaking space in unicode

    return $("<div>").html(str).text();
}
