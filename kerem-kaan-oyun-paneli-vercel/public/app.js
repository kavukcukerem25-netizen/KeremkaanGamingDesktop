const state = {
  games: [],
  query: "",
  editingId: null,
  busy: false,
  onlineMode: !["127.0.0.1", "localhost", ""].includes(window.location.hostname)
};

const elements = {
  gameGrid: document.querySelector("#gameGrid"),
  emptyState: document.querySelector("#emptyState"),
  statusBar: document.querySelector("#statusBar"),
  searchInput: document.querySelector("#searchInput"),
  dialog: document.querySelector("#gameDialog"),
  form: document.querySelector("#gameForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  deleteGame: document.querySelector("#deleteGame"),
  discoverPanel: document.querySelector("#discoverPanel"),
  shortcutList: document.querySelector("#shortcutList"),
  fields: {
    id: document.querySelector("#gameId"),
    title: document.querySelector("#gameTitle"),
    target: document.querySelector("#gameTarget"),
    platform: document.querySelector("#gamePlatform"),
    genre: document.querySelector("#gameGenre"),
    cover: document.querySelector("#gameCover"),
    accent: document.querySelector("#gameAccent")
  }
};

const coverByPlatform = [
  { test: /valorant|riot/i, cover: "/assets/valorant.png", accent: "#ff3b4f" },
  { test: /assetto|race|yarış|racing/i, cover: "/assets/assetto-corsa.png", accent: "#00a36c" },
  { test: /minecraft/i, cover: "/assets/minecraft.png", accent: "#30a46c" },
  { test: /fortnite|epic/i, cover: "/assets/fortnite.png", accent: "#8e56ff" },
  { test: /counter|strike|cs2|cs go|steam/i, cover: "/assets/counter-strike-2.png", accent: "#4f7cff" }
];

function setStatus(message = "") {
  elements.statusBar.textContent = message;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "İşlem tamamlanamadı.");
  }

  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function filteredGames() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.games;

  return state.games.filter((game) => {
    return [game.title, game.genre, game.platform]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

function renderGames() {
  const games = filteredGames();
  elements.emptyState.hidden = games.length > 0;

  elements.gameGrid.innerHTML = games
    .map((game) => {
      const title = escapeHtml(game.title);
      const genre = escapeHtml(game.genre || "Oyun");
      const platform = escapeHtml(game.platform || "Bilgisayar");
      const cover = escapeHtml(game.cover || "/assets/default-game.png");
      const accent = escapeHtml(game.accent || "#0071e3");

      return `
        <article class="game-card" style="--accent: ${accent}">
          <div class="game-cover">
            <img src="${cover}" alt="${title}" loading="lazy" />
          </div>
          <div class="game-body">
            <div class="game-meta">
              <div>
                <h3>${title}</h3>
                <p>${genre} · ${platform}</p>
              </div>
              <span class="accent-dot" aria-hidden="true"></span>
            </div>
            <div class="game-actions">
              <button class="primary-button" type="button" data-action="launch" data-id="${game.id}">
                <span class="button-icon play-icon" aria-hidden="true"></span>
                <span>Aç</span>
              </button>
              <button class="icon-button" type="button" data-action="edit" data-id="${game.id}" title="Düzenle" aria-label="${title} düzenle">
                <span class="edit-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadGames() {
  setStatus("Oyunlar yükleniyor...");
  let payload;

  try {
    payload = await requestJson("/api/games");
    state.onlineMode = false;
  } catch {
    const fallbackResponse = await fetch("/games.json");
    payload = await fallbackResponse.json();
    payload = Array.isArray(payload) ? { games: payload } : payload;
    state.onlineMode = true;
  }

  state.games = payload.games || [];
  renderGames();
  setStatus(state.onlineMode ? `${state.games.length} oyun online vitrinde. Oyun açma yerel Mac sürümünde çalışır.` : `${state.games.length} oyun hazır.`);
}

function chooseVisual(title, platform = "") {
  const sample = `${title} ${platform}`;
  return coverByPlatform.find((item) => item.test.test(sample)) || {
    cover: "/assets/default-game.png",
    accent: "#0071e3"
  };
}

function resetForm(game = null) {
  state.editingId = game?.id || null;
  elements.dialogTitle.textContent = game ? "Oyunu Düzenle" : "Oyun Ekle";
  elements.deleteGame.hidden = !game;

  elements.fields.id.value = game?.id || "";
  elements.fields.title.value = game?.title || "";
  elements.fields.target.value = game?.launchTarget || "";
  elements.fields.platform.value = game?.platform || "";
  elements.fields.genre.value = game?.genre || "";
  elements.fields.cover.value = game?.cover || "/assets/default-game.png";
  elements.fields.accent.value = game?.accent || "#0071e3";
}

function openDialog(game = null) {
  resetForm(game);
  if (typeof elements.dialog.showModal === "function") {
    elements.dialog.showModal();
  } else {
    elements.dialog.setAttribute("open", "");
  }
  elements.fields.title.focus();
}

function closeDialog() {
  elements.dialog.close();
}

function formPayload() {
  return {
    title: elements.fields.title.value,
    launchTarget: elements.fields.target.value,
    platform: elements.fields.platform.value,
    genre: elements.fields.genre.value,
    cover: elements.fields.cover.value,
    accent: elements.fields.accent.value
  };
}

async function saveGame() {
  if (state.onlineMode) {
    setStatus("Online vitrinde oyun kaydetme kapalı. Kendi MacBook'unda yerel sürümde ekleme yapabilirsin.");
    return;
  }

  const payload = formPayload();
  const editingId = state.editingId;

  if (editingId) {
    await requestJson(`/api/games/${encodeURIComponent(editingId)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    setStatus(`${payload.title} güncellendi.`);
  } else {
    await requestJson("/api/games", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setStatus(`${payload.title} eklendi.`);
  }

  closeDialog();
  await loadGames();
}

async function deleteCurrentGame() {
  if (state.onlineMode) {
    setStatus("Online vitrinde silme kapalı. Kendi MacBook'unda yerel sürümde düzenleyebilirsin.");
    return;
  }

  if (!state.editingId) return;
  const game = state.games.find((item) => item.id === state.editingId);
  await requestJson(`/api/games/${encodeURIComponent(state.editingId)}`, {
    method: "DELETE"
  });
  closeDialog();
  await loadGames();
  setStatus(`${game?.title || "Oyun"} silindi.`);
}

async function launchGame(id) {
  const game = state.games.find((item) => item.id === id);
  if (!game) return;

  if (state.onlineMode) {
    setStatus(`${game.title} online vitrinde gösteriliyor. Oyunu açmak için siteyi Kerem Kaan'ın MacBook'unda çalıştır.`);
    return;
  }

  setStatus(`${game.title} açılıyor...`);
  await requestJson(`/api/games/${encodeURIComponent(id)}/launch`, {
    method: "POST",
    body: JSON.stringify({})
  });
  setStatus(`${game.title} için açılış komutu gönderildi.`);
}

async function scanShortcuts() {
  if (state.onlineMode) {
    elements.discoverPanel.hidden = false;
    elements.shortcutList.innerHTML = `<div class="empty-state"><h3>Yerel özellik</h3><p>Masaüstü tarama sadece Kerem Kaan'ın MacBook'unda çalışan sürümde kullanılabilir.</p></div>`;
    setStatus("Online vitrinde masaüstü tarama kapalı.");
    return;
  }

  elements.discoverPanel.hidden = false;
  elements.shortcutList.innerHTML = "";
  setStatus("Kısayollar taranıyor...");

  const payload = await requestJson("/api/discover");
  const shortcuts = payload.shortcuts || [];

  if (!shortcuts.length) {
    elements.shortcutList.innerHTML = `<div class="empty-state"><h3>Kısayol bulunamadı</h3><p>Masaüstünde oyun kısayolu görünmüyor.</p></div>`;
    setStatus("Kısayol bulunamadı.");
    return;
  }

  elements.shortcutList.innerHTML = shortcuts
    .map((shortcut) => {
      const title = escapeHtml(shortcut.title);
      const target = escapeHtml(shortcut.launchTarget);
      const platform = escapeHtml(shortcut.platform || "Bilgisayar");

      return `
        <div class="shortcut-row">
          <div>
            <strong>${title}</strong>
            <span>${platform} · ${target}</span>
          </div>
          <button class="secondary-button" type="button" data-action="add-shortcut" data-title="${title}" data-platform="${platform}" data-target="${target}">
            <span class="button-icon plus-icon" aria-hidden="true"></span>
            <span>Ekle</span>
          </button>
        </div>
      `;
    })
    .join("");

  setStatus(`${shortcuts.length} kısayol bulundu.`);
}

function openShortcutInDialog(button) {
  const title = button.dataset.title || "";
  const platform = button.dataset.platform || "";
  const target = button.dataset.target || "";
  const visual = chooseVisual(title, platform);

  openDialog({
    title,
    platform,
    launchTarget: target,
    genre: "Oyun",
    cover: visual.cover,
    accent: visual.accent
  });
}

function attachEvents() {
  document.querySelector("#openAddGame")?.addEventListener("click", () => openDialog());
  document.querySelector("#openAddGameTop")?.addEventListener("click", () => openDialog());
  document.querySelector("#openAddGameHero")?.addEventListener("click", () => openDialog());
  document.querySelector("#scanDesktop")?.addEventListener("click", scanShortcuts);
  document.querySelector("#scanDesktopHero")?.addEventListener("click", scanShortcuts);
  document.querySelector("#closeDiscover")?.addEventListener("click", () => {
    elements.discoverPanel.hidden = true;
  });
  document.querySelector("#closeDialog")?.addEventListener("click", closeDialog);
  document.querySelector("#cancelDialog")?.addEventListener("click", closeDialog);

  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderGames();
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveGame();
    } catch (error) {
      setStatus(error.message);
    }
  });

  elements.deleteGame.addEventListener("click", async () => {
    try {
      await deleteCurrentGame();
    } catch (error) {
      setStatus(error.message);
    }
  });

  elements.gameGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    try {
      if (action === "launch") {
        await launchGame(id);
      }

      if (action === "edit") {
        const game = state.games.find((item) => item.id === id);
        if (game) openDialog(game);
      }
    } catch (error) {
      setStatus(error.message);
    }
  });

  elements.shortcutList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='add-shortcut']");
    if (button) openShortcutInDialog(button);
  });

  elements.fields.title.addEventListener("blur", () => {
    if (state.editingId) return;
    const visual = chooseVisual(elements.fields.title.value, elements.fields.platform.value);
    elements.fields.cover.value = visual.cover;
    elements.fields.accent.value = visual.accent;
  });
}

attachEvents();

loadGames().catch((error) => {
  setStatus(error.message);
});
