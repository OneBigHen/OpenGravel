import { planRoute } from "../application/plan-route";

// Fixture: application depends on domain; the reverse edge is forbidden.
export const planner = planRoute;
