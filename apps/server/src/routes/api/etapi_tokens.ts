import { EtapiToken, PostTokensResponse } from "@triliumnext/commons";
import type { Request } from "express";

import etapiTokenService from "../../services/etapi_tokens.js";

function getTokens() {
    const tokens = etapiTokenService.getTokens();

    tokens.sort((a, b) => (a.utcDateCreated < b.utcDateCreated ? -1 : 1));

    return tokens satisfies EtapiToken[];
}

function createToken(req: Request) {
    return etapiTokenService.createToken(req.body.tokenName) satisfies PostTokensResponse;
}

function patchToken(req: Request<{ etapiTokenId: string }>) {
    etapiTokenService.renameToken(req.params.etapiTokenId, req.body.name);
}

function deleteToken(req: Request<{ etapiTokenId: string }>) {
    etapiTokenService.deleteToken(req.params.etapiTokenId);
}

export default {
    getTokens,
    createToken,
    patchToken,
    deleteToken
};
