import "./appearance.css";

import { FontFamily, OptionNames } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { isElectron, isMobile, reloadFrontendApp, restartDesktopApp } from "../../../services/utils";
import { VerticalLayoutIcon } from "../../buttons/global_menu";
import Button from "../../react/Button";
import Column from "../../react/Column";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import FormRadioGroup from "../../react/FormRadioGroup";
import FormSelect, { FormSelectWithGroups } from "../../react/FormSelect";
import FormText from "../../react/FormText";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Icon from "../../react/Icon";
import OptionsSection from "./components/OptionsSection";
import RadioWithIllustration from "./components/RadioWithIllustration";
import RelatedSettings from "./components/RelatedSettings";

const MIN_CONTENT_WIDTH = 640;

interface Theme {
    val: string;
    title: string;
    noteId?: string;
}

const BUILTIN_THEMES: Theme[] = [
    { val: "next", title: t("theme.triliumnext") },
    { val: "next-light", title: t("theme.triliumnext-light") },
    { val: "next-dark", title: t("theme.triliumnext-dark") },
    { val: "auto", title: t("theme.auto_theme") },
    { val: "light", title: t("theme.light_theme") },
    { val: "dark", title: t("theme.dark_theme") }
];

interface FontFamilyEntry {
    value: FontFamily;
    label?: string;
}

interface FontGroup {
    title: string;
    items: FontFamilyEntry[];
}

const FONT_FAMILIES: FontGroup[] = [
    {
        title: t("fonts.generic-fonts"),
        items: [
            { value: "theme", label: t("fonts.theme_defined") },
            { value: "system", label: t("fonts.system-default") },
            { value: "serif", label: t("fonts.serif") },
            { value: "sans-serif", label: t("fonts.sans-serif") },
            { value: "monospace", label: t("fonts.monospace") }
        ]
    },
    {
        title: t("fonts.sans-serif-system-fonts"),
        items: [{ value: "Arial" }, { value: "Verdana" }, { value: "Helvetica" }, { value: "Tahoma" }, { value: "Trebuchet MS" }, { value: "Microsoft YaHei" }]
    },
    {
        title: t("fonts.serif-system-fonts"),
        items: [{ value: "Times New Roman" }, { value: "Georgia" }, { value: "Garamond" }]
    },
    {
        title: t("fonts.monospace-system-fonts"),
        items: [
            { value: "Courier New" },
            { value: "Brush Script MT" },
            { value: "Impact" },
            { value: "American Typewriter" },
            { value: "Andalé Mono" },
            { value: "Lucida Console" },
            { value: "Monaco" }
        ]
    },
    {
        title: t("fonts.handwriting-system-fonts"),
        items: [{ value: "Bradley Hand" }, { value: "Luminari" }, { value: "Comic Sans MS" }]
    }
];

export default function AppearanceSettings() {
    const [ overrideThemeFonts ] = useTriliumOption("overrideThemeFonts");

    return (
        <div>
            {!isMobile() && <LayoutSwitcher />}
            {!isMobile() && <LayoutOrientation />}
            <ApplicationTheme />
            {overrideThemeFonts === "true" && <Fonts />}
            {isElectron() && <ElectronIntegration /> }
            <Performance />
            <MaxContentWidth />
            <RibbonOptions />
            <RelatedSettings items={[
                {
                    title: t("settings_appearance.related_code_blocks"),
                    targetPage: "_optionsTextNotes"
                },
                {
                    title: t("settings_appearance.related_code_notes"),
                    targetPage: "_optionsCodeNotes"
                }
            ]} />
        </div>
    );
}

function LayoutSwitcher() {
    const [ newLayout, setNewLayout ] = useTriliumOptionBool("newLayout");

    return (
        <OptionsSection title={t("settings_appearance.ui")}>
            <RadioWithIllustration
                currentValue={newLayout ? "new-layout" : "old-layout"}
                onChange={async newValue => {
                    await setNewLayout(newValue === "new-layout");
                    reloadFrontendApp();
                }}
                values={[
                    { key: "old-layout", text: t("settings_appearance.ui_old_layout"), illustration: <LayoutIllustration /> },
                    { key: "new-layout", text: t("settings_appearance.ui_new_layout"), illustration: <LayoutIllustration isNewLayout /> }
                ]}
            />
        </OptionsSection>
    );
}

