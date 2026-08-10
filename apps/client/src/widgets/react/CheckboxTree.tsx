import "./CheckboxTree.css";

import clsx from "clsx";
import { useMemo, useState } from "preact/hooks";

import SimpleBadge from "./Badge";
import FormCheckbox from "./FormCheckbox";
import Icon from "./Icon";

export interface CheckboxTreeNode {
    id: string;
    label: string;
    /** Present (possibly empty) on container nodes; absent on selectable leaves. */
    children?: CheckboxTreeNode[];
}

interface CheckboxTreeProps {
    nodes: CheckboxTreeNode[];
    /** Selected leaf ids — the single source of truth; container checkbox states are derived from it. */
    selectedIds: Set<string>;
    onChange(next: Set<string>): void;
    /** Containers shallower than this many levels start expanded. Defaults to 1 (root containers only). */
    defaultExpandedDepth?: number;
}

/**
 * A tree of checkboxes for picking a subset of leaves out of a hierarchy. Leaves toggle themselves;
 * containers show a tri-state checkbox (checked / indeterminate / unchecked) derived from their
 * descendant leaves and toggle all of them at once. Containers can be collapsed, in which case a
 * badge keeps the selection visible as "selected / total" leaf counts.
 *
 * Selection is controlled: the caller owns the set of selected leaf ids and receives the whole next
 * set on every change. Node ids must be unique across the entire tree.
 */
export default function CheckboxTree({ nodes, selectedIds, onChange, defaultExpandedDepth = 1 }: CheckboxTreeProps) {
    const leafIdsByContainer = useMemo(() => {
        const map = new Map<string, string[]>();
        collectLeafIds(nodes, map);
        return map;
    }, [nodes]);

    // Expansion is tracked as per-node overrides on top of the depth-based default rather than as a
    // set of expanded ids, so nodes arriving after mount (async loads) still get the default.
    const [expandOverrides, setExpandOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());

    const toggleExpanded = (id: string, expandedByDefault: boolean) => {
        setExpandOverrides((prev) => {
            const next = new Map(prev);
            next.set(id, !(prev.get(id) ?? expandedByDefault));
            return next;
        });
    };

    const toggleLeaf = (id: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) {
            next.add(id);
        } else {
            next.delete(id);
        }
        onChange(next);
    };

    // A partially selected container selects the remainder (the file-picker convention);
    // only a fully selected one deselects.
    const toggleContainer = (leafIds: string[], allSelected: boolean) => {
        const next = new Set(selectedIds);
        for (const id of leafIds) {
            if (allSelected) {
                next.delete(id);
            } else {
                next.add(id);
            }
        }
        onChange(next);
    };

    const renderLevel = (levelNodes: CheckboxTreeNode[], depth: number) => (
        <ul className={clsx("checkbox-tree-level", { "checkbox-tree": depth === 0 })}>
            {levelNodes.map((node) => {
                if (!node.children) {
                    return (
                        <li key={node.id} className="checkbox-tree-leaf">
                            <FormCheckbox
                                name={`checkbox-tree-${node.id}`}
                                label={node.label}
                                currentValue={selectedIds.has(node.id)}
                                onChange={(checked) => toggleLeaf(node.id, checked)}
                            />
                        </li>
                    );
                }

                const leafIds = leafIdsByContainer.get(node.id) ?? [];
                const selectedCount = leafIds.reduce((count, id) => count + (selectedIds.has(id) ? 1 : 0), 0);
                const allSelected = leafIds.length > 0 && selectedCount === leafIds.length;
                const expandedByDefault = depth < defaultExpandedDepth;
                const expanded = node.children.length > 0 && (expandOverrides.get(node.id) ?? expandedByDefault);

                return (
                    <li key={node.id} className="checkbox-tree-container">
                        <div className="checkbox-tree-row">
                            {node.children.length > 0
                                ? (
                                    <button
                                        type="button"
                                        className="checkbox-tree-caret tn-low-profile"
                                        aria-expanded={expanded}
                                        aria-label={node.label}
                                        onClick={() => toggleExpanded(node.id, expandedByDefault)}
                                    >
                                        <Icon className={clsx("arrow", { expanded })} icon="bx bx-chevron-right" />
                                    </button>
                                )
                                : <span className="checkbox-tree-caret" />}
                            <FormCheckbox
                                name={`checkbox-tree-${node.id}`}
                                label={node.label}
                                currentValue={allSelected}
                                indeterminate={selectedCount > 0 && !allSelected}
                                disabled={leafIds.length === 0}
                                onChange={() => toggleContainer(leafIds, allSelected)}
                            />
                            {!expanded && leafIds.length > 0 && (
                                <SimpleBadge
                                    className="checkbox-tree-count"
                                    title={selectedCount > 0 ? `${selectedCount} / ${leafIds.length}` : `${leafIds.length}`}
                                />
                            )}
                        </div>
                        {expanded && renderLevel(node.children, depth + 1)}
                    </li>
                );
            })}
        </ul>
    );

    return renderLevel(nodes, 0);
}

/** Fills `map` with each container's transitive leaf ids and returns the ids for the given level. */
function collectLeafIds(nodes: CheckboxTreeNode[], map: Map<string, string[]>): string[] {
    const leafIds: string[] = [];
    for (const node of nodes) {
        if (node.children) {
            const childLeafIds = collectLeafIds(node.children, map);
            map.set(node.id, childLeafIds);
            leafIds.push(...childLeafIds);
        } else {
            leafIds.push(node.id);
        }
    }
    return leafIds;
}
