(() => {
  const { $, api, toast, store, TOKEN_KEY, setupNav } = window.Shabdle;

  function setupActiveHomeOption() {
    const options = [...document.querySelectorAll("[data-home-option]")];
    if (!options.length) return;
    const activate = (selected) => options.forEach((o) => o.classList.toggle("primary", o === selected));
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const targetY = window.innerHeight * 0.42;
        const nearest = options.reduce((best, option) => {
          const b = option.getBoundingClientRect();
          const distance = Math.abs(b.top + b.height / 2 - targetY);
          return distance < best.distance ? { option, distance } : best;
        }, { option: options[0], distance: Infinity });
        activate(nearest.option);
      });
    };
    options.forEach((o) => {
      o.addEventListener("pointerenter", () => activate(o));
      o.addEventListener("focus", () => activate(o));
    });
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  async function initHome() {
    setupNav();
    setupActiveHomeOption();

    // Visitors can see the landing page; every game link sends them to log in first.
    if (!store.get(TOKEN_KEY)) {
      $("#daily-note").textContent = "Log in to play today’s word";
      return;
    }
    try {
      const [user, status] = await Promise.all([api("/api/auth/me"), api("/api/daily/today")]);
      $("#home-greeting").textContent = `Welcome back, ${user.username}`;
      $("#daily-note").textContent = status.already_played
        ? (status.won ? "You solved today’s word" : "You played today")
        : (status.guesses?.length ? `Resume — ${status.guesses.length} guesses used` : "One word for everyone today");
    } catch (error) {
      if (error.message !== "Login required") toast(error.message);
    }
  }

  window.Shabdle.initHome = initHome;
})();
