import { describe, expect, it } from "vitest";
import { note } from "../../test/becca_mocking.js";
import { renderSvgAttachment } from "./image.js";

describe("Image API", () => {
    it("renders empty SVG properly", () => {
        const parentNote = note("note").note;
        const response = new MockResponse();
        renderSvgAttachment(parentNote, response as any, "attachment");
        expect(response.headers["Content-Type"]).toBe("image/svg+xml");
        expect(response.body).toBe(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
    });

    it("sets Content-Security-Policy header on SVG responses", () => {
        const parentNote = note("note").note;
        const response = new MockResponse();
        renderSvgAttachment(parentNote, response as any, "attachment");
        expect(response.headers["Content-Security-Policy"]).toBeDefined();
        expect(response.headers["Content-Security-Policy"]).toContain("default-src 'none'");
    });

    it("sets X-Content-Type-Options header on SVG responses", () => {
        const parentNote = note("note").note;
        const response = new MockResponse();
        renderSvgAttachment(parentNote, response as any, "attachment");
        expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
    });
});

class MockResponse {

    body?: string;
    headers: Record<string, string>;

    constructor() {
        this.headers = {};
    }

    set(name: string, value: string) {
        this.headers[name] = value;
    }

    send(body: string) {
        this.body = body;
    }

}
