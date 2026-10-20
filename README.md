# CareerPilot backend

## Local development

Run `npm install`, configure `.env` using `.env.example`, then run `npm run dev`.

## Hostinger deployment

Deploy this directory as a Node.js application, separately from the Next.js frontend.

- Node.js: 22
- Build command: `npm run build`
- Build output directory, if requested: `dist`
- Start command: `npm run start`
- Entry file, if requested: `dist/main.js`

The build compiles TypeScript to JavaScript. Production startup uses Node directly,
so it does not depend on the development-only `tsx` package. Install development
dependencies during the build so TypeScript is available.

The server listens on `0.0.0.0` and uses the platform's `PORT`, falling back to
`API_PORT` or 4000 for local development.

Configure these environment variables in the hosting dashboard:

- `NODE_ENV=production`
- `DATABASE_URL`: reachable PostgreSQL database URL
- `JWT_SECRET`: stable, strong application secret
- `FRONTEND_URL`: deployed frontend origin
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_TEAM_ID`
- `SLACK_LOGIN_REDIRECT_URI`: frontend origin followed by `/auth/slack`
- `APIFY_TOKEN`, `APIFY_JOB_ACTOR_ID`, `APIFY_MAX_ITEMS` for job searches
- Cloudinary variables from `.env.example` for uploads
- `SLACK_BOT_TOKEN` if using Slack notifications

Register the same login callback URL in the Slack app's OAuth redirect settings.
On the frontend, set `API_PROXY_TARGET` to this backend's public origin and rebuild.
Do not commit `.env` or credentials.

The existing TypeORM configuration synchronizes the database schema on startup.
The scheduler runs inside the backend process; keep the application running for
automatic job searches.
