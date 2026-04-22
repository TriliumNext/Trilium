import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../data_dir.js', () => ({
    default: {
        OCR_CACHE_DIR: '/tmp/trilium-ocr-test-cache'
    }
}));

vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('../../options.js', () => ({
    default: {
        getOption: vi.fn().mockReturnValue('0')
    }
}));

import { ImageProcessor } from './image_processor.js';

describe('ImageProcessor', () => {
    const processor = new ImageProcessor();
    const sampleImagePath = path.join(__dirname, 'samples', 'image.png');

    it('should extract text from the sample image', async () => {
        const imageBuffer = fs.readFileSync(sampleImagePath);

        const result = await processor.extractText(imageBuffer, { language: 'eng' });
        expect(result.text).toContain('TriliumNext');
    }, 60000);
});
