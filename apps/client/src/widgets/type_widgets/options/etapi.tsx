import { useCallback, useEffect, useState } from "preact/hooks";
import { t } from "../../../services/i18n";
import Button from "../../react/Button";
import FormText from "../../react/FormText";
import RawHtml from "../../react/RawHtml";
import OptionsSection from "./components/OptionsSection";
import { EtapiToken, PostTokensResponse } from "@triliumnext/commons";
import server from "../../../services/server";
import toast from "../../../services/toast";
import dialog from "../../../services/dialog";
import { formatDateTime } from "../../../utils/formatters";
import ActionButton from "../../react/ActionButton";
import { useTriliumEvent } from "../../react/hooks";
import HelpButton from "../../react/HelpButton";

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
        <OptionsSection title={t("etapi.title")}>
            <FormText>
                {t("etapi.description")}
                <HelpButton helpPage="pgxEVkzLl1OP" />
            </FormText>

            <Button
                size="small" icon="bx bx-plus"
                text={t("etapi.create_token")}
                onClick={createTokenCallback}
            />

            <hr />

            <h5>{t("etapi.existing_tokens")}</h5>
            <TokenList tokens={tokens} />
        </OptionsSection>
    )
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

    return (
        tokens.length ? (
            <div style={{ overflow: "auto"}}>
                <table className="table table-stripped">
                    <thead>
                        <tr>
                            <th>{t("etapi.token_name")}</th>
                            <th>{t("etapi.created")}</th>
                            <th>{t("etapi.actions")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tokens.map(({ etapiTokenId, name, utcDateCreated}) => (
                            <tr>
                                <td>{name}</td>
                                <td>{formatDateTime(utcDateCreated)}</td>
                                <td>
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
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        ) : (
            <div>{t("etapi.no_tokens_yet")}</div>
        )
    );
}
