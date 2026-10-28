/** Maximum permitted edge dimension for resized images in pixels. */
export const MAX_EDGE_PX = 1024;

/** Maximum allowable upload payload in bytes (1 Megabyte). */
export const MAX_UPLOAD_BYTES = 1048576;

/** JPEG compression quality factor for canvas export. */
export const JPEG_QUALITY = 0.7;

/** Structured result containing stripped base64 payload and preview data. */
export interface ProcessedImage {
  /** Clean base64-encoded JPEG image string without headers or EXIF metadata. */
  readonly base64: string;
  /** Explicit statutory MIME type. */
  readonly mimeType: 'image/jpeg';
  /** Encoded Data URL suitable for safe DOM thumbnail display. */
  readonly previewUrl: string;
}

/**
 * Normalizes, scales, and strips metadata (EXIF/GPS) from citizen photos via an off-screen HTML5 canvas.
 *
 * @param file Raw user-selected image file or blob.
 * @returns Cleaned, compressed JPEG payload and preview URL.
 */
export async function processImageFile(file: Blob): Promise<ProcessedImage> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error("We couldn't read that image. Try a JPEG or PNG photo."));
      img.src = objectUrl;
    });

    let targetWidth = image.naturalWidth || image.width;
    let targetHeight = image.naturalHeight || image.height;

    if (targetWidth === 0 || targetHeight === 0) {
      throw new Error("We couldn't read that image. Try a JPEG or PNG photo.");
    }

    // Scale longest edge to MAX_EDGE_PX while preserving aspect ratio
    if (targetWidth > MAX_EDGE_PX || targetHeight > MAX_EDGE_PX) {
      if (targetWidth >= targetHeight) {
        targetHeight = Math.round((targetHeight * MAX_EDGE_PX) / targetWidth);
        targetWidth = MAX_EDGE_PX;
      } else {
        targetWidth = Math.round((targetWidth * MAX_EDGE_PX) / targetHeight);
        targetHeight = MAX_EDGE_PX;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error("We couldn't read that image. Try a JPEG or PNG photo.");
    }

    // Canvas re-encoding strips all original EXIF, GPS, camera, and device metadata
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const commaIndex = dataUrl.indexOf(',');
    const base64 = commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl;

    // Estimate binary byte length from base64 encoding (4 base64 chars = 3 bytes)
    const approximateBytes = Math.ceil((base64.length * 3) / 4);

    if (approximateBytes > MAX_UPLOAD_BYTES) {
      throw new Error('That photo is too large. Please select an image under 1 MB.');
    }

    return {
      base64,
      mimeType: 'image/jpeg',
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
