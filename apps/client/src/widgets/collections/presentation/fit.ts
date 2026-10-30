const MAX_FIT_ATTEMPTS = 8;

/**
 * Fits each observed slide content again whenever its size changes: an image or a font loads, the theme
 * changes, or Reveal.js shows a slide it had hidden. The size each fit leaves behind is remembered, so the
 * fit's own zoom does not trigger another fit.
 */
export function createFitObserver(onFitted: () => void) {
    const fittedSizes = new WeakMap<Element, string>();
    return new ResizeObserver((entries) => {
        let fitted = false;
        for (const { target } of entries) {
            if (!(target instanceof HTMLElement) || fittedSizes.get(target) === measureSize(target)) continue;
            fitSlideContent(target);
            fittedSizes.set(target, measureSize(target));
            fitted = true;
        }
        if (fitted) onFitted();
    });
}

function measureSize(element: HTMLElement) {
    return `${element.offsetWidth}x${element.offsetHeight}`;
}

/**
 * Zooms out the content of a slide that is larger than the slide, so that it fits. A hidden slide measures
 * as empty and keeps no zoom until it is fitted again.
 *
 * Some lengths (percentages, container query units) do not scale with `zoom`, so the content is measured
 * again after each zoom. The overflow is close to linear in the zoom, so each next zoom is a secant step.
 */
export function fitSlideContent(content: HTMLElement) {
    content.style.zoom = "";
    let previous = { scale: 1, overflow: measureOverflow(content) };
    if (previous.overflow <= 1) return;

    let scale = 1 / previous.overflow;
    for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
        content.style.zoom = String(scale);
        const overflow = measureOverflow(content);
        if (overflow <= 1) break;

        const slope = (previous.overflow - overflow) / (previous.scale - scale);
        const next = scale - (overflow - 1) / slope;
        previous = { scale, overflow };
        scale = slope > 0 && next > 0 ? next : scale / overflow;
    }
}

/** Returns how many times larger the content is than the slide, as measured on screen. */
function measureOverflow(content: HTMLElement) {
    const slides = content.closest<HTMLElement>(".slides");
    const slidesHeight = slides?.getBoundingClientRect().height;
    if (!slidesHeight || !content.clientWidth) return 0;

    const heightRatio = content.getBoundingClientRect().height / slidesHeight;
    const widthRatio = content.scrollWidth / content.clientWidth;
    return Math.max(heightRatio, widthRatio);
}
