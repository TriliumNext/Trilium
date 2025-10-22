// Type definitions for Split.js
// Project: https://github.com/nathancahill/split/tree/master/packages/splitjs
// Definitions by: Ilia Choly <https://github.com/icholy>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
// TypeScript Version: 2.1

// Global variable outside module loader
export as namespace Split

// Module loader
export = Split

declare function Split(
    elements: Array<string | HTMLElement>,
    options?: Split.Options,
): Split.Instance

declare namespace Split {
    type Partial<T> = { [P in keyof T]?: T[P] }
    type CSSStyleDeclarationPartial = Partial<CSSStyleDeclaration>

    interface Options {
        // Initial sizes of each element in percents or CSS values.
        sizes?: number[]

        // Minimum size of each element.
        minSize?: number | number[]

        // Maximum size of each element.
        maxSize?: number | number[]

        expandToMin?: boolean

        // Gutter size in pixels.
        gutterSize?: number

        gutterAlign?: string

        // Snap to minimum size offset in pixels.
        snapOffset?: number | number[]

        dragInterval?: number

        // Direction to split: horizontal or vertical.
        direction?: 'horizontal' | 'vertical'

        // If the UI is right-to-left. Affects the drag direction.
        rtl?: boolean

        // Cursor to display while dragging.
        cursor?: string

        // Callback on drag.
        onDrag?(sizes: number[]): void

        // Callback on drag start.
        onDragStart?(sizes: number[]): void

        // Callback on drag end.
        onDragEnd?(sizes: number[]): void

        // Called to create each gutter element
        gutter?(
            index: number,
            direction: 'horizontal' | 'vertical',
        ): HTMLElement

        // Called to set the style of each element.
        elementStyle?(
            dimension: 'width' | 'height',
            elementSize: number,
            gutterSize: number,
            index: number,
        ): CSSStyleDeclarationPartial

        // Called to set the style of the gutter.
        gutterStyle?(
            dimension: 'width' | 'height',
            gutterSize: number,
            index: number,
        ): CSSStyleDeclarationPartial
    }

    interface Instance {
        // setSizes behaves the same as the sizes configuration option, passing an array of percents or CSS values.
        // It updates the sizes of the elements in the split.
        setSizes(sizes: number[]): void

        // getSizes returns an array of percents, suitable for using with setSizes or creation.
        getSizes(): number[]

        // collapse changes the size of element at index to 0.
        // Every element except the last is collapsed towards the front (left or top).
        // The last is collapsed towards the back.
        collapse(index: number): void

        // Destroy the instance. It removes the gutter elements, and the size CSS styles Split.js set.
        destroy(preserveStyles?: boolean, preserveGutters?: boolean): void
    }
}
