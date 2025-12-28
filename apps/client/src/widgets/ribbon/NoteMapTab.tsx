import { TabContext } from "./ribbon-interface";
import { useElementSize, useWindowSize } from "../react/hooks";
import ActionButton from "../react/ActionButton";
import { t } from "../../services/i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import NoteMap from "../note_map/NoteMap";

const SMALL_SIZE_HEIGHT = "300px";

export default function NoteMapTab({ note }: TabContext) {
    const [ isExpanded, setExpanded ] = useState(false);
    const [ height, setHeight ] = useState(SMALL_SIZE_HEIGHT);
    const containerRef = useRef<HTMLDivElement>(null);
    const { windowHeight } = useWindowSize();
    const containerSize = useElementSize(containerRef);

    useEffect(() => {
        if (isExpanded && containerRef.current && containerSize) {
            const height = windowHeight - containerSize.top;
            setHeight(height + "px");
        } else {
            setHeight(SMALL_SIZE_HEIGHT);
        }
    }, [ isExpanded, containerRef, windowHeight, containerSize?.top ]);

    return (
        <div className="note-map-ribbon-widget" style={{ height }} ref={containerRef}>
            {note && <NoteMap note={note} widgetMode="ribbon" parentRef={containerRef} />}

            {!isExpanded ? (
                <ActionButton
                    icon="bx bx-expand-vertical"
                    text={t("note_map.open_full")}
                    className="open-full-button"
                    onClick={() => setExpanded(true)}
                />
            ) : (
                <ActionButton
                    icon="bx bx-collapse-vertical"
                    text={t("note_map.collapse")}
                    className="collapse-button"
                    onClick={() => setExpanded(false)}
                />
            )}
        </div>
    );
}
