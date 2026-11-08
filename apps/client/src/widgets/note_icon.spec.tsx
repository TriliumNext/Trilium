import $ from "jquery";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import { renderInto } from "../test/render";
import { ReactWrappedWidget } from "./basic_widget";

vi.mock("bootstrap", () => ({
    Tooltip: class {}
}));

// i18next is not initialized under test, where t() answers with nothing; echoing the key back keeps
// the assertions about whether there is a tooltip at all.
vi.mock("i18next", async (importOriginal) => ({
    ...(await importOriginal<typeof import("i18next")>()),
    t: (key: string) => key
}));

const noteContext = vi.hoisted(() => ({
    initialNote: undefined as FNote | undefined,
    setNote: undefined as ((note: FNote) => void) | undefined
}));
const tooltipStub = vi.hoisted(() => ({ showTooltip: vi.fn(), hideTooltip: vi.fn() }));
const tooltipConfig = vi.hoisted(() => ({ current: undefined as { title?: unknown } | undefined }));
const iconPickerProps = vi.hoisted(() => ({
    current: undefined as undefined | {
        disabled?: boolean;
        onSelect(icon: string): void;
        onReset?: () => void;
    }
}));

vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => {
        const [ note, setNote ] = useState(noteContext.initialNote);
        noteContext.setNote = setNote;
        return { note, viewScope: { viewMode: "default" } };
    },
    useNoteLabel: () => [ undefined ],
    useStaticTooltip: () => {},
    useTooltip: (_ref: unknown, config: { title?: unknown }) => {
        tooltipConfig.current = config;
        return tooltipStub;
    }
}));

vi.mock("../services/server", () => ({
    default: {
        get: vi.fn(async (url: string) => url === "other/icon-usage"
            ? { iconClassToCountMap: {} }
            : [])
    }
}));

vi.mock("../services/attributes", () => ({
    default: {
        setLabel: vi.fn(),
        removeAttributeById: vi.fn()
    }
}));

vi.mock("./react/IconPicker", async (importOriginal) => {
    const original = await importOriginal<typeof import("./react/IconPicker")>();
    return {
        ...original,
        IconPickerButton: (props: Parameters<typeof original.IconPickerButton>[0]) => {
            iconPickerProps.current = props;
            const OriginalIconPickerButton = original.IconPickerButton;
            return <OriginalIconPickerButton {...props} />;
        }
    };
});

import NoteIcon from "./note_icon";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver
    ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

describe("NoteIcon", () => {
    it("writes and resets the active note icon", () => {
        vi.mocked(attributes.setLabel).mockClear();
        vi.mocked(attributes.removeAttributeById).mockClear();

        noteContext.initialNote = undefined;
        renderInto(<NoteIcon />);
        iconPickerProps.current?.onSelect("bx-ignored");
        expect(attributes.setLabel).not.toHaveBeenCalled();

        const iconLabel = { noteId: "note-a", attributeId: "icon-a", name: "iconClass" };
        const unrelatedLabel = { noteId: "note-a", attributeId: "other-a", name: "other" };
        noteContext.initialNote = buildNote("note-a", "bx-note-a", [ iconLabel, unrelatedLabel ]);
        renderInto(<NoteIcon />);
        iconPickerProps.current?.onSelect("bx-star");
        iconPickerProps.current?.onReset?.();
        expect(attributes.setLabel).toHaveBeenLastCalledWith("note-a", "iconClass", "bx-star");
        expect(attributes.removeAttributeById).toHaveBeenCalledOnce();
        expect(attributes.removeAttributeById).toHaveBeenCalledWith("note-a", "icon-a");

        noteContext.initialNote = buildNote("note-b", "bx-note-b", [], true);
        renderInto(<NoteIcon />);
        iconPickerProps.current?.onSelect("bx-moon");
        expect(attributes.setLabel).toHaveBeenLastCalledWith("note-b", "workspaceIconClass", "bx-moon");
    });

    it("offers no tooltip to change the icon of a note whose icon cannot be changed", () => {
        noteContext.initialNote = buildNote("note-a");
        renderInto(<NoteIcon />);
        expect(tooltipConfig.current?.title).toBe("note_icon.change_note_icon");

        noteContext.initialNote = { ...buildNote("_help_page"), isMetadataReadOnly: true } as FNote;
        renderInto(<NoteIcon />);
        expect(iconPickerProps.current?.disabled).toBe(true);
        expect(tooltipConfig.current?.title).toBe("");
    });

    it("stays in the legacy widget tree when the active note changes", () => {
        glob.iconRegistry = { sources: [] };
        noteContext.initialNote = buildNote("note-a");
        const widget = new ReactWrappedWidget(<NoteIcon />);
        widget.doRender();
        const liveContainer = document.createElement("div");
        document.body.appendChild(liveContainer);
        liveContainer.append(...widget.$widget.get());

        try {
            expect(liveContainer.querySelector("button")).not.toBeNull();

            void act(() => noteContext.setNote?.(buildNote("note-b")));

            expect(liveContainer.querySelector("button")?.classList.contains("bx-note-b")).toBe(true);
        } finally {
            widget.cleanup();
            liveContainer.remove();
        }
    });

    it("closes an open icon picker when the active note changes", () => {
        glob.iconRegistry = { sources: [] };
        noteContext.initialNote = buildNote("note-a");
        const container = renderInto(<NoteIcon />);
        const toggle = container.querySelector<HTMLButtonElement>("button");
        const dropdown = container.querySelector<HTMLElement>(".dropdown");
        expect(toggle).not.toBeNull();
        expect(dropdown).not.toBeNull();
        void act(() => {
            $(dropdown as HTMLElement).children("button:not([aria-expanded=true])").trigger("click");
        });
        expect(document.body.querySelector(".tn-dropdown-portal .icon-picker")).not.toBeNull();

        void act(() => noteContext.setNote?.(buildNote("note-a", "bx-updated")));

        expect(container.querySelector("button")).toBe(toggle);
        expect(toggle?.classList.contains("bx-updated")).toBe(true);
        expect(toggle?.classList.contains("show")).toBe(true);
        expect(toggle?.getAttribute("aria-expanded")).toBe("true");
        expect(document.body.querySelector(".tn-dropdown-portal .icon-picker")).not.toBeNull();

        void act(() => noteContext.setNote?.(buildNote("note-b")));

        expect(container.querySelector("button")?.classList.contains("bx-note-b")).toBe(true);
        expect(container.querySelector("button")).not.toBe(toggle);
        expect(document.body.querySelector(".tn-dropdown-portal .icon-picker")).toBeNull();
    });
});

function buildNote(
    noteId: string,
    icon = `bx-${noteId}`,
    iconLabels: Array<{ noteId: string; attributeId: string; name: string }> = [],
    isWorkspace = false
) {
    return {
        noteId,
        isMetadataReadOnly: false,
        getIcon: () => icon,
        getOwnedLabels: () => iconLabels,
        hasOwnedLabel: (name: string) => isWorkspace && name === "workspace"
    } as unknown as FNote;
}
