import { EtapiToken, PostTokensResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { formatDateTime } from "../../../utils/formatters";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import { useTriliumEvent } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import OptionsRow from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

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
        <OptionsSection
            title={t("etapi.title")}
            description={t("etapi.description")}
            helpUrl="pgxEVkzLl1OP"
        >
            <TokenList tokens={tokens} />

            <OptionsRow name="create-etapi-token" centered>
                <Button
                    name="create-etapi-token-button"
                    size="micro" icon="bx bx-plus"
                    text={t("etapi.create_token")}
                    onClick={createTokenCallback}
                />
            </OptionsRow>
        </OptionsSection>
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

    if (!tokens.length) {
        return <NoItems icon="bx bx-key" text={t("etapi.no_tokens")} />;
    }

    return <>
        {tokens.map(({ etapiTokenId, name, utcDateCreated }) => (
            <OptionsRow
                key={etapiTokenId ?? name}
                name="etapi-token"
                label={name}
                description={formatDateTime(utcDateCreated)}
            >
                <div>
                    {etapiTokenId && (
                        <>
                            <ActionButton
                                icon="bx bx-edit-alt"
                                text={t("etapi.rename_token")}
                                onClick={() => renameCallback(etapiTokenId, name)}
                            />

                            <ActionButton
                                icon="bx bx-trash"
                                text={t("etapi.delete_token")}
                                onClick={() => deleteCallback(etapiTokenId, name)}
                            />
                        </>
                    )}
                </div>
            </OptionsRow>
        ))}
    </>;
}
