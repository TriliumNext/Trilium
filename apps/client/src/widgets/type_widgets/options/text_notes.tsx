import "./text_notes.css";

import { normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { Themes } from "@triliumnext/highlightjs";
import type { CSSProperties } from "preact/compat";
import { useEffect, useMemo, useState } from "preact/hooks";

import { isExperimentalFeatureEnabled } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import { ensureMimeTypesForHighlighting, loadHighlightingTheme } from "../../../services/syntax_highlight";
import { formatDateTime, toggleBodyClass } from "../../../services/utils";
import FormGroup from "../../react/FormGroup";
import Dropdown from "../../react/Dropdown";
import { FormListItem } from "../../react/FormList";
import { FormSelectGroup, FormSelectWithGroups } from "../../react/FormSelect";
import FormText from "../../react/FormText";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool, useTriliumOptionJson } from "../../react/hooks";
import { getHtml } from "../../react/RawHtml";
import CheckboxList from "./components/CheckboxList";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import RadioWithIllustration from "./components/RadioWithIllustration";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

export default function TextNoteSettings() {
    return (
        <>
            <FormattingToolbar />
            <EditorFeatures />
            <Editor />
            <CodeBlockStyle />
            <TableOfContent />
            <HighlightsList />
        </>
    );
}

function FormattingToolbar() {
    const [ textNoteEditorType, setTextNoteEditorType ] = useTriliumOption("textNoteEditorType", true);
    const [ textNoteEditorMultilineToolbar, setTextNoteEditorMultilineToolbar ] = useTriliumOptionBool("textNoteEditorMultilineToolbar", true);

    return (
        <OptionsSection title={t("editing.editor_type.label")}>
            <OptionsRow name="editor-type" label={t("editing.editor_type.toolbar_style")}>
                <RadioWithIllustration
                    currentValue={textNoteEditorType}
                    onChange={setTextNoteEditorType}
                    values={[
                        {
                            key: "ckeditor-balloon",
                            text: t("editing.editor_type.floating.title"),
                            illustration: <ToolbarIllustration type="floating" />
                        },
                        {
                            key: "ckeditor-classic",
                            text: t("editing.editor_type.fixed.title"),
                            illustration: <ToolbarIllustration type="fixed" />
                        }
                    ]}
                />
            </OptionsRow>

            <OptionsRowWithToggle
                name="multiline-toolbar"
                label={t("editing.editor_type.multiline-toolbar")}
                currentValue={textNoteEditorMultilineToolbar}
                onChange={setTextNoteEditorMultilineToolbar}
                disabled={textNoteEditorType === "ckeditor-balloon"}
            />
        </OptionsSection>
    );
}

function ToolbarIllustration({ type }: { type: "floating" | "fixed" }) {
    return (
        <div className="toolbar-illustration">
            {type === "fixed" && (
                <div className="toolbar-bar">
                    <ToolbarIcon />
                    <ToolbarIcon />
                    <ToolbarIcon />
                    <ToolbarIcon wide />
                    <ToolbarIcon />
                    <ToolbarIcon />
                </div>
            )}

            <div className="document-area">
                <div className="text-line" style={{ width: "90%" }} />
                <div className="text-line" style={{ width: "75%" }} />
                <div className="text-line-with-selection">
                    <span className="text-segment" style={{ width: "20%" }} />
                    <span className="text-selection" />
                    <span className="text-segment" style={{ width: "35%" }} />
                </div>
                <div className="text-line" style={{ width: "85%" }} />
                <div className="text-line" style={{ width: "60%" }} />
            </div>

            {type === "floating" && (
                <div className="floating-toolbar">
                    <ToolbarIcon />
                    <ToolbarIcon />
                    <ToolbarIcon />
                    <ToolbarIcon />
                </div>
            )}
        </div>
    );
}

function ToolbarIcon({ wide }: { wide?: boolean }) {
    return <div className={`toolbar-icon${wide ? " wide" : ""}`} />;
}

function EditorFeatures() {
    const [emojiCompletionEnabled, setEmojiCompletionEnabled] = useTriliumOptionBool("textNoteEmojiCompletionEnabled");
    const [noteCompletionEnabled, setNoteCompletionEnabled] = useTriliumOptionBool("textNoteCompletionEnabled");
    const [slashCommandsEnabled, setSlashCommandsEnabled] = useTriliumOptionBool("textNoteSlashCommandsEnabled");

    return (
        <OptionsSection title={t("editorfeatures.title")}>
            <OptionsRowWithToggle
                name="emoji-completion-enabled"
                label={t("editorfeatures.emoji_completion_enabled")}
                description={t("editorfeatures.emoji_completion_description")}
                currentValue={emojiCompletionEnabled}
                onChange={setEmojiCompletionEnabled}
            />

            <OptionsRowWithToggle
                name="note-completion-enabled"
                label={t("editorfeatures.note_completion_enabled")}
                description={t("editorfeatures.note_completion_description")}
                currentValue={noteCompletionEnabled}
                onChange={setNoteCompletionEnabled}
            />

            <OptionsRowWithToggle
                name="slash-commands-enabled"
                label={t("editorfeatures.slash_commands_enabled")}
                description={t("editorfeatures.slash_commands_description")}
                currentValue={slashCommandsEnabled}
                onChange={setSlashCommandsEnabled}
            />
        </OptionsSection>
    );
}

