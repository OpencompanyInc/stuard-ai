declare module '@polar-sh/sdk' {
  export interface PolarClientOptions {
    accessToken: string;
    server?: string;
  }

  export interface PolarListResult<T = any> {
    result: {
      items: T[];
    };
  }

  export class Polar {
    constructor(options: PolarClientOptions);

    products: {
      list(args?: Record<string, any>): Promise<PolarListResult<any>>;
    };

    customers: {
      list(args?: Record<string, any>): Promise<PolarListResult<any>>;
      getExternal(args: { externalId: string }): Promise<{ id?: string | null } & Record<string, any>>;
    };

    subscriptions: {
      list(args?: Record<string, any>): Promise<PolarListResult<any>>;
      get(args: { id: string } & Record<string, any>): Promise<any>;
      update(args: { id: string; subscriptionUpdate: Record<string, any> } & Record<string, any>): Promise<any>;
      revoke(args: { id: string } & Record<string, any>): Promise<any>;
    };

    orders: {
      list(args?: Record<string, any>): Promise<PolarListResult<any>>;
    };

    checkouts: {
      create(args: Record<string, any>): Promise<{ url?: string | null } & Record<string, any>>;
    };

    customerSessions: {
      create(args: Record<string, any>): Promise<{ customerPortalUrl?: string | null } & Record<string, any>>;
    };
  }
}
