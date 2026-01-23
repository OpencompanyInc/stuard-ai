import { Polar } from '@polar-sh/sdk'

function sanitizeToken(token: string): string {
    return token
}

export const polar = new Polar({
    accessToken: sanitizeToken(process.env.POLAR_ACCESS_TOKEN || ''),
    server: (String(process.env.POLAR_MODE || '').toLowerCase().startsWith('sand') ? 'sandbox' : 'production')
})
