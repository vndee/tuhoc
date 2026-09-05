type MatrixName = 'pixels' | 'kernel';

/** Multiplies a kernel over a valid image window and sums its numeric dot product. */
export function convolveAt(pixels: number[][], kernel: number[][], row: number, column: number): number {
  validateMatrix(pixels, 'pixels');
  validateMatrix(kernel, 'kernel');
  validateOrigin(pixels, kernel, row, column);
  let total = 0;
  for (let kernelRow = 0; kernelRow < kernel.length; kernelRow += 1) {
    for (let kernelColumn = 0; kernelColumn < kernel[0].length; kernelColumn += 1) {
      total += pixels[row + kernelRow][column + kernelColumn] * kernel[kernelRow][kernelColumn];
    }
  }
  return total;
}

/** Creates the valid convolution feature map without mutating either source matrix. */
export function convolveImage(pixels: number[][], kernel: number[][]): number[][] {
  validateMatrix(pixels, 'pixels');
  validateMatrix(kernel, 'kernel');
  const imageRows = pixels.length;
  const imageColumns = pixels[0].length;
  const kernelRows = kernel.length;
  const kernelColumns = kernel[0].length;
  if (kernelRows > imageRows || kernelColumns > imageColumns) {
    throw new Error(`Kernel dimensions ${kernelRows}×${kernelColumns} exceed pixel dimensions ${imageRows}×${imageColumns}.`);
  }

  return Array.from({ length: imageRows - kernelRows + 1 }, (_, row) =>
    Array.from({ length: imageColumns - kernelColumns + 1 }, (_, column) => convolveAt(pixels, kernel, row, column)),
  );
}

function validateMatrix(matrix: number[][], name: MatrixName) {
  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0
    || matrix.some((row) => !Array.isArray(row) || row.length !== matrix[0].length)) {
    throw new Error(`${name} must be a non-empty rectangular matrix.`);
  }
  if (matrix.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new Error(`${name} must contain only finite numbers.`);
  }
}

function validateOrigin(pixels: number[][], kernel: number[][], row: number, column: number) {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0
    || row + kernel.length > pixels.length || column + kernel[0].length > pixels[0].length) {
    throw new Error(`Kernel at row ${row}, column ${column} exceeds pixel bounds.`);
  }
}
