import { render, type VNode } from "preact";
import { act } from "preact/test-utils";

import appContext from "../components/app_context";
import Component from "../components/component";
import { ParentComponent } from "../widgets/react/react_utils";
import { type RightPaneTabContents, RightPaneTabBodies } from "../widgets/sidebar/RightPaneContent";

/** A tab of the right pane rendered as the pane renders it, with its filter field to type in. */
export function createFilterableTab() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parent = new Component();
    appContext.child(parent);

    const field = () => container.querySelector<HTMLInputElement>(".right-pane-filter input");
    const card = (id: string) => container.querySelector<HTMLElement>(`[role=tabpanel] > #${id}`);

    return {
        container,
        field,
        card,

        /** Renders `items` as the sections of the tab, again on each call. */
        async render(items: VNode[], { filterable = true, flat = false } = {}) {
            const tab: RightPaneTabContents = {
                id: "outline", title: "Outline", icon: "bx bx-list-ul", filterable, items
            };
            await act(async () => {
                render(
                    <ParentComponent.Provider value={parent}>
                        <RightPaneTabBodies tabs={[ tab ]} activeTabId="outline" flat={flat} />
                    </ParentComponent.Provider>, container);
            });
        },

        async type(text: string) {
            const input = field();
            if (!input) throw new Error("The tab has no filter field.");
            input.value = text;
            await act(async () => {
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
        },

        /** Presses `key` in the field, and returns the event. */
        async press(key: string, init: KeyboardEventInit = {}) {
            const event = new KeyboardEvent("keydown", {
                key, bubbles: true, cancelable: true, ...init
            });
            await act(async () => {
                field()?.dispatchEvent(event);
            });
            return event;
        },

        /** Whether the card `id` is in the tab and not filtered out. */
        isShown(id: string) {
            const element = card(id);
            return !!element && !element.classList.contains("right-pane-filtered-out");
        },

        /** The tab's own "No matches", after its cards. */
        emptyState: () => container.querySelector("[role=tabpanel] > .no-items"),

        destroy() {
            act(() => render(null, container));
            container.remove();
        }
    };
}
