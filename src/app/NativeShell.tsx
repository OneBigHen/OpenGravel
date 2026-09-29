"use client";

import { useEffect } from "react";

import { installTapHaptics } from "@/infrastructure/native/native-feel";

/** Native polish for the iOS app; renders nothing and does nothing in a browser. */
export function NativeShell() {
  useEffect(() => installTapHaptics() ?? undefined, []);
  return null;
}
