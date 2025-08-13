import { useContext, useEffect, useRef } from "preact/hooks";
import { EventData, EventNames } from "../../components/app_context";
import { ParentComponent } from "./ReactBasicWidget";
import SpacedUpdate from "../../services/spaced_update";

/**
 * Allows a React component to react to Trilium events (e.g. `entitiesReloaded`). When the desired event is triggered, the handler is invoked with the event parameters.
 * 
 * Under the hood, it works by altering the parent (Trilium) component of the React element to introduce the corresponding event.
 * 
 * @param eventName the name of the Trilium event to listen for.
 * @param handler the handler to be invoked when the event is triggered.
 * @param enabled determines whether the event should be listened to or not. Useful to conditionally limit the listener based on a state (e.g. a modal being displayed).
 */
export default function useTriliumEvent<T extends EventNames>(eventName: T, handler: (data: EventData<T>) => void, enabled = true) {
    const parentWidget = useContext(ParentComponent);
    useEffect(() => {
        if (!parentWidget || !enabled) {            
            return;
        }        

        // Create a unique handler name for this specific event listener
        const handlerName = `${eventName}Event`;
        const originalHandler = parentWidget[handlerName];

        // Override the event handler to call our handler
        parentWidget[handlerName] = async function(data: EventData<T>) {
            // Call original handler if it exists
            if (originalHandler) {
                await originalHandler.call(parentWidget, data);
            }
            // Call our React component's handler
            handler(data);
        };

        // Cleanup: restore original handler on unmount or when disabled
        return () => {
            parentWidget[handlerName] = originalHandler;
        };
    }, [parentWidget, enabled, eventName, handler]);
}

export function useSpacedUpdate(callback: () => Promise<void>, interval = 1000) {
    const callbackRef = useRef(callback);
    const spacedUpdateRef = useRef<SpacedUpdate>();

    // Update callback ref when it changes
    useEffect(() => {
        callbackRef.current = callback;
    });

    // Create SpacedUpdate instance only once
    if (!spacedUpdateRef.current) {
        spacedUpdateRef.current = new SpacedUpdate(
            () => callbackRef.current(),
            interval
        );
    }

    // Update interval if it changes
    useEffect(() => {
        spacedUpdateRef.current?.setUpdateInterval(interval);
    }, [interval]);

    return spacedUpdateRef.current;
}