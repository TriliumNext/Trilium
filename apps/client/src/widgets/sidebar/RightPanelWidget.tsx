import { useContext, useRef } from "preact/hooks";
import { ParentComponent } from "../react/react_utils";
import { ComponentChildren } from "preact";

interface RightPanelWidgetProps {
    title: string;
    children: ComponentChildren;
    buttons?: ComponentChildren;
}

export default function RightPanelWidget({ title, buttons, children }: RightPanelWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const parentComponent = useContext(ParentComponent);

    if (parentComponent) {
        parentComponent.initialized = Promise.resolve();
    }

    return (
        <div ref={containerRef} class="card widget" style={{contain: "none"}}>
            <div class="card-header">
                <div class="card-header-title">{title}</div>
                <div class="card-header-buttons">{buttons}</div>
            </div>

            <div id={parentComponent?.componentId} class="body-wrapper">
                <div class="card-body">
                    {children}
                </div>
            </div>
        </div>
    );
}
