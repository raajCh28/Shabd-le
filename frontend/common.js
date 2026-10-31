(() => {
const TOKEN_KEY = "token";

const $ = (selector, root = document) => root.querySelector(selector);

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);

// localStorage can throw (private mode, blocked cookies); never let that break a page.
const store = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  remove: (key) => { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

function toast(message) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 2800);
}

function showWordBanner(word) {
  hideWordBanner();
  const banner = document.createElement("div");
  banner.className = "word-banner";
  banner.setAttribute("role", "status");
  banner.textContent = String(word || "").toUpperCase();
  document.body.append(banner);
  requestAnimationFrame(() => banner.classList.add("visible"));
}

function hideWordBanner() {
  document.querySelector(".word-banner")?.remove();
}

function loginPath() {
  const next = location.pathname + location.search;
  location.href = "/login.html?next=" + encodeURIComponent(next);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const jwt = store.get(TOKEN_KEY);
  if (jwt) headers.Authorization = "Bearer " + jwt;

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("Can’t reach the server. Check your connection and try again.");
  }

  if (response.status === 401) {
    store.remove(TOKEN_KEY);
    loginPath();
    throw new Error("Login required");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // FastAPI validation errors put an array in `detail`.
    const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return data;
}

function guard() {
  if (!store.get(TOKEN_KEY)) {
    loginPath();
    return false;
  }
  return true;
}

// Colour-blind friendly palette, remembered per browser.
function applyContrast() {
  document.body.classList.toggle("hc", store.get("contrast") === "high");
}

function setupNav() {
  applyContrast();
  const nav = $("#nav");
  if (!nav) return;

  const contrast = '<button class="nav-button" id="contrast-toggle" type="button" aria-label="Toggle colour-blind friendly colours" title="Colour-blind friendly colours">◐</button>';
  nav.innerHTML = store.get(TOKEN_KEY)
    ? `${contrast}<a href="/dashboard.html">Your stats</a><button class="nav-button" id="logout" type="button">Log out</button>`
    : `${contrast}<a href="/login.html">Log in</a><a class="nav-cta" href="/register.html">Join free</a>`;

  $("#contrast-toggle")?.addEventListener("click", () => {
    store.set("contrast", store.get("contrast") === "high" ? "normal" : "high");
    applyContrast();
  });
  $("#logout")?.addEventListener("click", () => {
    store.remove(TOKEN_KEY);
    location.href = "/";
  });
}

async function shareText(text) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast("Result copied");
  } catch (error) {
    if (error?.name !== "AbortError") toast("Couldn’t copy — select and copy manually");
  }
}

window.Shabdle = { TOKEN_KEY, $, store, escapeHtml, toast, showWordBanner, hideWordBanner, loginPath, api, guard, setupNav, shareText, applyContrast };
applyContrast();
})();
