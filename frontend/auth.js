(() => {
const { $, store, toast, TOKEN_KEY } = window.Shabdle;

function safeNext() {
  const next = new URLSearchParams(location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function initAuth(mode) {
  window.Shabdle.setupNav?.();
  if (store.get(TOKEN_KEY)) { location.replace(safeNext()); return; } // already signed in

  const form = $("#auth-form");
  const submit = $("button[type=submit]", form);
  $("#username")?.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return; // block double submits
    const payload = { username: $("#username").value.trim(), password: $("#password").value };
    if (mode === "register") payload.email = $("#email").value.trim();

    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
        throw new Error(response.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : detail || "Something went wrong");
      }
      store.set(TOKEN_KEY, data.token);
      location.href = safeNext();
    } catch (error) {
      toast(error instanceof TypeError ? "Can’t reach the server. Try again." : error.message);
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
    }
  });
}

window.initAuth = initAuth;
})();
