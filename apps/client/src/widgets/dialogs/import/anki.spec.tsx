import { type ComponentChildren, render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    useProviderImport: vi.fn(),
    doImport: vi.fn(async () => {}),
    onChange: vi.fn(),
    onRemove: vi.fn()
}));

vi.mock("./useProviderImport.js", () => ({
    default: mocks.useProviderImport
}));
vi.mock("../../react/hooks.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks.js")>()),
    useTriliumOptionBool: () => [true, vi.fn()]
}));

const { default: provider } = await import("./anki.js");

let container: HTMLDivElement;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.useProviderImport.mockReturnValue({
        hasSelection: true,
        displayNames: ["deck.apkg"],
        onChange: mocks.onChange,
        onBrowse: undefined,
        onNativeDrop: undefined,
        onRemove: mocks.onRemove,
        doImport: mocks.doImport
    });
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
});

function Host() {
    const [footer, setFooter] = useState<ComponentChildren>(null);
    const Panel = provider.Panel;
    return (
        <>
            <Panel
                parentNoteId="parent"
                closeDialog={vi.fn()}
                setFooter={setFooter}
            />
            <div className="footer-host">{footer}</div>
        </>
    );
}

async function mount() {
    await act(async () => {
        render(<Host />, container);
    });
    await act(async () => {});
}

describe("Anki import provider", () => {
    it("accepts APKG files and routes them through the tagged importer", async () => {
        await mount();

        expect(provider.id).toBe("anki");
        expect(provider.icon).toBe("bx bx-brain");
        expect(container.querySelector<HTMLInputElement>("input[type=file]")?.accept)
            .toBe(".apkg");
        expect(mocks.useProviderImport).toHaveBeenCalledWith(expect.objectContaining({
            format: "anki",
            parentNoteId: "parent",
            shrinkImages: true
        }));

        const importButton = container.querySelector<HTMLButtonElement>(
            ".footer-host button"
        );
        expect(importButton?.disabled).toBe(false);
        await act(async () => {
            importButton?.click();
        });
        expect(mocks.doImport).toHaveBeenCalledOnce();
    });

    it("passes the image-compression choice to the importer", async () => {
        await mount();

        const toggle = container.querySelector<HTMLInputElement>("input[type=checkbox]");
        expect(toggle?.checked).toBe(true);
        await act(async () => {
            toggle?.click();
        });
        expect(mocks.useProviderImport).toHaveBeenLastCalledWith(expect.objectContaining({
            shrinkImages: false
        }));
    });
});
