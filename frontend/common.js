(() => {
const TOKEN_KEY = "token";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });

function toast(message) {
  const element = $("#toast");
  if (!element) return;

  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 2800);
}

function showWordBanner(word) {
  document.querySelector(".word-banner")?.remove();
  const banner = document.createElement("div");
  banner.className = "word-banner";
  banner.textContent = String(word || "").toUpperCase();
  document.body.append(banner);
  requestAnimationFrame(() => banner.classList.add("visible"));
}

function hideWordBanner() {
  const banner = document.querySelector(".word-banner");
  banner?.classList.remove("visible");
  window.setTimeout(() => banner?.remove(), 180);
}

function loginPath() {
  const next = location.pathname + location.search;
  location.href = "/login.html?next=" + encodeURIComponent(next);
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const jwt = localStorage.getItem(TOKEN_KEY);

  if (jwt) headers.Authorization = "Bearer " + jwt;

  const response = await fetch(path, { ...options, headers });

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    loginPath();
    throw new Error("Login required");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Request failed");
  return data;
}

function guard() {
  if (!localStorage.getItem(TOKEN_KEY)) {
    loginPath();
    return false;
  }

  return true;
}

function setupNav() {
  const nav = $("#nav");
  if (!nav) return;

  if (!localStorage.getItem(TOKEN_KEY)) {
    nav.innerHTML =
      '<a href="/login.html">Log in</a><a class="nav-cta" href="/register.html">Join free</a>';
    return;
  }

  nav.innerHTML =
    '<a href="/dashboard.html">Your stats</a><button class="nav-button" id="logout">Log out</button>';
  $("#logout")?.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/";
  });
}


window.Shabdle = { TOKEN_KEY, $, $$, escapeHtml, toast, showWordBanner, hideWordBanner, loginPath, api, guard, setupNav };
})();
