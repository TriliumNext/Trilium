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
            <h1>Демонстрация виджетов</h1>

            <Buttons />
            <Admonition type="note">
                <strong>Примечание</strong><br />
                {lorem}
            </Admonition>
            
            <Collapsible title="Сворачиваемый блок" initiallyExpanded>
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
    const onClick = () => showMessage("Кнопка нажата");
    
    return (
        <>
            <h2>Кнопки</h2>
            <div style={{ display: "flex", gap: "1em", alignItems: "center" }}>
                <ActionButton icon="bx bx-rocket" text="Кнопка действия" onClick={onClick} />
                <Button icon="bx bx-rocket" text="Обычная кнопка" onClick={onClick} />
                <LinkButton text="Кнопка-ссылка" onClick={onClick} />                
            </div>
        </>
    )
}

function NoteElements() {
    const [ noteId, setNoteId ] = useState("");
    
    return (
        <div>
            <h2>Элементы заметки</h2>

            <FormGroup name="note-autocomplete" label="Автодополнение заметок">
                <NoteAutocomplete
                    placeholder="Выберите заметку"
                    noteId={noteId} noteIdChanged={setNoteId}
                />
            </FormGroup>

            <FormGroup name="note-link" label="Ссылка на заметку">
                {noteId
                ? <NoteLink notePath={noteId} showNoteIcon />
                : <span>Сначала выберите заметку</span>}
            </FormGroup>
        </div>
    );
}

function ModalSample() {
    const [ shown, setShown ] = useState(false);    
    
    return (
        <>
            <h2>Модальное окно</h2>
            <Button text="Открыть модальное окно" onClick={() => setShown(true)} />            
            <Modal title="Заголовок модального окна" size="md" show={shown} onHidden={() => setShown(false)}>
                Modal goes here.
            </Modal>
        </>
    )
}

function DropdownSample() {
    return (
        <>
            <h2>Выпадающее меню</h2>
            <Dropdown text="Выпадающий список" hideToggleArrow>
                <FormListItem icon="bx bx-cut">Вырезать</FormListItem>
                <FormListItem icon="bx bx-copy">Копировать</FormListItem>
                <FormListItem icon="bx bx-paste">Вставить</FormListItem>
                <FormDropdownDivider />
                <FormDropdownSubmenu title="Подменю">
                    <FormListItem>Другие пункты</FormListItem>
                </FormDropdownSubmenu>
            </Dropdown>
        </>
    )
}