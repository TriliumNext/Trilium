import "./appearance_fonts.css";

import { customFontFamily, customFontNoteId, customFontOption, FontFamily, OptionNames, SYSTEM_MONOSPACE_FONT_STACK, SYSTEM_SANS_SERIF_FONT_STACK, UserFont } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChildren, Fragment } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Trans } from "react-i18next";

import FNote from "../../../entities/fnote";
import { getCustomFonts, registerFontNote } from "../../../services/custom_fonts";
import { filterAvailableFamilies, listSystemFonts, quoteFamily, type SystemFont } from "../../../services/font";
import { t } from "../../../services/i18n";
import { isElectron } from "../../../services/utils";
import Button from "../../react/Button";
import { Card, OptionCardSection } from "../../react/Card";
import { filterTokens, matchesFilter } from "../../react/filter";
import FormList, { FormListHeader, FormListItem } from "../../react/FormList";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useChildNotes, useNoteTitle, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Icon from "../../react/Icon";
import Modal from "../../react/Modal";
import NoItems from "../../react/NoItems";
import SegmentedChoice from "../../react/SegmentedChoice";
import { renderShortcutKbds } from "../../react/shortcut_kbd";
import Slider from "../../react/Slider";
import SettingsSearch from "./components/SettingsSearch";

interface FontFamilyEntry {
    value: FontFamily;
    label?: string;
}

interface FontGroup {
    title: string;
    items: FontFamilyEntry[];
}

/** Families the browser resolves for itself, so they hold wherever Trilium runs. */
const GENERIC_FONTS: FontGroup = {
    title: t("fonts.generic-fonts"),
    items: [
        { value: "theme", label: t("fonts.theme_defined") },
        { value: "system", label: t("fonts.system-default") },
        { value: "serif", label: t("fonts.serif") },
        { value: "sans-serif", label: t("fonts.sans-serif") },
        { value: "monospace", label: t("fonts.monospace") }
    ]
};

/** Named families, offered where the device's own fonts cannot be listed (see {@link useFontGroups}). */
const FONT_FAMILIES: FontGroup[] = [
    GENERIC_FONTS,
    {
        title: t("fonts.sans-serif-system-fonts"),
        items: [
            { value: "Arial" },
            { value: "Verdana" },
            { value: "Helvetica" },
            { value: "Tahoma" },
            { value: "Trebuchet MS" },
            { value: "Impact" },
            { value: "Microsoft YaHei" }
        ]
    },
    {
        title: t("fonts.serif-system-fonts"),
        items: [{ value: "Times New Roman" }, { value: "Georgia" }, { value: "Garamond" }, { value: "American Typewriter" }]
    },
    {
        title: t("fonts.monospace-system-fonts"),
        // "Andale Mono" carries no accent: the accented spelling matches no installed family, so CSS
        // falls through to the generic default.
        items: [{ value: "Courier New" }, { value: "Andale Mono" }, { value: "Lucida Console" }, { value: "Monaco" }]
    },
    {
        title: t("fonts.handwriting-system-fonts"),
        items: [{ value: "Bradley Hand" }, { value: "Brush Script MT" }, { value: "Comic Sans MS" }, { value: "Luminari" }]
    }
];

type FontTargetKey = "main" | "tree" | "detail" | "monospace";

/** One of the areas a font is set for, as the card row and the picker draw it. */
interface FontTarget {
    key: FontTargetKey;
    /** Names the area on the card. */
    label: string;
    /** Names it in the picker, whose dialog is already about fonts. */
    shortLabel: string;
    description?: string;
    sizeDescription?: string;
    /** What the theme sets for the area, which the `theme` entry is drawn in. */
    themeVariable: string;
    isMonospace?: boolean;
    /** What the chosen font is shown on, where a line of specimen text is not what it is set in. */
    Preview?: () => ComponentChildren;
}

