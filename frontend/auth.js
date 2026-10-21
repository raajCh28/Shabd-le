const AUTH_TOKEN_KEY = "token";
const auth$ = (selector) => document.querySelector(selector);

function authToast(message) {
  const toast = auth$("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(authToast.timer);
  authToast.timer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

async function authRequest(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Request failed");
  return data;
}

function initAuth(mode) {
  auth$("#auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { password: auth$("#password").value };
    payload.username = auth$("#username").value.trim();
    if (mode === "register") payload.email = auth$("#email").value.trim();

    try {
      const result = await authRequest(`/api/auth/${mode}`, payload);
      localStorage.setItem(AUTH_TOKEN_KEY, result.token);
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (error) {
      authToast(error.message);
    }
  });
}
