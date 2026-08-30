import "./code_notes.css";

import CodeMirror, { ColorThemes, getThemeById, type ThemeVariant } from "@triliumnext/codemirror";
import { useEffect, useMemo, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import FormSelect from "../../react/FormSelect";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useColorScheme, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import { CODE_THEME_DEFAULT_PREFIX as DEFAULT_PREFIX } from "../constants";
import { CodeMimeTypesList } from "./code_mime_types_list";
import OptionsPageHeader from "./components/OptionsPageHeader";
import ThemeModeSelector from "./components/ThemeModeSelector";
import codeNoteSample from "./samples/code_note.txt?raw";

const SAMPLE_MIME = "application/typescript";

export default function CodeNoteSettings() {
    const [codeLineWrapEnabled, setCodeLineWrapEnabled] = useTriliumOptionBool("codeLineWrapEnabled");
    const [codeNoteTabWidth] = useTriliumOption("codeNoteTabWidth");

    return (
        <>
            <OptionsPageHeader />
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
        <Card heading={t("code-editor-options.title")}>
            <OptionCardSection name="word-wrap" label={t("code_theme.word_wrapping")}>
                <FormToggle currentValue={wordWrapping} onChange={setWordWrapping} />
            </OptionCardSection>

            {/* Avoid using "code" in the name of numeric inputs to prevent KeepassXC from triggering. */}
            <OptionCardSection
                name="editor-tab-width"
                label={t("code-editor-options.tab_width")}
            >
                <FormTextBoxWithUnit
                    type="number" min={1} max={16} step={1}
                    unit={t("code-editor-options.tab_width_unit")}
                    currentValue={codeNoteTabWidth}
                    onChange={setCodeNoteTabWidth}
                    onBlur={setCodeNoteTabWidth}
                />
            </OptionCardSection>

            <OptionCardSection
                name="source-readonly-threshold"
                label={t("code_auto_read_only_size.label")}
                description={t("text_auto_read_only_size.description")}
            >
                <FormTextBoxWithUnit
                    type="number" min={0}
                    unit={t("text_auto_read_only_size.unit")}
                    currentValue={autoReadonlySize}
                    onBlur={setAutoReadonlySize}
                />
            </OptionCardSection>

            <OptionCardSection
                name="vim-keymap-enabled"
                label={t("vim_key_bindings.use_vim_keybindings_in_code_notes")}
                description={t("vim_key_bindings.enable_vim_keybindings")}
            >
                <FormToggle currentValue={vimKeymapEnabled} onChange={setVimKeymapEnabled} />
            </OptionCardSection>
        </Card>
    );
}

interface AppearanceProps {
    wordWrapping: boolean;
    indentSize: number;
}

function useFilteredThemes(variant?: ThemeVariant) {
    return useMemo(() => {
        return ColorThemes
            .filter((theme) => !variant || theme.variant === variant)
            .map(({ id, name }) => ({
                id: `default:${id}`,
                name
            }));
    }, [variant]);
}

function Appearance({ wordWrapping, indentSize }: AppearanceProps) {
    const [codeNoteTheme, setCodeNoteTheme] = useTriliumOption("codeNoteTheme");
    const [matchesApp, setMatchesApp] = useTriliumOptionBool("codeNoteThemeMatchesApp");
    const [lightTheme, setLightTheme] = useTriliumOption("codeNoteThemeLight");
    const [darkTheme, setDarkTheme] = useTriliumOption("codeNoteThemeDark");

    const colorScheme = useColorScheme();
    const allThemes = useFilteredThemes();
    const lightThemes = useFilteredThemes("light");
    const darkThemes = useFilteredThemes("dark");

    const effectiveTheme = matchesApp
        ? (colorScheme === "dark" ? darkTheme : lightTheme)
        : codeNoteTheme;

    return (
        <Card heading={t("code_theme.title")}>
            <ThemeModeSelector matchesApp={matchesApp} onMatchesAppChange={setMatchesApp} />

            {matchesApp ? (
                <>
                    <OptionCardSection name="light-theme" label={t("code_theme.light_theme")}>
                        <FormSelect
                            values={lightThemes}
                            keyProperty="id" titleProperty="name"
                            currentValue={lightTheme} onChange={setLightTheme}
                        />
                    </OptionCardSection>
                    <OptionCardSection name="dark-theme" label={t("code_theme.dark_theme")}>
                        <FormSelect
                            values={darkThemes}
                            keyProperty="id" titleProperty="name"
                            currentValue={darkTheme} onChange={setDarkTheme}
                        />
                    </OptionCardSection>
                </>
            ) : (
                <OptionCardSection name="color-scheme" label={t("code_theme.color-scheme")}>
                    <FormSelect
                        values={allThemes}
                        keyProperty="id" titleProperty="name"
                        currentValue={codeNoteTheme} onChange={setCodeNoteTheme}
                    />
                </OptionCardSection>
            )}

            {/* A specimen of the editor rather than a control standing beside a label, shown
                the way a code block is shown in a note. */}
            <CardSection className="code-note-preview" filterRole="companion">
                <CodeNotePreview wordWrapping={wordWrapping} themeName={effectiveTheme} indentSize={indentSize} />
            </CardSection>
        </Card>
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
        <div ref={containerRef} class="note-detail-readonly-code-content" />
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
        <Card heading={t("code_mime_types.title")}>
            <CardSection>
                <CodeMimeTypesList />
            </CardSection>
        </Card>
    );
}

