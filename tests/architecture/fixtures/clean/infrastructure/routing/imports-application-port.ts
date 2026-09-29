import type { RouteProviderPort } from "../../application/routing/ports/route-provider";

// Clean fixture: an application *port* is the only application import a
// provider adapter may make (Rule E whitelist).
export const applicationPort: RouteProviderPort | null = null;
