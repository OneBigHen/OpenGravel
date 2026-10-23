/** Public, device-backed pages that may be opened without a network.
 * The shipped worker's precache list is checked against this contract. */
export const OFFLINE_SHELL_ROUTES = ["/", "/ride", "/rides", "/settings", "/explore"] as const;
