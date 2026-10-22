(() => {
  const { $, api, toast, guard, setupNav } = window.Shabdle;

  function setupActiveHomeOption() {
    const options = [...document.querySelectorAll("[data-home-option]")];
    if (!options.length) return;

    const activate = (selected) => {
      options.forEach((option) => option.classList.toggle("primary", option === selected));
    };
    let frame = 0;
    const updateForScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const targetY = window.innerHeight * 0.42;
        const nearest = options.reduce((best, option) => {
          const bounds = option.getBoundingClientRect();
          const distance = Math.abs(bounds.top + bounds.height / 2 - targetY);
          return distance < best.distance ? { option, distance } : best;
        }, { option: options[0], distance: Infinity });
        activate(nearest.option);
      });
    };

    options.forEach((option) => {
      option.addEventListener("pointerenter", () => activate(option));
      option.addEventListener("focus", () => activate(option));
    });
    window.addEventListener("scroll", updateForScroll, { passive: true });
    window.addEventListener("resize", updateForScroll);
    updateForScroll();
  }

  async function initHome() {
    setupNav();
    setupActiveHomeOption();
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
