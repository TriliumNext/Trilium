import "./GeoMapProperties.css";

import { useEffect, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import { t } from "../../../services/i18n";
import {
    CollectionPropertiesDialog, IncludedNotesCard
} from "../../note_bars/CollectionProperties";
import { bookPropertiesConfig } from "../../note_bars/collection-properties-config";
import Admonition from "../../react/Admonition";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import FormDropdownList from "../../react/FormDropdownList";
import FormTextBox from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useNoteLabel, useNoteLabelBoolean, useNoteRelation } from "../../react/hooks";
import NoteAutocomplete from "../../react/NoteAutocomplete";
import { type BookProperty, ViewPropertySection } from "../../react/NotePropertyMenu";
import SegmentedChoice from "../../react/SegmentedChoice";
import { DEFAULT_MAP_LAYER_NAME, isTileUrl } from "./map_layer";
import { formatImageExtent, type ImageSize, parseImageExtent } from "./space";

/** What the map knows of its image: none, loading, unusable, or loaded at its natural size. */
export type GeoMapImageState =
    | { status: "geo" | "loading" }
    | { status: "error"; reason: "unloadable" | "svg" }
    | { status: "image"; size: ImageSize };

/** What a geo map is drawn over: a built-in world map, a raster tileset, or an image note. */
type BackgroundKind = "map" | "tiles" | "image";

interface BackgroundOption {
    value: BackgroundKind;
    title: string;
    description: string;
    icon: string;
    /** Why the option cannot be chosen, if it cannot. */
    unavailable?: string;
}

/**
 * The media types of the image notes a map can be drawn over: MapLibre decodes these, and refuses
 * SVG. `image/jpg` is not a registered type, but it is how Trilium stores a JPEG it compressed.
 */
const MAP_IMAGE_MIMES = [ "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif" ];

/** The search query the image picker is limited to. */
const IMAGE_NOTE_FILTER = `note.type = image AND (${
    MAP_IMAGE_MIMES.map((mime) => `note.mime = '${mime}'`).join(" OR ")})`;

/** The longest side, in pixels, that practically every graphics card can draw an image at. */
const SAFE_IMAGE_SIDE = 4096;

/**
 * The geo map's settings: those of the collection's settings dropdown, and what the map is drawn
 * over, which this dialog sets up in full.
 */
export default function GeoMapProperties({ note, image, onClose }: {
    note: FNote;
    image: GeoMapImageState;
    onClose: () => void;
}) {
    return (
        <CollectionPropertiesDialog
            className="geo-map-properties-dialog"
            title={t("geo-map.properties-title")}
            show
            onHidden={onClose}
        >
            <Card className="geo-map-properties-general" heading={t("geo-map.general")}>
                {GENERAL_PROPERTIES.map((property, index) => (
                    <ViewPropertySection key={index} note={note} property={property} />
                ))}
            </Card>

            <IncludedNotesCard note={note} />

            <BackgroundCard note={note} image={image} />
        </CollectionPropertiesDialog>
    );
}

/** The settings dropdown's map style, which the Background card holds instead of General. */
const MAP_STYLE_PROPERTY = bookPropertiesConfig.geoMap.properties.find(isMapStyle);

/** What the settings dropdown offers for a geo map, which the General card repeats. */
const GENERAL_PROPERTIES = bookPropertiesConfig.geoMap.properties
    .filter((property) => !isMapStyle(property));

function isMapStyle(property: BookProperty) {
    return "bindToLabel" in property && property.bindToLabel === "map:style";
}

/**
 * A built-in world map with its style, a tileset with its URL, or an image with its coordinates.
 *
 * Leaving the image disables `~map:image` as `~disabled:map:image` rather than removing it, and
 * going back to a built-in style disables a tileset's `#map:style` the same way; choosing either
 * again enables it. Without a disabled one, choosing the image or a tileset writes nothing until an
 * image note is picked or a URL is entered, so the map stays drawn as it was until then. An
 * inherited image can only be disabled on the note that owns it.
 */
