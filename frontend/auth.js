const AUTH_TOKEN_KEY = "token";
const auth$ = (selector) => document.querySelector(selector);

const authEscape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

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
    if (mode === "login") payload.username = auth$("#username").value.trim();
    else {
      payload.username = auth$("#username").value.trim();
      payload.email = auth$("#email").value.trim();
    }
    try {
      const result = await authRequest(`/api/auth/${mode}`, payload);
      if (mode === "register") {
        const card = auth$(".auth-card");
        card.innerHTML = `<p class="eyebrow">One quick step</p><h1>Check your inbox</h1>
          <p class="muted">We sent a six-digit code to <strong>${authEscape(payload.email)}</strong>. It expires in 10 minutes.</p>
          <form id="verify-form"><input type="hidden" id="verification-email" value="${authEscape(payload.email)}" />
          <label>Verification code<input id="verification-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
          <button class="button primary-button" type="submit">Verify email <span>→</span></button></form>
          <button class="button" id="resend-code" type="button">Send a new code</button>
          <p class="auth-foot"><a href="/login.html">Back to log in</a></p>`;
        bindVerificationForm();
        bindResendButton();
        return;
      }
      localStorage.setItem(AUTH_TOKEN_KEY, result.token);
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (error) { authToast(error.message); }
  });
}

function bindVerificationForm() {
  auth$("#verify-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await authRequest("/api/auth/verify-email", {
        email: auth$("#verification-email").value.trim(),
        code: auth$("#verification-code").value.trim(),
      });
      auth$(".auth-card").innerHTML = `<p class="eyebrow">You’re all set</p><h1>Email verified</h1>
        <p class="muted">${authEscape(result.message)}</p><a class="button primary-button" href="/login.html">Log in <span>→</span></a>`;
    } catch (error) { authToast(error.message); }
  });
}

function bindResendButton() {
  auth$("#resend-code")?.addEventListener("click", async () => {
    try {
      const result = await authRequest("/api/auth/resend-verification", {
        email: auth$("#verification-email").value.trim(),
      });
      authToast(result.message);
    } catch (error) { authToast(error.message); }
  });
}

function initEmailVerification() {
  const email = new URLSearchParams(location.search).get("email") || "";
  if (email) auth$("#verification-email").value = email;
  bindVerificationForm();
  bindResendButton();
}

function initPasswordReset() {
  auth$("#reset-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = auth$("#reset-email").value.trim();
    try {
      if (!auth$("#reset-code").value.trim()) {
        const result = await authRequest("/api/auth/forgot-password", { email });
        auth$("#reset-code-fields").hidden = false;
        auth$("#reset-code").required = true;
        auth$("#new-password").required = true;
        auth$("#reset-submit").textContent = "Update password →";
        authToast(result.message);
        return;
      }
      const result = await authRequest("/api/auth/reset-password", {
        email,
        code: auth$("#reset-code").value.trim(),
        new_password: auth$("#new-password").value,
      });
      auth$(".auth-card").innerHTML = `<p class="eyebrow">Password updated</p><h1>You’re back in.</h1>
        <p class="muted">${authEscape(result.message)}</p><a class="button primary-button" href="/login.html">Log in →</a>`;
    } catch (error) { authToast(error.message); }
  });
}
