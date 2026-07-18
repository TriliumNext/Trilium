export interface CookieJar {
    header?: string;
}

export interface ExecOpts {
    proxy: string | null;
    method: string;
    url: string;
    paging?: {
        pageCount: number;
        pageIndex: number;
        requestId: string;
    };
    cookieJar?: CookieJar;
    auth?: {
        password?: string;
    };
    timeout: number;
    body?: string | {};
}

export interface RequestProvider {
    exec<T>(opts: ExecOpts): Promise<T>;
    getImage(imageUrl: string): Promise<ArrayBuffer>;
}

let requestProvider: RequestProvider | null = null;

export function initRequest(provider: RequestProvider): void {
    requestProvider = provider;
}

export function getRequestProvider(): RequestProvider {
    if (!requestProvider) {
        throw new Error("Request provider not initialized. Call initRequest() first.");
    }
    return requestProvider;
}

export function isRequestInitialized(): boolean {
    return requestProvider !== null;
}

export default {
    exec<T>(opts: ExecOpts): Promise<T> {
        return getRequestProvider().exec(opts);
    },
    getImage(imageUrl: string): Promise<ArrayBuffer> {
        return getRequestProvider().getImage(imageUrl);
    }
};
