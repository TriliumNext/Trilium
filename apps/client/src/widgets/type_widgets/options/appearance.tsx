import "./appearance.css";

import { useEffect, useMemo, useState } from "preact/hooks";

import zoomService from "../../../components/zoom";
import { ColorScheme, resolveColorScheme, THEME_FAMILY_SCHEMES } from "../../../services/color_scheme";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { isElectron, isMobile, reloadFrontendApp } from "../../../services/utils";
import { VerticalLayoutIcon } from "../../buttons/global_menu";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import Dropdown from "../../react/Dropdown";
import { FormListHeader, FormListItem } from "../../react/FormList";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import HelpButton from "../../react/HelpButton";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Icon from "../../react/Icon";
import SegmentedChoice, { SegmentedChoiceOption } from "../../react/SegmentedChoice";
import Fonts from "./appearance_fonts";
import OptionsPageHeader from "./components/OptionsPageHeader";
import PlatformIndicator from "./components/PlatformIndicator";
import RadioWithIllustration from "./components/RadioWithIllustration";
import RelatedSettings from "./components/RelatedSettings";
import RestartAction from "./components/RestartAction";

const MIN_CONTENT_WIDTH = 640;

interface CustomTheme {
    val: string;
    title: string;
    icon?: string;
    noteId?: string;
}

interface ThemeFamily {
    key: string;
    title: string;
    icon: string;
    schemes: Record<ColorScheme, string>;
}

const THEME_FAMILIES: ThemeFamily[] = [
    {
        key: "modern",
        title: t("theme.modern_themes"),
        icon: "bx bx-star",
        schemes: THEME_FAMILY_SCHEMES.modern
    },
    {
        key: "legacy",
        title: t("theme.legacy_themes"),
        icon: "bx bx-history",
        schemes: THEME_FAMILY_SCHEMES.legacy
    }
];

const COLOR_SCHEMES: SegmentedChoiceOption<ColorScheme>[] = [
    { value: "system", label: t("theme.color_scheme_system"), icon: "bx-brightness-half" },
    { value: "light", label: t("theme.color_scheme_light"), icon: "bx-sun" },
    { value: "dark", label: t("theme.color_scheme_dark"), icon: "bx-moon" }
];

function resolveTheme(themeVal: string | null): { family: ThemeFamily | null; scheme: ColorScheme; isCustom: boolean } {
    const { family: familyKey, scheme, isCustom } = resolveColorScheme(themeVal);
    const family = THEME_FAMILIES.find(f => f.key === familyKey) ?? null;
    return { family, scheme, isCustom };
}

export default function AppearanceSettings() {
    return (
        <>
            <OptionsPageHeader />
            <UserInterface />
            {!isMobile() && <LayoutChoices />}
            <Fonts />
            {isElectron() && <ElectronIntegration /> }
            <Performance />
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
        </>
    );
}

function UserInterface() {
    const [ theme, setTheme ] = useTriliumOption("theme");
    const [ customThemes, setCustomThemes ] = useState<CustomTheme[]>([]);
    const [ newLayout ] = useTriliumOptionBool("newLayout");
    const [ editedNotesOpenInRibbon, setEditedNotesOpenInRibbon ] = useTriliumOptionBool("editedNotesOpenInRibbon");

    useEffect(() => {
        server.get<CustomTheme[]>("options/user-themes").then((userThemes) => {
            setCustomThemes(userThemes);
        });
    }, []);

    const resolved = useMemo(() => resolveTheme(theme ?? null), [theme]);
    const isCustom = resolved.isCustom;

    // Derive display info for the theme family dropdown
    const currentFamilyLabel = resolved.family?.title
        ?? customThemes.find(ct => ct.val === theme)?.title
        ?? theme ?? "";
    const currentFamilyIcon = resolved.family?.icon
        ?? customThemes.find(ct => ct.val === theme)?.icon
        ?? "bx bx-palette";

    const setFamily = (family: ThemeFamily) => {
        // Keep current color scheme when switching families
        setTheme(family.schemes[resolved.scheme]);
    };

    const setColorScheme = (scheme: ColorScheme) => {
        if (resolved.family) {
            setTheme(resolved.family.schemes[scheme]);
        }
    };

    return (
        <Card heading={t("theme.title")}>
            <OptionCardSection name="theme" label={t("theme.theme_label")}>
                <Dropdown
                    text={<>
                        <span className={`theme-family-icon ${currentFamilyIcon}`} />
                        {currentFamilyLabel}
                    </>}
                    mobileBottomSheet
                    // The card is a container, and so a backdrop root: left inside it the menu
                    // loses its blur and reads as a flat tint.
                    portalToBody
                >
                    {THEME_FAMILIES.map(family => (
                        <FormListItem
                            key={family.key}
                            icon={family.icon}
                            selected={resolved.family?.key === family.key}
                            onClick={() => setFamily(family)}
                            badges={family.key === "modern" ? [{ text: t("theme.recommended") }] : undefined}
                        >
                            {family.title}
                        </FormListItem>
                    ))}
                    {customThemes.length > 0 && (
                        <>
                            <FormListHeader text={t("theme.custom_themes")} />
                            {customThemes.map(ct => (
                                <FormListItem
                                    key={ct.val}
                                    icon={ct.icon}
                                    selected={theme === ct.val}
                                    onClick={() => setTheme(ct.val)}
                                >
                                    {ct.title}
                                </FormListItem>
                            ))}
                        </>
                    )}
                </Dropdown>
            </OptionCardSection>

            <OptionCardSection
                name="color-scheme"
                label={t("theme.color_scheme")}
                description={isCustom ? t("theme.color_scheme_custom_disabled") : undefined}
            >
                <SegmentedChoice
                    options={COLOR_SCHEMES}
                    // A custom theme brings its own colours, so the group highlights nothing rather
                    // than naming a scheme it is not following.
                    currentValue={isCustom ? "" : resolved.scheme}
                    onChange={setColorScheme}
                    disabled={isCustom}
                    collapseOnMobile
                />
            </OptionCardSection>

            {!isMobile() && !newLayout && (
                <OptionCardSection
                    name="edited-notes-open-in-ribbon"
                    label={t("ribbon.edited_notes_message")}
                >
                    <FormToggle
                        currentValue={editedNotesOpenInRibbon}
                        onChange={setEditedNotesOpenInRibbon}
                    />
                </OptionCardSection>
            )}
        </Card>
    );
}

