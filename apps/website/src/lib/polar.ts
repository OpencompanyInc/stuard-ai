import { Polar } from '@polar-sh/sdk'

/**
 * Polar always runs against production — there is no sandbox path, not even in
 * local dev. (A checkout route that fell back to sandbox while the rest used
 * production caused 401 invalid_token on checkout.) Single source of truth for
 * every Polar client in the app.
 */
export const POLAR_SERVER = 'production' as const

export const polar = new Polar({
    accessToken: (process.env.POLAR_ACCESS_TOKEN || '').trim(),
    server: POLAR_SERVER,
})
