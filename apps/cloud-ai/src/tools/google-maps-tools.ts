import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { mediaGalleryDir } from '../utils/platform';
import {
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_PRICE_USD_STATIC,
  GOOGLE_MAPS_PRICE_USD_DISTANCE_ELEMENT,
  GOOGLE_MAPS_PRICE_USD_PLACES_SEARCH,
  GOOGLE_MAPS_PRICE_USD_PLACE_DETAILS,
} from '../utils/config';
import { getBridgeSecrets } from './bridge';
import { logUsageEvent } from '../supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Google Maps Platform tools
//
// Backed by a single Google Maps Platform API key (GOOGLE_MAPS_API_KEY) — kept
// separate from the Gemini/Generative-AI key (GOOGLE_API_KEY). Enabled APIs:
//   • Maps Static API        → maps_static_map
//   • Distance Matrix API    → maps_distance_matrix
//   • Places API / (New)     → maps_search_places, maps_place_details
//
// These tools never return a key-bearing URL to the model/client: the static
// map is fetched server-side and surfaced as a saved media file, and Places /
// Distance requests sign with the key header-side or strip it from output.
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_MAPS_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const PLACES_SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_SEARCH_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';

function requireKey(): string {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY configuration');
  }
  return GOOGLE_MAPS_API_KEY;
}

/**
 * Charge the active user for one Maps API call against the credits ledger.
 * Mirrors the X integration: logUsageEvent records a usage_event and debits
 * credits from the explicit costUsd. Best-effort and never blocks the result
 * (a billing hiccup shouldn't fail a successful lookup). The userId comes from
 * the request-scoped bridge secrets, so it works in direct, execute_tool, and
 * run_parallel/run_sequential paths alike.
 */
async function meterMaps(operation: string, costUsd: number): Promise<void> {
  if (!(costUsd > 0)) return;
  try {
    const userId = String((getBridgeSecrets() as any)?.userId || '');
    if (!userId) return; // no authenticated user context — skip metering
    await logUsageEvent(userId, null, `google-maps/${operation}`, {
      costUsd,
      sourceType: 'integration',
      source_label: 'Google Maps',
      operation,
    });
  } catch {
    /* best-effort billing */
  }
}

/** Compact field mask for Places list results — rich enough for company research. */
const PLACES_LIST_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.priceLevel',
  'places.regularOpeningHours.openNow',
  'places.editorialSummary',
].join(',');

/** Fuller field mask for a single place's detail view (adds hours + reviews). */
const PLACE_DETAIL_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'shortFormattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'businessStatus',
  'primaryTypeDisplayName',
  'types',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'googleMapsUri',
  'priceLevel',
  'regularOpeningHours.openNow',
  'regularOpeningHours.weekdayDescriptions',
  'currentOpeningHours.openNow',
  'editorialSummary',
  'reviews.rating',
  'reviews.text',
  'reviews.relativePublishTimeDescription',
  'reviews.authorAttribution.displayName',
].join(',');

