import "./InheritedAttributes.css";

import { createPortal } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import FAttribute from "../../entities/fattribute";
import FNote from "../../entities/fnote";
import attribute_renderer from "../../services/attribute_renderer";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import { useTriliumEvent } from "../react/hooks";
import RawHtml from "../react/RawHtml";
import { joinElements } from "../react/react_utils";
import { AttributeDetail, AttributeDetailOpts } from "./attribute_detail";

interface InheritedAttributesProps {
    note: FNote | null | undefined;
    componentId: string;
}

export default function InheritedAttributes({ note, componentId }: InheritedAttributesProps) {
    const [ inheritedAttributes, setInheritedAttributes ] = useState<FAttribute[]>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [ detailOpts, setDetailOpts ] = useState<AttributeDetailOpts | null>(null);

    function refresh() {
        // switching note or tab should close the detail popup
        setDetailOpts(null);

        if (!note) return;
        const attrs = note.getAttributes().filter((attr) => attr.noteId !== note.noteId);
        attrs.sort((a, b) => {
            if (a.noteId === b.noteId) {
                return a.position - b.position;
            }

            // inherited attributes should stay grouped: https://github.com/zadam/trilium/issues/3761
            return a.noteId < b.noteId ? -1 : 1;

        });

        setInheritedAttributes(attrs);
    }

    useEffect(refresh, [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows(componentId).find((attr) => attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    return (
        <div className="inherited-attributes-widget">
            <div
                className="inherited-attributes-container selectable-text"
                ref={containerRef}
                // Presses inside the container do not dismiss the popup (so that clicking
                // another attribute swaps it in place instead of flickering), which leaves
                // closing on a click next to an attribute up to this handler.
                onClick={() => setDetailOpts(null)}
            >
                {inheritedAttributes?.length ? (
                    joinElements(inheritedAttributes.map(attribute => (
                        <InheritedAttribute
                            key={attribute.attributeId}
                            attribute={attribute}
                            onClick={(e) => {
                                // Keep the container's closing handler from undoing this.
                                e.stopPropagation();

                                setDetailOpts({
                                    attribute: {
                                        noteId: attribute.noteId,
                                        type: attribute.type,
                                        name: attribute.name,
                                        value: attribute.value,
                                        isInheritable: attribute.isInheritable
                                    },
                                    isOwned: false,
                                    x: e.pageX,
                                    y: e.pageY,
                                    parent: containerRef.current ?? undefined
                                });
                            }}
                        />
                    )), " ")
                ) : (
                    <>{t("inherited_attribute_list.none")}</>
                )}
            </div>

            {createPortal(
                <AttributeDetail
                    opts={detailOpts}
                    currentNoteId={note?.noteId}
                    onDismiss={() => setDetailOpts(null)}
                    // Inherited attributes are read-only here, so there is nothing to revert.
                    onCancel={() => setDetailOpts(null)}
                />,
                document.body)}
        </div>
    );
}
function InheritedAttribute({ attribute, onClick }: { attribute: FAttribute, onClick: (e: MouseEvent) => void }) {
    const [ html, setHtml ] = useState<JQuery<HTMLElement> | string>("");
    useEffect(() => {
        attribute_renderer.renderAttribute(attribute, false).then(setHtml);
    }, [ attribute ]);

    return (
        <RawHtml
            html={html}
            onClick={onClick}
        />
    );
}
