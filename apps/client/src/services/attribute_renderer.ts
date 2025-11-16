import ws from "./ws.js";
import froca from "./froca.js";
import type FAttribute from "../entities/fattribute.js";
import type FNote from "../entities/fnote.js";

async function renderAttribute(attribute: FAttribute, renderIsInheritable: boolean) {
    const isInheritable = renderIsInheritable && attribute.isInheritable ? `(inheritable)` : "";
    const $attr = $("<span>");

    if (attribute.type === "label") {
        $attr.append(document.createTextNode(`#${attribute.name}${isInheritable}`));

        if (attribute.value) {
            $attr.append("=");
            $attr.append(document.createTextNode(formatValue(attribute.value)));
        }
    } else if (attribute.type === "relation") {
        if (attribute.isAutoLink) {
            return $attr;
        }

        // when the relation has just been created, then it might not have a value
        if (attribute.value) {
            $attr.append(document.createTextNode(`~${attribute.name}${isInheritable}=`));

            const link = await createLink(attribute.value);
            if (link) {
                $attr.append(link);
            }
        }
    } else {
        ws.logError(`Unknown attr type: ${attribute.type}`);
    }

    return $attr;
}

function formatValue(val: string) {
    if (/^[\p{L}\p{N}\-_,.]+$/u.test(val)) {
        return val;
    } else if (!val.includes('"')) {
        return `"${val}"`;
    } else if (!val.includes("'")) {
        return `'${val}'`;
    } else if (!val.includes("`")) {
        return `\`${val}\``;
    } else {
        return `"${val.replace(/"/g, '\\"')}"`;
    }
}

async function createLink(noteId: string) {
    const note = await froca.getNote(noteId);

    if (!note) {
        return;
    }

    return $("<a>", {
        href: `#root/${noteId}`,
        class: "reference-link"
    }).text(note.title);
}

async function renderAttributes(attributes: FAttribute[], renderIsInheritable: boolean) {
    const $container = $('<span class="rendered-note-attributes">');

    for (let i = 0; i < attributes.length; i++) {
        const attribute = attributes[i];

        const $attr = await renderAttribute(attribute, renderIsInheritable);
        $container.append($attr.html()); // .html() to get only inner HTML, we don't want any spans

        if (i < attributes.length - 1) {
            $container.append(" ");
        }
    }

    return $container;
}

const HIDDEN_ATTRIBUTES = [
    "originalFileName",
    "fileSize",
    "template",
    "inherit",
    "cssClass",
    "iconClass",
    "pageSize",
    "viewType",
    "geolocation",
    "docName",
    "webViewSrc",
    "archived"
];

async function renderNormalAttributes(note: FNote) {
    const promotedDefinitionAttributes = note.getPromotedDefinitionAttributes();
    let attrs = note.getAttributes();

    if (promotedDefinitionAttributes.length > 0) {
        attrs = attrs.filter((attr) => !!promotedDefinitionAttributes.find((promAttr) => promAttr.isDefinitionFor(attr)));
    } else {
        attrs = attrs.filter((attr) => !attr.isDefinition() && !attr.isAutoLink && !HIDDEN_ATTRIBUTES.includes(attr.name) && attr.noteId === note.noteId);
    }

    const $renderedAttributes = await renderAttributes(attrs, false);

    return {
        count: attrs.length,
        $renderedAttributes
    };
}

export default {
    renderAttribute,
    renderAttributes,
    renderNormalAttributes
};
