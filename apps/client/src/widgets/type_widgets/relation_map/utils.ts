import { t } from "../../../services/i18n";

export function noteIdToId(noteId: string) {
    return `rel-map-note-${noteId}`;
}

export function idToNoteId(id: string) {
    return id.substr(13);
}

export function getZoom(container: HTMLDivElement) {
    const transform = window.getComputedStyle(container).transform;
    if (transform === "none") {
        return 1;
    }

    const matrixRegex = /matrix\((-?\d*\.?\d+),\s*0,\s*0,\s*-?\d*\.?\d+,\s*-?\d*\.?\d+,\s*-?\d*\.?\d+\)/;
    const matches = transform.match(matrixRegex);

    if (!matches) {
        throw new Error(t("relation_map.cannot_match_transform", { transform }));
    }

    return parseFloat(matches[1]);
}

export function getMousePosition(evt: MouseEvent, container: HTMLDivElement, zoom: number) {
    const rect = container.getBoundingClientRect();

    return {
        x: ((evt.clientX ?? 0) - rect.left) / zoom,
        y: ((evt.clientY ?? 0) - rect.top) / zoom
    };
}
