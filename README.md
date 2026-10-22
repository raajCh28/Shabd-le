# Shabdle

A logged-in Wordle app with a shared Daily puzzle, custom share-link games, an expanding Ladder mode, and per-user Daily stats. FastAPI owns the answers and scores each guess; the browser receives only tile states until a game ends.

## Run locally

1. Create and activate a virtual environment from the repository root.
2. Install dependencies with `python -m pip install -r backend/requirements.txt`.
3. Copy `.env.example` to `.env` and set a long random `JWT_SECRET`.
4. Run `uvicorn main:app --app-dir backend --reload` from the repository root. The app loads `.env` automatically.
5. Open <http://127.0.0.1:8000>. FastAPI's API explorer is at <http://127.0.0.1:8000/docs>.

SQLite data is stored in `wordle.db` in the current working directory. Set `DATABASE_URL` to switch databases. Keep the answer and guess word lists in `backend/`; they are not mounted as static assets. Daily and Ladder answers continue to come from the smaller curated lists, while guess validation uses the broader US English dictionary in `backend/dictionary_words.txt`.

The Daily answer rotation uses the checked-in `backend/words.txt` list and the frozen 2024-01-01 epoch. Changing that answer list after launch changes future puzzle dates.

## Publish a shareable web link

The repository includes a Render Blueprint in `render.yaml`. Push this project to GitHub, then choose **New → Blueprint** in Render and connect the repository. The Blueprint creates the web service and a Render Postgres database; it generates `JWT_SECRET` automatically, so no email or database credentials are required during deployment.

Registration creates an account immediately and signs the player in. Email verification and email password reset are disabled. Players should keep their passwords safe; there is no self-service password recovery. Render’s free web service sleeps after 15 minutes without requests. Its free Postgres database expires after 30 days, so this setup is for a demo; review current limits before inviting players to rely on saved accounts or progress.

## Scope

- Username/password login, account registration, bcrypt hashes, seven-day JWTs, and login throttling. Registration signs the player in immediately without email verification.
- Email is collected during registration, but is not verified and is not used for account recovery. Password reset is disabled.
- One server-date Daily word for everyone; a result can be recorded once per user and date.
- Normal Mode starts immediately with 5 letters and 6 guesses. Its settings button supports 3–20 letters, 2–8 guesses, and Hard Mode clue rules. Separate Normal Mode stats appear after each completed round.
- Ladder runs from 5 to 20 letters. Each solved word advances one step; a missed step resets the run with a different five-letter word. Progress and guesses are saved on the server.
- Custom words from 3 to 10 letters with random share codes.
- Duplicate-aware server scoring, finished-game re-verification, and dashboard history/stats.
- Plain HTML, CSS, and JavaScript served by FastAPI.

## Code layout

- `backend/main.py` configures the database, shared authentication dependency, and site routes.
- `backend/auth_routes.py` contains registration and login endpoints.
- `backend/ladder.py` contains the Ladder API, saved progress, and guess history; `backend/ladder_words.txt` is its private word bank.
- `backend/normal.py` implements independently configured Normal Mode rounds and their saved state.
- `backend/dictionary.py` loads the broad guess vocabulary. `backend/dictionary_words.txt` is the SCOWL/English Speller Database US size 70 list, filtered at load time to alphabetic words of 3–20 letters; its attribution and license are in `backend/dictionary-license.txt`.
- `frontend/auth.js`, `frontend/ladder.js`, `frontend/normal.js`, `frontend/daily.js`, and `frontend/custom.js` hold the page-specific flows. `frontend/game-engine.js` shares the Daily and Custom board behavior; `frontend/common.js` contains shared navigation and API helpers.
- `frontend/game-feedback.js` and `frontend/game-feedback.css` provide the animated answer dialog used after a loss.
- `frontend/ladder.css` contains Ladder-specific layout and progress indicator styles.

Daily and custom in-progress guesses remain in the browser and are sent for final verification. Ladder guesses are saved on the server so a refresh cannot reset the current step's six-guess limit. Use HTTPS and a strong `JWT_SECRET` in production.

The guess dictionary is sourced from the [English Speller Database (ESDB)](https://wordlist.aspell.net/), formerly SCOWL. The app accepts dictionary entries as guesses, but continues to draw answers from the existing curated Daily and Ladder lists.
