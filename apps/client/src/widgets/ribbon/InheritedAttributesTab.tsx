import { useEffect, useState } from "preact/hooks";
import { TabContext } from "./ribbon-interface";
import FAttribute from "../../entities/fattribute";
import { useLegacyWidget, useTriliumEvent } from "../react/hooks";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import attribute_renderer from "../../services/attribute_renderer";
import RawHtml from "../react/RawHtml";
import { joinElements } from "../react/react_utils";
import AttributeDetailWidget from "../attribute_widgets/attribute_detail";

type InheritedAttributesTabArgs = Pick<TabContext, "note" | "componentId"> & {
    emptyListString?: string;
}

export default function InheritedAttributesTab({ note, componentId, emptyListString }: InheritedAttributesTabArgs) {
    const [ inheritedAttributes, setInheritedAttributes ] = useState<FAttribute[]>();
    const [ attributeDetailWidgetEl, attributeDetailWidget ] = useLegacyWidget(() => new AttributeDetailWidget());

    function refresh() {
        if (!note) return;
        const attrs = note.getAttributes().filter((attr) => attr.noteId !== note.noteId);
        attrs.sort((a, b) => {
            if (a.noteId === b.noteId) {
                return a.position - b.position;
            } else {
                // inherited attributes should stay grouped: https://github.com/zadam/trilium/issues/3761
                return a.noteId < b.noteId ? -1 : 1;
            }
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
            <div className="inherited-attributes-container selectable-text">
                {inheritedAttributes?.length ? (
                    joinElements(inheritedAttributes.map(attribute => (
                        <InheritedAttribute
                            attribute={attribute}
                            onClick={(e) => {
                                setTimeout(
                                    () =>
                                        attributeDetailWidget.showAttributeDetail({
                                            attribute: {
                                                noteId: attribute.noteId,
                                                type: attribute.type,
                                                name: attribute.name,
                                                value: attribute.value,
                                                isInheritable: attribute.isInheritable
                                            },
                                            isOwned: false,
                                            x: e.pageX,
                                            y: e.pageY
                                        }),
                                    100
                                );
                            }}
                        />
                    )), " ")
                ) : (
                    <>{t(emptyListString ?? "inherited_attribute_list.no_inherited_attributes")}</>
                )}
            </div>

            {attributeDetailWidgetEl}
        </div>
    )
}
function InheritedAttribute({ attribute, onClick }: { attribute: FAttribute, onClick: (e: MouseEvent) => void }) {
    const [ html, setHtml ] = useState<JQuery<HTMLElement> | string>("");
    useEffect(() => {
        attribute_renderer.renderAttribute(attribute, false).then(setHtml);
    }, []);

    return (
        <RawHtml
            html={html}
            onClick={onClick}
        />
    );
}
