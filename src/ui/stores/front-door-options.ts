import { useSyncExternalStore } from "react";

import { getFrontDoorOption, subscribeFrontDoorOptions, type FrontDoorOption } from "@/application/map/front-door-options";

export { getFrontDoorOption, setFrontDoorOption, type FrontDoorOption } from "@/application/map/front-door-options";

/** Whether the rider turned this side feature on in Settings. Off on the server, so hydration agrees. */
export function useFrontDoorOption(option: FrontDoorOption): boolean {
  return useSyncExternalStore(
    subscribeFrontDoorOptions,
    () => getFrontDoorOption(option),
    () => false,
  );
}
