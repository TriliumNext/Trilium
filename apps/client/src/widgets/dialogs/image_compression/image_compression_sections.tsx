import "./image_compression_sections.css";

import { IMAGE_JPEG_HANDLINGS, IMAGE_PNG_HANDLINGS } from "@triliumnext/commons";
import clsx from "clsx";

import { t } from "../../../services/i18n";
import { CardSection } from "../../react/Card";
import ContextualHelp from "../../react/ContextualHelp";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import SegmentedChoice from "../../react/SegmentedChoice";
import Slider from "../../react/Slider";
import {
    type ImageCompressionToolOptions,
    MAX_QUALITY,
    MIN_MAX_WIDTH_HEIGHT,
    MIN_QUALITY,
    QUALITY_STEP
} from "./image_compression_options";

/**
 * The rows that configure an image compression run, each a `CardSection` of its own so a host shows
 * only the ones that mean anything where it stands — the dialog drops the subtree row for a single
 * image, and drops a format's row entirely when the image being compressed is not of that format.
 *
 * Each format is one exclusive choice rather than a set of switches, because only one thing can
 * ever become of a given image. What qualifies a choice is nested beneath it and appears only while
 * that choice is the one taken, so nothing on screen is a figure no longer in force.
 *
 * Every row takes the whole settings object and reports a patch, rather than a value and a setter,
 * so a host wires the group once and adding a row later costs it nothing.
 */
export interface ImageCompressionSectionProps {
    options: ImageCompressionToolOptions;
    onChange(patch: Partial<ImageCompressionToolOptions>): void;
    /** Greys the controls out, for a host that hangs the whole group off a switch of its own. */
    disabled?: boolean;
    /**
     * A sentence under a row's title, for a host with room to explain rather than to be asked.
     *
     * Keyed by row rather than passed to one, because the group is wired once and handed down: a
     * nested row is rendered by the row above it, and this is what lets a host still describe it.
     *
     * The settings page fills these in; the dialogs leave them out. A dialog is opened to do one
     * thing and is read in a hurry, so what a row means lives behind its help mark and stays out of
     * the way — where a settings page is read by someone deciding, and the prose is the point. Rows
     * with nothing extra to say keep the mark alone.
     */
    descriptions?: Partial<Record<ImageCompressionSectionKey, string>>;
}

/** The rows a host can describe, named after the setting each one carries. */
export type ImageCompressionSectionKey =
    | "resize"
    | "maxWidthHeight"
    | "jpegHandling"
    | "pngHandling"
    | "quality"
    | "conversionQuality"
    | "processChildNotes";

/**
 * Scaling an oversized image down, with the bound it is scaled to. The bound appears only while the
 * step is on: with it off nothing is measured against it, so a figure sitting there would read as
 * one still in force.
 */
export function ResizeImageSection(props: ImageCompressionSectionProps) {
    const { options, onChange, disabled } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.resize}
            subSections={[ <MaxImageDimensionsSection key="max-dimensions" {...props} /> ]}
        >
            <SectionLabel
                title={t("space_usage.compress_resize")}
                help={t("space_usage.compress_resize_help")}
                description={props.descriptions?.resize}
            />
            <FormToggle
                disabled={disabled}
                currentValue={options.resize}
                onChange={(value) => onChange({ resize: value })}
            />
        </CardSection>
    );
}

/** The bound an image is scaled down to fit. */
export function MaxImageDimensionsSection({ options, onChange, disabled, descriptions }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section image-compression-section-nested">
            <SectionLabel
                title={t("space_usage.compress_max_dimensions")}
                description={descriptions?.maxWidthHeight}
            />
            <FormTextBoxWithUnit
                className="image-compression-section-number"
                type="number"
                min={MIN_MAX_WIDTH_HEIGHT}
                disabled={disabled}
                unit={t("images.max_image_dimensions_unit")}
                currentValue={String(options.maxWidthHeight)}
                onChange={(value) => onChange({
                    maxWidthHeight: Math.max(parseInt(value, 10) || MIN_MAX_WIDTH_HEIGHT, MIN_MAX_WIDTH_HEIGHT)
                })}
            />
        </CardSection>
    );
}

/**
 * What becomes of an already-lossy image. Recompressing brings its own quality with it, nested
 * underneath — it governs that choice and nothing else, an image merely being scaled going out at a
 * near-lossless quality of the server's own.
 */
export function JpegHandlingSection(props: ImageCompressionSectionProps) {
    const { options, onChange } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.jpegHandling === "compress"}
            subSections={[ <JpegQualitySection key="quality" {...props} /> ]}
        >
            <HandlingChoice
                {...props}
                title={t("space_usage.compress_jpeg_handling")}
                help={t("space_usage.compress_jpeg_handling_help")}
                values={IMAGE_JPEG_HANDLINGS}
                currentValue={options.jpegHandling}
                description={props.descriptions?.jpegHandling}
                labelKey="compress_jpeg"
                onChoose={(jpegHandling) => onChange({ jpegHandling })}
            />
        </CardSection>
    );
}

