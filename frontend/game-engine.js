(() => {
const { $, $$, api, escapeHtml, toast, guard, setupNav, loginPath, TOKEN_KEY } = window.Shabdle;
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

async function initGame(mode) {
  setupNav();
  if (!guard()) return;

  const customCode =
    mode === "custom"
      ? decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "")
      : "";
  const endpoint =
    mode === "daily" ? "/api/daily" : "/api/custom/" + encodeURIComponent(customCode);
  const message = $("#game-message");

  try {
    const info = await api(mode === "daily" ? "/api/daily/today" : endpoint);
    const game = {
      length: info.length,
      max: info.max_guesses,
      row: 0,
      current: "",
      past: [],
      over: info.already_played,
      states: {},
      endpoint,
    };
    const board = $("#board");

    board.style.setProperty("--word-length", game.length);
    board.style.setProperty(
      "--board-width",
      `min(calc(${game.length} * (min(12vw, 64px) + 7px)), 92vw)`,
    );
    board.innerHTML = Array.from(
      { length: game.max },
      () =>
        `<div class="row">${Array.from(
          { length: game.length },
          () => '<div class="tile"></div>',
        ).join("")}</div>`,
    ).join("");

    const keyboard = $("#keyboard");
    keyboard.innerHTML = KEY_ROWS.map(
      (row, index) => `<div class="key-row">
        ${
          index === 2
            ? '<button class="key wide" data-key="ENTER">Enter</button>'
            : ""
        }
        ${[...row]
          .map(
            (letter) =>
              `<button class="key" data-key="${letter}">${letter}</button>`,
          )
          .join("")}
        ${
          index === 2
            ? '<button class="key wide" data-key="BACKSPACE" aria-label="Backspace">⌫</button>'
            : ""
        }
      </div>`,
    ).join("");

    if (info.already_played) {
      board.classList.add("board-muted");
      keyboard.hidden = true;
      message.textContent = info.won
        ? "You solved today’s word. See you tomorrow."
        : "Today’s puzzle is complete. Come back tomorrow for a new one.";
      return;
    }

    const updateTiles = () => {
      $$(".row", board).forEach((row, rowIndex) => {
        $$(".tile", row).forEach((tile, colIndex) => {
          tile.textContent =
            rowIndex === game.row ? game.current[colIndex] || "" : tile.textContent;

          if (rowIndex === game.row && game.current[colIndex]) {
            tile.classList.add("filled");
          } else {
            tile.classList.remove("filled");
          }
        });
      });
    };

    const addLetter = (letter) => {
      if (game.over || game.current.length >= game.length || !/^[A-Z]$/.test(letter)) {
        return;
      }

      game.current += letter;
      updateTiles();
    };

    const removeLetter = () => {
      if (game.over || !game.current) return;
      game.current = game.current.slice(0, -1);
      updateTiles();
    };

    const updateKeyboard = (guess, result) => {
      [...guess].forEach((letter, index) => {
        const rank = { absent: 1, present: 2, correct: 3 };
        if ((rank[result[index]] || 0) > (rank[game.states[letter]] || 0)) {
          game.states[letter] = result[index];
        }

        const key = $(`[data-key="${letter}"]`, keyboard);
        if (key) {
          key.classList.remove("absent", "present", "correct");
          key.classList.add(game.states[letter]);
        }
      });
    };

    const submit = async () => {
      if (game.over || game.current.length !== game.length) {
        toast(`Enter ${game.length} letters first`);
        return;
      }

      const guess = game.current;
      const row = $(".row:nth-child(" + (game.row + 1) + ")", board);

      try {
        const data = await api(endpoint + "/guess", {
          method: "POST",
          body: JSON.stringify({ guess, guesses: game.past }),
        });

        $$(".tile", row).forEach((tile, index) => {
          tile.style.animationDelay = `${index * 90}ms`;
          tile.classList.add(data.result[index]);
          tile.classList.remove("filled");
        });
        updateKeyboard(guess, data.result);
        game.past.push(guess);
        game.current = "";
        game.row += 1;
        updateTiles();

        if (data.status !== "playing") {
          game.over = true;
          keyboard.hidden = true;
          message.innerHTML = data.status === "won"
              ? `<strong>Lovely. You got it in ${data.guesses_used} ${
                  data.guesses_used === 1 ? "guess" : "guesses"
                }.</strong>`
              : "The puzzle is complete.";
          message.classList.add("result-message");

          if (mode === "daily") {
            api("/api/stats/me")
              .catch(() => null)
              .then((stats) => {
                window.showAnswerPopup({
                  answer: data.answer,
                  title: data.status === "won" ? "Daily streak" : "Daily puzzle complete",
                  message:
                    data.status === "won"
                      ? `Solved in ${data.guesses_used} ${data.guesses_used === 1 ? "guess" : "guesses"}.`
                      : "The right word was",
                  currentStreak: stats?.current_streak ?? 0,
                  bestStreak: stats?.max_streak ?? 0,
                });
              });
          } else {
            window.showAnswerPopup({
              answer: data.answer,
              title: data.status === "won" ? "Puzzle solved!" : "Good try!",
            });
          }
        }
      } catch (error) {
        row.classList.remove("shake");
        void row.offsetWidth;
        row.classList.add("shake");
        if (error.message !== "Login required") toast(error.message);
      }
    };

    keyboard.addEventListener("click", (event) => {
      const key = event.target.closest("[data-key]")?.dataset.key;
      if (key === "ENTER") {
        submit();
      } else if (key === "BACKSPACE") {
        removeLetter();
      } else if (key) {
        addLetter(key);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      } else if (event.key === "Backspace") {
        removeLetter();
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        addLetter(event.key.toUpperCase());
      }
    });

    window.addEventListener("resize", () => {
      board.style.setProperty(
        "--board-width",
        `min(calc(${game.length} * (min(12vw, 64px) + 7px)), 92vw)`,
      );
    });
  } catch (error) {
    if (error.message !== "Login required") toast(error.message);
  }
}

window.Shabdle.initWordGame = initGame;
})();
