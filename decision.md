# Decision Record

This document records the decisions made in this conversation and why they matter. Each section includes a possible improvement.

## Center the Normal Mode board

- **Decision:** Keep the board centered in its game container instead of allowing a wide board to sit toward the right.
- **Why it matters:** A centered board is easier to scan and matches the supplied reference image.
- **Implementation note:** The shared compact-game CSS had higher specificity than the first container-width rule. The Normal Mode selector was made more specific so the intended width takes effect.
- **Improvement:** Prefer shared layout variables or a clearly scoped Normal Mode layout over repeated selector-specificity overrides.

## Add vertical spacing between guess rows

- **Decision:** Use a 5px vertical gap between board rows, matching the second reference image.
- **Why it matters:** Distinct rows are easier to read, especially when many guesses are shown.
- **Implementation note:** The board must use grid layout for its row gap to apply; a block container's `gap` does not space its children.
- **Improvement:** Define row and tile spacing with shared CSS custom properties so all game modes stay visually consistent.

## Fit the board and keyboard to Normal Mode settings

- **Decision:** Recalculate tile and key sizes using the viewport, word length, and guess count; remove horizontal scrolling from the board.
- **Why it matters:** Increasing guesses should not push the keyboard below the visible screen or make the word grid scroll sideways.
- **Implementation note:** Layout runs when a game is created and on window resize. The board and keyboard stay centered while their sizes adapt.
- **Improvement:** Add browser-based visual regression tests for short and narrow viewports, browser zoom, and the maximum word length and guess count. Current validation checks sizing calculations and JavaScript syntax, not rendered browser layout.

## Require exactly 16 letters for requested word suggestions

- **Decision:** Count candidate words before presenting them as 16-letter words, and use the project's dictionary when matching the screenshot's tile clues.
- **Why it matters:** A suggestion with the wrong length cannot be entered into the requested game. An earlier suggestion, “counterproductive,” had 17 letters and was corrected.
- **Improvement:** Verify word length programmatically and, when solving from tile clues, check duplicate-letter scoring against the game's dictionary and scoring rules.

## Keep repository cleanup conservative

- **Decision:** Preserve existing worktree changes and remove code only when it is demonstrably unused. Keep the small Daily and Custom startup files and the deprecated guess-history request field because they are referenced or explicitly retained for compatibility.
- **Why it matters:** Removing apparently small glue code or compatibility behavior can break page startup or older cached clients.
- **Implementation note:** The audit found `verify_finished_guesses` in `backend/game.py`, the exported `$$` DOM helper, and two shared-game API methods had no callers; they were removed. The README now distinguishes the shared board module from the Daily/Custom flow module.
- **Improvement:** Add automated tests and static analysis to catch unused code and protect behavior before future cleanup.
