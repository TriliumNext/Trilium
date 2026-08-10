import { TypeWidgetProps } from "./type_widget";
import NoteMapEl from "../note_map/NoteMap";
import { useRef } from "preact/hooks";
import "./NoteMap.css";

export default function NoteMap({ note, noteContext }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
        <div ref={containerRef}>
            {/* The `note-map` view of an ordinary note is what the connections tab's expand button
                opens, and nothing else opens it — so it is drawn as that card's map rather than as the
                map of a note that is one, which is what this widget otherwise draws. */}
            <NoteMapEl
                parentRef={containerRef}
                note={note}
                widgetMode={noteContext?.viewScope?.viewMode === "note-map" ? "expanded" : "type"} />
        </div>
    );
}
