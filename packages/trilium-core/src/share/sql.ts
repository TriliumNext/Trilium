import { getShareProvider } from "./share_provider.js";

function getRawRows<T>(query: string, params: string[] = []): T[] {
    return getShareProvider().sql.getRawRows<T>(query, params);
}

function getRow<T>(query: string, params: string[] = []): T {
    return getShareProvider().sql.getRow<T>(query, params);
}

function getColumn<T>(query: string, params: string[] = []): T[] {
    return getShareProvider().sql.getColumn<T>(query, params);
}

export default {
    getRawRows,
    getRow,
    getColumn
};
