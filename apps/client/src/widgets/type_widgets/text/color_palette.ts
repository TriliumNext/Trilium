import { t } from "../../../services/i18n.js";
import { DEFAULT_COLOR_PALETTE } from "../../react/ColorPicker.js";

/**
 * The swatches of the Font Color and Font Background Color dropdowns: four greys, then the hues of
 * the note color palette.
 */
export function buildFontColorConfig() {
    const colors = buildSwatches();
    return {
        fontColor: { colors, columns: 4 },
        fontBackgroundColor: { colors, columns: 4 }
    };
}

/** The same swatches for the table and cell properties. */
export function buildTableColorConfig() {
    const colors = buildSwatches();
    return {
        tableProperties: { borderColors: colors, backgroundColors: colors },
        tableCellProperties: { borderColors: colors, backgroundColors: colors }
    };
}

const GREYS = [
    { color: "#000000", label: "Black" },
    { color: "#555555", label: "Dim grey" },
    { color: "#aaaaaa", label: "Light grey" },
    { color: "#ffffff", label: "White" }
];

/** The names of the `DEFAULT_COLOR_PALETTE` hues, which CKEditor translates on its own. */
const HUE_LABELS = [
    "Red", "Orange", "Yellow", "Light green", "Green", "Aquamarine", "Turquoise", "Light blue",
    "Blue", "Purple"
];

function buildSwatches() {
    // CKEditor has no name for pink, so it comes from the app's own catalogue.
    const hueLabels = [ ...HUE_LABELS, t("text-editor.colors.pink") ];
    return [
        ...GREYS,
        ...DEFAULT_COLOR_PALETTE.map((color, index) => ({ color, label: hueLabels[index] }))
    ];
}
