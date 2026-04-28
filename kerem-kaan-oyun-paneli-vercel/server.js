const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "games.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const SHORTCUT_EXTENSIONS = new Set([
  ".app",
  ".command",
  ".desktop",
  ".exe",
  ".lnk",
  ".sh",
  ".url",
  ".webloc"
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]\n", "utf8");
  }
}

async function readGames() {
  await ensureDataFile();
  const content = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(content || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function writeGames(games) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(games, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, DATA_FILE);
}

function slugify(value) {
  const base = String(value || "oyun")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "oyun";
}

function uniqueId(title, games, currentId) {
  const base = slugify(title);
  const used = new Set(games.filter((game) => game.id !== currentId).map((game) => game.id));
  if (!used.has(base)) return base;

  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 120);
}

function cleanTarget(value) {
  return String(value || "").trim().slice(0, 2000);
}

function cleanAccent(value) {
  const accent = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#0071e3";
}

function cleanCover(value) {
  const cover = String(value || "").trim();
  if (!cover) return "/assets/default-game.png";
  if (cover.startsWith("/assets/")) return cover;
  return "/assets/default-game.png";
}

function normalizeGame(payload, games, existing = null) {
  const title = cleanText(payload.title, existing?.title || "Yeni Oyun");
  const launchTarget = cleanTarget(payload.launchTarget || payload.path || existing?.launchTarget);

  if (!title) {
    throw new Error("Oyun adı gerekli.");
  }

  if (!launchTarget) {
    throw new Error("Kısayol yolu veya açılış linki gerekli.");
  }

  const now = new Date().toISOString();

  return {
    id: existing?.id || uniqueId(title, games),
    title,
    genre: cleanText(payload.genre, existing?.genre || "Oyun"),
    platform: cleanText(payload.platform, existing?.platform || "Bilgisayar"),
    launchTarget,
    cover: cleanCover(payload.cover || existing?.cover),
    accent: cleanAccent(payload.accent || existing?.accent),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function expandHome(target) {
  if (target === "~") return os.homedir();
  if (target.startsWith("~/") || target.startsWith("~\\")) {
    return path.join(os.homedir(), target.slice(2));
  }
  return target;
}

function looksLikeUrlOrScheme(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function launchTarget(target) {
  const rawTarget = cleanTarget(target);
  if (!rawTarget) {
    throw new Error("Açılacak oyun yolu bulunamadı.");
  }

  const finalTarget = looksLikeUrlOrScheme(rawTarget) ? rawTarget : path.resolve(expandHome(rawTarget));

  if (!looksLikeUrlOrScheme(rawTarget) && !(await pathExists(finalTarget))) {
    throw new Error(`Bu kısayol bulunamadı: ${finalTarget}`);
  }

  let command;
  let args;

  if (process.platform === "darwin") {
    command = "open";
    args = [finalTarget];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", finalTarget];
  } else {
    command = "xdg-open";
    args = [finalTarget];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function readJsonBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("İstek çok büyük.");
    }
  }

  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function discoverInDirectory(directory, label, maxDepth = 0) {
  const results = [];

  async function walk(currentDirectory, depth) {
    let entries;
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(currentDirectory, entry.name);
      const extension = path.extname(entry.name).toLowerCase();

      if (entry.isDirectory() && extension === ".app") {
        results.push({
          title: path.basename(entry.name, extension),
          launchTarget: fullPath,
          platform: label
        });
        continue;
      }

      if (entry.isFile() && SHORTCUT_EXTENSIONS.has(extension)) {
        results.push({
          title: path.basename(entry.name, extension),
          launchTarget: fullPath,
          platform: label
        });
        continue;
      }

      if (entry.isDirectory() && depth < maxDepth) {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(directory, 0);
  return results;
}

async function discoverShortcuts() {
  const home = os.homedir();
  const directories = [
    { directory: path.join(home, "Desktop"), label: "Masaüstü", depth: 1 },
    { directory: path.join(home, "Applications"), label: "Uygulamalar", depth: 1 }
  ];

  if (process.platform === "darwin") {
    directories.push({ directory: "/Applications", label: "Uygulamalar", depth: 1 });
  }

  if (process.platform === "win32") {
    directories.push(
      { directory: path.join(home, "Desktop"), label: "Masaüstü", depth: 1 },
      {
        directory: path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
        label: "Başlat Menüsü",
        depth: 2
      }
    );
  }

  const seen = new Set();
  const shortcuts = [];

  for (const item of directories) {
    const found = await discoverInDirectory(item.directory, item.label, item.depth);
    for (const shortcut of found) {
      const key = shortcut.launchTarget.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      shortcuts.push({
        id: slugify(`${shortcut.title}-${shortcut.platform}-${shortcuts.length}`),
        ...shortcut
      });
    }
  }

  return shortcuts.slice(0, 120);
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/games") {
    const games = await readGames();
    return sendJson(res, 200, { games });
  }

  if (req.method === "GET" && pathname === "/api/discover") {
    const shortcuts = await discoverShortcuts();
    return sendJson(res, 200, { shortcuts, platform: process.platform });
  }

  if (req.method === "POST" && pathname === "/api/games") {
    const payload = await readJsonBody(req);
    const games = await readGames();
    const game = normalizeGame(payload, games);
    const updatedGames = [game, ...games];
    await writeGames(updatedGames);
    return sendJson(res, 201, { game });
  }

  const gameRoute = pathname.match(/^\/api\/games\/([^/]+)(?:\/(launch))?$/);
  if (!gameRoute) {
    return sendError(res, 404, "API adresi bulunamadı.");
  }

  const id = decodeURIComponent(gameRoute[1]);
  const action = gameRoute[2];
  const games = await readGames();
  const gameIndex = games.findIndex((game) => game.id === id);

  if (gameIndex === -1) {
    return sendError(res, 404, "Oyun bulunamadı.");
  }

  if (req.method === "POST" && action === "launch") {
    await launchTarget(games[gameIndex].launchTarget);
    return sendJson(res, 200, { ok: true, game: games[gameIndex] });
  }

  if (req.method === "PUT" && !action) {
    const payload = await readJsonBody(req);
    const game = normalizeGame(payload, games, games[gameIndex]);
    games[gameIndex] = game;
    await writeGames(games);
    return sendJson(res, 200, { game });
  }

  if (req.method === "DELETE" && !action) {
    const [removedGame] = games.splice(gameIndex, 1);
    await writeGames(games);
    return sendJson(res, 200, { game: removedGame });
  }

  return sendError(res, 405, "Bu işlem desteklenmiyor.");
}

async function serveStatic(req, res, pathname) {
  const safePathname = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(safePathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodedPath));

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return sendError(res, 403, "Erişim engellendi.");
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(content);
  } catch {
    sendError(res, 404, "Sayfa bulunamadı.");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, 405, "Bu işlem desteklenmiyor.");
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    const message = error instanceof SyntaxError ? "Geçersiz JSON gönderildi." : error.message;
    sendError(res, 500, message || "Beklenmeyen hata.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kerem Kaan oyun paneli: http://${HOST}:${PORT}`);
});
