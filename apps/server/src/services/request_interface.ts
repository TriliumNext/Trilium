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
        totpToken?: string;
    };
    timeout: number;
    body?: string | {};
}
