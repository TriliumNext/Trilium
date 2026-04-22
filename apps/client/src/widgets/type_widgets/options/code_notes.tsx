import "./code_notes.css";

import CodeMirror, { ColorThemes, getThemeById } from "@triliumnext/codemirror";
import { default as codeNoteMimeTypes } from "@triliumnext/codemirror/src/syntax_highlighting";
import { MimeType } from "@triliumnext/commons";
import { byMimeType as codeBlockMimeTypes } from "@triliumnext/highlightjs/src/syntax_highlighting";
import { useEffect, useMemo, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import mime_types from "../../../services/mime_types";
import FormSelect from "../../react/FormSelect";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import { useStaticTooltip, useTriliumOption, useTriliumOptionBool, useTriliumOptionJson } from "../../react/hooks";
import { CODE_THEME_DEFAULT_PREFIX as DEFAULT_PREFIX } from "../constants";
import CheckboxList from "./components/CheckboxList";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import codeNoteSample from "./samples/code_note.txt?raw";

const SAMPLE_MIME = "application/typescript";

export default function CodeNoteSettings() {
    const [codeLineWrapEnabled, setCodeLineWrapEnabled] = useTriliumOptionBool("codeLineWrapEnabled");
    const [codeNoteTabWidth] = useTriliumOption("codeNoteTabWidth");

    return (
        <>
            <Editor wordWrapping={codeLineWrapEnabled} setWordWrapping={setCodeLineWrapEnabled} />
            <Appearance wordWrapping={codeLineWrapEnabled} indentSize={parseInt(codeNoteTabWidth) || 4} />
            <CodeMimeTypes />
        </>
    );
}

interface EditorProps {
    wordWrapping: boolean;
    setWordWrapping: (newValue: boolean) => void;
}

function Editor({ wordWrapping, setWordWrapping }: EditorProps) {
    const [vimKeymapEnabled, setVimKeymapEnabled] = useTriliumOptionBool("vimKeymapEnabled");
    const [autoReadonlySize, setAutoReadonlySize] = useTriliumOption("autoReadonlySizeCode");
    const [codeNoteTabWidth, setCodeNoteTabWidth] = useTriliumOption("codeNoteTabWidth");

    return (
        <OptionsSection title={t("code-editor-options.title")}>
            <OptionsRowWithToggle
                name="word-wrap"
                label={t("code_theme.word_wrapping")}
                currentValue={wordWrapping}
                onChange={setWordWrapping}
            />

            {/* Avoid using "code" in the name of numeric inputs to prevent KeepassXC from triggering. */}
            <OptionsRow name="editor-tab-width" label={t("code-editor-options.tab_width")}>
                <FormTextBoxWithUnit
                    type="number" min={1} max={16} step={1}
                    unit={t("code-editor-options.tab_width_unit")}
                    currentValue={codeNoteTabWidth}
                    onChange={setCodeNoteTabWidth}
                    onBlur={setCodeNoteTabWidth}
                />
            </OptionsRow>

            <OptionsRow name="source-readonly-threshold" label={t("code_auto_read_only_size.label")} description={t("text_auto_read_only_size.description")}>
                <FormTextBoxWithUnit
                    type="number" min={0}
                    unit={t("text_auto_read_only_size.unit")}
                    currentValue={autoReadonlySize}
                    onBlur={setAutoReadonlySize}
                />
            </OptionsRow>

            <OptionsRowWithToggle
                name="vim-keymap-enabled"
                label={t("vim_key_bindings.use_vim_keybindings_in_code_notes")}
                description={t("vim_key_bindings.enable_vim_keybindings")}
                currentValue={vimKeymapEnabled}
                onChange={setVimKeymapEnabled}
            />
        </OptionsSection>
    );
}

interface AppearanceProps {
    wordWrapping: boolean;
    indentSize: number;
}

function Appearance({ wordWrapping, indentSize }: AppearanceProps) {
    const [codeNoteTheme, setCodeNoteTheme] = useTriliumOption("codeNoteTheme");

    const themes = useMemo(() => {
        return ColorThemes.map(({ id, name }) => ({
            id: `default:${id}`,
            name
        }));
    }, []);

    return (
        <OptionsSection title={t("code_theme.title")}>
            <OptionsRow name="color-scheme" label={t("code_theme.color-scheme")}>
                <FormSelect
                    values={themes}
                    keyProperty="id" titleProperty="name"
                    currentValue={codeNoteTheme} onChange={setCodeNoteTheme}
                />
            </OptionsRow>

            <CodeNotePreview wordWrapping={wordWrapping} themeName={codeNoteTheme} indentSize={indentSize} />
        </OptionsSection>
    );
}

function CodeNotePreview({ themeName, wordWrapping, indentSize }: { themeName: string, wordWrapping: boolean, indentSize: number }) {
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
        const editor = editorRef.current;
        if (!editor) return;
        editor.setIndentSize(indentSize);
        editor.setText(reindentSample(codeNoteSample, indentSize));
    }, [ indentSize ]);

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

const SAMPLE_BASE_INDENT = 4;

function reindentSample(sample: string, indentSize: number): string {
    return sample.replace(/^( +)/gm, (match) => {
        const level = match.length / SAMPLE_BASE_INDENT;
        return " ".repeat(Math.round(level) * indentSize);
    });
}

function CodeMimeTypes() {
    return (
        <OptionsSection title={t("code_mime_types.title")}>
            <CodeMimeTypesList />
        </OptionsSection>
    );
}

type MimeTypeWithDisabled = MimeType & { disabled?: boolean };

export function CodeMimeTypesList() {
    const containerRef = useRef<HTMLUListElement>(null);
    useStaticTooltip(containerRef, {
        title() {
            const mime = this.querySelector("input")?.value;
            if (!mime || mime === "text/plain") return "";

            const hasCodeBlockSyntax = !!codeBlockMimeTypes[mime];
            const hasCodeNoteSyntax = !!codeNoteMimeTypes[mime];

            return `
                <strong>${t("code_mime_types.tooltip_syntax_highlighting")}</strong><br/>
                ${hasCodeBlockSyntax ? "✅" : "❌"} ${t("code_mime_types.tooltip_code_block_syntax")}<br/>
                ${hasCodeNoteSyntax ? "✅" : "❌"} ${t("code_mime_types.tooltip_code_note_syntax")}
            `;
        },
        selector: "label",
        customClass: "tooltip-top",
        placement: "left",
        fallbackPlacements: [ "left", "right" ],
        animation: false,
        html: true
    });
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
        <ul class="options-mime-types" ref={containerRef}>
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
