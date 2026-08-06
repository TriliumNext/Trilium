import "./OverlayPanel.css";

import clsx from "clsx";
import { ComponentChildren, RefObject } from "preact";

import ActionButton from "./ActionButton";
import Icon from "./Icon";

interface OverlayPanelProps {
    /** Where the panel stands, how wide it is and whatever else is peculiar to it, styled by
     *  whoever puts it there. */
    className?: string;
    /** The panel's own element, for a caller that has something to do with it — marking it as where
     *  its component is found, say (see `useLegacyComponentElement`). */
    containerRef?: RefObject<HTMLDivElement>;
    /**
     * What heads the panel: a {@link TabStrip} where it is divided into tabs, or an
     * {@link OverlayPanelTitle} where there is only the one thing to show.
     */
    header: ComponentChildren;
    /** Whatever else the header row offers, standing between the header and the close button —
     *  the geo pane's maximize, say (see MaximizeToQuickEditAction). */
    headerActions?: ComponentChildren;
    /** The way to send the panel away, offered at the end of the header row. Left out, the panel
     *  has no way of dismissing itself. */
    close?: {
        /** What the button is named — its tooltip, and what a screen reader reads. */
        text: string;
        onClick(): void;
    };
    /** One or more {@link OverlayPanelBody}, laid one over the other. */
    children: ComponentChildren;
}

/**
 * A panel standing over a canvas that is dragged and zoomed — a mind map, a geo map — holding what
 * is to be done with whatever is selected on it.
 *
 * It brings the surface (see OverlayPanel.css), the header row and the button that sends it away,
 * and keeps itself out of the canvas's reach; where it stands, how wide it is and what it holds are
 * left to the caller, which is what differs between two of them. The same division
 * {@link OverlayToolbar} makes for the bars those canvases carry.
 */
export default function OverlayPanel({ className, containerRef, header, headerActions, close, children }: OverlayPanelProps) {
    return (
        <div
            ref={containerRef}
            className={clsx("tn-overlay-panel", className)}
            /* Keep interactions inside the panel from reaching the canvas underneath. */
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
        >
            {/* What heads the panel, and the way to send it away — laid over the head of it rather
                than beside what is there, so that a strip of tabs stays centred on the panel (see
                the CSS). */}
            <div className="tn-overlay-panel-header">
                {header}

                {(headerActions || close) && (
                    <div className="tn-overlay-panel-header-actions">
                        {headerActions}

                        {close && (
                            <ActionButton
                                className="tn-overlay-panel-close"
                                icon="bx bx-x"
                                text={close.text}
                                onClick={close.onClick}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* The bodies are stacked one over the other rather than shown one at a time, so that
                the panel keeps the height of the tallest of them whichever is on show. */}
            <div className="tn-overlay-panel-bodies">
                {children}
            </div>
        </div>
    );
}

/**
 * A heading of one line, for a panel that is not divided into tabs — dressed as a strip of tabs is,
 * so that the two head a panel at the same height.
 */
export function OverlayPanelTitle({ icon, text }: { icon: string; text: string }) {
    return (
        <div className="tn-overlay-panel-title">
            <Icon icon={icon} />
            <span className="tn-overlay-panel-title-text">{text}</span>
        </div>
    );
}

/**
 * One body of a panel: the whole of it where there is only one, or one tab of it where there are
 * several.
 */
export function OverlayPanelBody({ className, isTab, hidden, title, children }: {
    /** What is peculiar to this body — the padding it keeps, most often (see the CSS). */
    className?: string;
    /**
     * The body is one tab among several, which is what makes it a tab panel and what has it say
     * whether it is the one on show. A panel holding a single body is not a tab and says neither.
     */
    isTab?: boolean;
    /** Another tab is the one on show. */
    hidden?: boolean;
    title?: string;
    children: ComponentChildren;
}) {
    return (
        <div
            role={isTab ? "tabpanel" : undefined}
            className={clsx("tn-overlay-panel-body", className)}
            aria-hidden={isTab ? hidden : undefined}
            title={title}
        >
            {children}
        </div>
    );
}

/** A field of a panel: what it stands for, and the control that sets it. */
export function OverlayPanelSection({ label, title, children }: {
    label: string;
    title?: string;
    children: ComponentChildren;
}) {
    return (
        <div className="tn-overlay-panel-section" title={title}>
            <div className="tn-overlay-panel-section-label">{label}</div>
            {children}
        </div>
    );
}
