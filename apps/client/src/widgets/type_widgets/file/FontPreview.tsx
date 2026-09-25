import "./FontPreview.css";

import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";

import type FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import { registerFontNote } from "../../../services/custom_fonts";
import { t } from "../../../services/i18n";
import Alert from "../../react/Alert";
import FormTextBox from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useNoteLabelBoolean } from "../../react/hooks";
import Slider from "../../react/Slider";

/** The sizes the specimen is laddered at, from a display line down to body copy. */
const LADDER_SIZES = [ 36, 24, 18, 14, 12 ];

const MIN_SPECIMEN_SIZE = 12;
const MAX_SPECIMEN_SIZE = 96;
const DEFAULT_SPECIMEN_SIZE = 56;

/** The Latin repertoire, shown as a fixed sample of what the file draws. Any other script can be
 *  typed into the specimen box instead. */
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const DIGITS_AND_PUNCTUATION = "0123456789 & @ $ # % () [] {} / \\ ? ! . , ; : “ ” – —";

interface FontPreviewProps {
    note: FNote;
    /** The note's blob, fetched by the file widget. A font blob arrives contentless — the bytes are
     *  fetched below — but it is watched, so a replaced file re-reads. */
    blob: FBlob | null | undefined;
}

/**
 * Main-view preview for font files: the file rendered in itself, where "no preview available" used
 * to be — an editable specimen line whose size the slider drives, the same text laddered down to
 * body sizes, and the Latin repertoire.
 */
export default function FontPreview({ note, blob }: FontPreviewProps) {
    const family = useLoadedFont(note, blob);
    const [ specimen, setSpecimen ] = useState("");
    const [ size, setSize ] = useState(DEFAULT_SPECIMEN_SIZE);

    if (family === undefined) {
        return null;
    }
    if (family === null) {
        // A file the engine will not rasterize gets the notice any other unpreviewable file gets.
        return (
            <Alert className="file-preview-not-available" type="info">
                {t("file.file_preview_not_available")}
            </Alert>
        );
    }

    const text = specimen.trim() ? specimen : t("font_preview.pangram");

    return (
        <div className="font-preview selectable-text" style={{ "--font-preview-family": `"${family}"` }}>
            <div className="font-preview-controls">
                <FormTextBox
                    className="font-preview-specimen-input"
                    currentValue={specimen}
                    onChange={(newValue) => setSpecimen(newValue)}
                    placeholder={t("font_preview.specimen_placeholder")}
                />
                <div className="font-preview-size">
                    <Slider
                        value={size}
                        min={MIN_SPECIMEN_SIZE}
                        max={MAX_SPECIMEN_SIZE}
                        onChange={setSize}
                        title={t("font_preview.size")}
                    />
                    <span className="font-preview-size-value">{t("font_preview.size_pixels", { size })}</span>
                </div>

                <PickerOffer note={note} />
            </div>

            <div className="font-preview-specimen" style={{ "--font-preview-specimen-size": `${size}px` }}>{text}</div>

            <div className="font-preview-ladder">
                {LADDER_SIZES.map((ladderSize) => (
                    <Fragment key={ladderSize}>
                        <div className="font-preview-ladder-size">{t("font_preview.size_pixels", { size: ladderSize })}</div>
                        <div className="font-preview-ladder-line" style={{ "--font-preview-ladder-size": `${ladderSize}px` }}>{text}</div>
                    </Fragment>
                ))}
            </div>

            <div className="font-preview-characters">
                <div>{UPPERCASE}</div>
                <div>{LOWERCASE}</div>
                <div>{DIGITS_AND_PUNCTUATION}</div>
            </div>
        </div>
    );
}

/** Whether the font picker in the appearance settings offers this font, and the switch that puts it
 *  there or takes it back — the `#customFont` label, which the picker reads. */
function PickerOffer({ note }: { note: FNote }) {
    const [ offered, setOffered ] = useNoteLabelBoolean(note, "customFont");

    return (
        <div className="font-preview-offer">
            <FormToggle
                currentValue={offered}
                switchOnName={t("font_preview.in_picker")}
                switchOnTooltip={t("font_preview.offer_in_picker")}
                switchOffName={t("font_preview.in_picker")}
                switchOffTooltip={t("font_preview.remove_from_picker")}
                onChange={setOffered}
            />
        </div>
    );
}

/**
 * Registers the note's font with the document for as long as the preview is mounted, and returns
 * the family name to render it with — `undefined` while it loads, `null` if the file is not a font
 * the engine accepts.
 */
function useLoadedFont(note: FNote, blob: FBlob | null | undefined) {
    const [ family, setFamily ] = useState<string | null>();

    useEffect(() => {
        if (!blob) return;
        if (!note.isContentAvailable()) {
            setFamily(null);
            return;
        }

        let cancelled = false;
        let registered: FontFace | undefined;
        // Private to this note, so a preview can never shadow the font the app itself renders in.
        const previewFamily = `trilium-font-preview-${note.noteId}`;
        setFamily(undefined);

        (async () => {
            try {
                const face = await registerFontNote(note.noteId, previewFamily, blob.blobId);
                if (cancelled) {
                    document.fonts.delete(face);
                    return;
                }

                registered = face;
                setFamily(previewFamily);
            } catch {
                if (!cancelled) setFamily(null);
            }
        })();

        return () => {
            cancelled = true;
            if (registered) document.fonts.delete(registered);
        };
    }, [ note, blob ]);

    return family;
}
