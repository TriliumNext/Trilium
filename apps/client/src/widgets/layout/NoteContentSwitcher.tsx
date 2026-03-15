import "./NoteContentSwitcher.css";

import FNote from "../../entities/fnote";
import server from "../../services/server";
import { Badge } from "../react/Badge";
import { useNoteSavedData } from "../react/hooks";

export interface NoteContentTemplate {
    name: string;
    content: string;
}

interface NoteContentSwitcherProps {
    text: string;
    note: FNote;
    templates: NoteContentTemplate[];
}

export default function NoteContentSwitcher({ text, note, templates }: NoteContentSwitcherProps) {
    const blob = useNoteSavedData(note?.noteId);

    return (blob?.trim().length === 0 &&
        <div className="note-content-switcher">
            {text}{" "}

            {templates.map(sample => (
                <Badge
                    key={sample.name}
                    text={sample.name}
                    onClick={async () => {
                        await server.put(`notes/${note.noteId}/data`, {
                            content: sample.content
                        });
                    }}
                />
            ))}
        </div>
    );
}