function BackgroundCard({ note, image }: { note: FNote; image: GeoMapImageState }) {
    const [ imageNoteId, setImageNoteId ] = useNoteRelation(note, "map:image");
    const [ style, setStyle ] = useNoteLabel(note, "map:style");
    // Read so that the card follows the image and the tileset being disabled and enabled.
    useNoteRelation(note, "disabled:map:image");
    useNoteLabel(note, "disabled:map:style");
    const tileUrl = isTileUrl(style) ? style : undefined;
    const savedKind: BackgroundKind = imageNoteId ? "image" : tileUrl ? "tiles" : "map";
    const [ kind, setKind ] = useState<BackgroundKind>(savedKind);
    const isInherited = !!imageNoteId && !note.getOwnedRelation("map:image");
    const inheritedReason = isInherited ? t("geo-map.background-image-inherited") : undefined;
    const options = BACKGROUND_OPTIONS.map((option) =>
        option.value !== "image" ? { ...option, unavailable: inheritedReason } : option);

    useEffect(() => {
        if (savedKind !== "map") setKind(savedKind);
    }, [ savedKind ]);

    function changeKind(newKind: BackgroundKind) {
        setKind(newKind);
        const hasTileset = !!tileUrl || !!note.getOwnedLabel("disabled:map:style");
        const replacesImage = newKind === "map" || (newKind === "tiles" && hasTileset);
        if (replacesImage && note.getOwnedRelation("map:image")) {
            disableImage();
        } else if (newKind === "image" && !imageNoteId && note.getOwnedRelation("disabled:map:image")) {
            void attributes.toggleDangerousAttribute(note, "relation", "map:image", true);
        }

        if (newKind === "map" && tileUrl) {
            if (note.getOwnedLabel("map:style")) {
                void attributes.toggleDangerousAttribute(note, "label", "map:style", false);
            } else {
                // An inherited tileset is overridden, since only its owner can disable it.
                setStyle(DEFAULT_MAP_LAYER_NAME);
            }
        } else if (newKind === "tiles" && !tileUrl && note.getOwnedLabel("disabled:map:style")) {
            void attributes.toggleDangerousAttribute(note, "label", "map:style", true);
        }
    }

    function pickImage(noteId: string) {
        setImageNoteId(noteId);
        // The note holds one image at a time, so a disabled one does not outlive its replacement.
        if (note.getOwnedRelation("disabled:map:image")) {
            void attributes.removeOwnedRelationByName(note, "disabled:map:image");
        }
    }

    function setTileUrl(url: string) {
        setStyle(url);
        if (note.getOwnedLabel("disabled:map:style")) {
            void attributes.removeOwnedLabelByName(note, "disabled:map:style");
        }
        if (note.getOwnedRelation("map:image")) {
            disableImage();
        }
    }

    function disableImage() {
        void attributes.toggleDangerousAttribute(note, "relation", "map:image", false);
    }

    return (
        <Card className="geo-map-properties-background" heading={t("geo-map.background")}>
            <OptionCardSection
                className="geo-map-background-type"
                label={t("geo-map.background-type")}
                description={inheritedReason}
            >
                <FormDropdownList
                    values={options}
                    keyProperty="value"
                    titleProperty="title"
                    descriptionProperty="description"
                    iconProperty="icon"
                    disabledProperty="unavailable"
                    currentValue={kind}
                    onChange={(value) => changeKind(value as BackgroundKind)}
                />
            </OptionCardSection>

            {kind === "map" && MAP_STYLE_PROPERTY && (
                <ViewPropertySection note={note} property={MAP_STYLE_PROPERTY} />
            )}

            {kind === "tiles" && (
                <TileSettings note={note} tileUrl={tileUrl} onChangeUrl={setTileUrl} />
            )}

            {kind === "image" && (
                <ImageSettings
                    note={note}
                    image={image}
                    imageNoteId={imageNoteId}
                    onPickImage={pickImage}
                />
            )}
        </Card>
    );
}

const BACKGROUND_OPTIONS: BackgroundOption[] = [
    {
        value: "map",
        title: t("geo-map.background-map"),
        description: t("geo-map.background-map-description"),
        icon: "bx bx-world"
    },
    {
        value: "tiles",
        title: t("geo-map.background-tiles"),
        description: t("geo-map.background-tiles-description"),
        icon: "bx bx-grid-alt"
    },
    {
        value: "image",
        title: t("geo-map.background-image"),
        description: t("geo-map.background-image-description"),
        icon: "bx bx-image"
    }
];

