# iOS smoke flow

The Maestro flow requires a booted iOS simulator and a built OpenGravel app. Set `CAPACITOR_SERVER_URL` during `npm run sync` so the shell loads a reachable OpenGravel deployment.

Run the flow with:

```sh
maestro test plan-and-start.yaml
```
