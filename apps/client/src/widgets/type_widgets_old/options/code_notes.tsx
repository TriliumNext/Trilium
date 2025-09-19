import CodeMirror, { ColorThemes, getThemeById } from "@triliumnext/codemirror";
import { t } from "../../../services/i18n";
import Column from "../../react/Column";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import FormSelect from "../../react/FormSelect";
import { useTriliumOption, useTriliumOptionBool, useTriliumOptionJson } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import { useEffect, useMemo, useRef } from "preact/hooks";
import codeNoteSample from "./samples/code_note.txt?raw";
import { DEFAULT_PREFIX } from "../abstract_code_type_widget";
import { MimeType } from "@triliumnext/commons";
import mime_types from "../../../services/mime_types";
import CheckboxList from "./components/CheckboxList";
import AutoReadOnlySize from "./components/AutoReadOnlySize";
import "./code_notes.css";

const SAMPLE_MIME = "application/typescript";

export default function CodeNoteSettings() {
    return (
        <>
            <Editor />
            <Appearance />
            <CodeMimeTypes />
            <AutoReadOnlySize option="autoReadonlySizeCode" label={t("code_auto_read_only_size.label")} />
        </>
    )
}

function Editor() {
    const [ vimKeymapEnabled, setVimKeymapEnabled ] = useTriliumOptionBool("vimKeymapEnabled");

    return (
        <OptionsSection title={t("code-editor-options.title")}>
            <FormGroup name="vim-keymap-enabled" description={t("vim_key_bindings.enable_vim_keybindings")}>
                <FormCheckbox
                    label={t("vim_key_bindings.use_vim_keybindings_in_code_notes")}
                    currentValue={vimKeymapEnabled} onChange={setVimKeymapEnabled}
                />
            </FormGroup>
        </OptionsSection>
    )
}

function Appearance() {
    const [ codeNoteTheme, setCodeNoteTheme ] = useTriliumOption("codeNoteTheme");
    const [ codeLineWrapEnabled, setCodeLineWrapEnabled ] = useTriliumOptionBool("codeLineWrapEnabled");

    const themes = useMemo(() => {
        return ColorThemes.map(({ id, name }) => ({
            id: "default:" + id,
            name
        }));
    }, []);

    return (
        <OptionsSection title={t("code_theme.title")}>
            <div className="row" style={{ marginBottom: "15px" }}>
                <FormGroup name="color-scheme" label={t("code_theme.color-scheme")} className="col-md-6" style={{ marginBottom: 0 }}>
                    <FormSelect 
                        values={themes}
                        keyProperty="id" titleProperty="name"
                        currentValue={codeNoteTheme} onChange={setCodeNoteTheme}
                    />
                </FormGroup>

                <Column className="side-checkbox">
                    <FormCheckbox
                        name="word-wrap"
                        label={t("code_theme.word_wrapping")}
                        currentValue={codeLineWrapEnabled} onChange={setCodeLineWrapEnabled}
                    />
                </Column>
            </div>

            <CodeNotePreview wordWrapping={codeLineWrapEnabled} themeName={codeNoteTheme} />
        </OptionsSection>
    );
}

function CodeNotePreview({ themeName, wordWrapping }: { themeName: string, wordWrapping: boolean }) {
    const editorRef = useRef<CodeMirror>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) {
            return;
        }

        // Clean up previous instance.
        editorRef.current?.destroy();
        containerRef.current.innerHTML = "";

        // Set up a new instance.
        const editor = new CodeMirror({
            parent: containerRef.current
        });
        editor.setText(codeNoteSample);
        editor.setMimeType(SAMPLE_MIME);
        editorRef.current = editor;
    }, []);

    useEffect(() => {
        editorRef.current?.setLineWrapping(wordWrapping);
    }, [ wordWrapping ]);

    useEffect(() => {
        if (themeName?.startsWith(DEFAULT_PREFIX)) {
            const theme = getThemeById(themeName.substring(DEFAULT_PREFIX.length));
            if (theme) {
                editorRef.current?.setTheme(theme);
            }
        }
    }, [ themeName ]);

    return (
        <div
            ref={containerRef}
            class="note-detail-readonly-code-content"
            style={{ margin: 0, height: "200px" }}
        />
    );
}

function CodeMimeTypes() {
    return (
        <OptionsSection title={t("code_mime_types.title")}>
            <CodeMimeTypesList />
        </OptionsSection>
    )
}

type MimeTypeWithDisabled = MimeType & { disabled?: boolean };

export function CodeMimeTypesList() {
    const [ codeNotesMimeTypes, setCodeNotesMimeTypes ] = useTriliumOptionJson<string[]>("codeNotesMimeTypes");
    const groupedMimeTypes: Record<string, MimeType[]> = useMemo(() => {
        mime_types.loadMimeTypes();

        const ungroupedMimeTypes = Array.from(mime_types.getMimeTypes()) as MimeTypeWithDisabled[];
        const plainTextMimeType = ungroupedMimeTypes.shift();
        const result: Record<string, MimeType[]> = {};
        ungroupedMimeTypes.sort((a, b) => a.title.localeCompare(b.title));

        if (plainTextMimeType) {
            result[""] = [ plainTextMimeType ];
            plainTextMimeType.enabled = true;
            plainTextMimeType.disabled = true;
        }
        
        for (const mimeType of ungroupedMimeTypes) {
            const initial = mimeType.title.charAt(0).toUpperCase();
            if (!result[initial]) {
                result[initial] = [];
            }
            result[initial].push(mimeType);
        }
        return result;
    }, [ codeNotesMimeTypes ]);  

    return (
        <ul class="options-mime-types">
            {Object.entries(groupedMimeTypes).map(([ initial, mimeTypes ]) => (
                <section>
                    { initial && <h5>{initial}</h5> }
                    <CheckboxList
                        values={mimeTypes as MimeTypeWithDisabled[]}
                        keyProperty="mime" titleProperty="title" disabledProperty="disabled"
                        currentValue={codeNotesMimeTypes} onChange={setCodeNotesMimeTypes}
                        columnWidth="inherit"
                    />
                </section>
            ))}
        </ul>
    );
}