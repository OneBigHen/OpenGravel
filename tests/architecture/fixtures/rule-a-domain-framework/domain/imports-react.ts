import { useState } from "react";

// Fixture: Rule A — a domain module must never reach for a framework runtime.
export const frameworkHook = useState;
