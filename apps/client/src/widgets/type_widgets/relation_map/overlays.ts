import { jsPlumbInstance, OverlaySpec } from "jsplumb";

export const uniDirectionalOverlays: OverlaySpec[] = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ],
    ["Label", { label: "", id: "label", cssClass: "connection-label" }]
];

const biDirectionalOverlays = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ],
    ["Label", { label: "", id: "label", cssClass: "connection-label" }],
    [
        "Arrow",
        {
            location: 0,
            id: "arrow2",
            length: 14,
            direction: -1,
            foldback: 0.8
        }
    ]
];

const inverseRelationsOverlays = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ],
    ["Label", { label: "", location: 0.2, id: "label-source", cssClass: "connection-label" }],
    ["Label", { label: "", location: 0.8, id: "label-target", cssClass: "connection-label" }],
    [
        "Arrow",
        {
            location: 0,
            id: "arrow2",
            length: 14,
            direction: -1,
            foldback: 0.8
        }
    ]
];

const linkOverlays = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ]
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
