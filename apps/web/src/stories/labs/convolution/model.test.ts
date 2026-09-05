import { describe, expect, it } from 'vitest';
import { convolveAt, convolveImage } from './model';

describe('convolution model', () => {
  const pixels = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];
  const kernel = [
    [1, 0],
    [0, -1],
  ];

  it('calculates a numeric dot product at an authored kernel origin', () => {
    expect(convolveAt([[1, 2], [3, 4]], kernel, 0, 0)).toBe(-3);
  });

  it('calculates the valid feature map without changing either input matrix', () => {
    const originalPixels = pixels.map((row) => [...row]);
    const originalKernel = kernel.map((row) => [...row]);
    expect(convolveImage(pixels, kernel)).toEqual([[-4, -4], [-4, -4]]);
    expect(pixels).toEqual(originalPixels);
    expect(kernel).toEqual(originalKernel);
  });

  it('rejects ragged and non-finite matrices with descriptive errors', () => {
    expect(() => convolveImage([[1], [2, 3]], [[1]])).toThrow('pixels must be a non-empty rectangular matrix.');
    expect(() => convolveImage([[1]], [[Infinity]])).toThrow('kernel must contain only finite numbers.');
  });

  it('rejects a kernel origin or image kernel that cannot fit', () => {
    expect(() => convolveAt([[1, 2], [3, 4]], kernel, 1, 0)).toThrow('Kernel at row 1, column 0 exceeds pixel bounds.');
    expect(() => convolveImage([[1, 2]], kernel)).toThrow('Kernel dimensions 2×2 exceed pixel dimensions 1×2.');
  });
});
