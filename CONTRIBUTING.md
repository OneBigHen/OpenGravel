# Contributing

Thanks for taking a look. Small changes with a clear purpose are easiest to review.

1. Open an issue for a larger change so we can agree on the behavior first.
2. Make a focused branch and include a test when behavior changes.
3. Run the checks relevant to your change:

   ```sh
   npm ci
   npm run lint
   npm run typecheck
   npm test
   npm run test:architecture
   npm run build
   ```

4. Open a pull request with a short explanation, how you checked it, and screenshots for visible changes.

Keep ride history and location data out of commits. Do not add real riders' GPX files, route logs, API keys, or screenshots that reveal private locations. Test ride and GPX samples are synthetic. The bundled route library is credited in THIRD-PARTY-NOTICES.md; to add routes, open an issue with the source and its permission. The small OpenStreetMap-derived test map is credited separately in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

By submitting a contribution, you agree that it is provided under the project's AGPL-3.0-only license.
