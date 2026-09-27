export async function albumColor(url: string): Promise<string> {
  if (!url) return "#A7A8B8";
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const timeout = setTimeout(() => resolve("#A7A8B8"), 4000);
    image.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 40;
        const context = canvas.getContext("2d");
        if (!context) return resolve("#A7A8B8");
        context.drawImage(image, 0, 0, 40, 40);
        const { data } = context.getImageData(0, 0, 40, 40);
        const bins = new Map<
          string,
          { count: number; r: number; g: number; b: number; score: number }
        >();
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
          const max = Math.max(r, g, b),
            min = Math.min(r, g, b);
          if (max < 25 || min > 238 || data[i + 3] < 200) continue;
          const key = `${r >> 5},${g >> 5},${b >> 5}`;
          const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0, score: 0 };
          bin.count++;
          bin.r += r;
          bin.g += g;
          bin.b += b;
          bin.score += 1 + (max - min) / 128;
          bins.set(key, bin);
        }
        const best = [...bins.values()].sort((a, b) => b.score - a.score)[0];
        resolve(
          best
            ? `#${[best.r, best.g, best.b]
                .map((c) =>
                  Math.round(c / best.count)
                    .toString(16)
                    .padStart(2, "0"),
                )
                .join("")}`
            : "#A7A8B8",
        );
      } catch {
        resolve("#A7A8B8");
      }
    };
    image.onerror = () => {
      clearTimeout(timeout);
      resolve("#A7A8B8");
    };
    image.src = url;
  });
}
