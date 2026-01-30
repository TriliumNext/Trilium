export type Rect = { x: number, y: number, width: number, height: number };

export function randomString(len: number) {
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
        const outputArr = output.split('/');
        outputArr.pop();
        output = outputArr.join('/');
    }

    return output;
}

export function getPageLocationOrigin() {
    // location.origin normally returns the protocol + domain + port (eg. https://example.com:8080)
    // but for file:// protocol this is browser dependant and in particular Firefox returns "null" in this case.
    return location.protocol === 'file:' ? 'file://' : location.origin;
}

export function createLink(clickAction: object, text: string, color = "lightskyblue") {
    const link = document.createElement('a');
    link.href = "javascript:";
    link.style.color = color;
    link.appendChild(document.createTextNode(text));
    link.addEventListener("click", () => {
        browser.runtime.sendMessage(null, clickAction);
    });

    return link;
}
