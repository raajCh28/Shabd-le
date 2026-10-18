(() => {
  const { $, api, toast, guard, setupNav } = window.Shabdle;

  async function initHome() {
    setupNav();
    if (!guard()) return;

    try {
      const [user, status] = await Promise.all([
        api("/api/auth/me"),
        api("/api/daily/today"),
      ]);

      $("#home-greeting").textContent = `Welcome back, ${user.username}`;
      $("#daily-note").textContent = status.already_played
        ? status.won
          ? "You solved today’s word"
          : "You played today"
        : "One word for everyone today";
    } catch (error) {
      if (error.message !== "Login required") toast(error.message);
    }
  }

  window.Shabdle.initHome = initHome;
})();
