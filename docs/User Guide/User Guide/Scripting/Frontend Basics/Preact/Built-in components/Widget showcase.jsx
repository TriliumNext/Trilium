import {
    ActionButton, Button, LinkButton,
    Admonition, Collapsible,
    FormCheckbox, FormDropdownList, FormFileUploadButton, FormGroup, FormRadioGroup, FormTextArea,
    FormTextBox, FormToggle, Slider, RawHtml, LoadingSpinner, Icon,
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

function FormElements() {
    const [ checkboxChecked, setCheckboxChecked ] = useState(false);
    const [ dropdownValue, setDropdownValue ] = useState("key-1");
    const [ radioGroupValue, setRadioGroupValue ] = useState("key-1");
    const [ sliderValue, setSliderValue ] = useState(50);
    
    return (
        <>
            <h2>Form elements</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1em" }}>
                <FormGroup name="checkbox" label="Checkbox">
                    <FormCheckbox label="Checkbox" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                </FormGroup>
                <FormGroup name="toggle" label="Toggle">
                    <FormToggle switchOnName="Off" switchOffName="On" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                </FormGroup>
                <FormGroup name="dropdown" label="Dropdown">
                    <FormDropdownList
                        values={[
                            { key: "key-1", name: "First item" },
                            { key: "key-2", name: "Second item" },
                            { key: "key-3", name: "Third item" },
                        ]}
                        currentValue={dropdownValue} onChange={setDropdownValue}
                        keyProperty="key" titleProperty="name"
                    />
                </FormGroup>
                <FormGroup name="radio-group" label="Radio group">
                    <FormRadioGroup
                        values={[
                            { value: "key-1", label: "First item" },
                            { value: "key-2", label: "Second item" },
                            { value: "key-3", label: "Third item" },
                        ]}
                        currentValue={radioGroupValue} onChange={setRadioGroupValue}
                    />
                </FormGroup>                
                <FormGroup name="text-box" label="Text box">
                    <FormTextBox
                        placeholder="Type something..."
                        currentValue="" onChange={(newValue) => {}}
                    />                
                </FormGroup>        
                <FormGroup name="text-area" label="Text area">
                    <FormTextArea
                        placeholder="Type something bigger..."
                        currentValue="" onChange={(newValue) => {}}
                    />
                </FormGroup>
                <FormGroup name="slider" label="Slider">
                    <Slider
                        min={1} max={100}
                        value={sliderValue} onChange={setSliderValue}
                    />
                </FormGroup>
                <FormGroup name="file-upload" label="File upload">
                    <FormFileUploadButton
                        text="Upload"
                        onChange={(files) => {
                            const file = files?.[0];
                            if (!file) return;
                            showMessage(`Got file "${file.name}" of size ${file.size} B and type ${file.type}.`);
                        }}
                    /> 
                </FormGroup>                
                <FormGroup name="icon" label="Icon">
                    <Icon icon="bx bx-smile" />
                </FormGroup>
                <FormGroup name="loading-spinner" label="Loading spinner">
                    <LoadingSpinner />
                </FormGroup>
                <FormGroup name="raw-html" label="Raw HTML">
                    <RawHtml html="<strong>Hi</strong> <em>there</em>" />
                </FormGroup>
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