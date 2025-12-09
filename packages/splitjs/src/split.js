// The programming goals of Split.js are to deliver readable, understandable and
// maintainable code, while at the same time manually optimizing for tiny minified file size,
// browser compatibility without additional requirements
// and very few assumptions about the user's page layout.
const global = typeof window !== 'undefined' ? window : null
const ssr = global === null
const document = !ssr ? global.document : undefined

// Save a couple long function names that are used frequently.
// This optimization saves around 400 bytes.
const addEventListener = 'addEventListener'
const removeEventListener = 'removeEventListener'
const getBoundingClientRect = 'getBoundingClientRect'
const gutterStartDragging = '_a'
const aGutterSize = '_b'
const bGutterSize = '_c'
const HORIZONTAL = 'horizontal'
const NOOP = () => false

// Helper function determines which prefixes of CSS calc we need.
// We only need to do this once on startup, when this anonymous function is called.
//
// Tests -webkit, -moz and -o prefixes. Modified from StackOverflow:
// http://stackoverflow.com/questions/16625140/js-feature-detection-to-detect-the-usage-of-webkit-calc-over-calc/16625167#16625167
const calc = ssr
    ? 'calc'
    : `${['', '-webkit-', '-moz-', '-o-']
          .filter(prefix => {
              const el = document.createElement('div')
              el.style.cssText = `width:${prefix}calc(9px)`

              return !!el.style.length
          })
          .shift()}calc`

// Helper function checks if its argument is a string-like type
const isString = v => typeof v === 'string' || v instanceof String

// Helper function allows elements and string selectors to be used
// interchangeably. In either case an element is returned. This allows us to
// do `Split([elem1, elem2])` as well as `Split(['#id1', '#id2'])`.
const elementOrSelector = el => {
    if (isString(el)) {
        const ele = document.querySelector(el)
        if (!ele) {
            throw new Error(`Selector ${el} did not match a DOM element`)
        }
        return ele
    }

    return el
}

// Helper function gets a property from the properties object, with a default fallback
const getOption = (options, propName, def) => {
    const value = options[propName]
    if (value !== undefined) {
        return value
    }
    return def
}

const getGutterSize = (gutterSize, isFirst, isLast, gutterAlign) => {
    if (isFirst) {
        if (gutterAlign === 'end') {
            return 0
        }
        if (gutterAlign === 'center') {
            return gutterSize / 2
        }
    } else if (isLast) {
        if (gutterAlign === 'start') {
            return 0
        }
        if (gutterAlign === 'center') {
            return gutterSize / 2
        }
    }

    return gutterSize
}

// Default options
const defaultGutterFn = (i, gutterDirection) => {
    const gut = document.createElement('div')
    gut.className = `gutter gutter-${gutterDirection}`
    return gut
}

const defaultElementStyleFn = (dim, size, gutSize) => {
    const style = {}

    if (!isString(size)) {
        style[dim] = `${calc}(${size}% - ${gutSize}px)`
    } else {
        style[dim] = size
    }

    return style
}

const defaultGutterStyleFn = (dim, gutSize) => ({ [dim]: `${gutSize}px` })

