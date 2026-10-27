/** A picture of a drawing that waits to be drawn. */
interface PendingPicture {
    draw: () => Promise<void>;
    timer: ReturnType<typeof setTimeout>;
}

/** How long the user gives no input before a picture is drawn, in ms. */
const INPUT_PAUSE = 2000;
const INPUT_EVENTS = [ "pointerdown", "pointermove", "wheel", "keydown" ];

const pendingPictures = new Map<string, PendingPicture>();
/** The latest draw of each drawing, which the next draw of the drawing waits for. */
const runningDraws = new Map<string, Promise<void>>();
let lastInputTime = 0;
let isWatchingPage = false;

/**
 * Draws the picture of the drawing `key` with `draw` once `delay` ms pass without another call for
 * `key` and the user pauses their input, or at once while the page is hidden. A later call
 * replaces the `draw` that waits. Drawing blocks the main thread for the whole scene, so it waits
 * until the user is idle.
 */
export function schedulePicture(key: string, draw: () => Promise<void>, delay: number) {
    const pending = pendingPictures.get(key);
    if (pending) {
        clearTimeout(pending.timer);
    }
    pendingPictures.set(key, { draw, timer: setTimeout(() => drawWhenIdle(key), delay) });
    watchPage();
    if (document.visibilityState === "hidden") {
        drawPicture(key);
    }
}

/** Draws the picture of `key` that waits, or waits until the user's input pauses. */
function drawWhenIdle(key: string) {
    const pending = pendingPictures.get(key);
    if (!pending) return;

    const wait = lastInputTime + INPUT_PAUSE - Date.now();
    if (wait > 0) {
        pending.timer = setTimeout(() => drawWhenIdle(key), wait);
    } else {
        drawPicture(key);
    }
}

/** Starts the draw of `key` that waits, once the running draw of `key` ends. */
function drawPicture(key: string) {
    const pending = pendingPictures.get(key);
    if (!pending) return;
    pendingPictures.delete(key);
    clearTimeout(pending.timer);

    // `draw` reports its own failures.
    const draw = (runningDraws.get(key) ?? Promise.resolve()).then(pending.draw).catch(() => {});
    runningDraws.set(key, draw);
    void draw.then(() => {
        if (runningDraws.get(key) === draw) {
            runningDraws.delete(key);
        }
    });
}

/**
 * Records the time of the user's input, and draws the pictures that wait once the page is hidden,
 * since a hidden page can close.
 */
function watchPage() {
    if (isWatchingPage) return;
    isWatchingPage = true;

    const noteInput = () => {
        lastInputTime = Date.now();
    };
    for (const type of INPUT_EVENTS) {
        document.addEventListener(type, noteInput, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") return;
        for (const key of [ ...pendingPictures.keys() ]) {
            drawPicture(key);
        }
    });
}