/** A tileset's URL, committed when the box is left, and whether its tiles are dark. */
function TileSettings({ note, tileUrl, onChangeUrl }: {
    note: FNote;
    tileUrl: string | undefined;
    onChangeUrl: (url: string) => void;
}) {
    const [ isDarkTiles, setDarkTiles ] = useNoteLabelBoolean(note, "map:darkStyle");
    const [ draft, setDraft ] = useState(tileUrl ?? "");
    const [ isInvalid, setInvalid ] = useState(false);

    useEffect(() => {
        setDraft(tileUrl ?? "");
        setInvalid(false);
    }, [ tileUrl ]);

    function commit(value: string) {
        const url = value.trim();
        if (!url || url === tileUrl) {
            setInvalid(false);
            return;
        }

        const isValid = isTileUrlTemplate(url);
        setInvalid(!isValid);
        if (isValid) onChangeUrl(url);
    }

    return <>
        <OptionCardSection
            label={t("geo-map.tiles-url")}
            description={t("geo-map.tiles-url-description")}
            stacked
        >
            <FormTextBox
                className="geo-map-tiles-url"
                type="url"
                placeholder={TILE_URL_PLACEHOLDER}
                currentValue={draft}
                onChange={setDraft}
                onBlur={commit}
            />
        </OptionCardSection>

        {isInvalid && (
            <CardSection>
                <Admonition type="caution" className="geo-map-tiles-url-error">
                    {t("geo-map.tiles-url-invalid")}
                </Admonition>
            </CardSection>
        )}

        <OptionCardSection
            name="geo-map-dark-tiles"
            label={t("geo-map.dark-tiles")}
            description={t("geo-map.dark-tiles-description")}
        >
            <FormToggle currentValue={isDarkTiles} onChange={setDarkTiles} />
        </OptionCardSection>
    </>;
}

const TILE_URL_PLACEHOLDER = "https://tile.example.org/{z}/{x}/{y}.png";

/** Whether a URL can serve tiles: an `http(s)` address naming the tile by `{z}/{x}/{y}` or `{quadkey}`. */
export function isTileUrlTemplate(url: string) {
    if (!isTileUrl(url)) return false;
    return url.includes("{quadkey}")
        || [ "{z}", "{x}", "{y}" ].every((placeholder) => url.includes(placeholder));
}

function ImageSettings({ note, image, imageNoteId, onPickImage }: {
    note: FNote;
    image: GeoMapImageState;
    imageNoteId: string | null | undefined;
    onPickImage: (noteId: string) => void;
}) {
    const [ isDarkImage, setDarkImage ] = useNoteLabelBoolean(note, "map:darkStyle");
    const notice = imageNotice(image);

    return <>
        <OptionCardSection
            label={t("geo-map.image-note")}
            description={t("geo-map.image-note-description")}
            stacked
        >
            <NoteAutocomplete
                noteId={imageNoteId ?? undefined}
                placeholder={t("geo-map.image-note-placeholder")}
                filter={IMAGE_NOTE_FILTER}
                noteIdChanged={onPickImage}
            />
        </OptionCardSection>

        {imageNoteId && notice && (
            <CardSection>
                <Admonition type={notice.type} className="geo-map-image-notice">
                    {notice.text}
                </Admonition>
            </CardSection>
        )}

        {imageNoteId && <>
            <ImageCoordinates
                note={note}
                size={image.status === "image" ? image.size : undefined}
            />
            <OptionCardSection
                name="geo-map-dark-image"
                label={t("geo-map.dark-image")}
                description={t("geo-map.dark-image-description")}
            >
                <FormToggle currentValue={isDarkImage} onChange={setDarkImage} />
            </OptionCardSection>
        </>}
    </>;
}

/**
 * Whether positions are measured in the image's pixels or in coordinates of the map's own, and the
 * corners those coordinates give the image (`#map:imageBounds`).
 */
