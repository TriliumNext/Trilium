import "./etapi.css";

import { EtapiToken, PostTokensResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { formatDateTime } from "../../../utils/formatters";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import { Card, OptionCardSection } from "../../react/Card";
import { useTriliumEvent } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";

type RenameTokenCallback = (tokenId: string, oldName: string) => Promise<void>;
type DeleteTokenCallback = (tokenId: string, name: string ) => Promise<void>;

export default function EtapiSettings() {
    const [ tokens, setTokens ] = useState<EtapiToken[]>([]);

    function refreshTokens() {
        server.get<EtapiToken[]>("etapi-tokens").then(setTokens);
    }

    useEffect(refreshTokens, []);
    useTriliumEvent("entitiesReloaded", ({loadResults}) => {
        if (loadResults.hasEtapiTokenChanges) {
            refreshTokens();
        }
    });

    const createTokenCallback = useCallback(async () => {
        const tokenName = await dialog.prompt({
            title: t("etapi.new_token_title"),
            message: t("etapi.new_token_message"),
            defaultValue: t("etapi.default_token_name")
        });

        if (!tokenName?.trim()) {
            toast.showError(t("etapi.error_empty_name"));
            return;
        }

        const { authToken } = await server.post<PostTokensResponse>("etapi-tokens", { tokenName });

        await dialog.prompt({
            title: t("etapi.token_created_title"),
            message: t("etapi.token_created_message"),
            defaultValue: authToken
        });
    }, []);

    return (
        <>
            {/* Both the sentence and the way to add a token belong to the page rather than to the
                list: with no tokens yet there is no card for either of them to sit in. They share the
                row below the title, where the button is clear of the dialog's own close button. */}
            <OptionsPageHeader
                helpUrl="pgxEVkzLl1OP"
                below={
                    <div className="etapi-header-row">
                        <p className="etapi-description">{t("etapi.description")}</p>

                        <Button
                            name="create-etapi-token-button"
                            size="micro" icon="bx-plus"
                            text={t("etapi.create_token")}
                            onClick={createTokenCallback}
                        />
                    </div>
                }
            />

            <TokenList tokens={tokens} />

            {/* The page's one command lives in its header, out of the search's reach. Offered
                here as the settings on other pages are: named, and operated where it is found. */}
            <Card filterOnly heading={t("settings.related_actions")}>
                <OptionCardSection
                    label={t("etapi.create_token")}
                    description={t("etapi.description")}
                >
                    <Button text={t("etapi.create_token")} onClick={createTokenCallback} />
                </OptionCardSection>
            </Card>
        </>
    );
}

function TokenList({ tokens }: { tokens: EtapiToken[] }) {
    const renameCallback = useCallback<RenameTokenCallback>(async (tokenId: string, oldName: string) => {
        const tokenName = await dialog.prompt({
            title: t("etapi.rename_token_title"),
            message: t("etapi.rename_token_message"),
            defaultValue: oldName
        });

        if (!tokenName?.trim()) {
            return;
        }

        await server.patch(`etapi-tokens/${tokenId}`, { name: tokenName });
    }, []);

    const deleteCallback = useCallback<DeleteTokenCallback>(async (tokenId: string, name: string) => {
        if (!(await dialog.confirm(t("etapi.delete_token_confirmation", { name })))) {
            return;
        }

        await server.remove(`etapi-tokens/${tokenId}`);
    }, []);

    // Nothing to frame while there is nothing to list: the placeholder stands on the page itself, an
    // empty card being a statement of its own.
    if (!tokens.length) {
        return (
            <NoItems icon="bx bx-key" text={t("etapi.no_tokens")} />
        );
    }

    return (
        // A card of tokens the user named themselves, with no name of its own to be found by: the
        // page's own sentence about what ETAPI is stands in for one.
        <Card filterExtraKeywords={`${t("etapi.description")} ${t("etapi.token_name")}`}>
            {tokens.map(({ etapiTokenId, name, utcDateCreated }) => (
                <OptionCardSection
                    key={etapiTokenId ?? name}
                    label={name}
                    description={formatDateTime(utcDateCreated)}
                >
                    {etapiTokenId && (
                        <span className="tn-card-option-actions">
                            <ActionButton
                                icon="bx bx-edit-alt"
                                text={t("etapi.rename_token")}
                                onClick={() => renameCallback(etapiTokenId, name)}
                            />

                            <ActionButton
                                className="destructive-action-icon"
                                icon="bx bx-trash"
                                text={t("etapi.delete_token")}
                                onClick={() => deleteCallback(etapiTokenId, name)}
                            />
                        </span>
                    )}
                </OptionCardSection>
            ))}
        </Card>
    );
}
