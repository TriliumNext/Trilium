import "./IconPack.css";

import { useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { isDesktop } from "../../../services/utils";
import { useNoteBlob } from "../../react/hooks";
import { TextPreview } from "../File";
import SplitEditor from "../helpers/SplitEditor";
import { TypeWidgetProps } from "../type_widget";
import { IconPackPreview } from "./IconPackPreview";

export default function IconPack(props: TypeWidgetProps) {
    const [ content, setContent ] = useState("");
    // Icon packs shipped in distributable zips are `file` notes, whose content isn't editable as
    // text and can be large — show a read-only, truncated source pane (no CodeMirror). Manually
    // created `code` notes stay editable in the normal code editor.
    const isFileNote = props.note.type === "file";
    return (
        <SplitEditor
            noteType="code"
            {...props}
            forceReadOnly={isFileNote}
            onContentChanged={setContent}
            editorContent={isFileNote ? <FileSource note={props.note} /> : undefined}
            previewContent={<IconPackPreview note={props.note} content={content} />}
            forceOrientation={isDesktop() ? "horizontal" : "vertical"}
        />
    );
}

function FileSource({ note }: { note: FNote }) {
    const blob = useNoteBlob(note);
    // `TextPreview` renders the alert and the `<pre>` as siblings; wrap them so the split editor
    // pane has a single flow child and doesn't break its layout.
    return (
        <div className="icon-pack-file-source">
            <TextPreview content={blob?.content ?? ""} />
        </div>
    );
}