function Editor() {
    const [headingStyle, setHeadingStyle] = useTriliumOption("headingStyle");
    const [autoReadonlySize, setAutoReadonlySize] = useTriliumOption("autoReadonlySizeText");
    const [customDateTimeFormat, setCustomDateTimeFormat] = useTriliumOption("customDateTimeFormat");

    useEffect(() => {
        toggleBodyClass("heading-style-", headingStyle);
    }, [headingStyle]);

    return (
        <OptionsSection title={t("text_editor.title")}>
            <OptionsRow name="heading-style" label={t("heading_style.title")} description={t("heading_style.description")}>
                <HeadingStyleSelector currentValue={headingStyle} onChange={setHeadingStyle} />
            </OptionsRow>

            <OptionsRow name="auto-readonly-size-text" label={t("text_auto_read_only_size.label")} description={t("text_auto_read_only_size.description")}>
                <FormTextBoxWithUnit
                    type="number" min={0}
                    unit={t("text_auto_read_only_size.unit")}
                    currentValue={autoReadonlySize}
                    onBlur={setAutoReadonlySize}
                />
            </OptionsRow>

            <OptionsRow
                name="custom-date-time-format"
                label={t("custom_date_time_format.title")}
                description={<>{t("custom_date_time_format.description_short")} {t("custom_date_time_format.preview", { preview: formatDateTime(new Date(), customDateTimeFormat) })}</>}
            >
                <FormTextBox
                    placeholder="YYYY-MM-DD HH:mm"
                    currentValue={customDateTimeFormat || "YYYY-MM-DD HH:mm"} onBlur={setCustomDateTimeFormat}
                />
            </OptionsRow>
        </OptionsSection>
    );
}

const HEADING_STYLES = [
    { value: "plain", labelKey: "heading_style.plain" },
    { value: "underline", labelKey: "heading_style.underline" },
    { value: "markdown", labelKey: "heading_style.markdown" }
] as const;

function HeadingStyleSelector({ currentValue, onChange }: { currentValue: string, onChange: (value: string) => void }) {
    const currentStyle = HEADING_STYLES.find(s => s.value === currentValue) ?? HEADING_STYLES[0];

    return (
        <Dropdown text={t(currentStyle.labelKey)}>
            {HEADING_STYLES.map(({ value, labelKey }) => (
                <FormListItem
                    key={value}
                    onClick={() => onChange(value)}
                    selected={currentValue === value}
                >
                    <div className="heading-style-preview">
                        <HeadingPreview style={value} />
                        <span className="heading-style-label">{t(labelKey)}</span>
                    </div>
                </FormListItem>
            ))}
        </Dropdown>
    );
}