/**
 * The two choices that decide the shape of the window, each shown as a picture rather than named in
 * words. Neither fits a settings row — an illustration is too large to stand as a value beside a
 * label — so each takes a card of its own, with what the choice is called as the card's heading.
 *
 * Side by side, being read against one another rather than one after the other; a pane too narrow to
 * hold both puts them on lines of their own instead (see the CSS).
 */
function LayoutChoices() {
    return (
        <div className="appearance-layout-choices">
            <LayoutOrientation />
            <LayoutStyle />
        </div>
    );
}

function LayoutStyle() {
    const [ newLayout, setNewLayout ] = useTriliumOptionBool("newLayout");

    return (
        <Card className="thumbnail-selector-option-card" heading={t("settings_appearance.ui_layout_style")}>
            <CardSection>
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
            </CardSection>
        </Card>
    );
}

function LayoutOrientation() {
    const [ layoutOrientation, setLayoutOrientation ] = useTriliumOption("layoutOrientation", true);

    return (
        <Card className="thumbnail-selector-option-card" heading={t("settings_appearance.ui_layout_orientation")}>
            <CardSection>
                <RadioWithIllustration
                    currentValue={layoutOrientation ?? "vertical"}
                    onChange={setLayoutOrientation}
                    values={[
                        { key: "vertical", text: t("theme.layout-vertical-title"), illustration: <OrientationIllustration orientation="vertical" /> },
                        { key: "horizontal", text: t("theme.layout-horizontal-title"), illustration: <OrientationIllustration orientation="horizontal" /> }
                    ]}
                />
            </CardSection>
        </Card>
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
                            <div className="ribbon-body-content" />
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

function OrientationIllustration({ orientation }: { orientation: "vertical" | "horizontal" }) {
    const isHorizontal = orientation === "horizontal";

    return (
        <div className={`orientation-illustration ${orientation}`}>
            {isHorizontal && (
                <div className="tab-bar full-width">
                    <div className="tab active" />
                    <div className="tab" />
                    <div className="tab" />
                </div>
            )}
            {isHorizontal && (
                <div className="launcher-bar horizontal">
                    <Icon icon="bx bx-menu" />
                    <Icon icon="bx bx-send" />
                    <Icon icon="bx bx-file-blank" />
                    <Icon icon="bx bx-search" />
                </div>
            )}
            <div className="main-area">
                {!isHorizontal && (
                    <div className="launcher-bar vertical">
                        <Icon icon="bx bx-menu" />
                        <Icon icon="bx bx-send" />
                        <Icon icon="bx bx-file-blank" />
                        <Icon icon="bx bx-search" />
                    </div>
                )}
                <div className="tree-pane">
                    <div className="tree-content" />
                </div>
                <div className="content-pane">
                    {!isHorizontal && (
                        <div className="tab-bar">
                            <div className="tab active" />
                            <div className="tab" />
                            <div className="tab" />
                        </div>
                    )}
                    <div className="note-content" />
                </div>
            </div>
        </div>
    );
}

function ElectronIntegration() {
    const [ zoomFactor ] = useTriliumOption("zoomFactor");
    const [ nativeTitleBarVisible, setNativeTitleBarVisible ] = useTriliumOptionBool("nativeTitleBarVisible");
    const [ backgroundEffects, setBackgroundEffects ] = useTriliumOptionBool("backgroundEffects");

    const zoomPercentage = Math.round(parseFloat(zoomFactor || "1") * 100);
    // Background effects are only supported on Windows 11 and macOS; on Linux they have no
    // visual effect and would only cost the native window shadow.
    const backgroundEffectsSupported = window.glob.platform === "win32" || window.glob.platform === "darwin";

    return (
        <>
            <Card className="appearance-electron" heading={t("electron_integration.desktop-application")}>
                <OptionCardSection
                    name="zoom-factor"
                    label={t("electron_integration.zoom-factor")}
                    description={t("zoom_factor.description")}
                >
                    <FormTextBoxWithUnit
                        type="number"
                        min={50} max={200} step={10}
                        currentValue={String(zoomPercentage)}
                        onChange={(v) => zoomService.setZoomFactorAndSave(parseInt(v, 10) / 100)}
                        unit={t("units.percentage")}
                    />
                </OptionCardSection>

                <OptionCardSection
                    name="native-title-bar"
                    label={t("electron_integration.native-title-bar")}
                    description={t("electron_integration.native-title-bar-description")}
                >
                    <FormToggle currentValue={nativeTitleBarVisible} onChange={setNativeTitleBarVisible} />
                </OptionCardSection>

                <OptionCardSection
                    name="background-effects"
                    label={<>{t("electron_integration.background-effects")} <PlatformIndicator windows="11" mac /></>}
                    description={t("electron_integration.background-effects-description")}
                >
                    <FormToggle
                        currentValue={backgroundEffects}
                        onChange={setBackgroundEffects}
                        disabled={nativeTitleBarVisible || !backgroundEffectsSupported}
                    />
                </OptionCardSection>
            </Card>

            <RestartAction text={t("electron_integration.restart-app-button")} icon="bx-refresh" />
        </>
    );
}

function Performance() {
    const [ motionEnabled, setMotionEnabled ] = useTriliumOptionBool("motionEnabled");
    const [ shadowsEnabled, setShadowsEnabled ] = useTriliumOptionBool("shadowsEnabled");
    const [ backdropEffectsEnabled, setBackdropEffectsEnabled ] = useTriliumOptionBool("backdropEffectsEnabled");

    return (
        <Card heading={t("ui-performance.title")}>
            <OptionCardSection name="motion-enabled" label={t("ui-performance.enable-motion")}>
                <FormToggle currentValue={motionEnabled} onChange={setMotionEnabled} />
            </OptionCardSection>

            <OptionCardSection name="shadows-enabled" label={t("ui-performance.enable-shadows")}>
                <FormToggle currentValue={shadowsEnabled} onChange={setShadowsEnabled} />
            </OptionCardSection>

            {!isMobile() && (
                <OptionCardSection name="backdrop-effects-enabled" label={t("ui-performance.enable-backdrop-effects")}>
                    <FormToggle currentValue={backdropEffectsEnabled} onChange={setBackdropEffectsEnabled} />
                </OptionCardSection>
            )}

            {isElectron() && <SmoothScrollEnabledOption />}

            {isElectron() && <HardwareAccelerationOption />}
        </Card>
    );
}

function SmoothScrollEnabledOption() {
    const [ smoothScrollEnabled, setSmoothScrollEnabled ] = useTriliumOptionBool("smoothScrollEnabled");

    return (
        <OptionCardSection
            name="smooth-scroll-enabled"
            label={t("ui-performance.enable-smooth-scroll")}
            description={t("ui-performance.app-restart-required")}
        >
            <FormToggle currentValue={smoothScrollEnabled} onChange={setSmoothScrollEnabled} />
        </OptionCardSection>
    );
}

function HardwareAccelerationOption() {
    const [ hardwareAccelerationEnabled, setHardwareAccelerationEnabled ] = useTriliumOptionBool("hardwareAccelerationEnabled");

    return (
        <OptionCardSection
            name="hardware-acceleration-enabled"
            label={t("ui-performance.enable-hardware-acceleration")}
            description={t("ui-performance.enable-hardware-acceleration-description")}
        >
            <FormToggle currentValue={hardwareAccelerationEnabled} onChange={setHardwareAccelerationEnabled} />
        </OptionCardSection>
    );
}

function MaxContentWidth() {
    const [maxContentWidth, setMaxContentWidth] = useTriliumOption("maxContentWidth");
    const [centerContent, setCenterContent] = useTriliumOptionBool("centerContent");

    return (
        <Card
            heading={t("max_content_width.title")}
            description={t("max_content_width.default_description")}
            actions={<HelpButton helpPage="t596jLvPrqkS" />}
        >
            <OptionCardSection
                name="max-content-width"
                label={t("max_content_width.max_width_label")}
            >
                <FormTextBoxWithUnit
                    type="number" min={MIN_CONTENT_WIDTH} step="10"
                    currentValue={maxContentWidth} onBlur={setMaxContentWidth}
                    unit={t("max_content_width.max_width_unit")}
                />
            </OptionCardSection>

            <OptionCardSection name="center-content" label={t("max_content_width.centerContent")}>
                <FormToggle currentValue={centerContent} onChange={setCenterContent} />
            </OptionCardSection>
        </Card>
    );
}
