import "./OverlayRail.css";

import clsx from "clsx";
import { type ComponentChildren, createContext, createPortal } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import OverlayControlGroup from "./OverlayControlGroup";

/**
 * How long a rail takes to slide out. The caller keeps rendering it that long after it is
 * dismissed (see `useLingeringTrue`). Matches `--overlay-rail-exit-duration` in OverlayRail.css.
 */
export const RAIL_EXIT_MS = 400;

interface OverlayRailProps {
    /**
     * Where the rail renders. It is placed over `host` if `host` is positioned, else over the
     * nearest positioned ancestor of `host`.
     */
    host: HTMLElement;
    /** Whether the rail slides out, back over the edge it came from. */
    isLeaving: boolean;
    /** The class of this rail, for the caller's own styles, such as its `z-index`. */
    className?: string;
    onFocusOut?: (event: FocusEvent) => void;
    /** The `OverlayControlButton`s of the rail. */
    children: ComponentChildren;
}

/**
 * A vertical column of touch-sized buttons, flush with the trailing edge of `host`, for the
 * actions on the focused element. It slides in, and slides out while `isLeaving`. Of the rails
 * in one {@link RailStandContext}, only the last one to appear shows (see {@link RailStand}).
 *
 * A press on the rail does not move the focus, and neither the press nor the click reaches the
 * elements below the rail.
 */
export default function OverlayRail({
    host, isLeaving, className, onFocusOut, children
}: OverlayRailProps) {
    const stand = useContext(RailStandContext);
    const token = useRef({}).current;
    // Read once: a rail that replaces another rail appears in place, without sliding in.
    const [ isTakingOver ] = useState(() => stand.isTaken);
    useEffect(() => {
        stand.claim(token);
        return () => stand.release(token);
    }, [ stand, token ]);
    const isSuperseded = useSyncExternalStore(
        useCallback((listener: () => void) => stand.subscribe(listener), [ stand ]),
        useCallback(() => stand.isSuperseded(token), [ stand, token ]));
    // A leaving rail that another rail replaces is dropped, so it does not come back to finish
    // its exit once the other rail leaves.
    const isDropped = useRef(false);
    if (isLeaving && isSuperseded) {
        isDropped.current = true;
    }
    useEffect(() => {
        if (isDropped.current) {
            stand.release(token);
        }
    }, [ stand, token, isLeaving, isSuperseded ]);

    if (isDropped.current || isSuperseded) {
        return null;
    }

    return createPortal(
        <div
            className={clsx("tn-overlay-rail", className, {
                leaving: isLeaving,
                "takes-over": isTakingOver
            })}
            onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            onFocusOut={onFocusOut}
        >
            <OverlayControlGroup placement="middle-end" vertical overCanvas>
                {children}
            </OverlayControlGroup>
        </div>,
        host
    );
}

/**
 * Shows one rail at a time: the last one that claimed the stand. Earlier rails are hidden, and
 * show again in order as the later ones release the stand.
 */
export class RailStand {
    /** The rails in the order they claimed the stand. The last one is shown. */
    private claimants: object[] = [];
    private listeners = new Set<() => void>();

    /** Whether any rail has claimed the stand, a leaving one included. */
    get isTaken() {
        return this.claimants.length > 0;
    }

    /** Whether a rail that claimed the stand later hides this one. */
    isSuperseded(token: object) {
        const index = this.claimants.indexOf(token);
        return index >= 0 && index < this.claimants.length - 1;
    }

    claim(token: object) {
        if (this.claimants.at(-1) === token) return;
        this.claimants = [ ...this.claimants.filter((other) => other !== token), token ];
        this.notify();
    }

    release(token: object) {
        if (!this.claimants.includes(token)) return;
        this.claimants = this.claimants.filter((other) => other !== token);
        this.notify();
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify() {
        for (const listener of [ ...this.listeners ]) {
            listener();
        }
    }
}

/**
 * The stand of the rails below it. A view with rails of its own, such as a board, provides one, so
 * that two views side by side each show a rail.
 */
export const RailStandContext = createContext(new RailStand());