const FONT_TARGETS: FontTarget[] = [
    {
        key: "main",
        label: t("fonts.main_font"),
        shortLabel: t("fonts.main_font_short"),
        themeVariable: "var(--main-font-family)",
        Preview: InterfacePreview
    },
    {
        key: "tree",
        label: t("fonts.note_tree_font"),
        shortLabel: t("fonts.note_tree_font_short"),
        sizeDescription: t("fonts.size_relative_to_general"),
        themeVariable: "var(--tree-font-family)",
        Preview: TreePreview
    },
    {
        key: "detail",
        label: t("fonts.note_detail_font"),
        shortLabel: t("fonts.note_detail_font_short"),
        sizeDescription: t("fonts.size_relative_to_general"),
        themeVariable: "var(--detail-font-family)",
        Preview: DocumentPreview
    },
    {
        key: "monospace",
        label: t("fonts.monospace_font"),
        shortLabel: t("fonts.monospace_font_short"),
        description: t("fonts.monospace_font_description"),
        themeVariable: "var(--monospace-font-family)",
        isMonospace: true,
        Preview: CodePreview
    }
];

export default function Fonts() {
    const [ overrideThemeFonts, setOverrideThemeFonts ] = useTriliumOptionBool("overrideThemeFonts");
    const [ ligaturesEnabled, setLigaturesEnabled ] = useTriliumOptionBool("monospaceLigaturesEnabled");
    const isEnabled = overrideThemeFonts === true;
    const fontGroups = useFontGroups();
    const fontOptions = useFontOptions();
    const [ pickerTarget, setPickerTarget ] = useState(FONT_TARGETS[0]);
    const [ pickerShown, setPickerShown ] = useState(false);

    return (
        <Card className="appearance-fonts" heading={t("fonts.fonts")}>
            <OptionCardSection
                name="override-theme-fonts"
                label={t("fonts.custom_fonts")}
                description={t("fonts.custom_fonts_description")}
                // The four fonts stay on show with the switch off, greyed rather than gone: what
                // is there to be set is the whole reason for turning it on, and a switch with
                // nothing under it says nothing about what it would bring.
                subSectionsVisible
                subSections={FONT_TARGETS.map((target) => (
                    <FontRow
                        key={target.key}
                        target={target}
                        option={fontOptions[target.key]}
                        groups={fontGroups}
                        disabled={!isEnabled}
                        onOpen={() => {
                            setPickerTarget(target);
                            setPickerShown(true);
                        }}
                    />
                ))}
            >
                <FormToggle currentValue={overrideThemeFonts} onChange={setOverrideThemeFonts} />
            </OptionCardSection>

            {/*
              * One picker for all four areas rather than one apiece: the areas are set against each
              * other — a tree size is a percentage of the interface size — and the list it is
              * chosen from runs to every family the device has, which is not worth rebuilding to
              * look at the next area.
              */}
            <FontPickerModal
                show={pickerShown}
                onHidden={() => setPickerShown(false)}
                target={pickerTarget}
                onTargetChange={setPickerTarget}
                option={fontOptions[pickerTarget.key]}
                groups={fontGroups}
            />

            {/*
              * Deliberately not nested under `overrideThemeFonts` like the fonts above: the
              * ligatures come from the *theme's* monospace font, so the setting is needed exactly
              * when custom fonts are off. Gating it would put it out of reach of everyone affected.
              */}
            <OptionCardSection
                name="monospace-ligatures-enabled"
                label={t("fonts.monospace_ligatures")}
                description={t("fonts.monospace_ligatures_description")}
            >
                <FormToggle currentValue={ligaturesEnabled} onChange={setLigaturesEnabled} />
            </OptionCardSection>
        </Card>
    );
}

/**
 * The picker's groups, with the fonts the user labelled `#customFont` appended. Those are also
 * registered with the document for as long as the page is open, so the picker draws each specimen
 * in the font it names.
 *
 * Where the device's own fonts can be listed, they stand in for the named families: the stock list
 * is a guess at what a device has, and half of it does not resolve on any given one.
 */
