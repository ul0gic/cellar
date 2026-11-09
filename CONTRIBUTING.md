# Contributing

Thanks for helping. Bug reports and pull requests are welcome.

## Reporting a bug

Open an issue with what you did, what you expected, what happened, and the Cellar version (Settings, About, or `docker exec cellar cellar version`). Include log lines from `docker logs cellar` if they show an error. Leave out passwords, API keys and backup files.

## Sending a change

1. Fork the repository and branch from `main`.
2. Set up as in the README's Development section.
3. Keep the change to one fix or feature, and match the code around it.
4. Before you push, run:

   ```sh
   pnpm typecheck
   pnpm lint
   pnpm build:frontend
   pnpm openapi
   ```

5. Open a pull request that says what changed and why, and how you checked it in the running app.

CI runs the same checks and builds the image on every pull request; it has to pass before review.

## Ground rules

- The API is defined once in `contract/`. Change it there, never by hand in the server or the web app.
- Every "can make" and "missing" answer comes from `backend/src/shelf/satisfaction.ts`.
- Outbound requests go through `backend/src/core/outbound.ts`.
- New dependencies need a reason the platform and existing code can't cover.
- Don't add person, bar or book credits to catalog records.
