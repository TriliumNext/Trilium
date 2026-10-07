import { jsPlumbInstance, OverlaySpec } from "jsplumb";

const ARROW_LENGTH_PX = 9;

export const uniDirectionalOverlays: OverlaySpec[] = [
    arrow({ location: 1, id: "arrow" }),
    ["Label", { label: "", id: "label", cssClass: "connection-label" }]
];

const biDirectionalOverlays: OverlaySpec[] = [
    arrow({ location: 1, id: "arrow" }),
    ["Label", { label: "", id: "label", cssClass: "connection-label" }],
    arrow({ location: 0, id: "arrow2", direction: -1 })
];

const inverseRelationsOverlays: OverlaySpec[] = [
    arrow({ location: 1, id: "arrow" }),
    ["Label", { label: "", location: 0.2, id: "label-source", cssClass: "connection-label" }],
    ["Label", { label: "", location: 0.8, id: "label-target", cssClass: "connection-label" }],
    arrow({ location: 0, id: "arrow2", direction: -1 })
];

const linkOverlays: OverlaySpec[] = [
    arrow({ location: 1, id: "arrow" })
];

export default function setupOverlays(jsPlumbInstance: jsPlumbInstance) {
    jsPlumbInstance.registerConnectionType("uniDirectional", {
        anchor: "Continuous",
        connector: "StateMachine",
        overlays: uniDirectionalOverlays
    });

    jsPlumbInstance.registerConnectionType("biDirectional", {
        anchor: "Continuous",
        connector: "StateMachine",
        overlays: biDirectionalOverlays
    });

    jsPlumbInstance.registerConnectionType("inverse", {
        anchor: "Continuous",
        connector: "StateMachine",
        overlays: inverseRelationsOverlays
    });

    jsPlumbInstance.registerConnectionType("link", {
        anchor: "Continuous",
        connector: "StateMachine",
        overlays: linkOverlays
    });
}

/**
 * The arrowhead of the note map (`note_map/rendering.ts`): as wide as 0.72 of its length, with the
 * tail swept back to 0.72 of the length from the tip. It is a pixel shorter, because the rounded
 * stroke of `.relation-map-arrow` adds about half a pixel on every side.
 */
function arrow(options: { location: number, id: string, direction?: number }): OverlaySpec {
    return [ "Arrow", {
        ...options,
        length: ARROW_LENGTH_PX,
        width: ARROW_LENGTH_PX * 0.72,
        foldback: 0.72,
        cssClass: "relation-map-arrow"
    } ];
}
