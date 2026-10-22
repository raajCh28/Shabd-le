(() => {
  const { $, api, toast, guard, setupNav } = window.Shabdle;
  const keyRows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const rank = { absent: 1, present: 2, correct: 3 };
  const victoryDelay = 3000;
  const gamePanel = $("#normal-game");
  const settingsForm = $("#normal-settings");
  const settingsToggle = $("#normal-settings-toggle");
  const statsPanel = $("#normal-stats-panel");
  const statsToggle = $("#normal-stats-toggle");
  const board = $("#normal-board");
  const keyboard = $("#normal-keyboard");
  const status = $("#normal-status");
  const message = $("#normal-message");
  const answerReveal = $("#normal-answer-reveal");
  let game = null;

  function buildBoard(length, maxGuesses) {
    board.style.setProperty("--word-length", length);
    board.style.setProperty(
      "--board-width",
      `min(calc(${length} * (min(12vw, 64px) + 7px)), 92vw)`,
    );
    board.innerHTML = Array.from(
      { length: maxGuesses },
      () => `<div class="row">${Array.from({ length }, () => '<div class="tile"></div>').join("")}</div>`,
    ).join("");
  }

  function buildKeyboard() {
    keyboard.hidden = false;
    keyboard.innerHTML = keyRows.map((row, index) => `
      <div class="key-row">
        ${index === 2 ? '<button class="key wide" data-key="ENTER">Enter</button>' : ""}
        ${[...row].map((letter) => `<button class="key" data-key="${letter}">${letter}</button>`).join("")}
        ${index === 2 ? '<button class="key wide" data-key="BACKSPACE" aria-label="Backspace">⌫</button>' : ""}
      </div>`).join("");
  }

  function updateTiles() {
    const rows = [...board.querySelectorAll(".row")];
    rows.forEach((row, rowIndex) => {
      row.classList.toggle("is-active", !game.over && rowIndex === game.row);
      [...row.querySelectorAll(".tile")].forEach((tile, column) => {
        if (rowIndex === game.row) {
          tile.textContent = game.current[column] || "";
          tile.classList.toggle("filled", Boolean(game.current[column]));
        }
      });
    });
  }

  function restoreGuesses(guesses) {
    guesses.forEach((entry, rowIndex) => {
      const row = board.querySelectorAll(".row")[rowIndex];
      [...row.querySelectorAll(".tile")].forEach((tile, column) => {
        tile.textContent = entry.guess[column];
        tile.classList.add(entry.result[column]);
        const letter = entry.guess[column];
        if ((rank[entry.result[column]] || 0) > (rank[game.states[letter]] || 0)) {
          game.states[letter] = entry.result[column];
        }
      });
    });
    Object.entries(game.states).forEach(([letter, result]) => {
      keyboard.querySelector(`[data-key="${letter}"]`)?.classList.add(result);
    });
  }

  function updateKeyboard(guess, result) {
    [...guess].forEach((letter, index) => {
      if ((rank[result[index]] || 0) > (rank[game.states[letter]] || 0)) {
        game.states[letter] = result[index];
      }
      const key = keyboard.querySelector(`[data-key="${letter}"]`);
      if (key) {
        key.classList.remove("absent", "present", "correct");
        key.classList.add(game.states[letter]);
      }
    });
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

    try {
      setStats(await api("/api/normal/stats"));
    } catch (error) {
      if (error.message !== "Login required") toast(error.message);
    }
  }

  function revealAnswer(answer) {
    answerReveal.textContent = `The word was ${answer.toUpperCase()}`;
    answerReveal.hidden = false;
  }

  function showFinished(result) {
    game.over = true;
    keyboard.hidden = true;
    const won = result.status === "won";
    const summary = won
      ? `Solved in ${result.guesses_used} of ${game.max} guesses · ${game.length} letters${game.hardMode ? " · Hard Mode" : ""}`
      : `You used all ${game.max} guesses · ${game.length} letters${game.hardMode ? " · Hard Mode" : ""}`;
    void showStats(summary).then(() => $("#normal-play-again").focus());
  }

  function renderGame(state) {
    gamePanel.hidden = false;
    hideMenus();
    message.textContent = "";
    answerReveal.hidden = true;
    syncSettings(state);
    status.textContent = `${state.length} letters · ${state.max_guesses} ${state.max_guesses === 1 ? "try" : "tries"}${state.hard_mode ? " · Hard Mode" : ""}`;
    game = {
      code: state.game_code,
      length: state.length,
      max: state.max_guesses,
      hardMode: Boolean(state.hard_mode),
      row: state.guesses.length,
      current: "",
      past: state.guesses.map((entry) => entry.guess),
      states: {},
      over: state.status !== "playing",
      submitting: false,
    };
    buildBoard(game.length, game.max);
    buildKeyboard();
    restoreGuesses(state.guesses);

    if (state.status !== "playing") {
      if (state.status === "lost") revealAnswer(state.answer);
      void showFinished({ status: state.status, answer: state.answer, guesses_used: state.guesses.length });
      return;
    }
    updateTiles();
    message.textContent = game.row
      ? `Resume this round. ${game.row} ${game.row === 1 ? "guess" : "guesses"} used.`
      : "";
  }

  async function startRound(length, maxGuesses, hardMode) {
    const state = await api("/api/normal/start", {
      method: "POST",
      body: JSON.stringify({ length, max_guesses: maxGuesses, hard_mode: hardMode }),
    });
    sessionStorage.setItem("normalGameCode", state.game_code);
    renderGame(state);
  }

  function readSettings() {
    return {
      length: Number($("#word-length").value),
      maxGuesses: Number($("#try-count").value),
      hardMode: $("#hard-mode").checked,
    };
  }

  function showSettings(show) {
    settingsForm.hidden = !show;
    statsPanel.hidden = true;
    settingsToggle.setAttribute("aria-expanded", String(show));
    statsToggle.setAttribute("aria-expanded", "false");
    if (show) $("#word-length").focus();
  }

  function addLetter(letter) {
    if (!game || game.over || game.submitting || game.current.length >= game.length) return;
    if (!/^[A-Z]$/.test(letter)) return;
    game.current += letter;
    updateTiles();
  }

  function removeLetter() {
    if (!game || game.over || game.submitting || !game.current) return;
    game.current = game.current.slice(0, -1);
    updateTiles();
  }

  async function submitGuess() {
    if (!game || game.over || game.submitting) return;
    if (game.current.length !== game.length) {
      toast(`Enter ${game.length} letters first`);
      return;
    }

    const guess = game.current;
    const row = board.querySelectorAll(".row")[game.row];
    game.submitting = true;
    try {
      const result = await api(`/api/normal/${encodeURIComponent(game.code)}/guess`, {
        method: "POST",
        body: JSON.stringify({ guess, guesses: game.past }),
      });
      row.classList.remove("is-active");
      [...row.querySelectorAll(".tile")].forEach((tile, index) => {
        tile.style.animationDelay = `${index * 80}ms`;
        tile.classList.add(result.result[index]);
        tile.classList.remove("filled");
      });
      updateKeyboard(guess, result.result);
      game.past.push(guess);
      game.current = "";
      game.row += 1;
      game.submitting = false;

      if (result.status === "playing") {
        updateTiles();
      } else {
        sessionStorage.setItem("normalGameCode", game.code);
        game.over = true;
        keyboard.hidden = true;
        if (result.status === "won") {
          window.setTimeout(() => row.classList.add("victory"), 500);
        } else {
          revealAnswer(result.answer);
        }
        window.setTimeout(() => showFinished(result), victoryDelay);
      }
    } catch (error) {
      game.submitting = false;
      row.classList.remove("shake");
      void row.offsetWidth;
      row.classList.add("shake");
      if (error.message !== "Login required") toast(error.message);
    }
  }

  async function init() {
    setupNav();
    if (!guard()) return;

    const code = sessionStorage.getItem("normalGameCode");
    if (code) {
      try {
        renderGame(await api(`/api/normal/${encodeURIComponent(code)}`));
        return;
      } catch (error) {
        sessionStorage.removeItem("normalGameCode");
        if (error.message === "Login required") return;
      }
    }

    try {
      await startRound(5, 6, false);
    } catch (error) {
      if (error.message !== "Login required") toast(error.message);
    }
  }

  settingsToggle.addEventListener("click", () => showSettings(settingsForm.hidden));

  statsToggle.addEventListener("click", () => {
    if (!statsPanel.hidden) {
      hideMenus();
      return;
    }
    void showStats();
  });

  $("#try-count").addEventListener("input", (event) => {
    $("#try-count-value").value = event.target.value;
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { length, maxGuesses, hardMode } = readSettings();
    try {
      await startRound(length, maxGuesses, hardMode);
    } catch (error) {
      if (error.message !== "Login required") toast(error.message);
    }
  });

  $("#normal-play-again").addEventListener("click", async () => {
    hideMenus();
    const { length, maxGuesses, hardMode } = readSettings();
    try {
      await startRound(length, maxGuesses, hardMode);
    } catch (error) {
      if (error.message !== "Login required") toast(error.message);
    }
  });

  document.querySelectorAll("[data-close-menu]").forEach((button) => {
    button.addEventListener("click", hideMenus);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".normal-tools")) hideMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideMenus();
  });

  keyboard.addEventListener("click", (event) => {
    const key = event.target.closest("[data-key]")?.dataset.key;
    if (key === "ENTER") submitGuess();
    else if (key === "BACKSPACE") removeLetter();
    else if (key) addLetter(key);
  });

  document.addEventListener("keydown", (event) => {
    if (!game || gamePanel.hidden || !statsPanel.hidden || !settingsForm.hidden || event.target.matches("input, select, textarea")) return;
    if (event.key === "Enter") submitGuess();
    else if (event.key === "Backspace") removeLetter();
    else if (/^[a-z]$/i.test(event.key)) addLetter(event.key.toUpperCase());
  });

  void init();
})();
