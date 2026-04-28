const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "assets");

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ];
}

function mix(a, b, amount) {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  ];
}

function distanceToLine(x, y, x1, y1, x2, y2) {
  const a = x - x1;
  const b = y - y1;
  const c = x2 - x1;
  const d = y2 - y1;
  const dot = a * c + b * d;
  const lenSq = c * c + d * d;
  const param = lenSq ? Math.max(0, Math.min(1, dot / lenSq)) : -1;
  const xx = x1 + param * c;
  const yy = y1 + param * d;
  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function lineAlpha(x, y, line, width) {
  const distance = distanceToLine(x, y, line[0], line[1], line[2], line[3]);
  return Math.max(0, 1 - distance / width);
}

function diagonalBand(x, y, offset, width) {
  const value = (x + y * 0.45 - offset) / width;
  return value > 0 && value < 1 ? Math.sin(value * Math.PI) : 0;
}

function gridAlpha(x, y, size) {
  const gx = Math.min(x % size, size - (x % size));
  const gy = Math.min(y % size, size - (y % size));
  return Math.max(0, 1 - Math.min(gx, gy) / 1.4);
}

function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;

    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = pixel(x, y, width, height).map(clamp);
      const index = row + 1 + x * 4;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
      raw[index + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND")
  ]);
}

function renderCard(spec) {
  const dark = hexToRgb(spec.dark);
  const mid = hexToRgb(spec.mid);
  const bright = hexToRgb(spec.bright);
  const paper = hexToRgb(spec.paper || "#f5f5f7");

  return makePng(1200, 750, (x, y, width, height) => {
    const nx = x / width;
    const ny = y / height;
    let color = mix(paper, mid, 0.08 + ny * 0.16);

    const vignette = Math.pow(Math.abs(nx - 0.5), 2) + Math.pow(Math.abs(ny - 0.5), 2);
    color = mix(color, dark, vignette * 0.9);

    for (const band of spec.bands) {
      const alpha = diagonalBand(x, y, band.offset, band.width) * band.alpha;
      color = mix(color, hexToRgb(band.color), alpha);
    }

    for (const line of spec.lines) {
      const alpha = lineAlpha(x, y, line.points, line.width) * line.alpha;
      color = mix(color, hexToRgb(line.color), alpha);
    }

    if (spec.grid) {
      const alpha = gridAlpha(x + spec.grid.shift, y, spec.grid.size) * spec.grid.alpha * (0.2 + ny);
      color = mix(color, bright, alpha);
    }

    for (const rect of spec.rects || []) {
      if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) {
        const edge = Math.min(x - rect.x, rect.x + rect.w - x, y - rect.y, rect.y + rect.h - y);
        const alpha = Math.min(1, edge / rect.soft) * rect.alpha;
        color = mix(color, hexToRgb(rect.color), alpha);
      }
    }

    return [color[0], color[1], color[2], 255];
  });
}

