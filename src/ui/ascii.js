// Image -> ASCII. Text port of the IQ Art Generator backend
// (rust-asciiart-api /convert), which renders the same picture: 700px height,
// Nearest resize, weighted brightness, the same char ramp, step = font + density.
export const toAscii = (dataUrl, fontSize = 8, density = -2, outputHeight = 700) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onerror = () => reject(new Error("image load failed"));
    img.onload = () => {
      const w = Math.max(1, Math.floor(outputHeight * (img.width / img.height))); // as u32 truncates
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = outputHeight;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = false; // the backend resizes with Nearest
      ctx.drawImage(img, 0, 0, w, outputHeight);
      const px = ctx.getImageData(0, 0, w, outputHeight).data;
      const step = Math.max(1, fontSize + density);
      const lines = [];
      for (let y = 0; y < outputHeight; y += step) {
        let line = "";
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const b = Math.floor(px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11); // as u8 truncates
          line += (px[i + 3] === 0 || b <= 50) ? " " : b <= 101 ? "'" : b <= 139 ? ":" : b <= 169 ? "i" : b <= 199 ? "I" : b <= 209 ? "J" : "$";
        }
        lines.push(line.replace(/ +$/, "")); // trailing spaces draw nothing
      }
      resolve(lines.join("\n"));
    };
    img.src = dataUrl;
  });
