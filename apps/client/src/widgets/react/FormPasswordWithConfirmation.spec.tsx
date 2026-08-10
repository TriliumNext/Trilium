import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

// i18next is not initialised under test, where `t` answers undefined; echoing the key back keeps the
// rendered strings truthy and lets the assertions name the keys the component is expected to use.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

import FormPasswordWithConfirmation from "./FormPasswordWithConfirmation";

describe("FormPasswordWithConfirmation", () => {
    it("reports the password only once both fields agree", () => {
        const { password, confirmation, onChange } = renderFields();

        type(password, "hunter2");
        expect(onChange).toHaveBeenLastCalledWith(null);

        type(confirmation, "hunter");
        expect(onChange).toHaveBeenLastCalledWith(null);

        type(confirmation, "hunter2");
        expect(onChange).toHaveBeenLastCalledWith("hunter2");
    });

    it("withdraws the password again when the fields stop agreeing", () => {
        const { password, confirmation, onChange } = renderFields();

        type(password, "hunter2");
        type(confirmation, "hunter2");
        expect(onChange).toHaveBeenLastCalledWith("hunter2");

        type(password, "hunter3");
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("never reports an empty password, even when both fields are empty", () => {
        const { password, confirmation, onChange } = renderFields();

        type(password, "a");
        type(password, "");
        type(confirmation, "");

        expect(onChange).not.toHaveBeenCalledWith("");
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("states the mismatch on the second field, and stops once it is resolved", () => {
        const { container, password, confirmation } = renderFields();

        type(password, "hunter2");
        type(confirmation, "hunter");
        expect(container.querySelector(".text-danger")?.textContent).toBe("password_with_confirmation.mismatch");

        type(confirmation, "hunter2");
        expect(container.querySelector(".text-danger")).toBeNull();
    });

    it("says nothing while the confirmation is still empty", () => {
        const { container, password } = renderFields();

        type(password, "hunter2");

        expect(container.querySelector(".text-danger")).toBeNull();
    });

    it("masks both fields", () => {
        const { password, confirmation } = renderFields();

        expect(password.type).toBe("password");
        expect(confirmation.type).toBe("password");
    });

});

function renderFields() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onChange = vi.fn();

    act(() => render(<FormPasswordWithConfirmation onChange={onChange} />, container));

    const inputs = [...container.querySelectorAll("input")];

    return { container, onChange, password: inputs[0], confirmation: inputs[1] };
}

/** Typing, then flushing, since the value only reaches the host through an effect. */
function type(input: HTMLInputElement, value: string) {
    act(() => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
