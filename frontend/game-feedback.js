(() => {
  window.showAnswerPopup = ({
    answer = "",
    title = "Good try!",
    message = "The right word was",
    currentStreak,
    bestStreak,
    homeOnClose = false,
    reloadOnClose = false,
  }) => {
    document.querySelector(".answer-popup")?.remove();

    const dialog = document.createElement("dialog");
    dialog.className = "answer-popup";
    dialog.setAttribute("aria-labelledby", "answer-popup-title");
    dialog.innerHTML = `
      <div class="answer-popup-card">
        <p class="eyebrow">Puzzle complete</p>
        <h2 id="answer-popup-title"></h2>
        <p class="answer-popup-copy"></p>
        <strong class="answer-popup-word"></strong>
        <div class="answer-popup-stats" hidden>
          <div><strong class="current-streak"></strong><span>Current streak</span></div>
          <div><strong class="best-streak"></strong><span>Best streak</span></div>
        </div>
        <button class="button primary-button answer-popup-close" type="button">Got it</button>
      </div>`;
    dialog.querySelector("#answer-popup-title").textContent = title;
    dialog.querySelector(".answer-popup-copy").textContent = message;
    const answerElement = dialog.querySelector(".answer-popup-word");
    answerElement.textContent = answer;
    answerElement.hidden = !answer;
    const stats = dialog.querySelector(".answer-popup-stats");
    const closeButton = dialog.querySelector(".answer-popup-close");
    if (Number.isFinite(currentStreak) && Number.isFinite(bestStreak)) {
      stats.hidden = false;
      dialog.querySelector(".current-streak").textContent = `${currentStreak} days`;
      dialog.querySelector(".best-streak").textContent = `${bestStreak} days`;
    }
    document.body.append(dialog);

    const close = () => {
      dialog.close();
      dialog.remove();
    };
    closeButton.addEventListener("click", () => {
      if (homeOnClose) {
        location.href = "/";
        return;
      }
      if (reloadOnClose) {
        location.reload();
        return;
      }
      close();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    closeButton.focus();
  };
})();
