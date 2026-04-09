import electron from "electron";
import type { Application } from "express";
import type { ParamsDictionary, Request, Response } from "express-serve-static-core";
import type QueryString from "qs";
import { Session, SessionData } from "express-session";
import { parse as parseQuery } from "qs";
import EventEmitter from "events";

type MockedResponse = Response<any, Record<string, any>, number>;

function init(app: Application) {
    electron.ipcMain.on("server-request", (event, arg) => {
        const req = new FakeRequest(arg);
        const res = new FakeResponse(event, arg);

        return app.router(req as any, res as any, () => {});
    });
}

const fakeSession: Session & Partial<SessionData> = {
    id: "session-id", // Placeholder for session ID
    cookie: {
        originalMaxAge: 3600000, // 1 hour
    },
    loggedIn: true,
    regenerate(callback) {
        callback?.(null);
        return fakeSession;
    },
    destroy(callback) {
        callback?.(null);
        return fakeSession;
    },
    reload(callback) {
        callback?.(null);
        return fakeSession;
    },
    save(callback) {
        callback?.(null);
        return fakeSession;
    },
    resetMaxAge: () => fakeSession,
    touch: () => fakeSession
};

interface Arg {
    url: string;
    method: string;
    data: any;
    headers: Record<string, string>
}

class FakeRequest extends EventEmitter implements Pick<Request<ParamsDictionary, any, any, QueryString.ParsedQs, Record<string, any>>, "url" | "method" | "body" | "headers" | "session" | "query"> {
    url: string;
    method: string;
    body: any;
    headers: Record<string, string>;
    session: Session & Partial<SessionData>;
    query: Record<string, any>;

    constructor(arg: Arg) {
        super();
        this.url = arg.url;
        this.method = arg.method;
        this.body = arg.data;
        this.headers = arg.headers;
        this.session = fakeSession;
        this.query = parseQuery(arg.url.split("?")[1] || "", { ignoreQueryPrefix: true });
    }
}

class FakeResponse extends EventEmitter implements Pick<Response<any, Record<string, any>, number>, "status" | "send" | "json" | "setHeader"> {
    private respHeaders: Record<string, string | string[]> = {};
    private event: Electron.IpcMainEvent;
    private arg: Arg & { requestId: string; };
    statusCode: number = 200;
    headers: Record<string, string> = {};
    locals: Record<string, any> = {};

    constructor(event: Electron.IpcMainEvent, arg: Arg & { requestId: string; }) {
        super();
        this.event = event;
        this.arg = arg;
    }

    getHeader(name) {
        return this.respHeaders[name];
    }

    setHeader(name, value) {
        this.respHeaders[name] = value.toString();
        return this as unknown as MockedResponse;
    }

    header(name: string, value?: string | string[]) {
        this.respHeaders[name] = value ?? "";
        return this as unknown as MockedResponse;
    }

    status(statusCode) {
        this.statusCode = statusCode;
        return this as unknown as MockedResponse;
    }

    send(obj) {
        this.event.sender.send("server-response", {
            url: this.arg.url,
            method: this.arg.method,
            requestId: this.arg.requestId,
            statusCode: this.statusCode,
            headers: this.respHeaders,
            body: obj
        });
        return this as unknown as MockedResponse;
    }

    json(obj) {
        this.respHeaders["Content-Type"] = "application/json";
        this.send(JSON.stringify(obj));
        return this as unknown as MockedResponse;
    }
}

export default init;
