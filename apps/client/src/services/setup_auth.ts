/**
 * The token that unlocks a setup wizard with a knowledge base behind it.
 *
 * A module of its own, and a very small one, because of who needs it: the request layer sends it on
 * every call, and the wizard's first screen is what obtains it. Either importing the other would
 * close a loop, since the wizard reaches the server through that same request layer.
 *
 * Held in memory only. A reload of the wizard asks for the password again, which is the right answer
 * for a screen that can erase a knowledge base and is often left open on a shared machine.
 *
 * See `setup_auth` in core for what the token is and why a session cannot take its place.
 *
 * @module
 */

let token: string | null = null;

/** What the request layer puts on every call; `null` everywhere but an unlocked wizard. */
export function getSetupAuthToken(): string | null {
    return token;
}

export function setSetupAuthToken(value: string): void {
    token = value;
}
