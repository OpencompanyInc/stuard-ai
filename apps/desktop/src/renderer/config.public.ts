// Public config safe to ship inside the desktop app bundle
// Replace with your Supabase project values before packaging
export const SUPABASE_URL = "https://mptdemenoyqzyttglrvd.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_G-mV2gtVnux0HvP6Zh6woA_VNfJzIcA";
// Public website auth page that handles Supabase sign-in and broadcasts session to Realtime channel
// TODO: revert to stuard.ai once beta period ends
export const AUTH_PAGE_URL = (import.meta as any).env?.DEV ? "http://localhost:3000/auth" : "https://beta.stuard.ai/auth";