/**
 * What becomes of a lossless image — one exclusive choice, because only one of the three can ever
 * happen to it: it survives as it is, survives smaller, or stops being a PNG. Converting brings its
 * own quality with it, nested underneath, since someone converting a pristine original may well
 * want more quality there than they would spend recompressing something already lossy.
 */
export function PngHandlingSection(props: ImageCompressionSectionProps) {
    const { options, onChange } = props;

    return (
        <CardSection
            className="image-compression-section"
            subSectionsVisible={options.pngHandling === "jpeg"}
            subSections={[ <ConversionQualitySection key="conversion-quality" {...props} /> ]}
        >
            <HandlingChoice
                {...props}
                title={t("space_usage.compress_png_handling")}
                help={t("space_usage.compress_png_handling_help")}
                values={IMAGE_PNG_HANDLINGS}
                currentValue={options.pngHandling}
                description={props.descriptions?.pngHandling}
                labelKey="compress_png"
                onChoose={(pngHandling) => onChange({ pngHandling })}
            />
        </CardSection>
    );
}

/** The quality an already-lossy image is recompressed at. */
export function JpegQualitySection({ options, onChange, disabled, descriptions }: ImageCompressionSectionProps) {
    return (
        <QualitySlider
            value={options.quality}
            disabled={disabled}
            description={descriptions?.quality}
            onChange={(quality) => onChange({ quality })}
        />
    );
}

/** The quality a converted lossless image is written at, kept apart from the one above. */
export function ConversionQualitySection({ options, onChange, disabled, descriptions }: ImageCompressionSectionProps) {
    return (
        <QualitySlider
            value={options.conversionQuality}
            disabled={disabled}
            description={descriptions?.conversionQuality}
            onChange={(conversionQuality) => onChange({ conversionQuality })}
        />
    );
}

/** Whether the run reaches past the note it was invoked on, into its whole subtree. */
export function ProcessChildNotesSection({ options, onChange, disabled, descriptions }: ImageCompressionSectionProps) {
    return (
        <CardSection className="image-compression-section">
            <SectionLabel
                title={t("space_usage.compress_process_child_notes")}
                help={t("space_usage.compress_process_child_notes_help")}
                description={descriptions?.processChildNotes}
            />
            <FormToggle
                disabled={disabled}
                currentValue={options.processChildNotes}
                onChange={(value) => onChange({ processChildNotes: value })}
            />
        </CardSection>
    );
}

/**
 * Said in place of a format's choice when the image being compressed is of neither kind the run can
 * act on. Better than an empty card: the dialog opened, and the reason nothing is on offer is the
 * one thing it can usefully say.
 */
export function UnsupportedFormatNotice() {
    return (
        <CardSection className="image-compression-notice">
            {t("space_usage.compress_unsupported_format")}
        </CardSection>
    );
}

/**
 * What a row is called, and — where the host gave one — what it means.
 *
 * Undescribed, this is the bare title span the rows have always been built from, so a dialog's
 * markup is exactly what it was. A description wraps the pair in a column instead: the title keeps
 * its own element, since the title is what the row's layout is measured against, and the sentence
 * hangs beneath it where it can wrap.
 */
function SectionLabel({ title, help, description }: { title: string; help?: string; description?: string }) {
    const label = (
        <span className="image-compression-section-title">
            {title}
            {help && <ContextualHelp helpMessage={help} />}
        </span>
    );

    if (!description) {
        return label;
    }

    return (
        <span className="image-compression-section-label">
            {label}
            <small className="image-compression-section-description">{description}</small>
        </span>
    );
}

/** The title, help and buttons every format choice is made of. */
function HandlingChoice<T extends string>({ title, help, description, values, currentValue, labelKey, onChoose, disabled }: {
    title: string;
    help: string;
    description?: string;
    values: readonly T[];
    currentValue: T;
    /** Prefix of the translation key naming each choice, completed with the value itself. */
    labelKey: string;
    onChoose: (value: T) => void;
} & ImageCompressionSectionProps) {
    return (
        <>
            <SectionLabel title={title} help={help} description={description} />
            <SegmentedChoice
                className="image-compression-section-choice"
                // A disabled group highlights nothing rather than showing a choice it will not take.
                currentValue={disabled ? "" : currentValue}
                options={values.map((value) => ({ value, label: t(`space_usage.${labelKey}_${value}`) }))}
                onChange={(value) => !disabled && onChoose(value)}
            />
        </>
    );
}

/**
 * The row both qualities are made of: a title, the current figure, and the slider it reads.
 *
 * The figure sits between the two rather than inside the title — a slider says which way it is
 * going but never where it is, and the reading belongs beside the control it reads. Always nested,
 * each quality qualifying exactly one choice above it.
 */
function QualitySlider({ value, onChange, disabled, description }: {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
    description?: string;
}) {
    return (
        <CardSection className={clsx("image-compression-section", "image-compression-section-nested")}>
            <SectionLabel title={t("space_usage.compress_quality")} description={description} />
            <span className="image-compression-section-value">
                {t("space_usage.compress_quality_value", { quality: value })}
            </span>
            <Slider
                min={MIN_QUALITY}
                max={MAX_QUALITY}
                step={QUALITY_STEP}
                disabled={disabled}
                value={value}
                onChange={onChange}
            />
        </CardSection>
    );
}
