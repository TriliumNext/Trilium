import { ChangePasswordResponse } from "@triliumnext/commons";
import { password as passwordService, ValidationError } from "@triliumnext/core";
import type { Request } from "express";

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