const cardSpecs = [
  {
    file: "counter-strike-2.png",
    dark: "#182338",
    mid: "#4f7cff",
    bright: "#ffffff",
    paper: "#f7f8fb",
    grid: { size: 58, shift: 18, alpha: 0.08 },
    bands: [
      { offset: 130, width: 190, color: "#4f7cff", alpha: 0.54 },
      { offset: 560, width: 120, color: "#111827", alpha: 0.28 },
      { offset: 930, width: 260, color: "#00a3ff", alpha: 0.18 }
    ],
    lines: [
      { points: [120, 560, 980, 120], width: 5, color: "#ffffff", alpha: 0.45 },
      { points: [510, 90, 740, 610], width: 4, color: "#a8c7ff", alpha: 0.38 },
      { points: [60, 330, 1120, 330], width: 3, color: "#ffffff", alpha: 0.22 }
    ],
    rects: [
      { x: 470, y: 215, w: 250, h: 154, soft: 22, color: "#ffffff", alpha: 0.34 }
    ]
  },
  {
    file: "valorant.png",
    dark: "#241216",
    mid: "#ff3b4f",
    bright: "#fff3f3",
    paper: "#fbf7f7",
    grid: { size: 64, shift: 3, alpha: 0.05 },
    bands: [
      { offset: 40, width: 210, color: "#ff3b4f", alpha: 0.62 },
      { offset: 430, width: 160, color: "#111111", alpha: 0.3 },
      { offset: 780, width: 140, color: "#ff7a2f", alpha: 0.32 }
    ],
    lines: [
      { points: [140, 130, 1020, 610], width: 8, color: "#ffffff", alpha: 0.32 },
      { points: [880, 60, 360, 690], width: 5, color: "#ffffff", alpha: 0.34 },
      { points: [280, 90, 500, 615], width: 4, color: "#ffb0b8", alpha: 0.38 }
    ],
    rects: [
      { x: 360, y: 240, w: 430, h: 90, soft: 18, color: "#ffffff", alpha: 0.23 }
    ]
  },
  {
    file: "assetto-corsa.png",
    dark: "#10251e",
    mid: "#00a36c",
    bright: "#d7fff0",
    paper: "#f6faf8",
    grid: { size: 52, shift: 20, alpha: 0.05 },
    bands: [
      { offset: 160, width: 220, color: "#00a36c", alpha: 0.52 },
      { offset: 610, width: 90, color: "#1d1d1f", alpha: 0.34 },
      { offset: 920, width: 200, color: "#5fd4ff", alpha: 0.2 }
    ],
    lines: [
      { points: [90, 560, 1020, 560], width: 5, color: "#ffffff", alpha: 0.42 },
      { points: [160, 620, 670, 160], width: 7, color: "#ffffff", alpha: 0.32 },
      { points: [540, 610, 1110, 150], width: 10, color: "#99ffe1", alpha: 0.25 }
    ],
    rects: [
      { x: 268, y: 395, w: 650, h: 42, soft: 12, color: "#ffffff", alpha: 0.32 }
    ]
  },
  {
    file: "minecraft.png",
    dark: "#1b2f24",
    mid: "#30a46c",
    bright: "#f4ffee",
    paper: "#f7faf4",
    grid: { size: 50, shift: 0, alpha: 0.12 },
    bands: [
      { offset: 110, width: 180, color: "#30a46c", alpha: 0.5 },
      { offset: 510, width: 150, color: "#8bc34a", alpha: 0.25 },
      { offset: 860, width: 220, color: "#3c5f42", alpha: 0.28 }
    ],
    lines: [
      { points: [120, 210, 1080, 210], width: 4, color: "#ffffff", alpha: 0.24 },
      { points: [180, 500, 980, 500], width: 4, color: "#ffffff", alpha: 0.3 },
      { points: [630, 90, 630, 640], width: 4, color: "#ffffff", alpha: 0.25 }
    ],
    rects: [
      { x: 330, y: 230, w: 180, h: 180, soft: 1, color: "#ffffff", alpha: 0.18 },
      { x: 530, y: 270, w: 180, h: 180, soft: 1, color: "#0f2419", alpha: 0.26 },
      { x: 730, y: 210, w: 180, h: 180, soft: 1, color: "#ffffff", alpha: 0.17 }
    ]
  },
  {
    file: "fortnite.png",
    dark: "#221947",
    mid: "#8e56ff",
    bright: "#f7f2ff",
    paper: "#faf8ff",
    grid: { size: 62, shift: 11, alpha: 0.05 },
    bands: [
      { offset: 90, width: 230, color: "#8e56ff", alpha: 0.54 },
      { offset: 520, width: 165, color: "#2fc2ff", alpha: 0.24 },
      { offset: 830, width: 170, color: "#ffb020", alpha: 0.2 }
    ],
    lines: [
      { points: [160, 120, 1020, 340], width: 8, color: "#ffffff", alpha: 0.3 },
      { points: [880, 140, 300, 620], width: 6, color: "#ffffff", alpha: 0.32 },
      { points: [240, 380, 1120, 600], width: 5, color: "#d8c8ff", alpha: 0.34 }
    ],
    rects: [
      { x: 420, y: 210, w: 360, h: 260, soft: 20, color: "#ffffff", alpha: 0.16 }
    ]
  },
  {
    file: "default-game.png",
    dark: "#1d1d1f",
    mid: "#0071e3",
    bright: "#ffffff",
    paper: "#f5f5f7",
    grid: { size: 56, shift: 6, alpha: 0.06 },
    bands: [
      { offset: 120, width: 220, color: "#0071e3", alpha: 0.48 },
      { offset: 590, width: 140, color: "#1d1d1f", alpha: 0.28 },
      { offset: 910, width: 180, color: "#30a46c", alpha: 0.18 }
    ],
    lines: [
      { points: [150, 160, 1050, 590], width: 6, color: "#ffffff", alpha: 0.32 },
      { points: [220, 610, 820, 120], width: 7, color: "#9ac7ff", alpha: 0.3 },
      { points: [90, 380, 1110, 380], width: 3, color: "#ffffff", alpha: 0.24 }
    ],
    rects: [
      { x: 430, y: 245, w: 340, h: 170, soft: 18, color: "#ffffff", alpha: 0.22 }
    ]
  }
];