function ImageCoordinates({ note, size }: { note: FNote; size: ImageSize | undefined }) {
    const [ boundsValue, setBoundsValue ] = useNoteLabel(note, "map:imageBounds");
    const isCustom = boundsValue !== null && boundsValue !== undefined;
    const isInherited = isCustom && !note.getOwnedLabel("map:imageBounds");
    // Custom corners start from the image's size, so they cannot be chosen before it is known.
    const isDisabled = isInherited || (!isCustom && !size);
    const [ corners, setCorners ] = useState(() => cornersOf(boundsValue));
    const [ isInvalid, setInvalid ] = useState(false);

    useEffect(() => {
        setCorners(cornersOf(boundsValue));
        setInvalid(false);
    }, [ boundsValue ]);

    function changeMode(mode: string) {
        if (mode === "custom") {
            // Starts from the pixels, so that switching leaves every marker where it is.
            if (!size) return;
            setBoundsValue(formatImageExtent({
                topLeft: [ 0, 0 ],
                bottomRight: [ size.width, size.height ]
            }));
        } else {
            setBoundsValue(null);
        }
    }

    function commitCorner(index: number, value: string) {
        const next = [ ...corners ];
        next[index] = value;
        setCorners(next);

        const extent = parseImageExtent(`${next[0]},${next[1]} ${next[2]},${next[3]}`);
        setInvalid(!extent);
        if (extent) {
            setBoundsValue(formatImageExtent(extent));
        }
    }

    return (
        <OptionCardSection
            className="geo-map-coordinates"
            label={t("geo-map.coordinates")}
            description={isInherited
                ? t("geo-map.coordinates-inherited")
                : t("geo-map.coordinates-description")}
            subSectionsVisible
            subSections={isCustom ? <>
                <CornerSection
                    label={t("geo-map.top-left-corner")}
                    x={corners[0]} y={corners[1]}
                    onCommit={commitCorner}
                />
                <CornerSection
                    label={t("geo-map.bottom-right-corner")}
                    x={corners[2]} y={corners[3]}
                    onCommit={(axis, value) => commitCorner(2 + axis, value)}
                />
                {isInvalid && (
                    <CardSection>
                        <Admonition type="caution" className="geo-map-coordinates-error">
                            {t("geo-map.coordinates-invalid")}
                        </Admonition>
                    </CardSection>
                )}
            </> : undefined}
        >
            <SegmentedChoice
                options={[
                    { value: "pixels", label: t("geo-map.coordinates-pixels") },
                    { value: "custom", label: t("geo-map.coordinates-custom") }
                ]}
                currentValue={isCustom ? "custom" : "pixels"}
                onChange={changeMode}
                disabled={isDisabled}
            />
        </OptionCardSection>
    );
}

/** One corner of the image, as an `x` and a `y` committed when either box is left. */
function CornerSection({ label, x, y, onCommit }: {
    label: string;
    x: string;
    y: string;
    /** Called with 0 for `x` and 1 for `y`. */
    onCommit: (axis: 0 | 1, value: string) => void;
}) {
    return (
        <OptionCardSection className="geo-map-corner" label={label}>
            <FormTextBox
                type="number" step="any" placeholder="x" aria-label={`${label} x`}
                currentValue={x} onBlur={(value) => onCommit(0, value)}
            />
            <FormTextBox
                type="number" step="any" placeholder="y" aria-label={`${label} y`}
                currentValue={y} onBlur={(value) => onCommit(1, value)}
            />
        </OptionCardSection>
    );
}

/** The four numbers of a `#map:imageBounds` value, empty where it names no corners. */
function cornersOf(value: string | null | undefined): string[] {
    const extent = parseImageExtent(value);
    return extent ? [ ...extent.topLeft, ...extent.bottomRight ].map(String) : [ "", "", "", "" ];
}

interface ImageNotice {
    type: "caution" | "warning";
    text: string;
}

/** What the dialog says about an image that cannot be drawn, or might not be on every device. */
function imageNotice(image: GeoMapImageState): ImageNotice | null {
    if (image.status === "error") {
        return {
            type: "caution",
            text: t(image.reason === "svg"
                ? "geo-map.image-svg-unsupported"
                : "geo-map.image-unavailable")
        };
    }
    if (image.status !== "image") return null;

    const { width, height } = image.size;
    if (Math.max(width, height) <= SAFE_IMAGE_SIDE) return null;
    return {
        type: "warning",
        text: t("geo-map.image-too-large", { width, height, limit: SAFE_IMAGE_SIDE })
    };
}
