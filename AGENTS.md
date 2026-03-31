# Repository Guidelines

## Project Structure & Module Organization
`src/app` contains the Next.js App Router pages, layouts, and API routes. Reusable UI lives in `src/components`, shared business logic in `src/lib`, and helper functions in `src/utils`. Static assets belong in `public`. Data and operational work is split out: Python/SQL maintenance jobs live in `scripts`, and Supabase schema changes live in `supabase/migrations`. Treat `scripts/output` and debug HTML/CSV files as generated artifacts, not hand-edited source.

## Build, Test, and Development Commands
Use `npm run dev` to start the local Next.js app on port 3000. Run `npm run build` before shipping changes that affect routing, data fetching, or deployment. Use `npm run start` to smoke-test the production build locally. Run `npm run lint` for the TypeScript/React codebase. For data jobs, install Python deps with `pip install -r scripts/requirements.txt`, then run the specific script, for example `python scripts/update_today_v3.py`.

## Coding Style & Naming Conventions
Follow the existing style in each area of the repo. TypeScript components use PascalCase file names such as `Sidebar.tsx`; route folders in `src/app` stay lowercase and descriptive. Prefer typed functions, small helpers, and colocated domain logic in `src/lib`. ESLint uses `eslint-config-next` with the TypeScript and Core Web Vitals presets, so lint before opening a PR. Keep SQL migration files timestamped and action-oriented, for example `20260302_create_user_portfolio_transactions.sql`.

## Testing Guidelines
There is no dedicated automated test suite yet. Validate frontend changes with `npm run lint` and a local `npm run build`. Validate Python changes by running the affected script directly and, where available, the targeted check scripts under `scripts/test_*.py` or `scripts/check_*.py`. Keep new verification scripts narrowly scoped and name them after the behavior under test.

## Commit & Pull Request Guidelines
Recent history favors short, task-focused commit subjects, often with a `YYMMDD` prefix and Korean summaries, for example `260326 시총 top 100 수정 요청사항 반영`. Keep commits small and descriptive rather than generic. PRs should include a clear summary, impacted areas (`src/app/discovery`, `scripts/update_today_v3.py`, etc.), required env vars or migrations, and screenshots for UI changes.

## Security & Configuration Tips
Secrets live in `.env.local` and GitHub Actions secrets; never commit API keys or Supabase service-role values. Review scripts carefully before running production data updates because many write directly to Supabase.
