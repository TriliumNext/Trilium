import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import CheckboxTree, { type CheckboxTreeNode } from "./CheckboxTree";

/**
 * Work ─┬─ Meetings           (leaf)
 *       ├─ Projects           (leaf)
 *       └─ Archive  ─┬─ Old plans   (leaf)
 *                    └─ Newer plans (leaf)
 * Empty notebook     (container without any descendant leaves)
 */
const NODES: CheckboxTreeNode[] = [
    {
        id: "work",
        label: "Work",
        children: [
            { id: "meetings", label: "Meetings" },
            { id: "projects", label: "Projects" },
            {
                id: "archive",
                label: "Archive",
                children: [
                    { id: "plansOld", label: "Old plans" },
                    { id: "plansNew", label: "Newer plans" }
                ]
            }
        ]
    },
    { id: "empty", label: "Empty notebook", children: [] }
];

let container: HTMLDivElement | undefined;

function mount(vnode: Parameters<typeof render>[0]) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    void act(() => render(vnode, target));
    return target;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

/** Clicks inside act() so Preact flushes the resulting re-render before assertions run. */
function click(el: HTMLElement | null | undefined) {
    expect(el, "click target").not.toBeNull();
    void act(() => el?.click());
}

function checkboxFor(root: HTMLElement, id: string): HTMLInputElement {
    const input = root.querySelector<HTMLInputElement>(`input[id^="checkbox-tree-${id}"]`);
    if (!input) {
        throw new Error(`no checkbox for ${id}`);
    }
    return input;
}

/** Renders the tree with its selection state held in a component, the way callers use it. */
function Harness({ initialSelection = [], onChange }: { initialSelection?: string[]; onChange?: (next: Set<string>) => void }) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelection));
    return (
        <CheckboxTree
            nodes={NODES}
            selectedIds={selectedIds}
            onChange={(next) => {
                setSelectedIds(next);
                onChange?.(next);
            }}
        />
    );
}

describe("CheckboxTree", () => {
    it("derives container states from selected leaves: unchecked → indeterminate → checked", () => {
        const root = mount(<Harness />);
        const work = () => checkboxFor(root, "work");

        expect(work().checked).toBe(false);
        expect(work().indeterminate).toBe(false);

        click(checkboxFor(root, "meetings"));
        expect(work().checked).toBe(false);
        expect(work().indeterminate).toBe(true);

        // Selecting a partially selected container selects the remainder, everywhere beneath it.
        click(work());
        expect(work().checked).toBe(true);
        expect(work().indeterminate).toBe(false);
        expect(checkboxFor(root, "archive").checked).toBe(true);
        expect(checkboxFor(root, "projects").checked).toBe(true);
    });

    it("toggles all descendant leaves through a container and reports the full selection", () => {
        const onChange = vi.fn();
        const root = mount(<Harness onChange={onChange} />);

        click(checkboxFor(root, "work"));
        expect(onChange).toHaveBeenLastCalledWith(new Set(["meetings", "projects", "plansOld", "plansNew"]));

        // A fully selected container deselects everything beneath it.
        click(checkboxFor(root, "work"));
        expect(onChange).toHaveBeenLastCalledWith(new Set());
    });

    it("keeps leaf toggling independent and unchecks the container when its last leaf is dropped", () => {
        const onChange = vi.fn();
        const root = mount(<Harness initialSelection={["meetings"]} onChange={onChange} />);

        click(checkboxFor(root, "projects"));
        expect(onChange).toHaveBeenLastCalledWith(new Set(["meetings", "projects"]));

        click(checkboxFor(root, "meetings"));
        click(checkboxFor(root, "projects"));
        expect(onChange).toHaveBeenLastCalledWith(new Set());
        expect(checkboxFor(root, "work").indeterminate).toBe(false);
    });

    it("disables containers without descendant leaves and gives them no caret", () => {
        const root = mount(<Harness />);
        const empty = checkboxFor(root, "empty");

        expect(empty.disabled).toBe(true);
        const emptyRow = empty.closest(".checkbox-tree-row");
        expect(emptyRow?.querySelector("button.checkbox-tree-caret")).toBeNull();
    });

    it("expands roots by default, collapses deeper containers behind a caret with a count badge", () => {
        const root = mount(<Harness initialSelection={["plansOld"]} />);

        // Root level is expanded (its leaves are rendered), the nested group is not.
        expect(root.querySelector(`input[id^="checkbox-tree-meetings"]`)).not.toBeNull();
        expect(root.querySelector(`input[id^="checkbox-tree-plansOld"]`)).toBeNull();

        // The collapsed group still surfaces its hidden selection as "selected / total".
        const archiveRow = checkboxFor(root, "archive").closest(".checkbox-tree-row");
        expect(archiveRow?.querySelector(".checkbox-tree-count")?.textContent).toBe("1 / 2");
        expect(checkboxFor(root, "archive").indeterminate).toBe(true);

        // Expanding reveals the leaves and hides the badge; collapsing restores it.
        const caret = archiveRow?.querySelector<HTMLButtonElement>("button.checkbox-tree-caret");
        expect(caret?.getAttribute("aria-expanded")).toBe("false");
        click(caret);
        expect(caret?.getAttribute("aria-expanded")).toBe("true");
        expect(root.querySelector(`input[id^="checkbox-tree-plansOld"]`)).not.toBeNull();
        expect(root.querySelector(".checkbox-tree-count")).toBeNull();
        click(caret);
        expect(root.querySelector(`input[id^="checkbox-tree-plansOld"]`)).toBeNull();
        expect(root.querySelector(".checkbox-tree-count")?.textContent).toBe("1 / 2");
    });

    it("shows plain totals on collapsed containers without any selection", () => {
        const root = mount(<Harness />);
        const archiveRow = checkboxFor(root, "archive").closest(".checkbox-tree-row");
        expect(archiveRow?.querySelector(".checkbox-tree-count")?.textContent).toBe("2");
    });
});
