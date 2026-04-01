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
    };

    subscriptions: {
      list(args?: Record<string, any>): Promise<PolarListResult<any>>;
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