function HeadingPreview({ style }: { style: string }) {
    const previewClass = `heading-preview heading-preview-${style}`;
    return (
        <span className={previewClass}>
            {style === "markdown" && <span className="heading-prefix">## </span>}
            Aa
            {style === "underline" && <span className="heading-underline" />}
        </span>
    );
}

function CodeBlockStyle() {
    const themes = useMemo(() => {
        const darkThemes: ThemeData[] = [];
        const lightThemes: ThemeData[] = [];

        for (const [ id, theme ] of Object.entries(Themes)) {
            const data: ThemeData = {
                val: `default:${  id}`,
                title: theme.name
            };

            if (theme.name.includes("Dark")) {
                darkThemes.push(data);
            } else {
                lightThemes.push(data);
            }
        }

        const output: FormSelectGroup<ThemeData>[] = [
            {
                title: "",
                items: [{
                    val: "none",
                    title: t("code_block.theme_none")
                }]
            },
            {
                title: t("code_block.theme_group_light"),
                items: lightThemes
            },
            {
                title: t("code_block.theme_group_dark"),
                items: darkThemes
            }
        ];
        return output;
    }, []);
    const [ codeBlockTheme, setCodeBlockTheme ] = useTriliumOption("codeBlockTheme");
    const [ codeBlockWordWrap, setCodeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
    const [ codeBlockTabWidth, setCodeBlockTabWidth ] = useTriliumOption("codeBlockTabWidth");

    return (
        <OptionsSection title={t("highlighting.title")}>
            <OptionsRow name="code-block-theme" label={t("highlighting.color-scheme")}>
                <FormSelectWithGroups
                    values={themes}
                    keyProperty="val" titleProperty="title"
                    currentValue={codeBlockTheme} onChange={(newTheme) => {
                        loadHighlightingTheme(newTheme);
                        setCodeBlockTheme(newTheme);
                    }}
                />
            </OptionsRow>

            <OptionsRowWithToggle
                name="code-block-word-wrap"
                label={t("code_block.word_wrapping")}
                currentValue={codeBlockWordWrap}
                onChange={setCodeBlockWordWrap}
            />

            {/* Avoid using "code" in the name of numeric inputs to prevent KeepassXC from triggering. */}
            <OptionsRow name="block-tab-width" label={t("code_block.tab_width")}>
                <FormTextBoxWithUnit
                    type="number" min={1} max={16} step={1}
                    unit={t("code_block.tab_width_unit")}
                    currentValue={codeBlockTabWidth}
                    onChange={setCodeBlockTabWidth}
                    onBlur={setCodeBlockTabWidth}
                />
            </OptionsRow>

            <CodeBlockPreview theme={codeBlockTheme} wordWrap={codeBlockWordWrap} tabWidth={codeBlockTabWidth} />
        </OptionsSection>
    );
}

const SAMPLE_LANGUAGE = normalizeMimeTypeForCKEditor("application/javascript;env=frontend");
const SAMPLE_CODE = `\
const n = 10;
greet(n); // Print "Hello World" for n times

/**
 * Displays a "Hello World!" message for a given amount of times, on the standard console. The "Hello World!" text will be displayed once per line.
 *
 * @param {number} times    The number of times to print the \`Hello World!\` message.
 */
function greet(times) {
\tfor (let i = 0; i++; i < times) {
\t\tconsole.log("Hello World!");
\t}
}
`;

function CodeBlockPreview({ theme, wordWrap, tabWidth }: { theme: string, wordWrap: boolean, tabWidth: string }) {
    const [ code, setCode ] = useState<string>(SAMPLE_CODE);

    useEffect(() => {
        if (theme !== "none") {
            import("@triliumnext/highlightjs").then(async (hljs) => {
                await ensureMimeTypesForHighlighting();
                const highlightedText = hljs.highlight(SAMPLE_CODE, {
                    language: SAMPLE_LANGUAGE
                });
                if (highlightedText) {
                    setCode(highlightedText.value);
                }
            });
        } else {
            setCode(SAMPLE_CODE);
        }
    }, [theme]);

    const codeStyle: CSSProperties = useMemo(() => {
        return {
            whiteSpace: wordWrap ? "pre-wrap" : "pre",
            tabSize: tabWidth || "4"
        };
    }, [ wordWrap, tabWidth ]);

    return (
        <div className="note-detail-readonly-text-content ck-content code-sample-wrapper">
            <pre className="hljs selectable-text" style={{ marginBottom: 0 }}>
                <code className="code-sample" style={codeStyle} dangerouslySetInnerHTML={getHtml(code)} />
            </pre>
        </div>
    );
}

interface ThemeData {
    val: string;
    title: string;
}

function TableOfContent() {
    const [ minTocHeadings, setMinTocHeadings ] = useTriliumOption("minTocHeadings");

    return (!isNewLayout &&
        <OptionsSection title={t("table_of_contents.title")}>
            <FormText>{t("table_of_contents.description")}</FormText>

            <FormGroup name="min-toc-headings">
                <FormTextBoxWithUnit
                    type="number"
                    min={0} max={999999999999999} step={1}
                    unit={t("table_of_contents.unit")}
                    currentValue={minTocHeadings} onChange={setMinTocHeadings}
                />
            </FormGroup>

            <FormText>{t("table_of_contents.disable_info")}</FormText>
            <FormText>{t("table_of_contents.shortcut_info")}</FormText>
        </OptionsSection>
    );
}

function HighlightsList() {
    return (
        <OptionsSection title={t("highlights_list.title")}>
            <HighlightsListOptions />

            {!isNewLayout && (
                <>
                    <hr />
                    <h5>{t("highlights_list.visibility_title")}</h5>
                    <FormText>{t("highlights_list.visibility_description")}</FormText>
                    <FormText>{t("highlights_list.shortcut_info")}</FormText>
                </>
            )}
        </OptionsSection>
    );
}

export function HighlightsListOptions() {
    const [ highlightsList, setHighlightsList ] = useTriliumOptionJson<string[]>("highlightsList");

    return (
        <>
            <FormText>{t("highlights_list.description")}</FormText>
            <CheckboxList
                values={[
                    { val: "bold", title: t("highlights_list.bold") },
                    { val: "italic", title: t("highlights_list.italic") },
                    { val: "underline", title: t("highlights_list.underline") },
                    { val: "color", title: t("highlights_list.color") },
                    { val: "bgColor", title: t("highlights_list.bg_color") }
                ]}
                keyProperty="val" titleProperty="title"
                currentValue={highlightsList} onChange={setHighlightsList}
            />
        </>
    );
}
