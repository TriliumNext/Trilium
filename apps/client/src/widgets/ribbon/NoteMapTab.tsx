import { TabContext } from "./ribbon-interface";
import NoteMapWidget from "../note_map";
import { useElementSize, useLegacyWidget, useWindowSize } from "../react/hooks";
import ActionButton from "../react/ActionButton";
import { t } from "../../services/i18n";
import { useEffect, useRef, useState } from "preact/hooks";

const SMALL_SIZE_HEIGHT = "300px";

export default function NoteMapTab({ noteContext }: TabContext) {
    const [ isExpanded, setExpanded ] = useState(false);
    const [ height, setHeight ] = useState(SMALL_SIZE_HEIGHT);
    const containerRef = useRef<HTMLDivElement>(null);
    const { windowHeight } = useWindowSize();
    const containerSize = useElementSize(containerRef);

    const [ noteMapContainer, noteMapWidget ] = useLegacyWidget(() => new NoteMapWidget("ribbon"), {
        noteContext,
        containerClassName: "note-map-container"
    });
    
    useEffect(() => {
        if (isExpanded && containerRef.current && containerSize) {
            const height = windowHeight - containerSize.top;
            setHeight(height + "px");
        } else {
            setHeight(SMALL_SIZE_HEIGHT);
        }
    }, [ isExpanded, containerRef, windowHeight, containerSize?.top ]);
    useEffect(() => noteMapWidget.setDimensions(), [ containerSize?.width, height ]);    

    return (
        <div className="note-map-ribbon-widget" style={{ height }} ref={containerRef}>
            {noteMapContainer}

            {!isExpanded ? (
                <ActionButton
                    icon="bx bx-arrow-to-bottom"
                    text={t("note_map.open_full")}
                    className="open-full-button"
                    onClick={() => setExpanded(true)}
                />
            ) : (
                <ActionButton
                    icon="bx bx-arrow-to-top"
                    text={t("note_map.collapse")}
                    className="collapse-button"
                    onClick={() => setExpanded(false)}
                />
            )}
        </div>
    );
}