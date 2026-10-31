(() => {
  const { $, api, toast, store, showWordBanner, hideWordBanner, guard, setupNav, createGame } = window.Shabdle;
  const END_DELAY = 1800;
  const gamePanel = $("#normal-game");
  const settingsForm = $("#normal-settings");
  const settingsToggle = $("#normal-settings-toggle");
  const statsPanel = $("#normal-stats-panel");
  const statsToggle = $("#normal-stats-toggle");
  const board = $("#normal-board");
  const keyboard = $("#normal-keyboard");
  const status = $("#normal-status");
  const message = $("#normal-message");
  const CODE_KEY = "normalGameCode";

  let session = null; // { code, length, max, hardMode, core }

  const report = (error) => { if (error.message !== "Login required") toast(error.message); };

  function layoutFor(length, maxGuesses) {
    const shell = document.querySelector(".normal-shell");
    const toolbar = document.querySelector(".normal-toolbar");
    const topbar = document.querySelector(".topbar");
    const shellStyle = getComputedStyle(shell);
    const toolbarStyle = getComputedStyle(toolbar);
    const messageStyle = getComputedStyle(message);
    const verticalMargins = (style) => parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    const fixedHeight = topbar.getBoundingClientRect().height
      + parseFloat(shellStyle.paddingTop) + parseFloat(shellStyle.paddingBottom)
      + toolbar.getBoundingClientRect().height + verticalMargins(toolbarStyle)
      + message.getBoundingClientRect().height + verticalMargins(messageStyle) + 8;
    const availableHeight = Math.max(0, window.innerHeight - fixedHeight);
    const keyboardRows = keyboard.querySelectorAll(".key-row").length;
    const keyboardGap = 5;
    const keyboardMargin = 10;
    const keyHeight = Math.min(52, Math.max(30, availableHeight * 0.28 / keyboardRows));
    const boardHeight = availableHeight - keyboardMargin
      - keyboardRows * keyHeight - (keyboardRows - 1) * keyboardGap;
    const availableWidth = Math.min(board.parentElement.clientWidth, window.innerWidth - 24, 760);
    const tileGap = 5;
    const preferred = Math.min(window.innerWidth * 0.12, 64);
    const widthLimitedTile = (availableWidth - (length - 1) * tileGap) / length;
    const heightLimitedTile = (boardHeight - (maxGuesses - 1) * tileGap) / maxGuesses;
    const tile = Math.max(1, Math.min(preferred, widthLimitedTile, heightLimitedTile));

    board.style.setProperty("--tile-size", `${tile}px`);
    board.style.setProperty("--tile-font-size", `${Math.max(7, Math.min(29, tile * 0.68))}px`);
    board.style.setProperty("--tile-border-width", `${tile < 24 ? 1 : 2}px`);
    board.style.setProperty("--board-width", `${length * tile + (length - 1) * tileGap}px`);
    keyboard.style.setProperty("--normal-key-height", `${keyHeight}px`);
  }

  function syncSettings(state) {
    $("#word-length").value = String(state.length);
    $("#try-count").value = String(state.max_guesses);
    $("#try-count-value").value = String(state.max_guesses);
    $("#hard-mode").checked = Boolean(state.hard_mode);
  }

  function setStats(stats) {
    $("#normal-solved").textContent = `${stats.wins} / ${stats.games_played}`;
    $("#normal-win-rate").textContent = `${stats.win_rate}%`;
    $("#normal-current-streak").textContent = stats.current_streak;
    $("#normal-best-streak").textContent = stats.best_streak;
    $("#normal-average-guesses").textContent = stats.average_guesses ?? "—";
  }

  function hideMenus() {
    settingsForm.hidden = true;
    statsPanel.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
    statsToggle.setAttribute("aria-expanded", "false");
  }

  async function showStats(summary = "") {
    settingsForm.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
    $("#normal-round-summary").hidden = !summary;
    $("#normal-round-summary").textContent = summary;
    statsPanel.hidden = false;
    statsToggle.setAttribute("aria-expanded", "true");
    try { setStats(await api("/api/normal/stats")); } catch (error) { report(error); }
  }

  function showFinished(result) {
    const { length, max, hardMode } = session;
    const tags = `${length} letters${hardMode ? " · Hard Mode" : ""}`;
    if (result.status === "lost") {
      showWordBanner(result.answer);
      return showStats(`You used all ${max} guesses · ${tags}`);
    }
    return showStats(`Solved in ${result.guesses_used} of ${max} guesses · ${tags}`)
      .then(() => $("#normal-play-again").focus());
  }

  function renderGame(state) {
    session?.core.destroy();
    if (state.status === "playing") hideWordBanner();
    gamePanel.hidden = false;
    hideMenus();
    message.textContent = "";
    syncSettings(state);
    status.textContent = `${state.length} letters · ${state.max_guesses} ${state.max_guesses === 1 ? "try" : "tries"}${state.hard_mode ? " · Hard Mode" : ""}`;

    const code = state.game_code;
    session = { code, length: state.length, max: state.max_guesses, hardMode: Boolean(state.hard_mode) };
    session.core = createGame({
      board, keyboard,
      length: state.length,
      maxGuesses: state.max_guesses,
      restored: state.guesses,
      layout: () => layoutFor(state.length, state.max_guesses),
      onMessage: toast,
      isBlocked: () => !statsPanel.hidden || !settingsForm.hidden,
      onSubmit: (guess, past) => api(`/api/normal/${encodeURIComponent(code)}/guess`, {
        method: "POST",
        body: JSON.stringify({ guess, guesses: past }),
      }),
      onResult: (result) => {
        if (result.status === "playing") return;
        setTimeout(() => showFinished(result), END_DELAY);
      },
    });

    if (state.status !== "playing") {
      session.core.finish();
      showFinished({ status: state.status, answer: state.answer, guesses_used: state.guesses.length });
    } else if (state.guesses.length) {
      const n = state.guesses.length;
      message.textContent = `Resume this round. ${n} ${n === 1 ? "guess" : "guesses"} used.`;
    }
  }

  async function startRound(length, maxGuesses, hardMode) {
    hideWordBanner();
    const state = await api("/api/normal/start", {
      method: "POST",
      body: JSON.stringify({ length, max_guesses: maxGuesses, hard_mode: hardMode }),
    });
    store.set(CODE_KEY, state.game_code);
    renderGame(state);
  }

  const readSettings = () => ({
    length: Number($("#word-length").value),
    maxGuesses: Number($("#try-count").value),
    hardMode: $("#hard-mode").checked,
  });

  const newRound = async () => {
    const { length, maxGuesses, hardMode } = readSettings();
    try { await startRound(length, maxGuesses, hardMode); } catch (error) { report(error); }
  };

  async function init() {
    setupNav();
    if (!guard()) return;

    const code = store.get(CODE_KEY);
    if (code) {
      try {
        renderGame(await api(`/api/normal/${encodeURIComponent(code)}`));
        return;
      } catch (error) {
        store.remove(CODE_KEY);
        if (error.message === "Login required") return;
      }
    }
    try { await startRound(5, 6, false); } catch (error) { report(error); }
  }

  function showSettings(show) {
    settingsForm.hidden = !show;
    statsPanel.hidden = true;
    settingsToggle.setAttribute("aria-expanded", String(show));
    statsToggle.setAttribute("aria-expanded", "false");
    if (show) $("#word-length").focus();
  }

  settingsToggle.addEventListener("click", () => showSettings(settingsForm.hidden));
  statsToggle.addEventListener("click", () => (statsPanel.hidden ? showStats() : hideMenus()));
  $("#try-count").addEventListener("input", (event) => { $("#try-count-value").value = event.target.value; });
  settingsForm.addEventListener("submit", (event) => { event.preventDefault(); newRound(); });
  $("#normal-play-again").addEventListener("click", () => { hideMenus(); newRound(); });
  document.querySelectorAll("[data-close-menu]").forEach((b) => b.addEventListener("click", hideMenus));
  document.addEventListener("click", (event) => { if (!event.target.closest(".normal-tools")) hideMenus(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideMenus(); });

  init();
})();
