import "./text_notes.css";

import { normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { getThemeVariant, Themes } from "@triliumnext/highlightjs";
import type { CSSProperties } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { isExperimentalFeatureEnabled } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import { ensureMimeTypesForHighlighting, loadHighlightingTheme } from "../../../services/syntax_highlight";
import { formatDateTime, toggleBodyClass } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import Dropdown from "../../react/Dropdown";
import FormGroup from "../../react/FormGroup";
import { FormListItem } from "../../react/FormList";
import FormSelect, { FormSelectGroup, FormSelectWithGroups } from "../../react/FormSelect";
import FormText from "../../react/FormText";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useColorScheme, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import { getHtml } from "../../react/RawHtml";
import { QUOTE_MARK_PRESETS } from "../text/quotes";
import { type CustomReplacement, parseCustomReplacements } from "../text/replacements";
import OptionsPageHeader from "./components/OptionsPageHeader";
import RadioWithIllustration from "./components/RadioWithIllustration";
import RelatedSettings from "./components/RelatedSettings";
import ThemeModeSelector from "./components/ThemeModeSelector";
import { HighlightsListOptions } from "./highlights_list_options";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

export default function TextNoteSettings() {
    return (
        <>
            <OptionsPageHeader />
            <ToolbarStyle />
            <FormattingToolbar />
            <EditorFeatures />
            <AutomaticReplacements />
            <Editor />
            <CodeBlockStyle />
            <TableOfContent />
            <HighlightsList />
            <RelatedSettings items={[
                {
                    title: t("text_editor.related_task_states"),
                    targetNoteId: "_taskStates"
                }
            ]} />
        </>
    );
}

function FormattingToolbar() {
    const [ textNoteEditorType ] = useTriliumOption("textNoteEditorType");
    const [ textNoteEditorMultilineToolbar, setTextNoteEditorMultilineToolbar ] = useTriliumOptionBool("textNoteEditorMultilineToolbar");

    return (
        <Card heading={t("editing.editor_type.label")}>
            <OptionCardSection
                name="multiline-toolbar"
                label={t("editing.editor_type.multiline-toolbar")}
            >
                <FormToggle
                    currentValue={textNoteEditorMultilineToolbar}
                    onChange={setTextNoteEditorMultilineToolbar}
                    // Nothing to wrap onto a second line where the toolbar follows the cursor.
                    disabled={textNoteEditorType === "ckeditor-balloon"}
                />
            </OptionCardSection>
        </Card>
    );
}

/**
 * Where the editing tools are kept, shown as a picture of each rather than named in words. Given a
 * card of its own for the same reason the layout choices have one: an illustrated choice is too large
 * to stand as a value beside a label, so what it is called becomes the card's heading.
 */
function ToolbarStyle() {
    const [ textNoteEditorType, setTextNoteEditorType ] = useTriliumOption("textNoteEditorType");

    return (
        <Card className="thumbnail-selector-option-card" heading={t("editing.editor_type.toolbar_style")}>
            <CardSection>
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
            </CardSection>
        </Card>
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
    const [contentHintsEnabled, setContentHintsEnabled] = useTriliumOptionBool("textNoteContentHintsEnabled");
    const [autoLinkPreviewsEnabled, setAutoLinkPreviewsEnabled] = useTriliumOptionBool("textNoteAutoLinkPreviewsEnabled");
    const [htmlSupportEnabled, setHtmlSupportEnabled] = useTriliumOptionBool("textNoteHtmlSupportEnabled");

    return (
        <Card heading={t("editorfeatures.title")}>
            <OptionCardSection
                name="emoji-completion-enabled"
                label={t("editorfeatures.emoji_completion_enabled")}
                description={t("editorfeatures.emoji_completion_description")}
            >
                <FormToggle currentValue={emojiCompletionEnabled} onChange={setEmojiCompletionEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="auto-link-previews-enabled"
                label={t("editorfeatures.auto_link_previews_enabled")}
                description={t("editorfeatures.auto_link_previews_description")}
            >
                <FormToggle currentValue={autoLinkPreviewsEnabled} onChange={setAutoLinkPreviewsEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="note-completion-enabled"
                label={t("editorfeatures.note_completion_enabled")}
                description={t("editorfeatures.note_completion_description")}
            >
                <FormToggle currentValue={noteCompletionEnabled} onChange={setNoteCompletionEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="slash-commands-enabled"
                label={t("editorfeatures.slash_commands_enabled")}
                description={t("editorfeatures.slash_commands_description")}
            >
                <FormToggle currentValue={slashCommandsEnabled} onChange={setSlashCommandsEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="content-hints-enabled"
                label={t("editorfeatures.content_hints_enabled")}
                description={t("editorfeatures.content_hints_description")}
            >
                <FormToggle currentValue={contentHintsEnabled} onChange={setContentHintsEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="html-support-enabled"
                label={t("editorfeatures.html_support_enabled")}
                description={t("editorfeatures.html_support_description")}
            >
                <FormToggle currentValue={htmlSupportEnabled} onChange={setHtmlSupportEnabled} />
            </OptionCardSection>
        </Card>
    );
}

/**
 * The as-you-type replacements, grouped the way CKEditor groups them. Each description names what
 * the group actually does to your text: the complaints these settings answer were as much about the
 * behaviour being undocumented as about it being unwanted, so the examples are the point.
 */
function AutomaticReplacements() {
    const [doubleQuoteStyle, setDoubleQuoteStyle] = useTriliumOption("textNoteDoubleQuoteStyle");
    const [singleQuoteStyle, setSingleQuoteStyle] = useTriliumOption("textNoteSingleQuoteStyle");
    const [punctuationEnabled, setPunctuationEnabled] = useTriliumOptionBool("textNotePunctuationReplacementsEnabled");
    const [mathEnabled, setMathEnabled] = useTriliumOptionBool("textNoteMathReplacementsEnabled");
    const [symbolsEnabled, setSymbolsEnabled] = useTriliumOptionBool("textNoteSymbolReplacementsEnabled");

    return (
        <Card className="text-notes-replacements"
            heading={t("automatic_replacements.title")}
            description={t("automatic_replacements.description")}
        >
            <OptionCardSection
                name="double-quote-style"
                label={t("automatic_replacements.double_quotes")}
                description={t("automatic_replacements.double_quotes_description")}
            >
                <QuoteStyleSelect currentValue={doubleQuoteStyle} onChange={setDoubleQuoteStyle} />
            </OptionCardSection>

            <OptionCardSection
                name="single-quote-style"
                label={t("automatic_replacements.single_quotes")}
                description={t("automatic_replacements.single_quotes_description")}
            >
                <QuoteStyleSelect currentValue={singleQuoteStyle} onChange={setSingleQuoteStyle} />
            </OptionCardSection>

            <OptionCardSection
                name="punctuation-replacements-enabled"
                label={t("automatic_replacements.punctuation")}
                description={t("automatic_replacements.punctuation_description")}
            >
                <FormToggle currentValue={punctuationEnabled} onChange={setPunctuationEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="math-replacements-enabled"
                label={t("automatic_replacements.math")}
                description={t("automatic_replacements.math_description")}
            >
                <FormToggle currentValue={mathEnabled} onChange={setMathEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="symbol-replacements-enabled"
                label={t("automatic_replacements.symbols")}
                description={t("automatic_replacements.symbols_description")}
            >
                <FormToggle currentValue={symbolsEnabled} onChange={setSymbolsEnabled} />
            </OptionCardSection>

            <CustomReplacements />
        </Card>
    );
}

/**
 * The choice offered for one of the two quote keys. The same list serves both: which pair belongs on
 * which key is a convention rather than a property of the marks, and the conventions disagree —
 * British typography puts `‘…’` where American puts `“…”`.
 */
function QuoteStyleSelect({ currentValue, onChange }: { currentValue: string, onChange: (newValue: string) => void }) {
    return (
        <FormSelect
            currentValue={currentValue || "auto"}
            onChange={onChange}
            keyProperty="value" titleProperty="label"
            values={[
                { value: "auto", label: t("automatic_replacements.quotes_auto") },
                { value: "off", label: t("automatic_replacements.quotes_off") },
                // The marks are their own label — no wording to translate, and nothing between the
                // choice and what it produces.
                ...QUOTE_MARK_PRESETS.map(({ id, marks }) => ({
                    value: id,
                    label: `${marks[0]}…${marks[1]}`
                }))
            ]}
        />
    );
}

/**
 * The user's own replacements: one nested segment per pair already held, and a last segment holding
 * the boxes the next one is typed into.
 *
 * Nothing is copied into local state but the pair being typed. What is held *is* the option, read
 * back on every render, so a list arriving from another device or a second settings tab is simply
 * what is drawn next — there is no second copy to fall behind it, and none to be written back over
 * it. The rows this replaced needed a guard for each of those; a set that is added to and removed
 * from rather than edited in place has neither problem to guard against.
 *
 * A pair cannot be edited once taken. Typing a `from` already held replaces that entry instead of
 * adding a second one, which gives the editing back without an affordance for it — and a second
 * entry under the same `from` would in any case be dead weight, since the first match is the one
 * that fires.
 */
export function CustomReplacements() {
    const [ storedJson, setStoredJson ] = useTriliumOption("textNoteCustomReplacements");
    const replacements = parseCustomReplacements(storedJson);

    const [ draftFrom, setDraftFrom ] = useState("");
    const [ draftTo, setDraftTo ] = useState("");
    const fromRef = useRef<HTMLInputElement>(null);
    const entryRef = useRef<HTMLDivElement>(null);

    const isComplete = draftFrom.trim().length > 0 && draftTo.trim().length > 0;

    function save(next: CustomReplacement[]) {
        void setStoredJson(JSON.stringify(next.map(({ from, to }) => ({ from, to }))));
    }

    function take() {
        const from = draftFrom.trim();
        const to = draftTo.trim();
        if (!from || !to) return;

        // Matching ignores case, so what counts as the same shortcut has to as well — otherwise
        // `TN` and `tn` would sit there as two entries of which only the first could ever fire.
        const kept = replacements.filter((replacement) => replacement.from.toLowerCase() !== from.toLowerCase());
        save([ ...kept, { from, to } ]);

        setDraftFrom("");
        setDraftTo("");
        fromRef.current?.focus();
    }

    return (
        <OptionCardSection
            className="custom-replacements"
            label={t("automatic_replacements.custom")}
            description={t("automatic_replacements.custom_description")}
            subSectionsVisible
            subSections={[
                ...replacements.map((replacement) => (
                    <CardSection key={replacement.from} className="custom-replacement">
                        <span className="custom-replacement-pair">{replacement.from} → {replacement.to}</span>
                        <ActionButton
                            className="custom-replacement-remove"
                            icon="bx bx-x"
                            text={t("automatic_replacements.custom_remove")}
                            onClick={() => save(replacements.filter((held) => held.from !== replacement.from))}
                        />
                    </CardSection>
                )),

                <CardSection key="entry" className="custom-replacement">
                    {/* The two boxes and the button asking for what they hold are one thing on the
                        page, so the focus is watched over the group rather than over each box. */}
                    <div
                        className="custom-replacement-entry"
                        ref={entryRef}
                        onFocusOut={(e) => {
                            // Moving between the two boxes is not leaving the pair. Only a complete
                            // one is taken on the way out: half of a replacement is not a
                            // replacement, and storing it would put an entry in the set that could
                            // never fire.
                            if (e.relatedTarget instanceof Node && entryRef.current?.contains(e.relatedTarget)) return;
                            if (isComplete) take();
                        }}
                    >
                        <FormTextBox
                            inputRef={fromRef}
                            currentValue={draftFrom}
                            placeholder={t("automatic_replacements.custom_from_placeholder")}
                            onChange={setDraftFrom}
                            onKeyDown={(e) => e.key === "Enter" && take()}
                        />
                        <span className="custom-replacement-arrow" aria-hidden="true">→</span>
                        <FormTextBox
                            currentValue={draftTo}
                            placeholder={t("automatic_replacements.custom_to_placeholder")}
                            onChange={setDraftTo}
                            onKeyDown={(e) => e.key === "Enter" && take()}
                        />

                        {/* Enter takes the pair, but nothing on the page says so — so once there is
                            a whole one to take, the same offer appears where it can be seen. */}
                        {isComplete && (
                            <ActionButton
                                className="custom-replacement-add"
                                icon="bx bx-plus"
                                text={t("automatic_replacements.custom_add")}
                                onClick={take}
                            />
                        )}
                    </div>
                </CardSection>
            ]}
        />
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
        <Card className="text-notes-editor" heading={t("text_editor.title")}>
            <OptionCardSection
                name="heading-style"
                label={t("heading_style.title")}
                description={t("heading_style.description")}
            >
                <HeadingStyleSelector currentValue={headingStyle} onChange={setHeadingStyle} />
            </OptionCardSection>

            <OptionCardSection
                name="auto-readonly-size-text"
                label={t("text_auto_read_only_size.label")}
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
                name="custom-date-time-format"
                label={t("custom_date_time_format.title")}
                description={<>{t("custom_date_time_format.description_short")} {t("custom_date_time_format.preview", { preview: formatDateTime(new Date(), customDateTimeFormat) })}</>}
            >
                <FormTextBox
                    placeholder="YYYY-MM-DD HH:mm"
                    currentValue={customDateTimeFormat || "YYYY-MM-DD HH:mm"} onBlur={setCustomDateTimeFormat}
                />
            </OptionCardSection>
        </Card>
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
        <Dropdown
            text={t(currentStyle.labelKey)} mobileBottomSheet
            // The options card is a container, and so a backdrop root: left inside it the menu
            // loses its blur and reads as a flat tint.
            portalToBody
        >
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

function useCodeBlockThemes() {
    const allThemes = useMemo(() => {
        const darkThemes: ThemeData[] = [];
        const lightThemes: ThemeData[] = [];

        for (const [ id, theme ] of Object.entries(Themes)) {
            const data: ThemeData = {
                val: `default:${id}`,
                title: theme.name
            };

            if (getThemeVariant(theme) === "dark") {
                darkThemes.push(data);
            } else {
                lightThemes.push(data);
            }
        }

        return { lightThemes, darkThemes };
    }, []);

    const groupedThemes = useMemo((): FormSelectGroup<ThemeData>[] => [
        {
            title: "",
            items: [{
                val: "none",
                title: t("code_block.theme_none")
            }]
        },
        {
            title: t("code_block.theme_group_light"),
            items: allThemes.lightThemes
        },
        {
            title: t("code_block.theme_group_dark"),
            items: allThemes.darkThemes
        }
    ], [allThemes]);

    return { groupedThemes, lightThemes: allThemes.lightThemes, darkThemes: allThemes.darkThemes };
}

function CodeBlockStyle() {
    const { groupedThemes, lightThemes, darkThemes } = useCodeBlockThemes();
    const [ codeBlockTheme, setCodeBlockTheme ] = useTriliumOption("codeBlockTheme");
    const [ matchesApp, setMatchesApp ] = useTriliumOptionBool("codeBlockThemeMatchesApp");
    const [ lightTheme, setLightTheme ] = useTriliumOption("codeBlockThemeLight");
    const [ darkTheme, setDarkTheme ] = useTriliumOption("codeBlockThemeDark");
    const [ codeBlockWordWrap, setCodeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
    const [ codeBlockTabWidth, setCodeBlockTabWidth ] = useTriliumOption("codeBlockTabWidth");
    const colorScheme = useColorScheme();

    const effectiveTheme = matchesApp
        ? (colorScheme === "dark" ? darkTheme : lightTheme)
        : codeBlockTheme;

    useEffect(() => {
        loadHighlightingTheme(effectiveTheme);
    }, [effectiveTheme]);

    return (
        <Card heading={t("highlighting.title")}>
            <ThemeModeSelector matchesApp={matchesApp} onMatchesAppChange={setMatchesApp} />

            {matchesApp ? (
                <>
                    <OptionCardSection name="light-theme" label={t("code_theme.light_theme")}>
                        <FormSelect
                            values={lightThemes}
                            keyProperty="val" titleProperty="title"
                            currentValue={lightTheme} onChange={setLightTheme}
                        />
                    </OptionCardSection>
                    <OptionCardSection name="dark-theme" label={t("code_theme.dark_theme")}>
                        <FormSelect
                            values={darkThemes}
                            keyProperty="val" titleProperty="title"
                            currentValue={darkTheme} onChange={setDarkTheme}
                        />
                    </OptionCardSection>
                </>
            ) : (
                <OptionCardSection name="code-block-theme" label={t("highlighting.color-scheme")}>
                    <FormSelectWithGroups
                        values={groupedThemes}
                        keyProperty="val" titleProperty="title"
                        currentValue={codeBlockTheme} onChange={setCodeBlockTheme}
                    />
                </OptionCardSection>
            )}

            <OptionCardSection name="code-block-word-wrap" label={t("code_block.word_wrapping")}>
                <FormToggle currentValue={codeBlockWordWrap} onChange={setCodeBlockWordWrap} />
            </OptionCardSection>

            {/* Avoid using "code" in the name of numeric inputs to prevent KeepassXC from triggering. */}
            <OptionCardSection name="block-tab-width" label={t("code_block.tab_width")}>
                <FormTextBoxWithUnit
                    type="number" min={1} max={16} step={1}
                    unit={t("code_block.tab_width_unit")}
                    currentValue={codeBlockTabWidth}
                    onChange={setCodeBlockTabWidth}
                    onBlur={setCodeBlockTabWidth}
                />
            </OptionCardSection>

            <CardSection className="code-block-preview" filterRole="companion">
                <CodeBlockPreview theme={effectiveTheme} wordWrap={codeBlockWordWrap} tabWidth={codeBlockTabWidth} />
            </CardSection>
        </Card>
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
        <Card className="text-notes-toc"
            heading={t("table_of_contents.title")}
            description={t("table_of_contents.description")}
        >
            <CardSection>
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
            </CardSection>
        </Card>
    );
}

function HighlightsList() {
    return (
        <>
            <Card heading={t("highlights_list.title")}>
                <CardSection>
                    <HighlightsListOptions />
                </CardSection>
            </Card>

            {/* Its own card rather than a heading inside the one above: what the list is made of and
                where it is shown are two subjects, and a card heading is what tells them apart. */}
            {!isNewLayout && (
                <Card heading={t("highlights_list.visibility_title")}>
                    <CardSection>
                        <FormText>{t("highlights_list.visibility_description")}</FormText>
                        <FormText>{t("highlights_list.shortcut_info")}</FormText>
                    </CardSection>
                </Card>
            )}
        </>
    );
}
