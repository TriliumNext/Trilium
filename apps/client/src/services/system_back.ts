/**
 * Answers the system back gesture and button (Android's, through `MainActivity`): each handler
 * closes or steps back from something on screen and returns whether it did. The handler registered
 * last is asked first, so a menu or dialog opened over the note answers before the note does.
 */
export type SystemBackHandler = () => boolean;

const handlers: SystemBackHandler[] = [];

/** Registers `handler` until the returned function runs. */
export function onSystemBack(handler: SystemBackHandler) {
    handlers.push(handler);
    return () => {
        const index = handlers.lastIndexOf(handler);
        if (index !== -1) handlers.splice(index, 1);
    };
}

/** Runs the newest handler that has something to go back from; `false` when none had. */
export function handleSystemBack() {
    for (const handler of [ ...handlers ].reverse()) {
        if (handler()) return true;
    }
    return false;
}
