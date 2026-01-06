import { ChangePasswordResponse } from "@triliumnext/commons";
import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import passwordService from "../../services/encryption/password.js";

function changePassword(req: Request): ChangePasswordResponse {
    if (passwordService.isPasswordSet()) {
        return passwordService.changePassword(req.body.current_password, req.body.new_password);
    }
    return passwordService.setPassword(req.body.new_password);

}

function resetPassword(req: Request) {
    // protection against accidental call (not a security measure)
    if (req.query.really !== "yesIReallyWantToResetPasswordAndLoseAccessToMyProtectedNotes") {
        throw new ValidationError("Incorrect password reset confirmation");
    }

    return passwordService.resetPassword();
}

export default {
    changePassword,
    resetPassword
};
