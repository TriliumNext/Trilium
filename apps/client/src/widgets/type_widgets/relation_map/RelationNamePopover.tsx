import "./RelationNamePopover.css";

import type { Connection } from "jsplumb";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import utils from "../../../services/utils";
import { AttributeNameSuggestion, fetchAttributeNames } from "../../attribute_widgets/attribute_detail";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import FormAutocomplete from "../../react/FormAutocomplete";
import Popover from "../../react/Popover";

interface RelationNameRequest {
    /** Tells requests apart, so a new one opens a fresh popover. */
    id: number;
    connection: Connection;
    /** The name the field opens with: the current one when renaming, empty for a new relation. */
    defaultValue: string;
    resolve(name: string | null): void;
}

/**
 * Asks for the name of the relation drawn by `connection`, next to the connection itself. Resolves
 * with the name, or `null` when the request is canceled with Escape, the close button or a press
 * outside the popover.
 */
export default function RelationNamePopover({ connection, defaultValue, onAnswer }: {
    connection: Connection;
    defaultValue: string;
    onAnswer(name: string | null): void;
}) {
    const [ name, setName ] = useState(defaultValue);
    const isComposing = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const isRename = !!defaultValue;

    const suggestRelationNames = useCallback((query: string) => fetchAttributeNames("relation", query), []);
    const renderRelationSuggestion = useCallback(
        (suggestion: string, query: string) => <AttributeNameSuggestion type="relation" name={suggestion} query={query} />, []);
    const cancel = useCallback(() => onAnswer(null), [ onAnswer ]);

    // `FormAutocomplete` stops the propagation of an Escape that closes its list, so only an
    // Escape with the list closed reaches the window.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") cancel();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ cancel ]);

    return (
        <Popover
            className="relation-name-popover"
            placement="bottom"
            getAnchorRect={() => connectionAnchorRect(connection)}
            onDismiss={cancel}
            onPlaced={() => inputRef.current?.focus()}
        >
            <div className="relation-name-header">
                <span className="relation-name-heading">
                    {isRename ? t("relation_map.rename_relation") : t("relation_map.new_relation")}
                </span>
                <ActionButton icon="bx bx-x" text={t("modal.close")} onClick={cancel} />
            </div>

            <div className="relation-name-body">
                <FormAutocomplete
                    inputRef={inputRef}
                    currentValue={name}
                    placeholder={t("relation_map.relation_name_placeholder")}
                    source={suggestRelationNames}
                    renderItem={renderRelationSuggestion}
                    openOnFocus
                    // An input method's text is filtered once it is committed, not while composing.
                    onChange={(newValue) => setName(isComposing.current ? newValue : utils.filterAttributeName(newValue))}
                    onCompositionStart={() => isComposing.current = true}
                    onCompositionEnd={(e) => {
                        isComposing.current = false;
                        setName(utils.filterAttributeName(e.currentTarget.value));
                    }}
                    // A relation name already in use is a whole answer, so picking one confirms it.
                    onPick={onAnswer}
                    onKeyDown={(e) => {
                        // `FormAutocomplete` prevents the default of an Enter that picks a suggestion.
                        if (e.key === "Enter" && !e.defaultPrevented) {
                            e.preventDefault();
                            if (name.trim()) onAnswer(name);
                        }
                    }}
                />

                <div className="relation-name-actions">
                    <Button
                        kind="primary"
                        text={isRename ? t("relation_map.rename") : t("relation_map.create_relation")}
                        disabled={!name.trim()}
                        onClick={() => onAnswer(name)}
                    />
                </div>
            </div>
        </Popover>
    );
}

/** Asks for a relation name next to `connection`; see {@link useRelationNamePrompt}. */
export type AskRelationName = (connection: Connection, defaultValue?: string) => Promise<string | null>;

/**
 * Holds the pending request for a relation name, for {@link RelationNamePopover} to answer. `ask`
 * keeps its identity across renders, so a jsPlumb handler bound once can call it; a new request
 * cancels the one still pending.
 */
export function useRelationNamePrompt() {
    const [ request, setRequest ] = useState<RelationNameRequest>();
    const requestRef = useRef(request);
    requestRef.current = request;
    const nextId = useRef(0);

    const ask: AskRelationName = useCallback((connection, defaultValue = "") => new Promise<string | null>((resolve) => {
        requestRef.current?.resolve(null);
        requestRef.current = { id: nextId.current++, connection, defaultValue, resolve };
        setRequest(requestRef.current);
    }), []);

    const answer = useCallback((name: string | null) => {
        requestRef.current?.resolve(name);
        requestRef.current = undefined;
        setRequest(undefined);
    }, []);

    return { request, ask, answer };
}

/** The middle of the connection's drawing, read afresh so the popover follows the map's pan and zoom. */
function connectionAnchorRect(connection: Connection) {
    const rect = connection.canvas?.getBoundingClientRect();
    if (!rect) {
        return new DOMRect();
    }

    return new DOMRect(rect.left + rect.width / 2, rect.top + rect.height / 2, 0, 0);
}
