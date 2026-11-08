/**
 * Builds a real editor with a toolbar under the old and the new CKEditor stylesheet, in the app's
 * light and dark themes, and prints what changed in its controls: size, radius, padding, font,
 * icon size and focus ring.
 */
import {
    BalloonPanelView, Bold, ButtonView, ClassicEditor, Essentials, FontColor, Heading, InputTextView, Locale, Paragraph,
    Table, TableToolbar
} from "ckeditor5";
import { it } from "vitest";

import { computed, CONTEXTS, mountStyles, probe, report, type Side } from "./zz_ckcss_kit";

const PROPS = [ "width", "height", "padding", "margin", "border-radius", "font-size", "line-height", "column-gap", "row-gap" ];
const FOCUS_PROPS = [ "border-top-color", "border-top-width", "box-shadow", "outline-style", "outline-color" ];
/** The swatches `apps/client/.../text/color_palette.ts` configures: four greys, then the note colors. */
const COLORS = [ "#000000", "#555555", "#aaaaaa", "#ffffff", "#e64d4d", "#e6994d", "#e5e64d", "#99e64d", "#4de64d",
    "#4de699", "#4de5e6", "#4d99e6", "#4d4de6", "#994de6", "#e64db3" ].map((color) => ({ color, label: color }));
/** Keys of measured elements whose rules to list, with the properties to look for. */
const PROBE: Record<string, string[]> = {};

async function measure(context: string, side: Side) {
    const unmount = mountStyles(CONTEXTS[context](side));
    const result: Record<string, Record<string, string>> = {};
    const elements: Record<string, HTMLElement> = {};
    const record = (key: string, element: Element | null | undefined, focus = false) => {
        if (!element) { result[key] = { missing: "true" }; return; }
        elements[key] = element as HTMLElement;
        result[key] = computed(element, PROPS);
        const icon = element.querySelector(":scope > .ck-icon, :scope > .ck-button__icon, .ck-icon");
        if (icon) {
            const { width, height } = icon.getBoundingClientRect();
            result[key]["icon"] = `${width.toFixed(1)}x${height.toFixed(1)}`;
        }
        if (focus) {
            (element as HTMLElement).focus();
            Object.assign(result[key], Object.fromEntries(Object.entries(computed(element, FOCUS_PROPS))
                .map(([ p, v ]) => [ `:focus ${p}`, v ])));
        }
    };

    const host = document.body.appendChild(document.createElement("div"));
    const editor = await ClassicEditor.create(host, {
        licenseKey: "GPL",
        plugins: [ Essentials, Paragraph, Bold, Heading, FontColor, Table, TableToolbar ],
        toolbar: [ "bold", "heading", "fontColor", "insertTable" ],
        fontColor: { colors: COLORS, columns: 4 }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = editor.ui.view.toolbar.items as any;
    record("toolbar button", items.get(0).element, true);

    const heading = items.get(1);
    record("heading dropdown button", heading.buttonView.element);
    heading.isOpen = true;
    record("heading panel", heading.panelView.element);
    record("heading item", heading.panelView.element.querySelector(".ck-list__item .ck-button"), true);
    record("heading item label", heading.panelView.element.querySelector(".ck-list__item .ck-button__label"));
    heading.isOpen = false;

    const color = items.get(2);
    color.isOpen = true;
    const panel = color.panelView.element as HTMLElement;
    record("color panel", panel);
    record("color grid", panel.querySelector(".ck-color-grid"));
    record("color tile", panel.querySelector(".ck-color-grid__tile"), true);
    record("color remove button", panel.querySelector(".ck-color-selector__remove-color"), true);
    record("color picker button", panel.querySelector(".ck-color-selector__color-picker"), true);
    color.isOpen = false;

    const table = items.get(3);
    table.isOpen = true;
    record("insert table panel", table.panelView.element);
    record("insert table box", table.panelView.element.querySelector(".ck-insert-table-dropdown-grid-box"));
    table.isOpen = false;

    const locale = new Locale();
    for (const [ name, className ] of [ [ "dialog", "ck ck-reset_all ck-dialog" ], [ "floating", "ck ck-reset_all ck-body-wrapper" ] ]) {
        const wrapper = document.body.appendChild(document.createElement("div"));
        wrapper.className = className;
        const button = new ButtonView(locale);
        button.set({ label: "Button", withText: true });
        button.render();
        const input = new InputTextView(locale);
        input.render();
        if (name === "floating") {
            const balloon = new BalloonPanelView(locale);
            balloon.render();
            balloon.isVisible = true;
            balloon.content.add(button);
            balloon.content.add(input);
            wrapper.appendChild(balloon.element as HTMLElement);
            record("balloon", balloon.element);
        } else {
            wrapper.append(button.element as HTMLElement, input.element as HTMLElement);
            record("dialog", wrapper);
        }
        record(`${name} button`, button.element, true);
        record(`${name} input`, input.element, true);
    }

    for (const [ key, props ] of Object.entries(PROBE)) {
        if (elements[key]) probe(`${context} ${side} ${key}`, elements[key], props);
    }
    await editor.destroy();
    host.remove();
    for (const wrapper of document.querySelectorAll(".ck-dialog, .ck-body-wrapper")) wrapper.remove();
    unmount();
    return result;
}

for (const context of [ "app", "app-dark" ]) {
    it(`editor UI in ${context}`, async () => {
        report(context, await measure(context, "old"), await measure(context, "new"));
    });
}
