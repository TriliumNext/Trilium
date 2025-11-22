/**
 * Offscreen document for canvas-based image operations
 * Service workers don't have access to DOM/Canvas APIs, so we use an offscreen document
 */

interface CropImageMessage {
  type: 'CROP_IMAGE';
  dataUrl: string;
  cropRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface CropImageResponse {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

/**
 * Crops an image using canvas
 * @param dataUrl - The source image as a data URL
 * @param cropRect - The rectangle to crop (x, y, width, height)
 * @returns Promise resolving to the cropped image data URL
 */
function cropImage(
  dataUrl: string,
  cropRect: { x: number; y: number; width: number; height: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();

      img.onload = function () {
        try {
          const canvas = document.getElementById('canvas') as HTMLCanvasElement;
          if (!canvas) {
            reject(new Error('Canvas element not found'));
            return;
          }

          // Set canvas dimensions to crop area
          canvas.width = cropRect.width;
          canvas.height = cropRect.height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // Draw the cropped portion of the image
          // Source: (cropRect.x, cropRect.y, cropRect.width, cropRect.height)
          // Destination: (0, 0, cropRect.width, cropRect.height)
          ctx.drawImage(
            img,
            cropRect.x,
            cropRect.y,
            cropRect.width,
            cropRect.height,
            0,
            0,
            cropRect.width,
            cropRect.height
          );

          // Convert canvas to data URL
          const croppedDataUrl = canvas.toDataURL('image/png');
          resolve(croppedDataUrl);
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = function () {
        reject(new Error('Failed to load image'));
      };

      img.src = dataUrl;
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Handle messages from the background service worker
 */
chrome.runtime.onMessage.addListener(
  (
    message: CropImageMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: CropImageResponse) => void
  ) => {
    if (message.type === 'CROP_IMAGE') {
      cropImage(message.dataUrl, message.cropRect)
        .then((croppedDataUrl) => {
          sendResponse({ success: true, dataUrl: croppedDataUrl });
        })
        .catch((error) => {
          console.error('Failed to crop image:', error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        });

      // Return true to indicate we'll send response asynchronously
      return true;
    }
  }
);

console.log('Offscreen document loaded and ready');
