import type { Request } from "../../http_interface";
import events from "../../services/events.js";
import passwordEncryptionService from "../../services/encryption/password_encryption.js";
import protectedSession from "../../services/protected_session.js";
import ws from "../../services/ws.js";

async function loginToProtectedSession(req: Request) {
    const password = req.body.password;

    if (!(await passwordEncryptionService.verifyPassword(password))) {
        return {
            success: false,
            message: "Given current password doesn't match hash"
        };
    }

    const decryptedDataKey = await passwordEncryptionService.getDataKey(password);
    if (!decryptedDataKey) {
        // A reset would empty the data key on every device, so the message says the password
        // is right.
        return {
            success: false,
            message: "The password is right, but the key of protected notes cannot be read.",
            code: "data-key-unreadable"
        };
    }

    protectedSession.setDataKey(decryptedDataKey);

    events.emit(events.ENTER_PROTECTED_SESSION);

    ws.sendMessageToAllClients({ type: "protectedSessionLogin" });

    return {
        success: true
    };
}

function logoutFromProtectedSession() {
    protectedSession.resetDataKey();

    events.emit(events.LEAVE_PROTECTED_SESSION);

    ws.sendMessageToAllClients({ type: "protectedSessionLogout" });
}

function touchProtectedSession() {
    protectedSession.touchProtectedSession();
}

export default {
    loginToProtectedSession,
    logoutFromProtectedSession,
    touchProtectedSession
};
