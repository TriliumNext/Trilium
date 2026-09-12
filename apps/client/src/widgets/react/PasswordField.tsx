import type { RefObject } from "preact";

import { t } from "../../services/i18n";
import FormTextBox from "./FormTextBox";
import OptionsRow from "../type_widgets/options/components/OptionsRow";

/**
 * The instance's own password, asked for the way the login screen asks for it.
 *
 * Shared so the two screens that ask cannot drift apart: the login screen, and the setup wizard
 * standing over a knowledge base it has to prove ownership of before it will touch it. To a user
 * they are the same question, so they are the same field.
 *
 * Uncontrolled on purpose, and read from the ref at submit time. A controlled value of `""`
 * overwrites what the browser autofilled, so the first press would submit an empty password — the
 * "incorrect password, press again" bug. Neither screen needs live validation.
 */
export default function PasswordField({ inputRef }: { inputRef: RefObject<HTMLInputElement> }) {
    return (
        <OptionsRow name="password" label={t("login.password")} stacked>
            <FormTextBox
                inputRef={inputRef} autoFocus
                type="password" name="password"
                autocomplete="current-password" required
            />
        </OptionsRow>
    );
}
