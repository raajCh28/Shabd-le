(() => {
  const { $, api, toast, guard, setupNav } = window.Shabdle;
  const keyRows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const rank = { absent: 1, present: 2, correct: 3 };
  const gamePanel = $("#normal-game");
  const settingsForm = $("#normal-settings");
  const board = $("#normal-board");
  const keyboard = $("#normal-keyboard");
  const status = $("#normal-status");
  const message = $("#normal-message");
  const againButton = $("#normal-again");
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

  function showFinished(result) {
    game.over = true;
    keyboard.hidden = true;
    againButton.hidden = false;
    message.classList.add("result-message");
    const won = result.status === "won";
    message.textContent = won
      ? `Solved in ${result.guesses_used} ${result.guesses_used === 1 ? "guess" : "guesses"}.`
      : "No tries left. Start another round whenever you’re ready.";
    window.showAnswerPopup({
      answer: result.answer,
      title: won ? "Puzzle solved!" : "Good try!",
    });
    sessionStorage.removeItem("normalGameCode");
  }

  function renderGame(state) {
    settingsForm.hidden = true;
    gamePanel.hidden = false;
    againButton.hidden = state.status === "playing";
    message.classList.remove("result-message");
    message.textContent = "";
    status.textContent = `${state.length} letters · ${state.max_guesses} ${state.max_guesses === 1 ? "try" : "tries"}`;
    game = {
      code: state.game_code,
      length: state.length,
      max: state.max_guesses,
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
      showFinished({ status: state.status, answer: state.answer, guesses_used: state.guesses.length });
      return;
    }
    updateTiles();
    message.textContent = game.row
      ? `Resume this round. ${game.row} ${game.row === 1 ? "guess" : "guesses"} used.`
      : "";
  }

  async function startRound(length, maxGuesses) {
    const state = await api("/api/normal/start", {
      method: "POST",
      body: JSON.stringify({ length, max_guesses: maxGuesses }),
    });
    sessionStorage.setItem("normalGameCode", state.game_code);
    renderGame(state);
  }

  async function addLetter(letter) {
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
        showFinished(result);
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
    if (!code) return;
    try {
      const state = await api(`/api/normal/${encodeURIComponent(code)}`);
      renderGame(state);
    } catch (error) {
      sessionStorage.removeItem("normalGameCode");
      if (error.message !== "Login required") toast(error.message);
    }
  }

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const length = Number($("#word-length").value);
    const maxGuesses = Number($("#try-count").value);
    try {
      await startRound(length, maxGuesses);
    } catch (error) {
      if (error.message !== "Login required") toast(error.message);
    }
  });

  againButton.addEventListener("click", () => {
    sessionStorage.removeItem("normalGameCode");
    game = null;
    gamePanel.hidden = true;
    settingsForm.hidden = false;
    againButton.hidden = true;
  });

  keyboard.addEventListener("click", (event) => {
    const key = event.target.closest("[data-key]")?.dataset.key;
    if (key === "ENTER") submitGuess();
    else if (key === "BACKSPACE") removeLetter();
    else if (key) addLetter(key);
  });

  document.addEventListener("keydown", (event) => {
    if (!game || gamePanel.hidden || event.target.matches("input, select, textarea")) return;
    if (event.key === "Enter") submitGuess();
    else if (event.key === "Backspace") removeLetter();
    else if (/^[a-z]$/i.test(event.key)) addLetter(event.key.toUpperCase());
  });

  init();
})();
