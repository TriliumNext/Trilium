import "./ColorPicker.css";

import clsx from "clsx";

import Dropdown from "./Dropdown";
import Icon from "./Icon";

/** Curated default preset palette, using Trilium note-color-friendly CSS colors. */
const DEFAULT_PRESETS = [
    "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00897b",
    "#00acc1", "#1e88e5", "#3949ab", "#8e24aa", "#d81b60",
    "#6d4c41", "#757575", "#000000", "#ffffff"
];

interface ColorPickerProps {
    /** The current CSS color (e.g. `#ff8800`). Empty string means "no color". */
    currentValue: string;
    onChange(newValue: string): void;
    /** Preset swatches shown in the grid. Defaults to a curated palette. */
    presets?: string[];
    /** Tooltip / accessible label for the trigger. */
    title?: string;
    disabled?: boolean;
    className?: string;
}

/**
 * A color picker combining preset swatches with the browser's native color picker.
 *
 * The trigger is a swatch + label; the popover (a themed {@link Dropdown}) shows a grid of preset
 * swatches plus a native `<input type="color">` for arbitrary colors and a clear action. Value is a CSS
 * color string (`onChange("")` clears it). Theme-styled via `ColorPicker.css` / `--main-*` variables.
 */
export default function ColorPicker({ currentValue, onChange, presets = DEFAULT_PRESETS, title, disabled, className }: ColorPickerProps) {
    return (
        <Dropdown
            className={clsx("tn-color-picker", className)}
            noSelectButtonStyle
            hideToggleArrow
            disabled={disabled}
            title={title}
            text={
                <span className="tn-color-picker-trigger">
                    <span className="tn-color-picker-trigger-swatch" style={{ background: currentValue || "transparent" }} />
                    <span className="tn-color-picker-trigger-label">{currentValue || title || "Choose color"}</span>
                </span>
            }
        >
            <div className="tn-color-picker-grid">
                {presets.map((color) => (
                    <button
                        key={color}
                        type="button"
                        title={color}
                        className={clsx("tn-color-picker-swatch", { "active": currentValue === color })}
                        style={{ background: color }}
                        onClick={() => onChange(color)}
                    />
                ))}
            </div>

            <label className="tn-color-picker-custom">
                <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(currentValue) ? currentValue : "#000000"}
                    onInput={(e) => onChange(e.currentTarget.value)}
                />
                <span>Custom…</span>
            </label>

            <button
                type="button"
                className="tn-color-picker-clear tn-low-profile"
                onClick={() => onChange("")}
            >
                <Icon icon="bx bx-x" /> Clear
            </button>
        </Dropdown>
    );
}
