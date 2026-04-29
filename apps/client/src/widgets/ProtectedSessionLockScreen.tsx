import "./ProtectedSessionLockScreen.css";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import protected_session_holder from "../services/protected_session_holder.js";
import { useTriliumEvent } from "./react/hooks.jsx";
import ProtectedSession from "./type_widgets/ProtectedSession.jsx";

export default function ProtectedSessionLockScreen() {
    const [ isRootProtected, setIsRootProtected ] = useState(froca.getNoteFromCache("root")?.isProtected ?? false);
    const [ isProtectedSessionAvailable, setIsProtectedSessionAvailable ] = useState(protected_session_holder.isProtectedSessionAvailable());
    const requestIdRef = useRef(0);

    const refreshRootProtection = useCallback(() => {
        const cachedRootNote = froca.getNoteFromCache("root");

        if (cachedRootNote) {
            requestIdRef.current++;
            setIsRootProtected(cachedRootNote.isProtected ?? false);
            return;
        }

        const requestId = ++requestIdRef.current;
        froca.getNote("root")
            .then((rootNote) => {
                if (requestId !== requestIdRef.current) {
                    return;
                }

                setIsRootProtected(rootNote?.isProtected ?? false);
            })
            .catch((error: unknown) => {
                if (requestId !== requestIdRef.current) {
                    return;
                }

                const message = error instanceof Error ? error.message : String(error);
                window.logError(`Failed to load root note protection state: ${message}`);
                setIsRootProtected(false);
            });
    }, []);

    useEffect(() => {
        refreshRootProtection();
    }, [ refreshRootProtection ]);

    useTriliumEvent("frocaReloaded", () => {
        refreshRootProtection();
        setIsProtectedSessionAvailable(protected_session_holder.isProtectedSessionAvailable());
    });
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteReloaded("root")) {
            refreshRootProtection();
        }
    });
    useTriliumEvent("protectedSessionStarted", () => {
        setIsProtectedSessionAvailable(protected_session_holder.isProtectedSessionAvailable());
    });

    if (!isRootProtected || isProtectedSessionAvailable) {
        return null;
    }

    return (
        <div
            class="protected-session-lock-screen"
            role="dialog"
            aria-modal="true"
            aria-label={t("protected_session_password.modal_title")}
        >
            <div class="protected-session-lock-screen__panel">
                <ProtectedSession autoFocus />
            </div>
        </div>
    );
}
