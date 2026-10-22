(() => {
  const token = localStorage.getItem("token");
  const $ = (selector) => document.querySelector(selector);
  const statusPanel = $("#ladder-status");
  const board = $("#board");
  const keyboard = $("#keyboard");
  const message = $("#game-message");
  const nav = $("#nav");
  const keyRows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const rank = { absent: 1, present: 2, correct: 3 };

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.detail || `Request failed (${response.status})`);
      error.authenticationRequired = response.status === 401 || response.status === 403;
      throw error;
    }
    return result;
  }

  function showError(error) {
    if (keyboard) keyboard.hidden = true;
    if (board) board.innerHTML = "";
    if (!statusPanel) return;

    statusPanel.classList.add("error");
    statusPanel.textContent = error.message;
    if (error.authenticationRequired) {
      const login = document.createElement("a");
      login.href = "/login.html?next=%2Fladder.html";
      login.textContent = "Log in again";
      statusPanel.append(" ", login);
    }
  }

  function renderStatus(state, climbed = state.run_best_length || 0) {
    const rung = Math.max(0, Math.min(20, climbed));
    statusPanel.classList.remove("error");
    statusPanel.innerHTML = `
      <div><small>Current step</small><strong>${state.length} letters</strong></div>
      <div><small>You climbed</small><strong>${climbed ? `Through ${climbed} letters` : "Not yet"}</strong></div>
      <div><small>Personal best</small><strong>${state.best_length ? `${state.best_length} letters` : "Not yet"}</strong></div>
      <div class="ladder-rungs" aria-label="Climb progress">${Array.from({ length: 16 }, (_, i) => {
        const length = i + 5;
        return `<span class="${length <= rung ? "reached" : ""}">${length}</span>`;
      }).join("")}</div>`;
    const subtitle = $("#game-subtitle");
    if (subtitle) {
      subtitle.textContent = `Step ${state.length} of 20 · six guesses to solve it.`;
    }
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

  function buildBoard(length, maxGuesses) {
    board.style.setProperty("--word-length", length);
    board.style.setProperty("--board-width", `min(calc(${length} * (min(12vw, 64px) + 7px)), 92vw)`);
    board.innerHTML = Array.from({ length: maxGuesses }, () =>
      `<div class="row">${Array.from({ length }, () => '<div class="tile"></div>').join("")}</div>`,
    ).join("");
  }

  async function start() {
    if (!token) {
      showError(new Error("Log in to play Ladder."));
      return;
    }

    try {
      const state = await request("/api/ladder/state");
      let game = {
        length: state.length,
        max: state.max_guesses,
        row: (state.guesses || []).length,
        current: "",
        past: (state.guesses || []).map((entry) => entry.guess),
        states: {},
        over: false,
        submitting: false,
      };
      renderStatus(state, state.run_best_length || 0);
      buildBoard(game.length, game.max);
      buildKeyboard();
      if (nav) {
        nav.innerHTML = '<a href="/dashboard.html">Your stats</a><button class="nav-button" id="logout" type="button">Log out</button>';
        $("#logout").addEventListener("click", () => {
          localStorage.removeItem("token");
          location.href = "/login.html";
        });
      }
      (state.guesses || []).forEach((entry, rowIndex) => {
        const row = board.querySelectorAll(".row")[rowIndex];
        [...row.querySelectorAll(".tile")].forEach((tile, index) => {
          tile.textContent = entry.guess[index];
          tile.classList.add(entry.result[index]);
          const letter = entry.guess[index];
          if ((rank[entry.result[index]] || 0) > (rank[game.states[letter]] || 0)) {
            game.states[letter] = entry.result[index];
          }
        });
      });
      Object.entries(game.states).forEach(([letter, stateName]) => {
        keyboard.querySelector(`[data-key="${letter}"]`)?.classList.add(stateName);
      });

      const updateTiles = () => {
        const rows = [...board.querySelectorAll(".row")];
        rows.forEach((row, rowIndex) => {
          row.classList.toggle("is-active", !game.over && rowIndex === game.row);
          [...row.querySelectorAll(".tile")].forEach((tile, colIndex) => {
            if (rowIndex === game.row) {
              tile.textContent = game.current[colIndex] || "";
              tile.classList.toggle("filled", Boolean(game.current[colIndex]));
            }
          });
        });
      };

      updateTiles();

      const addLetter = (letter) => {
        if (game.over || game.submitting || game.current.length >= game.length || !/^[A-Z]$/.test(letter)) return;
        game.current += letter;
        updateTiles();
      };

      const removeLetter = () => {
        if (game.over || game.submitting || !game.current) return;
        game.current = game.current.slice(0, -1);
        updateTiles();
      };

      async function submit() {
        if (game.over || game.submitting) return;
        if (game.current.length !== game.length) {
          message.textContent = `Enter ${game.length} letters first.`;
          return;
        }

        game.submitting = true;
        message.textContent = "Checking your guess…";
        const guess = game.current;
        const activeRow = board.querySelectorAll(".row")[game.row];
        try {
          const result = await request("/api/ladder/guess", {
            method: "POST",
            body: JSON.stringify({ guess, guesses: game.past }),
          });
          activeRow.classList.remove("is-active");
          [...activeRow.querySelectorAll(".tile")].forEach((tile, index) => {
            tile.classList.add(result.result[index]);
            tile.classList.remove("filled");
            tile.style.animationDelay = `${index * 45}ms`;
          });
          [...guess].forEach((letter, index) => {
            if ((rank[result.result[index]] || 0) > (rank[game.states[letter]] || 0)) {
              game.states[letter] = result.result[index];
            }
            const key = keyboard.querySelector(`[data-key="${letter}"]`);
            if (key) {
              key.classList.remove("absent", "present", "correct");
              key.classList.add(game.states[letter]);
            }
          });

          game.past.push(guess);
          game.current = "";
          game.row += 1;
          game.submitting = false;

          if (result.status === "playing") {
            message.textContent = "";
            updateTiles();
            return;
          }

          game.over = true;
          keyboard.hidden = true;
          const climbed = result.status === "complete" ? 20 : result.status === "lost" ? result.climbed_to : Math.max(game.length, state.run_best_length || 0);
          const nextLength = result.status === "won" ? result.next_length : 5;
          const nextState = { ...state, length: nextLength, best_length: Math.max(state.best_length, climbed), run_best_length: climbed };
          renderStatus(nextState, climbed);
          message.classList.add("result-message");

          if (result.status === "won") {
            message.innerHTML = `<strong>Step cleared!</strong> Loading the ${result.next_length}-letter step…`;
            window.showAnswerPopup({
              answer: result.answer,
              title: "Step cleared!",
              message: `You solved the ${game.length}-letter word.`,
              reloadOnClose: true,
            });
          } else if (result.status === "complete") {
            message.innerHTML = "<strong>Ladder complete!</strong> You reached 20 letters.";
            window.showAnswerPopup({
              answer: result.answer,
              title: "Ladder complete!",
              message: "You reached 20 letters.",
              homeOnClose: true,
            });
          } else {
            message.innerHTML = `<strong>Run ended.</strong> You climbed through ${result.climbed_to} letters.`;
            window.showAnswerPopup({
              answer: result.answer,
              title: "Ladder run ended",
              message: "The right word for this step.",
              homeOnClose: true,
            });
          }
        } catch (error) {
          game.submitting = false;
          message.textContent = "";
          activeRow.classList.add("shake");
          setTimeout(() => activeRow.classList.remove("shake"), 350);
          if (error.message.includes("Reload to continue")) {
            message.innerHTML = `${escapeHtml(error.message)} <a class="ladder-next" href="/ladder.html">Reload Ladder</a>`;
            game.over = true;
          } else {
            message.textContent = error.message;
          }
        }
      }

      keyboard.addEventListener("click", (event) => {
        const key = event.target.closest("[data-key]")?.dataset.key;
        if (key === "ENTER") submit();
        else if (key === "BACKSPACE") removeLetter();
        else if (key) addLetter(key);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Enter") submit();
        else if (event.key === "Backspace") removeLetter();
        else if (/^[a-z]$/i.test(event.key)) addLetter(event.key.toUpperCase());
      });

      message.textContent = game.row ? `Resume this ${game.length}-letter step. ${game.row} ${game.row === 1 ? "guess" : "guesses"} used.` : "";
      updateTiles();
    } catch (error) {
      showError(error);
    }
  }

  $("#logout")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    location.href = "/login.html";
  });

  start();
})();
