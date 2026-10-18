(() => {
const { $, api, escapeHtml, toast, guard, setupNav } = window.Shabdle;
async function initDashboard() {
  setupNav();
  if (!guard()) return;

  try {
    const [stats, games] = await Promise.all([
      api("/api/stats/me"),
      api("/api/custom/mine"),
    ]);
    const cards = [
      [stats.solved_label, "Solved / played"],
      [stats.win_pct + "%", "Win rate"],
      [stats.current_streak, "Current streak"],
      [stats.max_streak, "Best streak"],
      [stats.played, "Dailies played"],
    ];

    $("#stats").innerHTML = cards
      .map(
        ([value, label]) => `<article class="stat-card">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </article>`,
      )
      .join("");

    const max = Math.max(1, ...stats.guess_distribution);
    $("#distribution").innerHTML = stats.guess_distribution
      .map(
        (count, index) => `<div class="distribution-row">
          <span>${index + 1}</span>
          <div class="distribution-track">
            <div class="distribution-bar ${count ? "active" : ""}"
              style="width:${Math.max(count ? 8 : 0, (count / max) * 100)}%">
              ${count || ""}
            </div>
          </div>
        </div>`,
      )
      .join("");

    $("#history").innerHTML = stats.history.length
      ? `<table>
          <thead>
            <tr><th>Date</th><th>Result</th><th>Guesses</th></tr>
          </thead>
          <tbody>
            ${stats.history
              .map(
                (row) => `<tr>
                  <td>${escapeHtml(row.date)}</td>
                  <td><span class="pill ${row.won ? "won" : "lost"}">
                    ${row.won ? "Solved" : "Missed"}
                  </span></td>
                  <td>${row.guesses}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>`
      : '<p class="muted empty-state">Your completed Daily games will appear here.</p>';

    $("#custom-games").innerHTML = games.created.length
      ? games.created
          .map(
            (game) => `<a class="game-list-item" href="/play/${encodeURIComponent(
              game.share_code,
            )}">
              <span>
                <strong>${escapeHtml(game.word)}</strong>
                <small>${game.length} letters · ${game.solvers} solved / ${game.players} played</small>
              </span>
              <span class="arrow">→</span>
            </a>`,
          )
          .join("")
      : '<p class="muted empty-state">Make your first custom puzzle and share it with someone.</p>';
  } catch (error) {
    if (error.message !== "Login required") toast(error.message);
  }
}

window.Shabdle.initDashboard = initDashboard;
})();
