import type { Request } from "express";
import etapiTokenService from "../../services/etapi_tokens.js";
import { EtapiToken, PostTokensResponse } from "@triliumnext/commons";

function getTokens() {
    const tokens = etapiTokenService.getTokens();

    tokens.sort((a, b) => (a.utcDateCreated < b.utcDateCreated ? -1 : 1));

    return tokens satisfies EtapiToken[];
}

function createToken(req: Request) {
    return etapiTokenService.createToken(req.body.tokenName) satisfies PostTokensResponse;
}

function patchToken(req: Request) {
    etapiTokenService.renameToken(req.params.etapiTokenId, req.body.name);
}

function deleteToken(req: Request) {
    etapiTokenService.deleteToken(req.params.etapiTokenId);
}

export default {
    getTokens,
    createToken,
    patchToken,
    deleteToken
};
