import "./ColorPicker.css";

import clsx from "clsx";
import Color, { ColorInstance } from "color";
import { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";
import Debouncer from "../../utils/debouncer";

/** Curated default preset palette, using Trilium note-color-friendly CSS colors. */
export const DEFAULT_COLOR_PALETTE = [
    "#e64d4d", "#e6994d", "#e5e64d", "#99e64d", "#4de64d", "#4de699",
    "#4de5e6", "#4d99e6", "#4d4de6", "#994de6", "#e64db3"
];

export interface ColorPickerProps {
    /** The current CSS color (e.g. `#ff8800`). `null` means "no color". */
    currentValue: string | null;
    /** Called with the newly picked color, or `null` when the color is cleared. */
    onChange(newValue: string | null): void;
    /** Preset swatches shown in the row. Defaults to a curated palette. */
    presets?: string[];
    /**
     * Renders no cell as selected, for when the picker stands for several targets that don't agree
     * on a color. Picking still applies to all of them.
     */
    indeterminate?: boolean;
    disabled?: boolean;
    className?: string;
    /** Overrides the cell tooltips, for callers that can word them more specifically. */
    tooltips?: {
        clear?: string;
        set?: string;
        setCustom?: string;
    };
}

/**
 * A row of preset color swatches plus a "clear" cell and a custom cell backed by the browser's
 * native `<input type="color">`.
 *
 * This is a controlled component: it renders `currentValue` and reports picks through `onChange`
 * (`onChange(null)` clears). It has no knowledge of notes or attributes — for the note-bound
 * variant that reads and writes the `color` label, see `NoteColorPicker`.
 */
export default function ColorPicker({ currentValue, onChange, presets = DEFAULT_COLOR_PALETTE, indeterminate, disabled, className, tooltips }: ColorPickerProps) {
    const normalizedValue = normalizeColor(currentValue);
    const isCustomColor = !indeterminate && normalizedValue !== null && presets.indexOf(normalizedValue) === -1;

    return <div className={clsx("color-picker", className)}>

        <ColorCell className="color-cell-reset"
            tooltip={tooltips?.clear ?? t("color-picker.clear-color")}
            color={null}
            isSelected={(!indeterminate && normalizedValue === null)}
            isDisabled={disabled}
            onSelect={onChange}>

            {/* https://pictogrammers.com/library/mdi/icon/close/ */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
            </svg>
        </ColorCell>


        {presets.map((color) => (
            <ColorCell key={color}
                tooltip={tooltips?.set ?? t("color-picker.set-color")}
                color={color}
                isSelected={(!indeterminate && color === normalizedValue)}
                isDisabled={disabled}
                onSelect={onChange} />
        ))}

        <CustomColorCell tooltip={tooltips?.setCustom ?? t("color-picker.set-custom-color")}
            color={normalizedValue}
            isSelected={isCustomColor}
            isDisabled={disabled}
            onSelect={onChange} />
    </div>;
}

interface ColorCellProps {
    children?: ComponentChildren,
    className?: string,
    tooltip?: string,
    color: string | null,
    isSelected: boolean,
    isDisabled?: boolean,
    onSelect?: (color: string | null) => void
}

function ColorCell(props: ColorCellProps) {
    return <div className={clsx(props.className, {
        "color-cell": true,
        "selected": props.isSelected,
        "disabled-color-cell": props.isDisabled
    })}
    style={`${(props.color !== null) ? `--color: ${props.color}` : ""}`}
    title={props.tooltip}
    onClick={() => !props.isDisabled && props.onSelect?.(props.color)}>
        {props.children}
    </div>;
}

function CustomColorCell(props: ColorCellProps) {
    const [pickedColor, setPickedColor] = useState<string | null>(null);
    const colorInput = useRef<HTMLInputElement>(null);
    const colorInputDebouncer = useRef<Debouncer<string | null> | null>(null);
    const callbackRef = useRef(props.onSelect);

    useEffect(() => {
        colorInputDebouncer.current = new Debouncer(250, (color) => {
            callbackRef.current?.(color);
            setPickedColor(color);
        });

        return () => {
            colorInputDebouncer.current?.destroy();
        };
    }, []);

    useEffect(() => {
        if (props.isSelected && pickedColor === null) {
            setPickedColor(props.color);
        }
    }, [props.isSelected]);

    useEffect(() => {
        callbackRef.current = props.onSelect;
    }, [props.onSelect]);

    const onSelect = useCallback(() => {
        if (pickedColor !== null) {
            callbackRef.current?.(pickedColor);
        }

        colorInput.current?.click();
    }, [pickedColor]);

    return <div style={`--foreground: ${getForegroundColor(props.color)};`}
        onClick={isMobile() ? (e) => {
            // The color picker dropdown will close on some browser if the parent context menu is
            // dismissed, so stop the click propagation to prevent dismissing the menu.
            e.stopPropagation();
        } : undefined}>
        <ColorCell {...props}
            color={pickedColor}
            className={clsx("custom-color-cell", {
                "custom-color-cell-empty": (pickedColor === null)
            })}
            onSelect={onSelect}>

            <input ref={colorInput}
                type="color"
                disabled={props.isDisabled}
                value={pickedColor ?? props.color ?? "#40bfbf"}
                onChange={() => {colorInputDebouncer.current?.updateValue(colorInput.current?.value ?? null);}}
                style="width: 0; height: 0; opacity: 0" />
        </ColorCell>
    </div>;
}

/**
 * Brings a color into the notation the presets are written in, so that the two can be compared.
 * The alpha channel is kept when there is one, letting callers offer translucent presets.
 */
function normalizeColor(color: string | null) {
    if (!color) return null;

    const parsed = tryParseColor(color);
    if (!parsed) return null;

    return (parsed.alpha() < 1 ? parsed.hexa() : parsed.hex()).toLowerCase();
}

function getForegroundColor(backgroundColor: string | null) {
    if (backgroundColor === null) return "inherit";

    const colorHsl = tryParseColor(backgroundColor)?.hsl();
    if (colorHsl) {
        const l = colorHsl.lightness();
        return colorHsl.saturationl(0).lightness(l >= 50 ? 0 : 100).hex();
    }
    return "inherit";

}

export function tryParseColor(colorStr: string): ColorInstance | null {
    try {
        return new Color(colorStr);
    } catch(ex) {
        console.error(ex);
    }

    return null;
}
