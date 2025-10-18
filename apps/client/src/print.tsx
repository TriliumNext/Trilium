import FNote from "./entities/fnote";
import { render } from "preact";
import { CustomNoteList } from "./widgets/collections/NoteList";
import "./print.css";

async function main() {
    const noteId = window.location.pathname.split("/")[2];
    const froca = (await import("./services/froca")).default;
    const note = await froca.getNote(noteId);

    if (!note) return;
    render(getElementForNote(note), document.body);
}

function getElementForNote(note: FNote) {
    // Collections.
    if (note.type === "book") {
        return <CustomNoteList
            isEnabled
            note={note}
            notePath={note.getBestNotePath().join("/")}
            ntxId="print"
            highlightedTokens={null}
            media="print"
        />;
    }

    // Other note types.
    return <>
        <h1>{note.title}</h1>
    </>;
}

main();
