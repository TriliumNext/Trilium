import {
    ActionButton, Button, LinkButton,
    Admonition, Collapsible, FormGroup,
    Dropdown, FormListItem, FormDropdownDivider, FormDropdownSubmenu,
    NoteAutocomplete, NoteLink, Modal,
    CKEditor,
    useEffect, useState
} from "trilium:preact";
import { showMessage } from "trilium:api";

export default function() {
    const [ time, setTime ] = useState();
    const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aliquam accumsan eu odio non gravida. Pellentesque ornare, arcu condimentum molestie dignissim, nibh turpis ultrices elit, eget elementum nunc erat at erat. Maecenas vehicula consectetur elit, nec fermentum elit venenatis eu.";
    useEffect(() => {
        const interval = setInterval(() => setTime(new Date().toLocaleString()), 1000);
        return () => clearInterval(interval);
    }, []);
    
    return (
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: "1em" }}>
            <h1>Widget showcase</h1>

            <Buttons />
            <Admonition type="note">
                <strong>Admonition</strong><br />
                {lorem}
            </Admonition>
            
            <Collapsible title="Collapsible" initiallyExpanded>
                {lorem}
            </Collapsible>

            <FormElements />
            <NoteElements />
            <ModalSample />
            <DropdownSample />
        </div>        
    );
}

function Buttons() {
    const onClick = () => showMessage("A button was pressed");
    
    return (
        <>
            <h2>Buttons</h2>
            <div style={{ display: "flex", gap: "1em", alignItems: "center" }}>
                <ActionButton icon="bx bx-rocket" text="Action button" onClick={onClick} />
                <Button icon="bx bx-rocket" text="Simple button" onClick={onClick} />
                <LinkButton text="Link button" onClick={onClick} />                
            </div>
        </>
    )
}

function NoteElements() {
    const [ noteId, setNoteId ] = useState("");
    
    return (
        <div>
            <h2>Note elements</h2>

            <FormGroup name="note-autocomplete" label="Note autocomplete">
                <NoteAutocomplete
                    placeholder="Select a note"
                    noteId={noteId} noteIdChanged={setNoteId}
                />
            </FormGroup>

            <FormGroup name="note-link" label="Note link">
                {noteId
                ? <NoteLink notePath={noteId} showNoteIcon />
                : <span>Select a note first</span>}
            </FormGroup>
        </div>
    );
}

function ModalSample() {
    const [ shown, setShown ] = useState(false);    
    
    return (
        <>
            <h2>Modal</h2>
            <Button text="Open modal" onClick={() => setShown(true)} />            
            <Modal title="Modal title" size="md" show={shown} onHidden={() => setShown(false)}>
                Modal goes here.
            </Modal>
        </>
    )
}

function DropdownSample() {
    return (
        <>
            <h2>Dropdown menu</h2>
            <Dropdown text="Dropdown" hideToggleArrow>
                <FormListItem icon="bx bx-cut">Cut</FormListItem>
                <FormListItem icon="bx bx-copy">Copy</FormListItem>
                <FormListItem icon="bx bx-paste">Paste</FormListItem>
                <FormDropdownDivider />
                <FormDropdownSubmenu title="Submenu">
                    <FormListItem>More items</FormListItem>
                </FormDropdownSubmenu>
            </Dropdown>
        </>
    )
}