// The main function to initialize a split. Split.js thinks about each pair
// of elements as an independant pair. Dragging the gutter between two elements
// only changes the dimensions of elements in that pair. This is key to understanding
// how the following functions operate, since each function is bound to a pair.
//
// A pair object is shaped like this:
//
// {
//     a: DOM element,
//     b: DOM element,
//     aMin: Number,
//     bMin: Number,
//     dragging: Boolean,
//     parent: DOM element,
//     direction: 'horizontal' | 'vertical'
// }
//
// The basic sequence:
//
// 1. Set defaults to something sane. `options` doesn't have to be passed at all.
// 2. Initialize a bunch of strings based on the direction we're splitting.
//    A lot of the behavior in the rest of the library is paramatized down to
//    rely on CSS strings and classes.
// 3. Define the dragging helper functions, and a few helpers to go with them.
// 4. Loop through the elements while pairing them off. Every pair gets an
//    `pair` object and a gutter.
// 5. Actually size the pair elements, insert gutters and attach event listeners.
const Split = (idsOption, options = {}) => {
    if (ssr) return {}

    let ids = idsOption
    let dimension
    let clientAxis
    let position
    let positionEnd
    let clientSize
    let elements

    // Allow HTMLCollection to be used as an argument when supported
    if (Array.from) {
        ids = Array.from(ids)
    }

    // All DOM elements in the split should have a common parent. We can grab
    // the first elements parent and hope users read the docs because the
    // behavior will be whacky otherwise.
    const firstElement = elementOrSelector(ids[0])
    const parent = firstElement.parentNode
    const parentStyle = getComputedStyle ? getComputedStyle(parent) : null
    const parentFlexDirection = parentStyle ? parentStyle.flexDirection : null

    // Set default options.sizes to equal percentages of the parent element.
    let sizes = getOption(options, 'sizes') || ids.map(() => 100 / ids.length)

    // Standardize minSize and maxSize to an array if it isn't already.
    // This allows minSize and maxSize to be passed as a number.
    const minSize = getOption(options, 'minSize', 100)
    const minSizes = Array.isArray(minSize) ? minSize : ids.map(() => minSize)
    const maxSize = getOption(options, 'maxSize', Infinity)
    const maxSizes = Array.isArray(maxSize) ? maxSize : ids.map(() => maxSize)

    // Get other options
    const expandToMin = getOption(options, 'expandToMin', false)
    const gutterSize = getOption(options, 'gutterSize', 10)
    const gutterAlign = getOption(options, 'gutterAlign', 'center')
    const snapOffset = getOption(options, 'snapOffset', 30)
    const snapOffsets = Array.isArray(snapOffset) ? snapOffset : ids.map(() => snapOffset)
    const dragInterval = getOption(options, 'dragInterval', 1)
    const direction = getOption(options, 'direction', HORIZONTAL)
    const cursor = getOption(
        options,
        'cursor',
        direction === HORIZONTAL ? 'col-resize' : 'row-resize',
    )
    const gutter = getOption(options, 'gutter', defaultGutterFn)
    const elementStyle = getOption(
        options,
        'elementStyle',
        defaultElementStyleFn,
    )
    const gutterStyle = getOption(options, 'gutterStyle', defaultGutterStyleFn)
    const rtl = getOption(options, 'rtl', false)

    // 2. Initialize a bunch of strings based on the direction we're splitting.
    // A lot of the behavior in the rest of the library is paramatized down to
    // rely on CSS strings and classes.
    if (direction === HORIZONTAL) {
        dimension = 'width'
        clientAxis = 'clientX'
        position = 'left'
        positionEnd = 'right'
        clientSize = 'clientWidth'
    } else if (direction === 'vertical') {
        dimension = 'height'
        clientAxis = 'clientY'
        position = 'top'
        positionEnd = 'bottom'
        clientSize = 'clientHeight'
    }

    // 3. Define the dragging helper functions, and a few helpers to go with them.
    // Each helper is bound to a pair object that contains its metadata. This
    // also makes it easy to store references to listeners that that will be
    // added and removed.
    //
    // Even though there are no other functions contained in them, aliasing
    // this to self saves 50 bytes or so since it's used so frequently.
    //
    // The pair object saves metadata like dragging state, position and
    // event listener references.

    function setElementSize(el, size, gutSize, i) {
        // Split.js allows setting sizes via numbers (ideally), or if you must,
        // by string, like '300px'. This is less than ideal, because it breaks
        // the fluid layout that `calc(% - px)` provides. You're on your own if you do that,
        // make sure you calculate the gutter size by hand.
        const style = elementStyle(dimension, size, gutSize, i)

        Object.keys(style).forEach(prop => {
            // eslint-disable-next-line no-param-reassign
            el.style[prop] = style[prop]
        })
    }

    function setGutterSize(gutterElement, gutSize, i) {
        const style = gutterStyle(dimension, gutSize, i)

        Object.keys(style).forEach(prop => {
            // eslint-disable-next-line no-param-reassign
            gutterElement.style[prop] = style[prop]
        })
    }

    function getSizes() {
        return elements.map(element => element.size)
    }

    // Supports touch events, but not multitouch, so only the first
    // finger `touches[0]` is counted.
    function getMousePosition(e) {
        if ('touches' in e) return e.touches[0][clientAxis]
        return e[clientAxis]
    }

    // Actually adjust the size of elements `a` and `b` to `offset` while dragging.
    // calc is used to allow calc(percentage + gutterpx) on the whole split instance,
    // which allows the viewport to be resized without additional logic.
    // Element a's size is the same as offset. b's size is total size - a size.
    // Both sizes are calculated from the initial parent percentage,
    // then the gutter size is subtracted.
    function adjust(offset) {
        const a = elements[this.a]
        const b = elements[this.b]
        const percentage = a.size + b.size

        a.size = (offset / this.size) * percentage
        b.size = percentage - (offset / this.size) * percentage

        setElementSize(a.element, a.size, this[aGutterSize], a.i)
        setElementSize(b.element, b.size, this[bGutterSize], b.i)
    }

    // drag, where all the magic happens. The logic is really quite simple:
    //
    // 1. Ignore if the pair is not dragging.
    // 2. Get the offset of the event.
    // 3. Snap offset to min if within snappable range (within min + snapOffset).
    // 4. Actually adjust each element in the pair to offset.
    //
    // ---------------------------------------------------------------------
    // |    | <- a.minSize               ||              b.minSize -> |    |
    // |    |  | <- this.snapOffset      ||     this.snapOffset -> |  |    |
    // |    |  |                         ||                        |  |    |
    // |    |  |                         ||                        |  |    |
    // ---------------------------------------------------------------------
    // | <- this.start                                        this.size -> |
    function drag(e) {
        let offset
        const a = elements[this.a]
        const b = elements[this.b]

        if (!this.dragging) return

        // Get the offset of the event from the first side of the
        // pair `this.start`. Then offset by the initial position of the
        // mouse compared to the gutter size.
        offset =
            getMousePosition(e) -
            this.start +
            (this[aGutterSize] - this.dragOffset)

        if (dragInterval > 1) {
            offset = Math.round(offset / dragInterval) * dragInterval
        }

        // If within snapOffset of min or max, set offset to min or max.
        // snapOffset buffers a.minSize and b.minSize, so logic is opposite for both.
        // Include the appropriate gutter sizes to prevent overflows.
        if (offset <= a.minSize + a.snapOffset + this[aGutterSize]) {
            offset = a.minSize + this[aGutterSize]
        } else if (
            offset >=
            this.size - (b.minSize + b.snapOffset + this[bGutterSize])
        ) {
            offset = this.size - (b.minSize + this[bGutterSize])
        }

        if (offset >= a.maxSize - a.snapOffset + this[aGutterSize]) {
            offset = a.maxSize + this[aGutterSize]
        } else if (
            offset <=
            this.size - (b.maxSize - b.snapOffset + this[bGutterSize])
        ) {
            offset = this.size - (b.maxSize + this[bGutterSize])
        }

        // Actually adjust the size.
        adjust.call(this, offset)

        // Call the drag callback continously. Don't do anything too intensive
        // in this callback.
        getOption(options, 'onDrag', NOOP)(getSizes())
    }

    // Cache some important sizes when drag starts, so we don't have to do that
    // continously:
    //
    // `size`: The total size of the pair. First + second + first gutter + second gutter.
    // `start`: The leading side of the first element.
    //
    // ------------------------------------------------
    // |      aGutterSize -> |||                      |
    // |                     |||                      |
    // |                     |||                      |
    // |                     ||| <- bGutterSize       |
    // ------------------------------------------------
    // | <- start                             size -> |
    function calculateSizes() {
        // Figure out the parent size minus padding.
        const a = elements[this.a].element
        const b = elements[this.b].element

        const aBounds = a[getBoundingClientRect]()
        const bBounds = b[getBoundingClientRect]()

        this.size =
            aBounds[dimension] +
            bBounds[dimension] +
            this[aGutterSize] +
            this[bGutterSize]
        this.start = aBounds[position]
        this.end = aBounds[positionEnd]
    }

    function innerSize(element) {
        // Return nothing if getComputedStyle is not supported (< IE9)
        // Or if parent element has no layout yet
        if (!getComputedStyle) return null

        const computedStyle = getComputedStyle(element)

        if (!computedStyle) return null

        let size = element[clientSize]

        if (size === 0) return null

        if (direction === HORIZONTAL) {
            size -=
                parseFloat(computedStyle.paddingLeft) +
                parseFloat(computedStyle.paddingRight)
        } else {
            size -=
                parseFloat(computedStyle.paddingTop) +
                parseFloat(computedStyle.paddingBottom)
        }

        return size
    }

    // When specifying percentage sizes that are less than the computed
    // size of the element minus the gutter, the lesser percentages must be increased
    // (and decreased from the other elements) to make space for the pixels
    // subtracted by the gutters.
    function trimToMin(sizesToTrim) {
        // Try to get inner size of parent element.
        // If it's no supported, return original sizes.
        const parentSize = innerSize(parent)
        if (parentSize === null) {
            return sizesToTrim
        }

        if (minSizes.reduce((a, b) => a + b, 0) > parentSize) {
            return sizesToTrim
        }

        // Keep track of the excess pixels, the amount of pixels over the desired percentage
        // Also keep track of the elements with pixels to spare, to decrease after if needed
        let excessPixels = 0
        const toSpare = []

        const pixelSizes = sizesToTrim.map((size, i) => {
            // Convert requested percentages to pixel sizes
            const pixelSize = (parentSize * size) / 100
            const elementGutterSize = getGutterSize(
                gutterSize,
                i === 0,
                i === sizesToTrim.length - 1,
                gutterAlign,
            )
            const elementMinSize = minSizes[i] + elementGutterSize

            // If element is too smal, increase excess pixels by the difference
            // and mark that it has no pixels to spare
            if (pixelSize < elementMinSize) {
                excessPixels += elementMinSize - pixelSize
                toSpare.push(0)
                return elementMinSize
            }

            // Otherwise, mark the pixels it has to spare and return it's original size
            toSpare.push(pixelSize - elementMinSize)
            return pixelSize
        })

        // If nothing was adjusted, return the original sizes
        if (excessPixels === 0) {
            return sizesToTrim
        }

        return pixelSizes.map((pixelSize, i) => {
            let newPixelSize = pixelSize

            // While there's still pixels to take, and there's enough pixels to spare,
            // take as many as possible up to the total excess pixels
            if (excessPixels > 0 && toSpare[i] - excessPixels > 0) {
                const takenPixels = Math.min(
                    excessPixels,
                    toSpare[i] - excessPixels,
                )

                // Subtract the amount taken for the next iteration
                excessPixels -= takenPixels
                newPixelSize = pixelSize - takenPixels
            }

            // Return the pixel size adjusted as a percentage
            return (newPixelSize / parentSize) * 100
        })
    }

    // stopDragging is very similar to startDragging in reverse.
    function stopDragging() {
        const self = this
        const a = elements[self.a].element
        const b = elements[self.b].element

        if (self.dragging) {
            getOption(options, 'onDragEnd', NOOP)(getSizes())
        }

        self.dragging = false

        // Remove the stored event listeners. This is why we store them.
        global[removeEventListener]('mouseup', self.stop)
        global[removeEventListener]('touchend', self.stop)
        global[removeEventListener]('touchcancel', self.stop)
        global[removeEventListener]('mousemove', self.move)
        global[removeEventListener]('touchmove', self.move)

        // Clear bound function references
        self.stop = null
        self.move = null

        a[removeEventListener]('selectstart', NOOP)
        a[removeEventListener]('dragstart', NOOP)
        b[removeEventListener]('selectstart', NOOP)
        b[removeEventListener]('dragstart', NOOP)

        a.style.userSelect = ''
        a.style.webkitUserSelect = ''
        a.style.MozUserSelect = ''
        a.style.pointerEvents = ''

        b.style.userSelect = ''
        b.style.webkitUserSelect = ''
        b.style.MozUserSelect = ''
        b.style.pointerEvents = ''

        self.gutter.style.cursor = ''
        self.parent.style.cursor = ''
        document.body.style.cursor = ''
    }

    // startDragging calls `calculateSizes` to store the inital size in the pair object.
    // It also adds event listeners for mouse/touch events,
    // and prevents selection while dragging so avoid the selecting text.
    function startDragging(e) {
        // Right-clicking can't start dragging.
        if ('button' in e && e.button !== 0) {
            return
        }

        // Alias frequently used variables to save space. 200 bytes.
        const self = this
        const a = elements[self.a].element
        const b = elements[self.b].element

        // Call the onDragStart callback.
        if (!self.dragging) {
            getOption(options, 'onDragStart', NOOP)(getSizes())
        }

        // Don't actually drag the element. We emulate that in the drag function.
        e.preventDefault()

        // Set the dragging property of the pair object.
        self.dragging = true

        // Create two event listeners bound to the same pair object and store
        // them in the pair object.
        self.move = drag.bind(self)
        self.stop = stopDragging.bind(self)

        // All the binding. `window` gets the stop events in case we drag out of the elements.
        global[addEventListener]('mouseup', self.stop)
        global[addEventListener]('touchend', self.stop)
        global[addEventListener]('touchcancel', self.stop)
        global[addEventListener]('mousemove', self.move)
        global[addEventListener]('touchmove', self.move)

        // Disable selection. Disable!
        a[addEventListener]('selectstart', NOOP)
        a[addEventListener]('dragstart', NOOP)
        b[addEventListener]('selectstart', NOOP)
        b[addEventListener]('dragstart', NOOP)

        a.style.userSelect = 'none'
        a.style.webkitUserSelect = 'none'
        a.style.MozUserSelect = 'none'
        a.style.pointerEvents = 'none'

        b.style.userSelect = 'none'
        b.style.webkitUserSelect = 'none'
        b.style.MozUserSelect = 'none'
        b.style.pointerEvents = 'none'

        // Set the cursor at multiple levels
        self.gutter.style.cursor = cursor
        self.parent.style.cursor = cursor
        document.body.style.cursor = cursor

        // Cache the initial sizes of the pair.
        calculateSizes.call(self)

        // Determine the position of the mouse compared to the gutter
        self.dragOffset = getMousePosition(e) - self.end
    }

    // adjust sizes to ensure percentage is within min size and gutter.
    sizes = trimToMin(sizes)

    // 5. Create pair and element objects. Each pair has an index reference to
    // elements `a` and `b` of the pair (first and second elements).
    // Loop through the elements while pairing them off. Every pair gets a
    // `pair` object and a gutter.
    //
    // Basic logic:
    //
    // - Starting with the second element `i > 0`, create `pair` objects with
    //   `a = i - 1` and `b = i`
    // - Set gutter sizes based on the _pair_ being first/last. The first and last
    //   pair have gutterSize / 2, since they only have one half gutter, and not two.
    // - Create gutter elements and add event listeners.
    // - Set the size of the elements, minus the gutter sizes.
    //
    // -----------------------------------------------------------------------
    // |     i=0     |         i=1         |        i=2       |      i=3     |
    // |             |                     |                  |              |
    // |           pair 0                pair 1             pair 2           |
    // |             |                     |                  |              |
    // -----------------------------------------------------------------------
    const pairs = []
    elements = ids.map((id, i) => {
        // Create the element object.
        const element = {
            element: elementOrSelector(id),
            size: sizes[i],
            minSize: minSizes[i],
            maxSize: maxSizes[i],
            snapOffset: snapOffsets[i],
            i,
        }

        let pair

        if (i > 0) {
            // Create the pair object with its metadata.
            pair = {
                a: i - 1,
                b: i,
                dragging: false,
                direction,
                parent,
            }

            pair[aGutterSize] = getGutterSize(
                gutterSize,
                i - 1 === 0,
                false,
                gutterAlign,
            )
            pair[bGutterSize] = getGutterSize(
                gutterSize,
                false,
                i === ids.length - 1,
                gutterAlign,
            )

            // if the parent has a reverse flex-direction, switch the pair elements.
            if (
                (direction === HORIZONTAL && rtl) ||
                parentFlexDirection === 'row-reverse' ||
                parentFlexDirection === 'column-reverse'
            ) {
                const temp = pair.a
                pair.a = pair.b
                pair.b = temp
            }
        }

        // Determine the size of the current element. IE8 is supported by
        // staticly assigning sizes without draggable gutters. Assigns a string
        // to `size`.
        //
        // Create gutter elements for each pair.
        if (i > 0) {
            const gutterElement = gutter(i, direction, element.element)
            setGutterSize(gutterElement, gutterSize, i)

            // Save bound event listener for removal later
            pair[gutterStartDragging] = startDragging.bind(pair)

            // Attach bound event listener
            gutterElement[addEventListener](
                'mousedown',
                pair[gutterStartDragging],
            )
            gutterElement[addEventListener](
                'touchstart',
                pair[gutterStartDragging],
            )

            parent.insertBefore(gutterElement, element.element)

            pair.gutter = gutterElement
        }

        setElementSize(
            element.element,
            element.size,
            getGutterSize(
                gutterSize,
                i === 0,
                i === ids.length - 1,
                gutterAlign,
            ),
            i,
        )

        // After the first iteration, and we have a pair object, append it to the
        // list of pairs.
        if (i > 0) {
            pairs.push(pair)
        }

        return element
    })

    function adjustToMin(element) {
        const isLast = element.i === pairs.length
        const pair = isLast ? pairs[element.i - 1] : pairs[element.i]

        calculateSizes.call(pair)

        const size = isLast
            ? pair.size - element.minSize - pair[bGutterSize]
            : element.minSize + pair[aGutterSize]

        adjust.call(pair, size)
    }

    elements.forEach(element => {
        const computedSize = element.element[getBoundingClientRect]()[dimension]

        if (computedSize < element.minSize) {
            if (expandToMin) {
                adjustToMin(element)
            } else {
                // eslint-disable-next-line no-param-reassign
                element.minSize = computedSize
            }
        }
    })

    function setSizes(newSizes) {
        const trimmed = trimToMin(newSizes)
        trimmed.forEach((newSize, i) => {
            if (i > 0) {
                const pair = pairs[i - 1]

                const a = elements[pair.a]
                const b = elements[pair.b]

                a.size = trimmed[i - 1]
                b.size = newSize

                setElementSize(a.element, a.size, pair[aGutterSize], a.i)
                setElementSize(b.element, b.size, pair[bGutterSize], b.i)
            }
        })
    }

    function destroy(preserveStyles, preserveGutter) {
        pairs.forEach(pair => {
            if (preserveGutter !== true) {
                pair.parent.removeChild(pair.gutter)
            } else {
                pair.gutter[removeEventListener](
                    'mousedown',
                    pair[gutterStartDragging],
                )
                pair.gutter[removeEventListener](
                    'touchstart',
                    pair[gutterStartDragging],
                )
            }

            if (preserveStyles !== true) {
                const style = elementStyle(
                    dimension,
                    pair.a.size,
                    pair[aGutterSize],
                )

                Object.keys(style).forEach(prop => {
                    elements[pair.a].element.style[prop] = ''
                    elements[pair.b].element.style[prop] = ''
                })
            }
        })
    }

    return {
        setSizes,
        getSizes,
        collapse(i) {
            adjustToMin(elements[i])
        },
        destroy,
        parent,
        pairs,
    }
}

export default Split
