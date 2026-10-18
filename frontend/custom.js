(() => {
const { $, api, escapeHtml, toast, guard, setupNav } = window.Shabdle;
function initCreate() {
  setupNav();
  if (!guard()) return;

  $("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const result = await api("/api/custom", {
        method: "POST",
        body: JSON.stringify({ word: $("#custom-word").value }),
      });
      const url = location.origin + result.url;
      const panel = $("#share-result");

      panel.hidden = false;
      panel.innerHTML = `<p class="eyebrow">Ready to share</p>
        <h2>Your ${result.length}-letter puzzle is live.</h2>
        <div class="copy-row">
          <input readonly value="${escapeHtml(url)}" aria-label="Share link" />
          <button id="copy-link" class="button">Copy link</button>
        </div>
        <a class="text-link" href="${escapeHtml(result.url)}">Play your puzzle →</a>`;

      $("#copy-link").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast("Link copied");
        } catch {
          $(".copy-row input").select();
          toast("Select and copy your link");
        }
      });

      $("#custom-word").value = "";
    } catch (error) {
      toast(error.message);
    }
  });
}

window.Shabdle.initCreate = initCreate;
})();