function renderHero() {
  const width = 1400;
  const height = 900;
  const blue = hexToRgb("#0071e3");
  const red = hexToRgb("#ff3b4f");
  const green = hexToRgb("#30a46c");
  const dark = hexToRgb("#1d1d1f");
  const paper = hexToRgb("#f5f5f7");

  return makePng(width, height, (x, y) => {
    const nx = x / width;
    const ny = y / height;
    let color = mix([255, 255, 255], paper, ny * 0.85);

    const platform = y > 640 && y < 700 ? 1 - Math.abs(y - 670) / 30 : 0;
    color = mix(color, [218, 220, 226], platform * 0.46);

    const screen = x > 410 && x < 990 && y > 160 && y < 520;
    if (screen) {
      const edge = Math.min(x - 410, 990 - x, y - 160, 520 - y);
      const screenAlpha = Math.min(1, edge / 20);
      color = mix(color, dark, 0.86 * screenAlpha);
      color = mix(color, blue, diagonalBand(x, y, 340, 330) * 0.18 * screenAlpha);
      color = mix(color, red, diagonalBand(x, y, 720, 260) * 0.2 * screenAlpha);
      color = mix(color, green, diagonalBand(x, y, 1040, 240) * 0.16 * screenAlpha);
    }

    const base = x > 610 && x < 790 && y > 520 && y < 650;
    if (base) {
      const edge = Math.min(x - 610, 790 - x, y - 520, 650 - y);
      color = mix(color, [78, 80, 86], Math.min(1, edge / 18) * 0.75);
    }

    const stand = x > 475 && x < 925 && y > 645 && y < 690;
    if (stand) {
      const edge = Math.min(x - 475, 925 - x, y - 645, 690 - y);
      color = mix(color, [96, 98, 105], Math.min(1, edge / 16) * 0.7);
    }

    const leftController = Math.pow((x - 315) / 210, 2) + Math.pow((y - 640) / 95, 2) < 1;
    const rightController = Math.pow((x - 1085) / 210, 2) + Math.pow((y - 640) / 95, 2) < 1;

    if (leftController || rightController) {
      const accent = leftController ? blue : red;
      color = mix(color, [248, 248, 250], 0.94);
      color = mix(color, accent, 0.12 + 0.1 * ny);
    }

    const buttonA = Math.pow((x - 1135) / 20, 2) + Math.pow((y - 625) / 20, 2) < 1;
    const buttonB = Math.pow((x - 1085) / 20, 2) + Math.pow((y - 665) / 20, 2) < 1;
    const stickL = Math.pow((x - 260) / 34, 2) + Math.pow((y - 650) / 34, 2) < 1;
    const stickR = Math.pow((x - 1025) / 34, 2) + Math.pow((y - 650) / 34, 2) < 1;
    const dpadH = x > 340 && x < 438 && y > 632 && y < 658;
    const dpadV = x > 376 && x < 402 && y > 596 && y < 694;

    if (buttonA || buttonB || stickL || stickR || dpadH || dpadV) {
      color = mix(color, dark, 0.76);
    }

    const shine = lineAlpha(x, y, [430, 190, 930, 500], 6) * 0.25;
    color = mix(color, [255, 255, 255], shine);

    const shade = Math.pow(Math.abs(nx - 0.5), 2) + Math.pow(Math.abs(ny - 0.55), 2);
    color = mix(color, [235, 236, 240], shade * 0.45);

    return [color[0], color[1], color[2], 255];
  });
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const spec of cardSpecs) {
  fs.writeFileSync(path.join(OUT_DIR, spec.file), renderCard(spec));
}

fs.writeFileSync(path.join(OUT_DIR, "hero-console.png"), renderHero());

console.log(`Generated ${cardSpecs.length + 1} assets in ${OUT_DIR}`);
