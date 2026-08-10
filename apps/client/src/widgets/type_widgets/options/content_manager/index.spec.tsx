import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

// The sections themselves pull in the whole listing/treemap machinery, and this is about which one
// the shell picks — stubs are enough to tell them apart.
vi.mock("./active_content", () => ({
    default: () => <div className="active-content-stub" />
}));

vi.mock("./space_usage", () => ({
    default: () => <div className="space-usage-stub" />
}));

// Import AFTER the mocks (vi.mock is hoisted, but the component import must resolve the mocked deps).
import type { TypeWidgetProps } from "../../type_widget";
import ContentManagerSettings, { requestContentManagerSection } from "./index";

let container: HTMLDivElement | undefined;

/** Opens the page as navigating to it would, and answers which section it landed on. */
function openPage() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<ContentManagerSettings {...({} as TypeWidgetProps)} />, container);

    return container.querySelector(".space-usage-stub") ? "spaceUsage" : "activeContent";
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

describe("Content Manager section choice", () => {
    it("opens on Active Content, and on the requested section once asked", () => {
        expect(openPage()).toBe("activeContent");

        requestContentManagerSection("spaceUsage");
        expect(openPage()).toBe("spaceUsage");
    });

    it("forgets the request once taken, so opening the page again starts over", () => {
        requestContentManagerSection("spaceUsage");
        expect(openPage()).toBe("spaceUsage");

        expect(openPage()).toBe("activeContent");
    });
});
