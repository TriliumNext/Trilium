"use strict";

import passwordService from "../../services/encryption/password.js";
import ValidationError from "../../errors/validation_error.js";
import type { Request } from "express";
import { ChangePasswordResponse } from "@triliumnext/commons";

function changePassword(req: Request): ChangePasswordResponse {
    if (passwordService.isPasswordSet()) {
        return passwordService.changePassword(req.body.current_password, req.body.new_password);
    } else {
        return passwordService.setPassword(req.body.new_password);
    }
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
