import { useContext, useDebugValue, useLayoutEffect } from "preact/hooks";

import type { EventData, EventNames } from "../../../components/app_context";
import { ParentComponent } from "../react_utils";

export function useTriliumEvent<T extends EventNames>(eventName: T, handler: (data: EventData<T>) => void) {
    const parentComponent = useContext(ParentComponent);
    useLayoutEffect(() => {
        parentComponent?.registerHandler(eventName, handler);
        return (() => parentComponent?.removeHandler(eventName, handler));
    }, [ eventName, handler ]);
    useDebugValue(eventName);
}

export function useTriliumEvents<T extends EventNames>(eventNames: T[], handler: (data: EventData<T>, eventName: T) => void) {
    const parentComponent = useContext(ParentComponent);

    useLayoutEffect(() => {
        const handlers: ({ eventName: T, callback: (data: EventData<T>) => unknown })[] = [];
        for (const eventName of eventNames) {
            // Return the handler's result so async handlers stay awaitable through triggerEvent().
            handlers.push({ eventName, callback: (data) => handler(data, eventName) });
        }

        for (const { eventName, callback } of handlers) {
            parentComponent?.registerHandler(eventName, callback);
        }

        return (() => {
            for (const { eventName, callback } of handlers) {
                parentComponent?.removeHandler(eventName, callback);
            }
        });
    }, [ eventNames, handler ]);
    useDebugValue(() => eventNames.join(", "));
}
