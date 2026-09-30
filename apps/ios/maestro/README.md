# iOS Maestro flows

The deterministic iOS flows live at the repo root in [`.maestro/`](../../../.maestro/),
one per ride-critical acceptance mission (M11 plan-and-start, M12 free ride,
M13 record, M14 resume-ride, M16 offline ride). The old
`apps/ios/maestro/plan-and-start.yaml` was moved to
`.maestro/M11-plan-and-start.yaml`; the full per-mission manifests are in
[`acceptance/manifests/`](../../../acceptance/manifests/).

The flows require a booted iOS simulator and a built OpenGravel app. Set
`CAPACITOR_SERVER_URL` during `npm run sync` so the shell loads a reachable
OpenGravel deployment. iOS flows only run on macOS (Xcode + simulator);
the nightly acceptance workflow is planned and is not running yet. See [`acceptance/README.md`](../../../acceptance/README.md).

Run the suite with:

```sh
maestro test .maestro/ --format junit --output maestro-report.xml
```
