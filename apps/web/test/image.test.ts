// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JPEG_QUALITY, MAX_EDGE_PX, MAX_UPLOAD_BYTES, processImageFile } from '../src/lib/image.js';

describe('Image pipeline (lib/image.ts)', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalImage: typeof Image;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalImage = globalThis.Image;

    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-blob');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('resizes image so longest edge <= 1024px, exports JPEG at 0.7 quality, strips EXIF, and revokes object URL', async () => {
    let capturedWidth = 0;
    let capturedHeight = 0;
    let exportedFormat = '';
    let exportedQuality = 0;
    let drawImageCalled = false;

    // Mock HTMLCanvasElement prototype
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

    HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      return {
        drawImage: vi.fn().mockImplementation(() => {
          drawImageCalled = true;
          capturedWidth = this.width;
          capturedHeight = this.height;
        }),
      } as unknown as CanvasRenderingContext2D;
    });

    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockImplementation(function (
      format: string,
      quality: number
    ) {
      exportedFormat = format;
      exportedQuality = quality;
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...cleanJPEGBytes';
    });

    // Mock Image with dimensions 2400 x 1200
    class MockOversizedImage {
      width = 2400;
      height = 1200;
      naturalWidth = 2400;
      naturalHeight = 1200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }

    globalThis.Image = MockOversizedImage as unknown as typeof Image;

    const fakeBlob = new Blob(['test-binary-data'], { type: 'image/png' });
    const result = await processImageFile(fakeBlob);

    // 1. Output is strictly JPEG
    expect(result.mimeType).toBe('image/jpeg');
    expect(exportedFormat).toBe('image/jpeg');
    expect(exportedQuality).toBe(JPEG_QUALITY);

    // 2. Longest edge scaled to <= 1024px while keeping 2:1 aspect ratio
    expect(capturedWidth).toBe(MAX_EDGE_PX);
    expect(capturedHeight).toBe(512);
    expect(capturedWidth).toBeLessThanOrEqual(MAX_EDGE_PX);
    expect(capturedHeight).toBeLessThanOrEqual(MAX_EDGE_PX);

    // 3. EXIF is stripped via clean canvas drawImage re-encode
    expect(drawImageCalled).toBe(true);

    // 4. Object URL is revoked
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob');

    // Restore canvas prototype
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
  });

  it('rejects with a friendly error message when image decoding fails', async () => {
    class MockCorruptImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }

    globalThis.Image = MockCorruptImage as unknown as typeof Image;

    const fakeBlob = new Blob(['corrupt-bytes'], { type: 'image/unknown' });

    await expect(processImageFile(fakeBlob)).rejects.toThrow(
      "We couldn't read that image. Try a JPEG or PNG photo."
    );

    // Revocation happens even on failure
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob');
  });

  it('rejects when re-encoded image exceeds MAX_UPLOAD_BYTES', async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    });

    // Create a base64 string exceeding MAX_UPLOAD_BYTES (1,048,576 bytes)
    const hugeBase64 = 'A'.repeat(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 100);
    HTMLCanvasElement.prototype.toDataURL = vi
      .fn()
      .mockReturnValue(`data:image/jpeg;base64,${hugeBase64}`);

    class MockImage {
      width = 500;
      height = 500;
      onload: (() => void) | null = null;
      set src(_url: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;

    const fakeBlob = new Blob(['large-image'], { type: 'image/jpeg' });

    await expect(processImageFile(fakeBlob)).rejects.toThrow(
      'That photo is too large. Please select an image under 1 MB.'
    );

    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
  });
});
