import type { ChangePasswordResponse } from "@triliumnext/commons";
import type { Request } from "express";
import passwordService from "../../services/encryption/password.js";
import { ValidationError } from "../../errors.js";

async function changePassword(req: Request): Promise<ChangePasswordResponse> {
    if (passwordService.isPasswordSet()) {
        return await passwordService.changePassword(req.body.current_password, req.body.new_password);
    }
    return await passwordService.setPassword(req.body.new_password);
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
