(() => {
  const { $, api, escapeHtml, guard, setupNav, createGame, showWordBanner, hideWordBanner } = window.Shabdle;
  const statusPanel = $("#ladder-status");
  const board = $("#board");
  const keyboard = $("#keyboard");
  const message = $("#game-message");
  const MAX_STEP = 20;
  let activeLength = 5;
  let activeMaxGuesses = 6;
  let revealedAnswers = {};

  window.showLadderResultPopup = ({ title, reached, personalBest, completed }) => {
    document.querySelector(".ladder-result-popup")?.remove();
    const dialog = document.createElement("dialog");
    dialog.className = "answer-popup ladder-result-popup";
    dialog.setAttribute("aria-labelledby", "ladder-popup-title");
    dialog.innerHTML = `
      <div class="answer-popup-card">
        <p class="eyebrow">Ladder stats</p>
        <h2 id="ladder-popup-title">${escapeHtml(title)}</h2>
        <div class="answer-popup-stats">
          <div><strong>${completed ? "20 letters" : `${reached} letters`}</strong><span>You climbed</span></div>
          <div><strong>${personalBest} letters</strong><span>Personal best</span></div>
        </div>
        <div class="ladder-result-actions">
          <button class="button primary-button ladder-play-again" type="button">Play again</button>
        </div>
      </div>`;
    document.body.append(dialog);
    dialog.querySelector(".ladder-play-again").addEventListener("click", () => location.reload());
    dialog.showModal();
  };

  function showError(error) {
    keyboard.hidden = true;
    board.innerHTML = "";
    statusPanel.classList.add("error");
    statusPanel.textContent = error.message;
  }

  function renderStatus(state, climbed = state.run_best_length || 0) {
    const rung = Math.max(0, Math.min(MAX_STEP, climbed));
    revealedAnswers = state.revealed_answers || {};
    statusPanel.classList.remove("error");
    statusPanel.innerHTML = `<div class="ladder-rungs" aria-label="Climb progress">${Array.from({ length: 16 }, (_, i) => {
      const length = i + 5;
      const isCurrent = length === state.length;
      const canReview = length < state.length && length <= rung && Boolean(revealedAnswers[length]);
      const classes = [length <= rung && "reached", isCurrent && "current"].filter(Boolean).join(" ");
      if (isCurrent) {
        return `<button class="ladder-rung ${classes}" type="button" data-ladder-step="${length}" data-ladder-action="continue" aria-label="Continue at ${length} letters" aria-current="step">${length}</button>`;
      }
      if (canReview) {
        return `<button class="ladder-rung ${classes}" type="button" data-ladder-step="${length}" data-ladder-action="review" aria-label="View the solved ${length}-letter word">${length}</button>`;
      }
      return `<span class="${classes}">${length}</span>`;
    }).join("")}</div>`;
    const subtitle = $("#game-subtitle");
    if (subtitle) subtitle.textContent = `Step ${state.length} of ${MAX_STEP} · six guesses to solve it.`;
  }

  statusPanel.addEventListener("click", (event) => {
    const rung = event.target.closest("[data-ladder-step]");
    if (!rung) return;
    if (rung.dataset.ladderAction === "continue") { location.reload(); return; }
    const length = Number(rung.dataset.ladderStep);
    window.showAnswerPopup({
      answer: revealedAnswers[length].toUpperCase(),
      title: `${length}-letter step`,
      message: "Previously solved word. Your active step is unchanged.",
      closeLabel: "Back to ladder",
    });
  });

  // Tiles shrink as words grow so every step fits on one screen.
  function updateLadderLayout() {
    const availableWidth = Math.max(0, window.innerWidth - 24);
    const preferredTile = Math.min(window.innerWidth * 0.12, 64);
    const progress = (activeLength - 5) / 15;
    const verticalScale = Math.min(1, Math.max(0.65, (window.innerHeight - 100) / 800));
    const scale = (1 - progress * 0.22) * verticalScale;
    const tileGap = Math.max(1.5, 5 - progress * 3.5);
    const mobile = window.innerWidth <= 700;
    const keyboardHeight = Math.max(mobile ? 58 : 50, 60 * scale);
    const keyboardWidth = Math.min(500, window.innerWidth - 16);

    board.style.setProperty("--ladder-tile-gap", `${tileGap}px`);
    keyboard.style.setProperty("--ladder-keyboard-width", `${keyboardWidth}px`);
    keyboard.style.setProperty("--ladder-key-height", `${keyboardHeight}px`);
    keyboard.style.setProperty("--ladder-key-font-size", `${Math.max(mobile ? 17 : 15, 17 * scale)}px`);
    keyboard.style.setProperty("--ladder-key-max-width", `${Math.max(18, Math.min(44, (keyboardWidth - 50) / 10))}px`);
    keyboard.style.setProperty("--ladder-wide-key-width", `${Math.max(34, Math.min(66, keyboardWidth * 0.14))}px`);

    const boardTop = board.getBoundingClientRect().top;
    const shell = document.querySelector(".ladder-shell");
    const msgStyle = getComputedStyle(message);
    const reserved = keyboard.getBoundingClientRect().height
      + (parseFloat(getComputedStyle(keyboard).marginTop) || 0)
      + message.getBoundingClientRect().height + (parseFloat(msgStyle.marginTop) || 0)
      + (parseFloat(getComputedStyle(shell).paddingBottom) || 0) + 12;
    const verticalTile = (window.innerHeight - boardTop - reserved - (activeMaxGuesses - 1) * tileGap) / activeMaxGuesses;
    const horizontalTile = (availableWidth - (activeLength - 1) * tileGap) / activeLength;
    const tile = Math.max(24, Math.min(preferredTile, verticalTile, horizontalTile));

    board.style.setProperty("--board-width", `${activeLength * tile + (activeLength - 1) * tileGap}px`);
    board.style.setProperty("--ladder-tile-height", `${tile}px`);
  }

  async function start() {
    setupNav();
    hideWordBanner();
    if (!guard()) return;

    let state;
    try {
      state = await api("/api/ladder/state");
    } catch (error) {
      if (error.message !== "Login required") showError(error);
      return;
    }

    activeLength = state.length;
    activeMaxGuesses = state.max_guesses;
    renderStatus(state, state.run_best_length || 0);

    const core = createGame({
      board, keyboard,
      length: state.length,
      maxGuesses: state.max_guesses,
      restored: state.guesses || [],
      layout: updateLadderLayout,
      onMessage: (text) => { message.textContent = text; },
      onSubmit: async (guess, past) => {
        message.textContent = "Checking your guess…";
        try {
          return await api("/api/ladder/guess", { method: "POST", body: JSON.stringify({ guess, guesses: past }) });
        } catch (error) {
          message.textContent = "";
          if (error.message.includes("Reload to continue")) {
            message.innerHTML = `${escapeHtml(error.message)} <a class="ladder-next" href="/ladder.html">Reload Ladder</a>`;
            core.finish();
            error.handled = true;
          }
          throw error;
        }
      },
      onResult: (result) => {
        if (result.status === "playing") { message.textContent = ""; return; }
        const length = state.length;
        const climbed = result.status === "complete" ? MAX_STEP
          : result.status === "lost" ? result.climbed_to
          : Math.max(length, state.run_best_length || 0);
        renderStatus({
          ...state,
          length: result.status === "won" ? result.next_length : 5,
          best_length: Math.max(state.best_length, climbed),
          run_best_length: climbed,
          revealed_answers: { ...(state.revealed_answers || {}), [length]: result.answer },
        }, climbed);
        message.classList.add("result-message");

        if (result.status === "won") {
          message.innerHTML = `<strong>Step cleared!</strong> Loading the ${result.next_length}-letter step…`;
          window.showAnswerPopup({
            answer: result.answer,
            title: "Step cleared!",
            message: `You solved the ${length}-letter word.`,
            reloadOnClose: true,
            closeLabel: "Continue to next step",
          });
        } else if (result.status === "complete") {
          message.textContent = "";
          window.showLadderResultPopup({
            title: "Ladder complete!", reached: MAX_STEP,
            personalBest: MAX_STEP, completed: true,
          });
        } else {
          message.textContent = "";
          showWordBanner(result.answer);
          setTimeout(() => window.showLadderResultPopup({
            title: "Run ended", reached: result.climbed_to,
            personalBest: Math.max(state.best_length || 0, result.climbed_to || 0), completed: false,
          }), 1500);
        }
      },
    });

    if (core.state.row) {
      const n = core.state.row;
      message.textContent = `Resume this ${state.length}-letter step. ${n} ${n === 1 ? "guess" : "guesses"} used.`;
    }
  }

  start();
})();
