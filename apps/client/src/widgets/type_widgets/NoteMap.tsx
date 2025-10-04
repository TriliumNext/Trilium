import { TypeWidgetProps } from "./type_widget";
import NoteMapEl from "../note_map/NoteMap";
import { useRef } from "preact/hooks";

export default function NoteMap({ note }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
        <div ref={containerRef} className="note-detail-note-map note-detail-printable">
            <NoteMapEl parentRef={containerRef} note={note} widgetMode="type" />
        </div>
    );
}
