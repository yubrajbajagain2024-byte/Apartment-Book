import qrcode from "qrcode-generator";

/** The squares of a QR code for `text`, row by row (true = dark). Medium error correction, smallest size that fits. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** One SVG path drawing the dark squares, for a `viewBox="0 0 n n"` where n is the matrix size. Runs of squares in a row are merged. */
export function qrSvgPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run += 1;
      parts.push(`M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return parts.join("");
}
