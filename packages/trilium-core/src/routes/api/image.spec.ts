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