function useFontGroups(): FontGroup[] {
    const [ customFonts, setCustomFonts ] = useState<UserFont[]>([]);
    const systemFonts = useSystemFonts();

    useEffect(() => {
        let cancelled = false;
        const registered: FontFace[] = [];

        (async () => {
            const fonts = await getCustomFonts();
            if (cancelled) return;
            setCustomFonts(fonts);

            await Promise.all(fonts.map(async ({ noteId, blobId }) => {
                try {
                    const face = await registerFontNote(noteId, customFontFamily(noteId), blobId);
                    if (cancelled) {
                        document.fonts.delete(face);
                    } else {
                        registered.push(face);
                    }
                } catch {
                    // The entry stays on the list and draws in the fallback family: the option can
                    // still be set to a font this device happens not to be able to load.
                }
            }));
        })();

        return () => {
            cancelled = true;
            for (const face of registered) {
                document.fonts.delete(face);
            }
        };
    }, []);

    return useMemo(() => {
        const stockGroups = systemFonts.length ? installedFontGroups(systemFonts) : availableStockGroups();

        // Ahead of the rest: a font the user went and added is the one they are looking for.
        return customFonts.length
            ? [ {
                title: t("fonts.user-fonts"),
                items: customFonts.map(({ noteId, title }) => ({ value: customFontOption(noteId), label: title }))
            }, ...stockGroups ]
            : stockGroups;
    }, [ customFonts, systemFonts ]);
}

/**
 * The stock groups, with the families this device cannot render left out and any group they empty
 * left out with them. The generic families always stay: the browser resolves those itself.
 *
 * The list is a guess at what a device holds, which is why every runtime that cannot enumerate its
 * fonts has to be told which of the guesses landed.
 */
function availableStockGroups(): FontGroup[] {
    const named = FONT_FAMILIES.filter((group) => group !== GENERIC_FONTS);
    const available = new Set(filterAvailableFamilies(named.flatMap((group) => group.items.map(({ value }) => value))));

    const groups = [ GENERIC_FONTS ];
    for (const group of named) {
        const items = group.items.filter(({ value }) => available.has(value));
        if (items.length) {
            groups.push({ ...group, items });
        }
    }

    return groups;
}

/**
 * The generic families, then the installed ones split by advance width. Serif and sans-serif cannot
 * be told apart from a browser — nothing reports a face's style — so this is as far as the grouping
 * goes, and an empty half is left out rather than headed.
 */
function installedFontGroups(systemFonts: SystemFont[]): FontGroup[] {
    const groups = [ GENERIC_FONTS ];
    const named: [ string, SystemFont[] ][] = [
        [ t("fonts.proportional-system-fonts"), systemFonts.filter(({ monospace }) => !monospace) ],
        [ t("fonts.monospace-system-fonts"), systemFonts.filter(({ monospace }) => monospace) ]
    ];

    for (const [ title, fonts ] of named) {
        if (fonts.length) {
            groups.push({ title, items: fonts.map(({ family }) => ({ value: family })) });
        }
    }

    return groups;
}

/**
 * The fonts installed on this device, empty everywhere but the desktop app. The API behind
 * {@link listSystemFonts} also exists in a browser served over HTTPS, where reading it would cost
 * the user a permission prompt for a list the desktop app can have for free — so the ask is kept to
 * the one runtime that grants it itself (see the `local-fonts` entry in `web_contents_security.ts`).
 */
