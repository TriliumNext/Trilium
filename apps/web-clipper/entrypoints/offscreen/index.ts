browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CROP_IMAGE') {
        cropImage(message.cropRect, message.dataUrl).then(sendResponse);
        return true; // Keep channel open for async response
    }
});

function cropImage(newArea: { x: number, y: number, width: number, height: number }, dataUrl: string) {
    return new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = newArea.width;
            canvas.height = newArea.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, newArea.x, newArea.y, newArea.width, newArea.height,
                    0, 0, newArea.width, newArea.height);
            }
            resolve(canvas.toDataURL());
        };
        img.src = dataUrl;
    });
}
