/* Daily + Custom share-link games. Guess history lives on the server, so a
   refresh resumes the round and the six-guess limit cannot be reset. */
(() => {
const { $, api, toast, showWordBanner, hideWordBanner, guard, setupNav, createGame, shareText } = window.Shabdle;
const END_DELAY = 1800;

async function initGame(mode) {
  setupNav();
  if (!guard()) return;
  hideWordBanner();

  const board = $("#board");
  const keyboard = $("#keyboard");
  const message = $("#game-message");
  const code = mode === "custom"
    ? decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "")
    : "";
  const base = mode === "daily" ? "/api/daily" : "/api/custom/" + encodeURIComponent(code);

  try {
    const info = await api(mode === "daily" ? "/api/daily/today" : base);
    const title = mode === "daily" ? `Shabdle Daily ${info.date}` : "Shabdle custom word";

    const layout = () => board.style.setProperty(
      "--board-width",
      `min(calc(${info.length} * (min(12vw, 64px) + 7px)), 92vw)`,
    );

    const showEnd = (won, answer, used) => {
      message.innerHTML = "";
      const line = document.createElement("span");
      line.textContent = won
        ? `Solved in ${used} of ${info.max_guesses}. `
        : `The word was ${answer}. `;
      const share = document.createElement("button");
      share.type = "button";
      share.className = "button";
      share.textContent = "Share result";
      share.addEventListener("click", () =>
        shareText(`${title} ${won ? used : "X"}/${info.max_guesses}\n\n${game.shareGrid()}`));
      message.append(line, share);
    };

    const game = createGame({
      board, keyboard,
      length: info.length,
      maxGuesses: info.max_guesses,
      restored: info.guesses || [],
      layout,
      onMessage: toast,
      // Only the new guess is sent; the server already holds the history.
      onSubmit: (guess) => api(base + "/guess", { method: "POST", body: JSON.stringify({ guess }) }),
      onResult: async (result) => {
        if (result.status === "playing") return;
        const won = result.status === "won";
        if (!won) showWordBanner(result.answer);
        showEnd(won, result.answer, result.guesses_used);

        let popup;
        if (mode === "daily") {
          const stats = await api("/api/stats/me").catch(() => null);
          popup = {
            answer: "",
            title: won ? "Daily streak" : "Daily stats",
            message: won
              ? `Solved in ${result.guesses_used} ${result.guesses_used === 1 ? "guess" : "guesses"}.`
              : "Try again tomorrow.",
            currentStreak: stats?.current_streak ?? 0,
            bestStreak: stats?.max_streak ?? 0,
          };
        } else if (won) {
          popup = { answer: result.answer, title: "Puzzle solved!" };
        }
        if (popup) setTimeout(() => window.showAnswerPopup(popup), END_DELAY);
      },
    });

    if (info.already_played) {
      game.finish();
      showEnd(info.won, info.answer, (info.guesses || []).length);
      if (mode === "daily") {
        message.prepend(info.won ? "You solved today’s word. " : "Today’s puzzle is complete. ", "See you tomorrow. ");
      }
    } else if (info.guesses?.length) {
      message.textContent = `Resumed — ${info.guesses.length} ${info.guesses.length === 1 ? "guess" : "guesses"} used.`;
    }
  } catch (error) {
    if (error.message === "Login required") return;
    board.innerHTML = "";
    keyboard.hidden = true;
    message.textContent = error.message === "Game not found"
      ? "This puzzle link doesn’t exist. Check the link and try again."
      : error.message;
  }
}

window.Shabdle.initWordGame = initGame;
})();
