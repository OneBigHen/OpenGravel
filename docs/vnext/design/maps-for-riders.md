# Maps for riders: the interaction contract

Owner brief, 2026-10-25: "taps randomly set locations and pins… I want a better
Google Maps for riders." This contract covers every map surface. A worker who is
unsure about a behaviour does what Google Maps does, then adds what a rider needs.

## §1 The map never edits your ride by itself
- A **plain tap on empty map** only dismisses things: it closes a card or menu and clears the selection. It never adds, moves or removes a point.
- A **tap on a POI, a place pill, a route or a pin** selects it and opens its card.
- **Press and hold** drops a pin and opens the point menu: *Start here · Add stop here · Finish here · Loop from here*. (Wave 1: "Directions to here" replaces "Finish here" when no route exists yet.)
- **Route edits only come from explicit controls**: menu rows, card buttons, armed chips ("Pick on map"), and a held drag of a pin or the route line.
- **Every map-originated edit can be undone** in one tap, including on the first screen.

## §2 Gestures never become taps
A release counts as a tap only when **all** of these hold. Owners: `src/application/map/interaction.ts` and `src/infrastructure/map/maplibre/host.ts`.
- It moved ≤ 10 CSS px from the press, measured over the whole gesture, so a pan that comes back to its start is still a drag.
- It lasted ≤ 350 ms (`TAP_MAX_MS`). A press of 450 ms is a long-press.
- Only one pointer was down during the gesture.
- The camera wasn't moving when it was pressed. A press during a glide only stops the camera.
- It came more than 300 ms after a pinch, rotate or pitch ended (`GESTURE_QUIET_MS`).

On **touch**, a pin only drags after a still hold of 300 ms (`PIN_HOLD_MS`). A quick pan that starts on a pin moves the map. With a mouse or pen, a pin drags straight away.

## §3 Search first (Wave 1)
- A floating search bar sits at the **top** of the home map, with a scrolling row of category chips under it: Gas · Food · Coffee · Lodging · Moto shop · Twisty roads · Gravel.
- Picking a result opens a **place card** (name, distance, drive time), with **Directions**, **Add stop**, **Save** and **Share**.
- **Directions** starts from My location and opens the route options.

## §4 Route options (Wave 1)
- Two or three rows: Fastest · Twistiest · Most gravel.
- Each row shows time, distance and a reason under 6 words.
- One big **Start** button.
- Ride style and avoid settings live together in a single Options sheet.

## §5 One sheet (Wave 1)
- One sheet component with three detents: peek, half and full.
- It's shared by the place card, directions, route options, Explore detail and the ride sheet.
- At half height the map keeps at least 50% of the screen.

## §6 Proof
- `tests/e2e/critical/map-gestures.spec.ts` fuzzes real CDP touch input (pans, pinches, flings, pan-and-return, presses) and asserts the ride is unchanged.
- Rider journeys are counted in taps:
  - Search → Directions → Start: ≤ 4 taps.
  - Twisty loop from here: ≤ 4 taps.
  - Hold → Add stop → Undo.
- Screens are reviewed at 320, 375 and 390 px wide, in Day and Night.