/** Strip a Places (New) object down to the fields useful to the LLM. */
function trimPlace(p: any): any {
  if (!p || typeof p !== 'object') return p;
  const out: any = {};
  if (p.id) out.place_id = p.id;
  if (p.displayName?.text) out.name = p.displayName.text;
  else if (typeof p.displayName === 'string') out.name = p.displayName;
  if (p.formattedAddress) out.address = p.formattedAddress;
  if (p.shortFormattedAddress) out.short_address = p.shortFormattedAddress;
  if (p.location) out.location = { lat: p.location.latitude, lng: p.location.longitude };
  if (typeof p.rating === 'number') out.rating = p.rating;
  if (typeof p.userRatingCount === 'number') out.review_count = p.userRatingCount;
  if (p.businessStatus) out.business_status = p.businessStatus;
  if (p.primaryTypeDisplayName?.text) out.category = p.primaryTypeDisplayName.text;
  if (Array.isArray(p.types) && p.types.length) out.types = p.types.slice(0, 6);
  if (p.nationalPhoneNumber) out.phone = p.nationalPhoneNumber;
  else if (p.internationalPhoneNumber) out.phone = p.internationalPhoneNumber;
  if (p.websiteUri) out.website = p.websiteUri;
  if (p.googleMapsUri) out.google_maps_url = p.googleMapsUri;
  if (p.priceLevel) out.price_level = p.priceLevel;
  const openNow = p.regularOpeningHours?.openNow ?? p.currentOpeningHours?.openNow;
  if (typeof openNow === 'boolean') out.open_now = openNow;
  if (Array.isArray(p.regularOpeningHours?.weekdayDescriptions)) {
    out.opening_hours = p.regularOpeningHours.weekdayDescriptions;
  }
  if (p.editorialSummary?.text) out.summary = String(p.editorialSummary.text).slice(0, 500);
  if (Array.isArray(p.reviews) && p.reviews.length) {
    out.reviews = p.reviews.slice(0, 5).map((r: any) => ({
      rating: r.rating,
      text: String(r.text?.text || r.text || '').slice(0, 600),
      author: r.authorAttribution?.displayName,
      when: r.relativePublishTimeDescription,
    }));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// maps_static_map — Maps Static API
// ─────────────────────────────────────────────────────────────────────────────

export const maps_static_map = createTool({
  id: 'maps_static_map',
  description:
    [
      'Render a static map image (Google Maps Static API) and save it to the media gallery so it shows in chat.',
      'Use for "show me a map of X", route overviews, or marking locations.',
      '',
      'Provide either `center` (an address or "lat,lng") with `zoom`, OR one/more `markers` (auto-fits if no center).',
      'Marker syntax follows Google: e.g. "color:red|label:A|Statue of Liberty, NY" or "color:blue|40.7128,-74.0060". Plain addresses also work.',
      'The API key is applied server-side and never included in the returned path.',
    ].join('\n'),
  inputSchema: z.object({
    center: z
      .string()
      .optional()
      .describe('Map center — an address ("Eiffel Tower, Paris") or "lat,lng" ("48.8584,2.2945"). Optional if markers are provided.'),
    zoom: z
      .number()
      .int()
      .min(0)
      .max(21)
      .optional()
      .describe('Zoom level 0 (world) to 21 (building). Typical city ~12, street ~16. Ignored when markers auto-fit.'),
    size: z
      .string()
      .regex(/^\d{1,4}x\d{1,4}$/)
      .default('640x400')
      .optional()
      .describe('Image size as "WIDTHxHEIGHT" in pixels, max 640x640 (default "640x400"). Rendered at scale 2 for retina sharpness.'),
    maptype: z
      .enum(['roadmap', 'satellite', 'terrain', 'hybrid'])
      .default('roadmap')
      .optional()
      .describe('Map style (default "roadmap").'),
    markers: z
      .array(z.string())
      .max(50)
      .optional()
      .describe('Marker specs, each "[style|]location". Style tokens: color:, label:, size:. Location is an address or "lat,lng". Example: "color:red|label:1|Googleplex".'),
    path: z
      .string()
      .optional()
      .describe('Optional path/polyline spec, e.g. "color:0x0000ff|weight:5|40.737,-73.99|40.749,-73.98".'),
    language: z.string().optional().describe('Optional UI language code (e.g. "en", "es").'),
    region: z.string().optional().describe('Optional region bias as a ccTLD code (e.g. "us", "fr").'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    images: z
      .array(
        z.object({
          filePath: z.string(),
          format: z.string(),
          sizeBytes: z.number().optional(),
          _b64: z.string().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const key = requireKey();
    const { center, zoom, size = '640x400', maptype = 'roadmap', markers, path, language, region } = input;

    if (!center && (!Array.isArray(markers) || markers.length === 0) && !path) {
      return { ok: false, error: 'Provide a `center`, at least one `marker`, or a `path`.' };
    }

    const params = new URLSearchParams();
    if (center) params.set('center', center);
    if (typeof zoom === 'number') params.set('zoom', String(zoom));
    params.set('size', size);
    params.set('scale', '2');
    params.set('maptype', maptype);
    if (language) params.set('language', language);
    if (region) params.set('region', region);
    params.set('key', key);
    // URLSearchParams handles single-valued keys; markers/path repeat, so append.
    for (const m of markers || []) params.append('markers', m);
    if (path) params.append('path', path);

    const url = `${STATIC_MAPS_URL}?${params.toString()}`;

    let resp: Response;
    try {
      resp = await fetch(url);
    } catch (e: any) {
      return { ok: false, error: `Static map request failed: ${e?.message || e}` };
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Static Maps API ${resp.status} ${resp.statusText} — ${errText.slice(0, 300)}` };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const b64 = buffer.toString('base64');
    const dir = mediaGalleryDir('maps');
    const fileName = `map_${randomUUID().slice(0, 8)}.png`;
    const filePath = join(dir, fileName);
    try {
      await writeFile(filePath, buffer);
    } catch (e: any) {
      return { ok: false, error: `Failed to save map image: ${e?.message || e}` };
    }

    const images = [{ filePath, format: 'png', sizeBytes: buffer.length, _b64: b64 }];

    // Register in the desktop media library so it renders inline (best-effort).
    try {
      const { execLocalTool } = await import('./bridge');
      const reg: any = await execLocalTool(
        '_media_register',
        {
          images: [{ _b64: b64, format: 'png' }],
          source: 'maps',
          toolName: 'maps_static_map',
          classification: 'Map',
          tags: ['map', 'google-maps'],
          metadata: { center: center || null, maptype },
        },
        undefined,
        30000,
        { silent: true },
      );
      const localPath = String(reg?.items?.[0]?.localPath || '').trim();
      if (reg?.items?.[0]?.ok && localPath) images[0].filePath = localPath;
    } catch {
      /* no bridge (cloud/VM) — filePath already points at the saved file */
    }

    await meterMaps('static_map', GOOGLE_MAPS_PRICE_USD_STATIC);
    console.log('[maps_static_map] center=%j markers=%d %dKB', center ?? null, (markers || []).length, Math.round(buffer.length / 1024));
    return { ok: true, images };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// maps_distance_matrix — Distance Matrix API
// ─────────────────────────────────────────────────────────────────────────────

export const maps_distance_matrix = createTool({
  id: 'maps_distance_matrix',
  description:
    [
      'Compute travel distance and time between origins and destinations (Google Distance Matrix API).',
      'Origins/destinations may be addresses, place names, or "lat,lng". Returns a matrix of distance + duration for every origin→destination pair.',
      'Use for "how far / how long to get from A to B", comparing commute options, or ranking nearby places by travel time.',
    ].join('\n'),
  inputSchema: z.object({
    origins: z
      .array(z.string().min(1))
      .min(1)
      .max(25)
      .describe('Start points — addresses, place names, or "lat,lng" strings.'),
    destinations: z
      .array(z.string().min(1))
      .min(1)
      .max(25)
      .describe('End points — addresses, place names, or "lat,lng" strings.'),
    mode: z
      .enum(['driving', 'walking', 'bicycling', 'transit'])
      .default('driving')
      .optional()
      .describe('Travel mode (default "driving").'),
    units: z
      .enum(['metric', 'imperial'])
      .default('metric')
      .optional()
      .describe('Unit system for the human-readable text (default "metric").'),
    departure_time: z
      .string()
      .optional()
      .describe('Optional departure time for traffic-aware driving/transit: "now" or a Unix epoch in seconds.'),
    avoid: z
      .enum(['tolls', 'highways', 'ferries', 'indoor'])
      .optional()
      .describe('Optional feature to avoid when routing.'),
    language: z.string().optional().describe('Optional language code for the result text.'),
    region: z.string().optional().describe('Optional region bias as a ccTLD code (e.g. "us").'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    origin_addresses: z.array(z.string()).optional(),
    destination_addresses: z.array(z.string()).optional(),
    rows: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const key = requireKey();
    const { origins, destinations, mode = 'driving', units = 'metric', departure_time, avoid, language, region } = input;

    const params = new URLSearchParams();
    params.set('origins', origins.join('|'));
    params.set('destinations', destinations.join('|'));
    params.set('mode', mode);
    params.set('units', units);
    if (departure_time) params.set('departure_time', departure_time);
    if (avoid) params.set('avoid', avoid);
    if (language) params.set('language', language);
    if (region) params.set('region', region);
    params.set('key', key);

    let resp: Response;
    try {
      resp = await fetch(`${DISTANCE_MATRIX_URL}?${params.toString()}`);
    } catch (e: any) {
      return { ok: false, error: `Distance Matrix request failed: ${e?.message || e}` };
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Distance Matrix API ${resp.status} ${resp.statusText} — ${errText.slice(0, 300)}` };
    }

    const data: any = await resp.json();
    if (data.status !== 'OK') {
      return { ok: false, error: `Distance Matrix status ${data.status}${data.error_message ? `: ${data.error_message}` : ''}` };
    }

    const rows = (data.rows || []).map((row: any, i: number) => ({
      origin: data.origin_addresses?.[i],
      elements: (row.elements || []).map((el: any, j: number) => ({
        destination: data.destination_addresses?.[j],
        status: el.status,
        distance_text: el.distance?.text,
        distance_meters: el.distance?.value,
        duration_text: el.duration?.text,
        duration_seconds: el.duration?.value,
        duration_in_traffic_text: el.duration_in_traffic?.text,
      })),
    }));

    const elements = Math.max(1, origins.length * destinations.length);
    await meterMaps('distance_matrix', GOOGLE_MAPS_PRICE_USD_DISTANCE_ELEMENT * elements);
    return {
      ok: true,
      origin_addresses: data.origin_addresses,
      destination_addresses: data.destination_addresses,
      rows,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// maps_search_places — Places API (New): text + nearby search
// ─────────────────────────────────────────────────────────────────────────────

export const maps_search_places = createTool({
  id: 'maps_search_places',
  description:
    [
      'Find businesses / points of interest (Google Places API New) with rich detail per result.',
      'Great for "find <type of company> near me", "best coffee in Austin", or building a list of nearby companies to research.',
      '',
      'Two modes:',
      '- Text search: pass `query` (e.g. "law firms in Chicago", "vegan restaurants near Times Square"). Optionally bias with latitude/longitude/radius_meters.',
      '- Nearby search: pass `latitude`+`longitude`+`radius_meters` and `included_type` (a Google place type like "restaurant", "lawyer", "gym") with no `query`.',
      '',
      'Each result includes name, address, location, rating, review count, phone, website, category, price level, and open-now where available. Use maps_place_details for full hours + reviews on a specific place_id.',
    ].join('\n'),
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Free-text search (text-search mode). Can embed a place, e.g. "dentists in Seattle". Omit to use nearby mode.'),
    latitude: z.number().optional().describe('Latitude for location bias (text mode) or center (nearby mode).'),
    longitude: z.number().optional().describe('Longitude for location bias (text mode) or center (nearby mode).'),
    radius_meters: z
      .number()
      .min(1)
      .max(50000)
      .default(5000)
      .optional()
      .describe('Search radius in meters around the lat/lng (max 50000, default 5000).'),
    included_type: z
      .string()
      .optional()
      .describe('A single Google place type to restrict to (e.g. "restaurant", "lawyer", "hospital"). Required for nearby mode (no query).'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .optional()
      .describe('Number of places to return (1-20, default 10).'),
    open_now: z.boolean().optional().describe('Only return places open now (text mode).'),
    min_rating: z.number().min(0).max(5).optional().describe('Only return places with at least this rating (text mode).'),
    rank_by: z
      .enum(['relevance', 'distance'])
      .optional()
      .describe('Result ranking. "distance" requires a lat/lng. Default is relevance (text) / popularity (nearby).'),
    language: z.string().optional().describe('Optional language code for names/summaries.'),
    region: z.string().optional().describe('Optional region bias as a ccTLD code (e.g. "us").'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    mode: z.string().optional(),
    count: z.number().optional(),
    places: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const key = requireKey();
    const {
      query,
      latitude,
      longitude,
      radius_meters = 5000,
      included_type,
      max_results = 10,
      open_now,
      min_rating,
      rank_by,
      language,
      region,
    } = input;

    const hasLatLng = typeof latitude === 'number' && typeof longitude === 'number';
    const useText = typeof query === 'string' && query.trim().length > 0;

    if (!useText && !hasLatLng) {
      return { ok: false, error: 'Provide either a `query` (text search) or `latitude`+`longitude` (nearby search).' };
    }
    if (!useText && !included_type) {
      return { ok: false, error: 'Nearby search (no query) requires `included_type`, e.g. "restaurant".' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': PLACES_LIST_FIELD_MASK,
    };

    let endpoint: string;
    const body: any = { maxResultCount: max_results };

    if (useText) {
      endpoint = PLACES_SEARCH_TEXT_URL;
      body.textQuery = query.trim();
      if (typeof open_now === 'boolean') body.openNow = open_now;
      if (typeof min_rating === 'number') body.minRating = min_rating;
      if (included_type) body.includedType = included_type;
      if (rank_by) body.rankPreference = rank_by === 'distance' ? 'DISTANCE' : 'RELEVANCE';
      if (hasLatLng) {
        body.locationBias = { circle: { center: { latitude, longitude }, radius: radius_meters } };
      }
      if (language) body.languageCode = language;
      if (region) body.regionCode = region;
    } else {
      endpoint = PLACES_SEARCH_NEARBY_URL;
      body.includedTypes = [included_type];
      body.locationRestriction = { circle: { center: { latitude, longitude }, radius: radius_meters } };
      if (rank_by) body.rankPreference = rank_by === 'distance' ? 'DISTANCE' : 'POPULARITY';
      if (language) body.languageCode = language;
      if (region) body.regionCode = region;
    }

    let resp: Response;
    try {
      resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e: any) {
      return { ok: false, error: `Places request failed: ${e?.message || e}` };
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Places API ${resp.status} ${resp.statusText} — ${errText.slice(0, 400)}` };
    }

    const data: any = await resp.json();
    const places = Array.isArray(data.places) ? data.places.map(trimPlace) : [];
    await meterMaps('search_places', GOOGLE_MAPS_PRICE_USD_PLACES_SEARCH);
    console.log('[maps_search_places] mode=%s query=%j type=%j count=%d', useText ? 'text' : 'nearby', query ?? null, included_type ?? null, places.length);
    return { ok: true, mode: useText ? 'text' : 'nearby', count: places.length, places };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// maps_place_details — Places API (New): full detail for one place
// ─────────────────────────────────────────────────────────────────────────────

export const maps_place_details = createTool({
  id: 'maps_place_details',
  description:
    [
      'Fetch full detail for a single place by its place_id (Google Places API New).',
      'Returns address, phone, website, category, price level, full weekly opening hours, open-now, an editorial summary, and recent reviews.',
      'Get the place_id from maps_search_places results, then call this for the place(s) the user cares about.',
    ].join('\n'),
  inputSchema: z.object({
    place_id: z.string().min(1).describe('The Places (New) place id, e.g. "ChIJ..." returned by maps_search_places.'),
    include_reviews: z.boolean().default(true).optional().describe('Include up to 5 recent reviews (default true).'),
    language: z.string().optional().describe('Optional language code for names/summaries/reviews.'),
    region: z.string().optional().describe('Optional region bias as a ccTLD code (e.g. "us").'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    place: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const key = requireKey();
    const { place_id, include_reviews = true, language, region } = input;

    // Drop review fields from the mask when reviews aren't wanted (cheaper SKU).
    const fieldMask = include_reviews
      ? PLACE_DETAIL_FIELD_MASK
      : PLACE_DETAIL_FIELD_MASK.split(',').filter((f) => !f.startsWith('reviews')).join(',');

    const params = new URLSearchParams();
    if (language) params.set('languageCode', language);
    if (region) params.set('regionCode', region);
    const qs = params.toString();
    const url = `${PLACES_DETAILS_URL}/${encodeURIComponent(place_id)}${qs ? `?${qs}` : ''}`;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
      });
    } catch (e: any) {
      return { ok: false, error: `Place details request failed: ${e?.message || e}` };
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Places API ${resp.status} ${resp.statusText} — ${errText.slice(0, 400)}` };
    }

    const data: any = await resp.json();
    await meterMaps('place_details', GOOGLE_MAPS_PRICE_USD_PLACE_DETAILS);
    return { ok: true, place: trimPlace(data) };
  },
});