function LayoutIllustration({ isNewLayout }: { isNewLayout?: boolean }) {
    return (
        <div className="old-layout-illustration">
            <div className="launcher-pane">
                <VerticalLayoutIcon />
                <Icon icon="bx bx-send" />
                <Icon icon="bx bx-file-blank" />
                <Icon icon="bx bx-search" />
            </div>

            <div className="tree">
                <ul>
                    <li>Options</li>
                    <ul>
                        <li>Appearance</li>
                        <li>Shortcuts</li>
                        <li>Text Notes</li>
                        <li>Code Notes</li>
                        <li>Images</li>
                    </ul>
                </ul>
            </div>

            <div className="main">
                <div className="tab-bar" />

                <div className="content">

                    {(isNewLayout) ? (
                        <div className="note-header">
                            <div className="note-toolbar">
                                <Icon icon="bx bx-dock-right" />
                            </div>
                            <div className="note-inline-title">
                                <Icon className="note-icon" icon="bx bx-leaf" />
                                <div className="note-title-row">
                                    <div className="title">Title</div>
                                    <div className="subtitle">Just a sample note</div>
                                </div>
                            </div>
                        </div>
                    ) : (
                    <div>
                        <div className="title-bar">
                            <Icon icon="bx bx-leaf" />
                            <span className="title">Title</span>
                            <Icon icon="bx bx-dock-right" />
                        </div>
                    </div>
                    )}

                    {!isNewLayout && <div className="ribbon">
                        <div className="ribbon-header">
                            <Icon icon="bx bx-slider" />
                            <Icon icon="bx bx-list-check" />
                            <Icon icon="bx bx-list-plus" />
                            <Icon icon="bx bx-collection" />
                        </div>

                        <div className="ribbon-body">
                            <div className="ribbon-body-content"></div>
                        </div>
                    </div>}

                    {isNewLayout && <div className="note-title-actions">
                        <Icon icon="bx bx-chevron-down" />{" "}Promoted attributes
                    </div>}

                    <div className="content-inner">
                        This is a "demo" document packaged with Trilium to showcase some of its features and also give you some ideas on how you might structure your notes. You can play with it, and modify the note content and tree structure as you wish.
                    </div>

                    {isNewLayout && <div className="status-bar">
                        <div className="status-bar-breadcrumb">
                            <Icon icon="bx bx-home" />
                            <Icon icon="bx bx-chevron-right" />
                            Note
                            <Icon icon="bx bx-chevron-right" />
                            Note
                        </div>

                        <div className="status-bar-actions">
                            <Icon icon="bx bx-list-check" />
                            <Icon icon="bx bx-info-circle" />
                        </div>
                    </div>}
                </div>
            </div>
        </div>
    );
}

function LayoutOrientation() {
    const [ layoutOrientation, setLayoutOrientation ] = useTriliumOption("layoutOrientation", true);

    return (
        <OptionsSection title={t("theme.layout")}>
            <FormRadioGroup
                name="layout-orientation"
                values={[
                    {
                        label: t("theme.layout-vertical-title"),
                        inlineDescription: t("theme.layout-vertical-description"),
                        value: "vertical"
                    },
                    {
                        label: t("theme.layout-horizontal-title"),
                        inlineDescription: t("theme.layout-horizontal-description"),
                        value: "horizontal"
                    }
                ]}
                currentValue={layoutOrientation} onChange={setLayoutOrientation}
            />
        </OptionsSection>
    );
}

function ApplicationTheme() {
    const [ theme, setTheme ] = useTriliumOption("theme", true);
    const [ overrideThemeFonts, setOverrideThemeFonts ] = useTriliumOptionBool("overrideThemeFonts");

    const [ themes, setThemes ] = useState<Theme[]>([]);

    useEffect(() => {
        server.get<Theme[]>("options/user-themes").then((userThemes) => {
            setThemes([
                ...BUILTIN_THEMES,
                ...userThemes
            ]);
        });
    }, []);

    return (
        <OptionsSection title={t("theme.title")}>
            <div className="row">
                <FormGroup name="theme" label={t("theme.theme_label")} className="col-md-6" style={{ marginBottom: 0 }}>
                    <FormSelect
                        values={themes} currentValue={theme} onChange={setTheme}
                        keyProperty="val" titleProperty="title"
                    />
                </FormGroup>

                <FormGroup className="side-checkbox col-md-6" name="override-theme-fonts">
                    <FormCheckbox
                        label={t("theme.override_theme_fonts_label")}
                        currentValue={overrideThemeFonts} onChange={setOverrideThemeFonts} />
                </FormGroup>
            </div>
        </OptionsSection>
    );
}

function Fonts() {
    return (
        <OptionsSection title={t("fonts.fonts")}>
            <Font title={t("fonts.main_font")} fontFamilyOption="mainFontFamily" fontSizeOption="mainFontSize" />
            <Font title={t("fonts.note_tree_font")} fontFamilyOption="treeFontFamily" fontSizeOption="treeFontSize" />
            <Font title={t("fonts.note_detail_font")} fontFamilyOption="detailFontFamily" fontSizeOption="detailFontSize" />
            <Font title={t("fonts.monospace_font")} fontFamilyOption="monospaceFontFamily" fontSizeOption="monospaceFontSize" />

            <FormText>{t("fonts.note_tree_and_detail_font_sizing")}</FormText>
            <FormText>{t("fonts.not_all_fonts_available")}</FormText>

            <p>
                {t("fonts.apply_font_changes")} <Button text={t("fonts.reload_frontend")} size="micro" onClick={reloadFrontendApp} />
            </p>
        </OptionsSection>
    );
}

