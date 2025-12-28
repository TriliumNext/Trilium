import { TypeWidgetProps } from "./type_widget";
import NoteMapEl from "../note_map/NoteMap";
import { useRef } from "preact/hooks";
import "./NoteMap.css";

export default function NoteMap({ note, noteContext }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
        <div ref={containerRef}>
            <NoteMapEl
                parentRef={containerRef}
                note={note}
                widgetMode={noteContext?.viewScope?.viewMode === "note-map" ? "ribbon" : "type"} />
        </div>
    );
}
