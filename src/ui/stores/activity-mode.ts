import { useSyncExternalStore } from "react";

import { getActivityMode, subscribeActivityMode, type ActivityMode } from "@/application/map/activity-mode";

export { getActivityMode, setActivityMode, subscribeActivityMode, type ActivityMode } from "@/application/map/activity-mode";

export function useActivityMode(): ActivityMode {
  return useSyncExternalStore(subscribeActivityMode, getActivityMode, () => "ride");
}
