import { Modal as BootstrapModal } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import GeoMapProperties, { type GeoMapImageState, isTileUrlTemplate } from "./GeoMapProperties";

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));
// The settings dropdown's definitions translate through i18next directly, at import.
vi.mock("i18next", async (importOriginal) => ({
    ...await importOriginal<typeof import("i18next")>(),
    t: (key: string) => key
}));

const mocks = vi.hoisted(() => ({
    setLabel: vi.fn(async () => {}),
    removeOwnedLabelByName: vi.fn(async () => {}),
    removeOwnedRelationByName: vi.fn(async () => {}),
    setAttribute: vi.fn(async () => {}),
    toggleDangerousAttribute: vi.fn(async () => {})
}));

vi.mock("../../../services/attributes", () => ({
    default: {
        setLabel: mocks.setLabel,
        removeOwnedLabelByName: mocks.removeOwnedLabelByName,
        removeOwnedRelationByName: mocks.removeOwnedRelationByName,
        setAttribute: mocks.setAttribute,
        toggleDangerousAttribute: mocks.toggleDangerousAttribute,
        isAffecting: () => true
    }
}));

// NoteAutocomplete is tested in its own spec. A click on the stub picks `image2`.
vi.mock("../../react/NoteAutocomplete", () => ({
    default: ({ noteId, filter, noteIdChanged }: {
        noteId?: string, filter?: string, noteIdChanged: (noteId: string) => void
    }) => (
        <div
            className="autocomplete-stub"
            data-note-id={noteId ?? ""}
            data-filter={filter}
            onClick={() => noteIdChanged("image2")}
        />
    )
}));

const LOADED_IMAGE: GeoMapImageState = { status: "image", size: { width: 2048, height: 1024 } };
const TILE_URL = "https://tiles.example.org/{z}/{x}/{y}{r}.png";