function Font({ title, fontFamilyOption, fontSizeOption }: { title: string, fontFamilyOption: OptionNames, fontSizeOption: OptionNames }) {
    const [ fontFamily, setFontFamily ] = useTriliumOption(fontFamilyOption);
    const [ fontSize, setFontSize ] = useTriliumOption(fontSizeOption);

    return (
        <>
            <h5>{title}</h5>
            <div className="row">
                <FormGroup name="font-family" className="col-md-4" label={t("fonts.font_family")}>
                    <FormSelectWithGroups
                        values={FONT_FAMILIES}
                        currentValue={fontFamily} onChange={setFontFamily}
                        keyProperty="value" titleProperty="label"
                    />
                </FormGroup>

                <FormGroup name="font-size" className="col-md-6" label={t("fonts.size")}>
                    <FormTextBoxWithUnit
                        name="tree-font-size"
                        type="number" min={50} max={200} step={10}
                        currentValue={fontSize} onBlur={setFontSize}
                        unit={t("units.percentage")}
                    />
                </FormGroup>
            </div>
        </>
    );
}

function ElectronIntegration() {
    const [ zoomFactor, setZoomFactor ] = useTriliumOption("zoomFactor");
    const [ nativeTitleBarVisible, setNativeTitleBarVisible ] = useTriliumOptionBool("nativeTitleBarVisible");
    const [ backgroundEffects, setBackgroundEffects ] = useTriliumOptionBool("backgroundEffects");

    return (
        <OptionsSection title={t("electron_integration.desktop-application")}>
            <FormGroup name="zoom-factor" label={t("electron_integration.zoom-factor")} description={t("zoom_factor.description")}>
                <FormTextBox
                    type="number"
                    min="0.3" max="2.0" step="0.1"
                    currentValue={zoomFactor} onChange={setZoomFactor}
                />
            </FormGroup>
            <hr/>

            <FormGroup name="native-title-bar" description={t("electron_integration.native-title-bar-description")}>
                <FormCheckbox
                    label={t("electron_integration.native-title-bar")}
                    currentValue={nativeTitleBarVisible} onChange={setNativeTitleBarVisible}
                />
            </FormGroup>

            <FormGroup name="background-effects" description={t("electron_integration.background-effects-description")}>
                <FormCheckbox
                    label={t("electron_integration.background-effects")}
                    currentValue={backgroundEffects} onChange={setBackgroundEffects}
                    disabled={nativeTitleBarVisible}
                />
            </FormGroup>

            <Button text={t("electron_integration.restart-app-button")} onClick={restartDesktopApp} />
        </OptionsSection>
    );
}

function Performance() {
    const [ motionEnabled, setMotionEnabled ] = useTriliumOptionBool("motionEnabled");
    const [ shadowsEnabled, setShadowsEnabled ] = useTriliumOptionBool("shadowsEnabled");
    const [ backdropEffectsEnabled, setBackdropEffectsEnabled ] = useTriliumOptionBool("backdropEffectsEnabled");

    return <OptionsSection title={t("ui-performance.title")}>
        <FormCheckbox
            label={t("ui-performance.enable-motion")}
            currentValue={motionEnabled} onChange={setMotionEnabled}
        />

        <FormCheckbox
            label={t("ui-performance.enable-shadows")}
            currentValue={shadowsEnabled} onChange={setShadowsEnabled}
        />

        <FormCheckbox
            label={t("ui-performance.enable-backdrop-effects")}
            currentValue={backdropEffectsEnabled} onChange={setBackdropEffectsEnabled}
        />

        {isElectron() && <SmoothScrollEnabledOption />}

    </OptionsSection>;
}

function SmoothScrollEnabledOption() {
    const [ smoothScrollEnabled, setSmoothScrollEnabled ] = useTriliumOptionBool("smoothScrollEnabled");

    return <FormCheckbox
        label={`${t("ui-performance.enable-smooth-scroll")} ${t("ui-performance.app-restart-required")}`}
        currentValue={smoothScrollEnabled} onChange={setSmoothScrollEnabled}
    />;
}

function MaxContentWidth() {
    const [maxContentWidth, setMaxContentWidth] = useTriliumOption("maxContentWidth");
    const [centerContent, setCenterContent] = useTriliumOptionBool("centerContent");

    return (
        <OptionsSection title={t("max_content_width.title")}>
            <FormText>{t("max_content_width.default_description")}</FormText>

            <Column md={6}>
                <FormGroup name="max-content-width" label={t("max_content_width.max_width_label")}>
                    <FormTextBoxWithUnit
                        type="number" min={MIN_CONTENT_WIDTH} step="10"
                        currentValue={maxContentWidth} onBlur={setMaxContentWidth}
                        unit={t("max_content_width.max_width_unit")}
                    />
                </FormGroup>
            </Column>

            <FormCheckbox label={t("max_content_width.centerContent")}
                currentValue={centerContent}
                onChange={setCenterContent} />
        </OptionsSection>
    );
}

function RibbonOptions() {
    const [ editedNotesOpenInRibbon, setEditedNotesOpenInRibbon ] = useTriliumOptionBool("editedNotesOpenInRibbon");

    return (
        <OptionsSection title={t('ribbon.widgets')}>
            <FormCheckbox
                label={t('ribbon.edited_notes_message')}
                currentValue={editedNotesOpenInRibbon} onChange={setEditedNotesOpenInRibbon}
            />
        </OptionsSection>
    );
}
