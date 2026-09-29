export type RouteProviderPort = {
  readonly providerId: string;
  readonly fetchRoute: (requestId: string) => Promise<string>;
};
