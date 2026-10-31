/* Shared Wordle board + keyboard used by Daily, Custom, Normal and Ladder.
   Each mode supplies only: sizes, restored guesses, and onSubmit(guess). */
(() => {
  const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const RANK = { absent: 1, present: 2, correct: 3 };
  const REVEAL_MS = 160;
  const reduceMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const LABEL = { correct: "correct", present: "in word, wrong place", absent: "not in word" };

  function createGame({ board, keyboard, length, maxGuesses, restored = [], layout, onSubmit, onResult, onMessage, isBlocked }) {
    const state = { length, max: maxGuesses, row: 0, current: "", past: [], keys: {}, locked: false, over: false };
    const say = (text) => (onMessage ? onMessage(text) : window.Shabdle.toast(text));
    const rows = () => [...board.querySelectorAll(".row")];

    function build() {
      board.style.setProperty("--word-length", length);
      board.setAttribute("role", "grid");
      board.setAttribute("aria-label", `${length}-letter word, ${maxGuesses} guesses`);
      board.innerHTML = Array.from({ length: maxGuesses }, (_, r) =>
        `<div class="row" role="row" aria-label="Guess ${r + 1}">${Array.from({ length }, (_, i) =>
          `<div class="tile" role="gridcell" style="--i:${i}" aria-label="empty"></div>`).join("")}</div>`).join("");
      keyboard.hidden = false;
      keyboard.innerHTML = KEY_ROWS.map((letters, index) => `<div class="key-row">
        ${index === 2 ? '<button type="button" class="key wide" data-key="ENTER">Enter</button>' : ""}
        ${[...letters].map((l) => `<button type="button" class="key" data-key="${l}">${l}</button>`).join("")}
        ${index === 2 ? '<button type="button" class="key wide" data-key="BACKSPACE" aria-label="Backspace">⌫</button>' : ""}
      </div>`).join("");
      layout?.();
    }

    function paintTile(tile, letter, result) {
      tile.textContent = letter || "";
      tile.dataset.state = result || "";
      tile.classList.remove("correct", "present", "absent");
      if (result) tile.classList.add(result);
      tile.setAttribute("aria-label", letter ? `${letter}${result ? ", " + LABEL[result] : ""}` : "empty");
    }

    function paintKey(letter, result) {
      if ((RANK[result] || 0) <= (RANK[state.keys[letter]] || 0)) return;
      state.keys[letter] = result;
      const key = keyboard.querySelector(`[data-key="${letter}"]`);
      if (key) {
        key.classList.remove("absent", "present", "correct");
        key.classList.add(result);
        key.setAttribute("aria-label", `${letter}, ${LABEL[result]}`);
      }
    }

    function refresh() {
      rows().forEach((row, r) => {
        row.classList.toggle("is-active", !state.over && r === state.row);
        if (r !== state.row) return;
        [...row.children].forEach((tile, c) => {
          const letter = state.current[c] || "";
          if (tile.textContent !== letter) paintTile(tile, letter, "");
          tile.classList.toggle("filled", Boolean(letter));
        });
      });
    }

    const canType = () => !state.over && !state.locked && !isBlocked?.();
    const addLetter = (letter) => {
      if (!canType() || state.current.length >= length || !/^[A-Z]$/.test(letter)) return;
      state.current += letter;
      refresh();
    };
    const removeLetter = () => {
      if (!canType() || !state.current) return;
      state.current = state.current.slice(0, -1);
      refresh();
    };

    async function submit() {
      if (!canType()) return;
      if (state.current.length !== length) {
        say(`Enter ${length} letters first`);
        shake(rows()[state.row]);
        return;
      }
      const guess = state.current;
      const row = rows()[state.row];
      state.locked = true;
      try {
        const result = await onSubmit(guess, [...state.past]);
        row.classList.remove("is-active");
        for (let i = 0; i < length; i += 1) {
          const tile = row.children[i];
          tile.classList.remove("filled");
          paintTile(tile, guess[i], result.result[i]);
          if (!reduceMotion()) await sleep(REVEAL_MS);
        }
        [...guess].forEach((l, i) => paintKey(l, result.result[i]));
        state.past.push(guess);
        state.current = "";
        state.row += 1;
        state.locked = false;
        if (result.status !== "playing") {
          state.over = true;
          keyboard.hidden = true;
          if (result.status === "won" || result.status === "complete") row.classList.add("victory");
        }
        refresh();
        await onResult?.(result, guess);
        return result;
      } catch (error) {
        state.locked = false;
        shake(row);
        if (!error.handled) say(error.message); // `handled`: the mode already showed its own message
        return null;
      }
    }

    function shake(row) {
      if (!row) return;
      row.classList.remove("shake");
      void row.offsetWidth;
      row.classList.add("shake");
    }

    function restore(entries) {
      entries.forEach((entry, r) => {
        const row = rows()[r];
        if (!row) return;
        [...entry.guess].forEach((letter, i) => {
          paintTile(row.children[i], letter, entry.result[i]);
          paintKey(letter, entry.result[i]);
        });
        state.past.push(entry.guess);
      });
      state.row = entries.length;
    }

    // Input: one set of listeners, ignoring browser shortcuts (Ctrl+R, Cmd+C…)
    // and ignoring Enter/Space that merely "click" a focused on-screen key.
    const onClick = (event) => {
      const button = event.target.closest("[data-key]");
      if (!button) return;
      button.blur();
      const key = button.dataset.key;
      if (key === "ENTER") submit();
      else if (key === "BACKSPACE") removeLetter();
      else addLetter(key);
    };
    const onKeydown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest?.("input, select, textarea")) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Enter") { event.preventDefault(); submit(); }
      else if (event.key === "Backspace") removeLetter();
      else if (/^[a-z]$/i.test(event.key)) addLetter(event.key.toUpperCase());
    };
    keyboard.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeydown);
    const onResize = () => layout?.();
    window.addEventListener("resize", onResize);

    build();
    restore(restored);
    refresh();

    return {
      state,
      shareGrid() {
        const marks = { correct: "🟩", present: "🟨" };
        return rows().slice(0, state.row)
          .map((row) => [...row.children].map((t) => marks[t.dataset.state] || "⬛").join("")).join("\n");
      },
      finish() { state.over = true; keyboard.hidden = true; refresh(); },
      destroy() {
        keyboard.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKeydown);
        window.removeEventListener("resize", onResize);
      },
    };
  }

  window.Shabdle = window.Shabdle || {};
  window.Shabdle.createGame = createGame;
})();