describe("GeoMapProperties", () => {
    let container: HTMLElement;

    function draw(labels: Record<string, string>, image: GeoMapImageState = { status: "geo" }) {
        return drawNote(buildNote({ title: "Map", ...labels }) as unknown as FNote, image);
    }

    function drawNote(note: FNote, image: GeoMapImageState = { status: "geo" }) {
        act(() => {
            render(<GeoMapProperties note={note} image={image} onClose={() => {}} />, container);
        });
        return note;
    }

    function query<T extends Element = HTMLElement>(selector: string) {
        return document.querySelector<T>(`.geo-map-properties-dialog ${selector}`);
    }

    function optionTitles(selector: string) {
        const titles = document.querySelectorAll(
            `.geo-map-properties-dialog ${selector} .tn-card-option-title`);
        return [ ...titles ].map((title) => title.textContent);
    }

    function cornerInputs() {
        return [ ...document.querySelectorAll<HTMLInputElement>(
            ".geo-map-properties-dialog .geo-map-corner input") ];
    }

    /** The background type the dropdown shows as chosen. */
    function backgroundType() {
        return query(".geo-map-background-type .dropdown > button")?.textContent?.trim();
    }

    /** Opens the background type dropdown, unless it is open, and returns its items. */
    function openBackgroundTypes() {
        const toggle = query(".geo-map-background-type .dropdown > button");
        if (!toggle) throw new Error("no background type dropdown");
        if (toggle.getAttribute("aria-expanded") !== "true") {
            act(() => toggle.click());
        }
        return [ ...document.querySelectorAll<HTMLElement>(".dropdown-item") ];
    }

    function choose(label: string) {
        const item = openBackgroundTypes()
            .find((candidate) => candidate.textContent?.trim().startsWith(label));
        if (!item) throw new Error(`no ${label} item`);
        act(() => item.click());
    }

    function coordinateButtons() {
        return [ ...document.querySelectorAll<HTMLButtonElement>(
            ".geo-map-properties-dialog .geo-map-coordinates .tn-segmented-choice button") ];
    }

    /** The coordinate modes, as their labels and whether each is the chosen one. */
    function coordinateModes() {
        return coordinateButtons()
            .map((button) => [ button.textContent?.trim(), button.classList.contains("active") ]);
    }

    function chooseCoordinateMode(label: string) {
        const button = coordinateButtons()
            .find((candidate) => candidate.textContent?.trim() === label);
        if (!button) throw new Error(`no ${label} button`);
        act(() => button.click());
    }

    /** Types `value` into `input` and leaves it, which is when a number box commits. */
    function commit(input: HTMLInputElement | undefined, value: string) {
        if (!input) throw new Error("no such input");
        act(() => {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change"));
        });
    }

    /** Types `value` into `input` and leaves it, which is when a text box commits. */
    function type(input: HTMLInputElement | null, value: string) {
        if (!input) throw new Error("no such input");
        act(() => {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();

        const modal = document.querySelector<HTMLElement>(".geo-map-properties-dialog");
        if (modal) {
            BootstrapModal.getInstance(modal)?.dispose();
            modal.remove();
        }

        document.querySelector(".modal-backdrop")?.remove();
        document.body.classList.remove("modal-open");
    });

    it("repeats the settings dropdown in a General card, except the map style", () => {
        draw({});
        expect(document.querySelector(".geo-map-properties-dialog .modal-title")?.textContent)
            .toContain("geo-map.properties-title");
        expect(optionTitles(".geo-map-properties-general")).toEqual([
            "book_properties_config.show-scale",
            "book_properties_config.show-labels",
            "book_properties_config.cluster-markers"
        ]);
    });

    it("holds which notes the map gathers in a card of their own, after General", () => {
        draw({});
        const included = query(".collection-included-notes");
        expect(optionTitles(".collection-included-notes")).toEqual([
            "book_properties.include_archived_notes",
            "book_properties_config.max-nesting-depth"
        ]);
        expect(query(".geo-map-properties-general")?.compareDocumentPosition(included as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(included?.compareDocumentPosition(query(".geo-map-properties-background") as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it("draws a world map with a style, until a custom image is chosen and picked", () => {
        const note = draw({});
        expect(backgroundType()).toBe("geo-map.background-map");
        expect(openBackgroundTypes().map((item) => item.textContent?.trim())).toEqual([
            "geo-map.background-mapgeo-map.background-map-description",
            "geo-map.background-tilesgeo-map.background-tiles-description",
            "geo-map.background-imagegeo-map.background-image-description"
        ]);
        expect(optionTitles(".geo-map-properties-background")).toEqual([
            "geo-map.background-type", "book_properties_config.map-style"
        ]);

        // Choosing the image writes nothing: the map stays a world map until an image is picked.
        choose("geo-map.background-image");
        expect(optionTitles(".geo-map-properties-background")).toEqual([
            "geo-map.background-type", "geo-map.image-note"
        ]);
        expect(mocks.setAttribute).not.toHaveBeenCalled();

        act(() => query(".autocomplete-stub")?.click());
        expect(mocks.setAttribute).toHaveBeenCalledWith(note, "relation", "map:image", "image2");
    });

    it("goes back to a world map by disabling the image, which it keeps", () => {
        const note = draw({ "~map:image": "image1" }, LOADED_IMAGE);
        expect(backgroundType()).toBe("geo-map.background-image");

        choose("geo-map.background-map");
        expect(mocks.toggleDangerousAttribute)
            .toHaveBeenCalledExactlyOnceWith(note, "relation", "map:image", false);
        expect(mocks.removeOwnedRelationByName).not.toHaveBeenCalled();
        expect(optionTitles(".geo-map-properties-background")).toEqual([
            "geo-map.background-type", "book_properties_config.map-style"
        ]);
    });

    it("enables a disabled image again, and replaces it when another one is picked", () => {
        const note = draw({ "~disabled:map:image": "image1" });
        expect(backgroundType()).toBe("geo-map.background-map");

        choose("geo-map.background-image");
        expect(mocks.toggleDangerousAttribute)
            .toHaveBeenCalledExactlyOnceWith(note, "relation", "map:image", true);

        act(() => query(".autocomplete-stub")?.click());
        expect(mocks.setAttribute).toHaveBeenCalledWith(note, "relation", "map:image", "image2");
        expect(mocks.removeOwnedRelationByName).toHaveBeenCalledWith(note, "disabled:map:image");
    });

    it("keeps an inherited image, which only its owner can switch off", () => {
        const parent = buildNote({
            title: "Maps",
            "~map:image(inheritable)": "image1",
            children: [ { id: "inheritingMap", title: "Map" } ]
        });
        expect(parent.children).toContain("inheritingMap");
        const note = drawNote(froca.notes.inheritingMap, LOADED_IMAGE);
        expect(backgroundType()).toBe("geo-map.background-image");
        expect(query(".geo-map-background-type .tn-card-option-description")?.textContent)
            .toBe("geo-map.background-image-inherited");

        const worldMap = openBackgroundTypes().find((item) =>
            item.textContent?.trim().startsWith("geo-map.background-map"));
        const tiles = openBackgroundTypes().find((item) =>
            item.textContent?.trim().startsWith("geo-map.background-tiles"));
        expect(worldMap?.classList.contains("disabled")).toBe(true);
        expect(tiles?.classList.contains("disabled")).toBe(true);
        act(() => worldMap?.click());
        expect(mocks.toggleDangerousAttribute).not.toHaveBeenCalled();
        expect(backgroundType()).toBe("geo-map.background-image");
        expect(note.noteId).toBe("inheritingMap");
    });

    it("draws a tileset once a URL naming its tiles is entered", () => {
        const note = draw({});
        choose("geo-map.background-tiles");
        expect(optionTitles(".geo-map-properties-background")).toEqual([
            "geo-map.background-type", "geo-map.tiles-url", "geo-map.dark-tiles"
        ]);
        expect(mocks.setLabel).not.toHaveBeenCalled();

        const url = query<HTMLInputElement>(".geo-map-tiles-url");
        type(url, "https://tiles.example.org/map.png");
        expect(query(".geo-map-tiles-url-error")).not.toBeNull();
        expect(url?.value).toBe("https://tiles.example.org/map.png");
        expect(mocks.setLabel).not.toHaveBeenCalled();

        type(url, ` ${TILE_URL} `);
        expect(query(".geo-map-tiles-url-error")).toBeNull();
        expect(mocks.setLabel).toHaveBeenCalledWith(note.noteId, "map:style", TILE_URL);
    });

    it("goes back to a built-in style by disabling the tileset, which it keeps", () => {
        const note = draw({ "#map:style": TILE_URL });
        expect(backgroundType()).toBe("geo-map.background-tiles");
        expect(query<HTMLInputElement>(".geo-map-tiles-url")?.value).toBe(TILE_URL);

        choose("geo-map.background-map");
        expect(mocks.toggleDangerousAttribute)
            .toHaveBeenCalledExactlyOnceWith(note, "label", "map:style", false);
        expect(optionTitles(".geo-map-properties-background")).toEqual([
            "geo-map.background-type", "book_properties_config.map-style"
        ]);
    });

    it("enables a disabled tileset again, and replaces it when another URL is entered", () => {
        const note = draw({ "#disabled:map:style": TILE_URL });
        expect(backgroundType()).toBe("geo-map.background-map");

        choose("geo-map.background-tiles");
        expect(mocks.toggleDangerousAttribute)
            .toHaveBeenCalledExactlyOnceWith(note, "label", "map:style", true);

        const other = "https://other.example.org/{z}/{y}/{x}";
        type(query<HTMLInputElement>(".geo-map-tiles-url"), other);
        expect(mocks.setLabel).toHaveBeenCalledWith(note.noteId, "map:style", other);
        expect(mocks.removeOwnedLabelByName).toHaveBeenCalledWith(note, "disabled:map:style");
    });

    it("overrides an inherited tileset with the default style, and disables an image for one", () => {
        buildNote({
            title: "Maps",
            "#map:style(inheritable)": TILE_URL,
            children: [ { id: "tiledMap", title: "Map" } ]
        });
        const tiled = drawNote(froca.notes.tiledMap);
        choose("geo-map.background-map");
        expect(mocks.toggleDangerousAttribute).not.toHaveBeenCalled();
        expect(mocks.setLabel)
            .toHaveBeenCalledWith(tiled.noteId, "map:style", "versatile-colorful-eclipse");

        vi.clearAllMocks();
        const imageMap = draw({ "~map:image": "image1", "#map:style": TILE_URL }, LOADED_IMAGE);
        choose("geo-map.background-tiles");
        expect(mocks.toggleDangerousAttribute)
            .toHaveBeenCalledExactlyOnceWith(imageMap, "relation", "map:image", false);
        expect(backgroundType()).toBe("geo-map.background-tiles");
    });

    it("measures in pixels until custom corners are chosen, starting them at the size", () => {
        const note = draw({ "~map:image": "image1" }, LOADED_IMAGE);
        expect(query(".autocomplete-stub")?.dataset.noteId).toBe("image1");
        // Only the images a map can be drawn over are offered.
        expect(query(".autocomplete-stub")?.dataset.filter).toBe(
            "note.type = image AND (note.mime = 'image/png' OR note.mime = 'image/jpeg' "
            + "OR note.mime = 'image/jpg' OR note.mime = 'image/webp' "
            + "OR note.mime = 'image/gif')");
        expect(optionTitles(".geo-map-properties-background")).toEqual([
            "geo-map.background-type", "geo-map.image-note",
            "geo-map.coordinates", "geo-map.dark-image"
        ]);
        expect(cornerInputs()).toHaveLength(0);

        expect(coordinateModes()).toEqual([
            [ "geo-map.coordinates-pixels", true ], [ "geo-map.coordinates-custom", false ]
        ]);
        chooseCoordinateMode("geo-map.coordinates-custom");
        expect(mocks.setLabel)
            .toHaveBeenCalledWith(note.noteId, "map:imageBounds", "0,0 2048,1024");
    });

    it("stores corners once they span the image, and removes them to return to pixels", () => {
        const note = draw(
            { "~map:image": "image1", "#map:imageBounds": "-512,512 512,-512" }, LOADED_IMAGE);
        const inputs = cornerInputs();
        expect(inputs.map((input) => input.value)).toEqual([ "-512", "512", "512", "-512" ]);

        // A right edge on the left one spans nothing, so it is held back and explained.
        commit(inputs[2], "-512");
        expect(mocks.setLabel).not.toHaveBeenCalled();
        expect(query(".geo-map-coordinates-error")?.textContent)
            .toBe("geo-map.coordinates-invalid");

        commit(inputs[2], "1024.5");
        expect(mocks.setLabel)
            .toHaveBeenCalledWith(note.noteId, "map:imageBounds", "-512,512 1024.5,-512");
        expect(query(".geo-map-coordinates-error")).toBeNull();

        expect(coordinateModes()).toEqual([
            [ "geo-map.coordinates-pixels", false ], [ "geo-map.coordinates-custom", true ]
        ]);
        chooseCoordinateMode("geo-map.coordinates-pixels");
        expect(mocks.removeOwnedLabelByName).toHaveBeenCalledWith(note, "map:imageBounds");
    });

    it("offers custom corners only once the image's size is known", () => {
        const unmeasured = [ { status: "loading" }, { status: "error", reason: "unloadable" } ] as const;
        for (const image of unmeasured) {
            draw({ "~map:image": "image1" }, image);
            expect(coordinateButtons()).toHaveLength(2);
            expect(coordinateButtons().every((button) => button.disabled)).toBe(true);
            chooseCoordinateMode("geo-map.coordinates-custom");
            expect(mocks.setLabel).not.toHaveBeenCalled();
            render(null, container);
        }

        // Corners already chosen can still be removed while the image loads.
        draw({ "~map:image": "image1", "#map:imageBounds": "0,0 10,10" }, { status: "loading" });
        expect(coordinateButtons().some((button) => button.disabled)).toBe(false);
    });

    it("keeps inherited corners, which only their owner can remove", () => {
        buildNote({
            title: "Maps",
            "#map:imageBounds(inheritable)": "-512,512 512,-512",
            children: [ { id: "cornersMap", title: "Map", "~map:image": "image1" } ]
        });
        drawNote(froca.notes.cornersMap, LOADED_IMAGE);
        expect(coordinateModes()).toEqual([
            [ "geo-map.coordinates-pixels", false ], [ "geo-map.coordinates-custom", true ]
        ]);
        expect(query(".geo-map-coordinates .tn-card-option-description")?.textContent)
            .toBe("geo-map.coordinates-inherited");
        expect(coordinateButtons().every((button) => button.disabled)).toBe(true);
        chooseCoordinateMode("geo-map.coordinates-pixels");
        expect(mocks.removeOwnedLabelByName).not.toHaveBeenCalled();
    });

    it("keeps drawing the image until a tileset's URL is entered", () => {
        const note = draw({ "~map:image": "image1" }, LOADED_IMAGE);
        choose("geo-map.background-tiles");
        expect(backgroundType()).toBe("geo-map.background-tiles");
        expect(mocks.toggleDangerousAttribute).not.toHaveBeenCalled();

        type(query<HTMLInputElement>(".geo-map-tiles-url"), TILE_URL);
        expect(mocks.setLabel).toHaveBeenCalledWith(note.noteId, "map:style", TILE_URL);
        expect(mocks.toggleDangerousAttribute)
            .toHaveBeenCalledExactlyOnceWith(note, "relation", "map:image", false);
    });

    it("says why an image cannot be drawn, or might not be on every device", () => {
        draw({ "~map:image": "image1" }, { status: "error", reason: "svg" });
        expect(query(".geo-map-image-notice")?.textContent).toBe("geo-map.image-svg-unsupported");

        render(null, container);
        draw({ "~map:image": "image1" }, { status: "image", size: { width: 8192, height: 2048 } });
        expect(query(".geo-map-image-notice")?.textContent).toBe("geo-map.image-too-large");

        render(null, container);
        draw({ "~map:image": "image1" }, LOADED_IMAGE);
        expect(query(".geo-map-image-notice")).toBeNull();
    });
});

describe("isTileUrlTemplate", () => {
    it("accepts an http(s) URL naming the tile by z/x/y or by quadkey", () => {
        expect(isTileUrlTemplate(TILE_URL)).toBe(true);
        expect(isTileUrlTemplate("http://tiles.example.org/{quadkey}.jpeg")).toBe(true);
        expect(isTileUrlTemplate("https://tiles.example.org/{z}/{x}.png")).toBe(false);
        expect(isTileUrlTemplate("ftp://tiles.example.org/{z}/{x}/{y}.png")).toBe(false);
        expect(isTileUrlTemplate("versatiles-colorful")).toBe(false);
    });
});
