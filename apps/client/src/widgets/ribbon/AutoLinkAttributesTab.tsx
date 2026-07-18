import { useEffect, useState } from "preact/hooks";

import FAttribute from "../../entities/fattribute";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import { useTriliumEvent } from "../react/hooks";
import { joinElements } from "../react/react_utils";
import { TabContext } from "./ribbon-interface";

type AutoLinkAttributesTabArgs = Pick<TabContext, "note" | "componentId">;

export default function AutoLinkAttributesTab({ note, componentId }: AutoLinkAttributesTabArgs) {
    const [autoLinkAttributes, setAutoLinkAttributes] = useState<FAttribute[]>();

    function refresh() {
        if (!note) return;
        const attrs = note.getAttributes().filter((attr) => attr.isAutoLink && attr.noteId === note.noteId);
        setAutoLinkAttributes(attrs);
    }

    useEffect(refresh, [note]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows(componentId).find((attr) => attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    if (!autoLinkAttributes?.length) {
        return null;
    }

    return (
        <div className="auto-link-attributes-widget">
            <div className="auto-link-attributes-container selectable-text">
                {joinElements(autoLinkAttributes.map((attribute) => (
                    <AutoLinkAttribute key={attribute.attributeId} attribute={attribute} />
                )), " ")}
            </div>
        </div>
    );
}

function AutoLinkAttribute({ attribute }: { attribute: FAttribute }) {
    const [html, setHtml] = useState<string>("");

    useEffect(() => {
        renderAutoLink(attribute).then(setHtml);
    }, [attribute]);

    return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

async function renderAutoLink(attribute: FAttribute) {
    if (attribute.type === "label") {
        return `#${escapeHtml(attribute.name)}=${escapeHtml(attribute.value)}`;
    }

    const note = await froca.getNote(attribute.value);
    if (!note) return "";

    const link = `<a href="#root/${attribute.value}" class="reference-link">${escapeHtml(note.title)}</a>`;
    return `~${escapeHtml(attribute.name)}=${link}`;
}

function escapeHtml(text: string) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}
