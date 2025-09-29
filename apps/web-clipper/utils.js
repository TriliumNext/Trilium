export function randomString(len) {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < len; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

export function getBaseUrl() {
    let output = getPageLocationOrigin() + location.pathname;

    if (output[output.length - 1] !== '/') {
        output = output.split('/');
        output.pop();
        output = output.join('/');
    }

    return output;
}

export function getPageLocationOrigin() {
    // location.origin normally returns the protocol + domain + port (eg. https://example.com:8080)
    // but for file:// protocol this is browser dependant and in particular Firefox returns "null" in this case.
    return location.protocol === 'file:' ? 'file://' : location.origin;
}
