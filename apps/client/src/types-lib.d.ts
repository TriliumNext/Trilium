export {};

declare module "htmldiff-js" {
    const HtmlDiff: {
        execute(oldHtml: string, newHtml: string): string;
    };
    export default HtmlDiff;
}

// TODO: Use real @types/ but that one generates a lot of errors.
declare module "draggabilly" {
    type DraggabillyEventData = {};
    interface MoveVector {
        x: number;
        y: number;
    }
    type DraggabillyCallback = (event: unknown, pointer: unknown, moveVector: MoveVector) => void;
    export default class Draggabilly {
        constructor(el: HTMLElement, opts: {
            axis: "x" | "y";
            handle: string;
            containment: HTMLElement
        });
        element: HTMLElement;
        on(event: "staticClick" | "dragStart" | "dragEnd" | "dragMove", callback: Callback);
        dragEnd();
        isDragging: boolean;
        positionDrag: () => void;
        destroy();
    }
}

declare module "katex/contrib/auto-render" {
    var renderMathInElement: (element: HTMLElement, options: {
        trust: boolean;
    }) => void;
    export default renderMathInElement;
}

declare global {
    /** Geometry of the title bar area left free by the native window controls, and changes to it. */
    interface WindowControlsOverlay extends EventTarget {
        /** Whether the window controls overlay is drawn (false when the native title bar is used). */
        readonly visible: boolean;
        /**
         * The part of the title bar not covered by the native caption buttons. A non-zero `x` means
         * the buttons sit on the left; `x + width < window width` means they sit on the right.
         */
        getTitlebarAreaRect(): DOMRect;
    }

    interface Navigator {
        /** Returns a boolean indicating whether the browser is running in standalone mode. Available on Apple's iOS Safari only. */
        standalone?: boolean;
        /** Returns the WindowControlsOverlay interface which exposes information about the geometry of the title bar in desktop Progressive Web Apps, and an event to know whenever it changes. */
        windowControlsOverlay?: WindowControlsOverlay;
    }
}

declare module "preact" {
    namespace JSX {
        interface ElectronWebViewElement extends JSX.HTMLAttributes<HTMLElement> {
            src: string;
            class: string;
            key?: string | number;
            partition?: string;
        }

        interface IntrinsicElements {
            webview: ElectronWebViewElement;
        }
    }
}
