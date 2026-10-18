# Shabdle

A logged-in Wordle app with a shared Daily puzzle, custom share-link games, an expanding Ladder mode, and per-user Daily stats. FastAPI owns the answers and scores each guess; the browser receives only tile states until a game ends.

## Run locally

1. Create and activate a virtual environment from the repository root.
2. Install dependencies with `python -m pip install -r backend/requirements.txt`.
3. Copy `.env.example` to `.env`, set a long random `JWT_SECRET`, and configure SMTP credentials for a real email provider.
4. Run `uvicorn main:app --app-dir backend --reload` from the repository root. The app loads `.env` automatically.
5. Open <http://127.0.0.1:8000>. FastAPI's API explorer is at <http://127.0.0.1:8000/docs>.

SQLite data is stored in `wordle.db` in the current working directory. Set `DATABASE_URL` to switch databases. Keep the answer and guess word lists in `backend/`; they are not mounted as static assets. Daily and Ladder answers continue to come from the smaller curated lists, while guess validation uses the broader US English dictionary in `backend/dictionary_words.txt`.

The Daily answer rotation uses the checked-in `backend/words.txt` list and the frozen 2024-01-01 epoch. Changing that answer list after launch changes future puzzle dates.

## Publish a shareable web link

The repository includes a Render Blueprint in `render.yaml`. To publish it, push this project to a GitHub repository, create a free Postgres project on Neon, and choose **New → Blueprint** in Render to connect the repository. Render uses the included Python build/start commands and generates a private `JWT_SECRET` automatically.

When Render prompts for environment variables, add:

- `DATABASE_URL`: Neon’s pooled PostgreSQL connection string. It can use the standard `postgresql://` form; the app selects psycopg 3 automatically.
- `RESEND_API_KEY`: an API key from Resend.
- `EMAIL_FROM`: a sender address verified with Resend, for example `Shabdle <play@your-verified-domain.example>`.

The hosted app needs an email provider because users must verify email addresses. The app supports SMTP locally, but Render free web services block outbound SMTP ports; hosted OTP delivery therefore uses Resend’s HTTPS API. Never put service keys in GitHub or commit `.env`.

After the deployment reports **Live**, Render provides an HTTPS `onrender.com` URL that can be shared with friends and opened on phones. Render’s free web service sleeps after 15 minutes without requests, so its first load after inactivity may take a short while. Neon’s free plan currently includes 100 compute-hours and 1 GB database storage per project; compute sleeps after five minutes of inactivity. Free plans are suitable for a small demo and have usage limits; review current provider limits before inviting many players.

The deployment requires your GitHub, Render, Neon, and Resend accounts to connect and provide their private credentials. This workspace does not have a Git remote or access to those accounts, so the code is deployment-ready but no public URL exists until those account steps are completed.

## Scope

- Username/password login, email-backed account registration, bcrypt hashes, seven-day JWTs, and login throttling.
- Six-digit email verification codes that expire after 10 minutes; unverified accounts cannot log in or play. Codes are single-use, limited to five attempts, and resend requests are rate-limited.
- Six-digit email OTP password recovery for verified accounts.
- One server-date Daily word for everyone; a result can be recorded once per user and date.
- Normal Mode lets players choose a 3–20-letter word and 1–12 guesses, then start another round.
- Ladder runs from 5 to 20 letters. Each solved word advances one step; a missed step resets the run with a different five-letter word. Progress and guesses are saved on the server.
- Custom words from 3 to 10 letters with random share codes.
- Duplicate-aware server scoring, finished-game re-verification, and dashboard history/stats.
- Plain HTML, CSS, and JavaScript served by FastAPI.

## Code layout

- `backend/main.py` configures the database, shared authentication dependency, and site routes.
- `backend/auth_routes.py` contains registration, login, email verification, and password recovery endpoints.
- `backend/email_verification.py` handles OTP generation, storage-safe hashes, and email delivery.
- `backend/ladder.py` contains the Ladder API, saved progress, and guess history; `backend/ladder_words.txt` is its private word bank.
- `backend/normal.py` implements independently configured Normal Mode rounds and their saved state.
- `backend/dictionary.py` loads the broad guess vocabulary. `backend/dictionary_words.txt` is the SCOWL/English Speller Database US size 70 list, filtered at load time to alphabetic words of 3–20 letters; its attribution and license are in `backend/dictionary-license.txt`.
- `frontend/auth.js`, `frontend/ladder.js`, `frontend/normal.js`, `frontend/daily.js`, and `frontend/custom.js` hold the page-specific flows. `frontend/game-engine.js` shares the Daily and Custom board behavior; `frontend/common.js` contains shared navigation and API helpers.
- `frontend/game-feedback.js` and `frontend/game-feedback.css` provide the animated answer dialog used after a loss.
- `frontend/ladder.css` contains Ladder-specific layout and progress indicator styles.

Daily and custom in-progress guesses remain in the browser and are sent for final verification. Ladder guesses are saved on the server so a refresh cannot reset the current step's six-guess limit. Use HTTPS and a strong `JWT_SECRET` in production.

The guess dictionary is sourced from the [English Speller Database (ESDB)](https://wordlist.aspell.net/), formerly SCOWL. The app accepts dictionary entries as guesses, but continues to draw answers from the existing curated Daily and Ladder lists.

### Email verification setup

Configure one SMTP sender in `.env`; all player verification emails are sent through this app-owned sender. Players only enter their own email address and never provide SMTP credentials.

For a Gmail sender, turn on Google 2-Step Verification and create an App Password. Put the full Gmail address in `SMTP_USERNAME` and `SMTP_FROM`, the App Password in `SMTP_PASSWORD`, and use `smtp.gmail.com`, port `587`, `SMTP_USE_TLS=true`, and `SMTP_USE_SSL=false`. Google requires 2-Step Verification for App Passwords and notes that availability can depend on account type and security settings: [Google App Password help](https://support.google.com/accounts/answer/185833).

Restart Uvicorn after editing `.env`, register using an inbox you can access, check Inbox and Spam for the six-digit code, then enter it on the verification screen. For deployment, configure private environment variables in the hosting service; do not commit `.env`. See [Publish a shareable web link](#publish-a-shareable-web-link) for Render and Resend setup. For a public domain, configure the mail provider's domain authentication records and review its sending limits.