function useSystemFonts(): SystemFont[] {
    const [ fonts, setFonts ] = useState<SystemFont[]>([]);

    useEffect(() => {
        if (!isElectron()) return;

        let cancelled = false;
        void listSystemFonts().then((found) => {
            if (!cancelled) setFonts(found);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    return fonts;
}

/** The family and the size that make up one area's font, as both the card and the picker read them. */
interface FontOption {
    family: string;
    size: number;
    setFamily: (family: string) => void;
    setSize: (size: number) => void;
}

/**
 * Every area's font, so that the picker can be handed whichever area it is on. The options are
 * named here and nowhere else: {@link useTriliumOption} reads its option once and holds what it
 * read, so a picker calling it with a changing name would keep showing the previous area's font.
 */
function useFontOptions(): Record<FontTargetKey, FontOption> {
    return {
        main: useFontOption("mainFontFamily", "mainFontSize"),
        tree: useFontOption("treeFontFamily", "treeFontSize"),
        detail: useFontOption("detailFontFamily", "detailFontSize"),
        monospace: useFontOption("monospaceFontFamily", "monospaceFontSize")
    };
}

function useFontOption(familyOption: OptionNames, sizeOption: OptionNames): FontOption {
    const [ family, saveFamily ] = useTriliumOption(familyOption);
    const [ size, saveSize ] = useTriliumOption(sizeOption);

    return {
        family: family ?? "",
        size: parseInt(size ?? "100", 10),
        setFamily: (newFamily) => void saveFamily(newFamily),
        setSize: (newSize) => void saveSize(String(newSize))
    };
}

interface FontRowProps {
    target: FontTarget;
    option: FontOption;
    /** The picker's groups, the user's own fonts among them (see {@link useFontGroups}). */
    groups: FontGroup[];
    disabled?: boolean;
    onOpen: () => void;
}

function FontRow({ target, option: { family, size }, groups, disabled, onOpen }: FontRowProps) {
    // One of the user's own fonts is named by the note holding it, so its own title says what is
    // set — read from the cache rather than waited for from the listing, and it follows a rename.
    const customFontTitle = useNoteTitle(customFontNoteId(family) ?? undefined, undefined);

    const entry = groups.flatMap((group) => group.items).find((item) => item.value === family);
    const name = customFontTitle ?? entry?.label ?? entry?.value ?? family;

    return (
        <OptionCardSection
            className={clsx("font-option", disabled && "disabled")}
            label={target.label}
            description={target.description}
            onAction={disabled ? undefined : onOpen}
        >
            <span className="font-option-preview">
                <span className="font-option-specimen" style={{ fontFamily: cssFontFamily(target, family), fontSize: `${size}%` }}>{name}</span>
                <span className="tn-card-chevron" />
            </span>
        </OptionCardSection>
    );
}

/** What CSS is given to draw an entry, whose value is not always a family the browser can resolve. */
function cssFontFamily(target: FontTarget, value: string): string {
    if (value === "theme") {
        return target.themeVariable;
    }

    if (value === "system") {
        return target.isMonospace ? SYSTEM_MONOSPACE_FONT_STACK : SYSTEM_SANS_SERIF_FONT_STACK;
    }

    // One of the user's own fonts names the note it is stored in; the family it was registered
    // under is built from the same id.
    const noteId = customFontNoteId(value);
    return noteId ? customFontFamily(noteId) : quoteFamily(value);
}

/**
 * The head of the user's own tree, which is what the font is being chosen for: a tree font is
 * judged on whether titles hold up at the density rows are stacked at, and a line of specimen text
 * says nothing about that.
 *
 * Falls back to {@link PREVIEW_TEXT} on a tree with nothing in it, which is a database that has
 * just been made.
 */
function TreePreview() {
    const roots = useChildNotes("root").slice(0, TREE_PREVIEW_ROOTS);
    // The first root is drawn open, so the rows below it carry the indentation a tree is read by.
    const children = useChildNotes(roots.at(0)?.noteId).slice(0, TREE_PREVIEW_CHILDREN);

    if (!roots.length) {
        return <>{PREVIEW_TEXT}</>;
    }

    return (
        <div className="font-preview-tree">
            {roots.map((note, index) => (
                <Fragment key={note.noteId}>
                    <TreePreviewRow note={note} expanded={index === 0 && children.length > 0} />
                    {index === 0 && children.map((child) => (
                        <TreePreviewRow key={child.noteId} note={child} nested />
                    ))}
                </Fragment>
            ))}
        </div>
    );
}

const TREE_PREVIEW_ROOTS = 3;
const TREE_PREVIEW_CHILDREN = 3;

function TreePreviewRow({ note, expanded, nested }: { note: FNote; expanded?: boolean; nested?: boolean }) {
    // A row with nothing under it keeps the space the others spend on the expander, so the icons
    // stay in one column rather than stepping in and out with each note's own children.
    const expander = note.hasChildren() ? (expanded ? "bx bx-chevron-down" : "bx bx-chevron-right") : "";

    return (
        <div className={clsx("font-preview-tree-row", nested && "nested")}>
            <Icon className="font-preview-tree-expander" icon={expander} />
            <Icon icon={note.getIcon()} />
            <span className="font-preview-tree-title">{note.title}</span>
        </div>
    );
}

/**
 * A heading over a paragraph, which is the shape the font is being chosen for. One line says
 * nothing about how a reading font behaves at length: the spacing between the lines, and the weight
 * a heading takes against the text under it.
 *
 * The paragraph carries a bold and an italic run, which a family missing either of those faces
 * cannot draw: the browser shears and thickens the upright one instead, and notes are written in
 * both often enough that a font that fails at them is the wrong font to have chosen.
 */
function DocumentPreview() {
    return (
        <div className="font-preview-document">
            <h3>{t("fonts.document_preview_heading")}</h3>
            <p>
                <Trans
                    i18nKey="fonts.document_preview_body"
                    components={{
                        strong: <strong />,
                        em: <em />
                    }}
                />
            </p>
        </div>
    );
}

/**
 * A menu and the buttons under it, built from the components the interface is built from rather
 * than mocked up, so what is previewed cannot drift from what it previews. The font is set for the
 * small text beside an icon, the shortcut in its `kbd`, and the label on a button — none of which a
 * line of specimen text stands in for.
 *
 * The labels are entries that already exist elsewhere in the interface, which is both what makes
 * them realistic and what keeps them from costing the catalogue anything.
 */
function InterfacePreview() {
    return (
        // Inert: a specimen of the interface rather than any part of it, and a menu that answered
        // to being pressed would be a menu the user has to work out is not one.
        <div className="font-preview-interface" inert>
            <FormList>
                <FormListItem icon="bx bx-link-external">
                    {t("tree-context-menu.open-in-a-new-tab")}
                    <span className="keyboard-shortcut">{renderShortcutKbds("CommandOrControl+Enter")}</span>
                </FormListItem>
                <FormListItem icon="bx bx-dock-right">{t("tree-context-menu.open-in-a-new-split")}</FormListItem>
                <FormListItem icon="bx bx-trash" disabled>{t("tree-context-menu.delete")}</FormListItem>
            </FormList>

            <div className="font-preview-interface-buttons">
                <Button text={t("confirm.cancel")} />
                <Button text={t("confirm.ok")} kind="primary" />
            </div>
        </div>
    );
}

/** The plot names set `0` against `O` and `1` against `l`; the operators are ligature pairs. */
const CODE_PREVIEW = `const PLOTS = ["01", "10", "11"];

/** Days until a stem in \`plot\` rooted, or null if it never did. */
function rootedAfter(log, plot = PLOTS[0]) {
    const entry = log.find(({ id }) => id === plot);
    if (!entry || entry.days <= 0) return null;

    return \`\${entry.days} days => \${entry.roots ?? 0} roots\`;
}`;

function CodePreview() {
    return <pre className="font-preview-code">{CODE_PREVIEW}</pre>;
}

const PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog. 0123456789";

/** Percentages, of the interface size for the tree and the document and of nothing for itself. */
const FONT_SIZE_MIN = 50;
const FONT_SIZE_MAX = 200;
const FONT_SIZE_STEP = 5;

interface FontPickerModalProps {
    show: boolean;
    onHidden: () => void;
    /** The area being set, which stays put as the dialog fades out so it does not change name. */
    target: FontTarget;
    onTargetChange: (target: FontTarget) => void;
    option: FontOption;
    groups: FontGroup[];
}

function FontPickerModal({ show, onHidden, target, onTargetChange, option: { family, size, setFamily, setSize }, groups }: FontPickerModalProps) {
    const [ query, setQuery ] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const matching = useMemo(() => filterFontGroups(groups, query), [ groups, query ]);
    const { Preview } = target;

    return createPortal(
        <Modal
            className="font-picker-modal"
            title={t("fonts.fonts")}
            size="lg"
            show={show}
            // The list runs to every family the device has, so the search is what the dialog opens on.
            onShown={() => searchRef.current?.focus()}
            onHidden={() => {
                setQuery("");
                onHidden();
            }}
            stackable
            // Beside a sidebar the header carries no title (see `style.css`), so the areas go there:
            // the switch is between what the dialog is setting, not between what it holds.
            header={
                <SegmentedChoice
                    className="font-picker-targets"
                    options={FONT_TARGETS.map(({ key, shortLabel }) => ({ value: key, label: shortLabel }))}
                    currentValue={target.key}
                    onChange={(key) => onTargetChange(FONT_TARGETS.find((candidate) => candidate.key === key) ?? target)}
                    collapseOnMobile
                />
            }
            sidebar={<>
                <SettingsSearch
                    inputRef={searchRef}
                    query={query}
                    onChange={setQuery}
                    placeholder={t("fonts.search_placeholder")}
                />

                {matching.length > 0 ? (
                    <FormList fullHeight wrapperClassName="font-picker-list">
                        {matching.map(group => (
                            <Fragment key={group.title}>
                                <FormListHeader text={group.title} />
                                {group.items.map(item => (
                                    <FormListItem
                                        key={item.value}
                                        onClick={() => setFamily(item.value)}
                                        checked={family === item.value}
                                        selected={family === item.value}
                                    >
                                        <span style={{ fontFamily: cssFontFamily(target, item.value) }}>
                                            {item.label ?? item.value}
                                        </span>
                                    </FormListItem>
                                ))}
                            </Fragment>
                        ))}
                    </FormList>
                ) : (
                    <NoItems className="font-picker-empty" icon="bx bx-search" text={t("fonts.no_fonts_found")} size="small" />
                )}
            </>}
        >
            <div className="font-picker-settings">
                <div className="font-size-control">
                    <label>{t("fonts.size")}</label>
                    <div className="font-size-slider">
                        <Slider
                            value={size}
                            onChange={setSize}
                            min={FONT_SIZE_MIN}
                            max={FONT_SIZE_MAX}
                            step={FONT_SIZE_STEP}
                        />
                        {/* The same control the zoom factor is set by, so a size can be typed and
                            read back rather than only dragged to. */}
                        <FormTextBoxWithUnit
                            className="font-size-value"
                            type="number"
                            min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step={FONT_SIZE_STEP}
                            currentValue={String(size)}
                            onChange={(value) => setSize(parseInt(value, 10))}
                            unit={t("units.percentage")}
                        />
                    </div>
                    {target.sizeDescription && <small className="font-size-description">{target.sizeDescription}</small>}
                </div>

                <div className="font-preview">
                    <label>{t("fonts.preview")}</label>
                    <div
                        className="font-preview-text"
                        style={{
                            fontFamily: cssFontFamily(target, family),
                            fontSize: `${size}%`
                        }}
                    >
                        {Preview ? <Preview /> : PREVIEW_TEXT}
                    </div>
                </div>
            </div>
        </Modal>,
        document.body
    );
}

/**
 * The groups narrowed to the fonts matching `query`, those left with nothing dropped. A group whose
 * own title matches keeps all of its fonts, so a search for "monospace" offers every monospace
 * family rather than only the generic entry named after them.
 */
function filterFontGroups(groups: FontGroup[], query: string): FontGroup[] {
    const tokens = filterTokens(query);
    if (tokens.length === 0) {
        return groups;
    }

    const matching: FontGroup[] = [];
    for (const group of groups) {
        if (matchesFilter(tokens, group.title)) {
            matching.push(group);
            continue;
        }

        // A user font is named by the note holding it; the value is that note's id, which is no
        // name to search by.
        const items = group.items.filter((item) => matchesFilter(tokens, item.label ?? item.value));
        if (items.length > 0) {
            matching.push({ ...group, items });
        }
    }

    return matching;
}
