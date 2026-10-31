(() => {
const { $, api, escapeHtml, toast, guard, setupNav } = window.Shabdle;
async function initDashboard() {
  setupNav();
  if (!guard()) return;

  try {
    const [stats, games, daily, ladder] = await Promise.all([
      api("/api/normal/stats"),
      api("/api/custom/mine"),
      api("/api/stats/me").catch(() => null),
      api("/api/ladder/state").catch(() => null),
    ]);
    const modeCards = [
      daily && [`${daily.current_streak} / ${daily.max_streak}`, "Daily streak (now / best)"],
      daily && [`${daily.wins} / ${daily.played}`, "Daily solved / played"],
      ladder && [`${ladder.best_length || 0} letters`, "Ladder personal best"],
    ].filter(Boolean);
    const cards = [
      ...modeCards,
      [`${stats.wins} / ${stats.games_played}`, "Solved / played"],
      [stats.win_rate + "%", "Win rate"],
      [stats.current_streak, "Current streak"],
      [stats.best_streak, "Best streak"],
      [stats.average_guesses ?? "—", "Average guesses"],
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
            <tr><th>Played</th><th>Game</th><th>Result</th><th>Guesses</th></tr>
          </thead>
          <tbody>
            ${stats.history
              .map(
                (row) => `<tr>
                  <td>${escapeHtml(row.date)}</td>
                  <td>${row.length} letters${row.hard_mode ? " · Hard" : ""}</td>
                  <td><span class="pill ${row.won ? "won" : "lost"}">
                    ${row.won ? "Solved" : "Missed"}
                  </span></td>
                  <td>${row.guesses}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>`
      : '<p class="muted empty-state">Your completed Normal Mode games will appear here.</p>';

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
