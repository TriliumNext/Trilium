import { useEffect, useState } from "preact/hooks";
import { t } from "../../../services/i18n";
import { isElectron, isMobile, reloadFrontendApp, restartDesktopApp } from "../../../services/utils";
import Column from "../../react/Column";
import FormRadioGroup from "../../react/FormRadioGroup";
import FormSelect, { FormSelectWithGroups } from "../../react/FormSelect";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import server from "../../../services/server";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import { FontFamily, OptionNames } from "@triliumnext/commons";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormText from "../../react/FormText";
import Button from "../../react/Button";
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
]

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
            {!isMobile() && <LayoutOrientation />}
            <ApplicationTheme />
            {overrideThemeFonts === "true" && <Fonts />}
            {isElectron() && <ElectronIntegration /> }
            <MaxContentWidth />
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
    )
}

function LayoutOrientation() {
    const [ layoutOrientation, setLayoutOrientation ] = useTriliumOption("layoutOrientation", true);
    
    return (
        <OptionsSection title={t("theme.layout")}>
            <FormRadioGroup
                name="layout-orientation"
                values={[
                    {
                        label: <><strong>{t("theme.layout-vertical-title")}</strong> - {t("theme.layout-vertical-description")}</>,
                        value: "vertical"
                    },
                    {
                        label: <><strong>{t("theme.layout-horizontal-title")}</strong> - {t("theme.layout-horizontal-description")}</>,
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
            ])
        });
    }, []);

    return (
        <OptionsSection title={t("theme.title")}>
            <Column>
                <label>{t("theme.theme_label")}</label>
                <FormSelect 
                    values={themes} currentValue={theme} onChange={setTheme}
                    keyProperty="val" titleProperty="title"
                />
            </Column>

            <Column className="side-checkbox">
                <FormCheckbox
                    name="override-theme-fonts"
                    label={t("theme.override_theme_fonts_label")}
                    currentValue={overrideThemeFonts} onChange={setOverrideThemeFonts} />
            </Column>
        </OptionsSection>
    )
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
                <Column md={4}>
                    <label>{t("fonts.font_family")}</label>
                    <FormSelectWithGroups
                        values={FONT_FAMILIES}
                        currentValue={fontFamily} onChange={setFontFamily}
                        keyProperty="value" titleProperty="label"                    
                    />
                </Column>

                <Column md={6}>
                    <label>{t("fonts.size")}</label>
                    <FormTextBoxWithUnit
                        name="tree-font-size"
                        type="number" min={50} max={200} step={10}
                        currentValue={fontSize} onChange={setFontSize}
                        unit="%"
                    />
                </Column>
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
            <FormGroup label={t("electron_integration.zoom-factor")} description={t("zoom_factor.description")}>
                <FormTextBox
                    type="number"
                    min="0.3" max="2.0" step="0.1"                    
                    currentValue={zoomFactor} onChange={setZoomFactor}
                />
            </FormGroup>
            <hr/>

            <FormGroup description={t("electron_integration.native-title-bar-description")}>
                <FormCheckbox
                    name="native-title-bar" label={t("electron_integration.native-title-bar")}
                    currentValue={nativeTitleBarVisible} onChange={setNativeTitleBarVisible}
                />
            </FormGroup>

            <FormGroup description={t("electron_integration.background-effects-description")}>
                <FormCheckbox
                    name="background-effects" label={t("electron_integration.background-effects")}
                    currentValue={backgroundEffects} onChange={setBackgroundEffects}
                />
            </FormGroup>

            <Button text={t("electron_integration.restart-app-button")} onClick={restartDesktopApp} />
        </OptionsSection>
    )
}

function MaxContentWidth() {
    const [ maxContentWidth, setMaxContentWidth ] = useTriliumOption("maxContentWidth");

    return (
        <OptionsSection title={t("max_content_width.title")}>
            <FormText>{t("max_content_width.default_description")}</FormText>

            <Column md={6}>
                <FormGroup label={t("max_content_width.max_width_label")}>
                    <FormTextBoxWithUnit
                        name="max-content-width"
                        type="number" min={MIN_CONTENT_WIDTH} step="10" 
                        currentValue={maxContentWidth} onChange={setMaxContentWidth}
                        unit={t("max_content_width.max_width_unit")}
                    />
                </FormGroup>
            </Column>

            <p>
                {t("max_content_width.apply_changes_description")} <Button text={t("max_content_width.reload_button")} size="micro" onClick={reloadFrontendApp} />
            </p>
        </OptionsSection>
    )
}