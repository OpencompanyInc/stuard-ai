import React from 'react';
import {
  Bike,
  Car,
  Clock,
  Footprints,
  Globe,
  MapPin,
  Navigation,
  Phone,
  Star,
  TrainFront,
  type LucideIcon,
} from 'lucide-react';
import { truncatePreviewText } from '../helpers/payload';

// ──────────────────────────────────────────────────────────────────────────────
// Bespoke result cards for the Google Maps tools so the chain-of-thought shows a
// real answer — a route with distance + travel time, a scannable list of places,
// or a rich single-place card — instead of the generic "Origin Addresses: 1 item
// · Rows: 1 item" envelope dump.
//
// Each renderer returns null when the payload isn't the shape it expects so the
// caller falls through to the generic preview.
// ──────────────────────────────────────────────────────────────────────────────

const TRAVEL_MODE_ICON: Record<string, LucideIcon> = {
  driving: Car,
  walking: Footprints,
  bicycling: Bike,
  transit: TrainFront,
};

const CARD_STYLE: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--sidebar-item-hover) 22%, transparent)',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--foreground) 6%, transparent)',
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Drop a long formatted address down to its leading, most identifying part so a
// route card reads "Eiffel Tower, Paris" not the full postal string.
function shortPlace(value: unknown): string {
  const s = str(value);
  if (!s) return '';
  const head = s.split(',').slice(0, 2).join(',').trim();
  return truncatePreviewText(head || s, 44);
}

function MetricPill({
  icon: Icon,
  value,
  tone = 'muted',
  large = false,
}: {
  icon: LucideIcon;
  value: string;
  tone?: 'muted' | 'strong';
  large?: boolean;
}) {
  const size = large ? 14 : 12;
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${large ? 'text-[13px]' : 'text-[12px]'}`}
      style={{ color: tone === 'strong' ? 'var(--foreground)' : 'color-mix(in srgb, var(--foreground) 78%, transparent)' }}
    >
      <Icon style={{ width: size, height: size, opacity: 0.7 }} strokeWidth={2} />
      {value}
    </span>
  );
}

// ── Distance Matrix ─────────────────────────────────────────────────────────

interface MatrixElement {
  destination?: string;
  status?: string;
  distance_text?: string;
  duration_text?: string;
  duration_in_traffic_text?: string;
}
interface MatrixRow {
  origin?: string;
  elements?: MatrixElement[];
}
interface DistanceMatrixResult {
  origin_addresses?: string[];
  destination_addresses?: string[];
  rows?: MatrixRow[];
}

function RouteRow({
  from,
  to,
  el,
  mode,
  prominent,
}: {
  from: string;
  to: string;
  el: MatrixElement;
  mode: string;
  prominent: boolean;
}) {
  const ModeIcon = TRAVEL_MODE_ICON[mode] || Navigation;
  const ok = (el.status || 'OK') === 'OK';
  const traffic = str(el.duration_in_traffic_text);

  return (
    <div className="rounded-xl px-3 py-2.5" style={CARD_STYLE}>
      <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>
        <MapPin style={{ width: 12, height: 12, opacity: 0.6, flexShrink: 0 }} strokeWidth={2} />
        <span className="truncate" title={from}>{shortPlace(from)}</span>
        <span className="shrink-0 opacity-50">→</span>
        <span className="truncate" title={to}>{shortPlace(to)}</span>
      </div>
      {ok ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[18px]">
          {str(el.distance_text) ? <MetricPill icon={ModeIcon} value={el.distance_text!} tone="strong" large={prominent} /> : null}
          {str(el.duration_text) ? <MetricPill icon={Clock} value={el.duration_text!} tone="strong" large={prominent} /> : null}
          {traffic && traffic !== el.duration_text ? (
            <span className="text-[11px]" style={{ color: 'color-mix(in srgb, var(--foreground) 55%, transparent)' }}>
              {traffic} in traffic
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 pl-[18px] text-[11px] text-red-500/90">
          No route found{el.status ? ` (${el.status.toLowerCase().replace(/_/g, ' ')})` : ''}
        </div>
      )}
    </div>
  );
}

export const DistanceMatrixPreview: React.FC<{ result: DistanceMatrixResult; mode?: string }> = ({ result, mode = 'driving' }) => {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (rows.length === 0) return null;

  // Flatten to origin→destination pairs in stable order.
  const pairs: Array<{ from: string; to: string; el: MatrixElement }> = [];
  rows.forEach((row, i) => {
    const from = str(row.origin) || str(result.origin_addresses?.[i]) || 'Origin';
    (row.elements || []).forEach((el, j) => {
      const to = str(el.destination) || str(result.destination_addresses?.[j]) || 'Destination';
      pairs.push({ from, to, el });
    });
  });
  if (pairs.length === 0) return null;

  const LIMIT = 6;
  const shown = pairs.slice(0, LIMIT);

  return (
    <div className="flex flex-col gap-2">
      {shown.map((p, i) => (
        <RouteRow key={`${p.from}-${p.to}-${i}`} from={p.from} to={p.to} el={p.el} mode={mode} prominent={pairs.length === 1} />
      ))}
      {pairs.length > LIMIT ? (
        <span className="text-[10px] text-theme-muted">+{pairs.length - LIMIT} more route{pairs.length - LIMIT === 1 ? '' : 's'}</span>
      ) : null}
    </div>
  );
};

// ── Places (search + details) ───────────────────────────────────────────────

interface Place {
  place_id?: string;
  name?: string;
  address?: string;
  short_address?: string;
  rating?: number;
  review_count?: number;
  business_status?: string;
  category?: string;
  phone?: string;
  website?: string;
  google_maps_url?: string;
  price_level?: string;
  open_now?: boolean;
  opening_hours?: string[];
  summary?: string;
  reviews?: Array<{ rating?: number; text?: string; author?: string; when?: string }>;
}

const PRICE_LEVEL_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

function priceLabel(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  return PRICE_LEVEL_LABEL[s] || (/^\$+$/.test(s) ? s : null);
}

function Rating({ rating, count }: { rating?: number; count?: number }) {
  const r = num(rating);
  if (r === null) return null;
  const c = num(count);
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium" style={{ color: 'color-mix(in srgb, var(--foreground) 82%, transparent)' }}>
      <Star style={{ width: 11, height: 11, fill: '#FBBF24', color: '#FBBF24' }} />
      {r.toFixed(1)}
      {c ? <span className="text-theme-muted">({c.toLocaleString()})</span> : null}
    </span>
  );
}

function OpenBadge({ open }: { open?: boolean }) {
  if (typeof open !== 'boolean') return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
      style={
        open
          ? { background: 'color-mix(in srgb, #22C55E 18%, transparent)', color: '#16A34A' }
          : { background: 'color-mix(in srgb, var(--destructive) 14%, transparent)', color: 'color-mix(in srgb, var(--destructive) 90%, var(--foreground))' }
      }
    >
      {open ? 'Open' : 'Closed'}
    </span>
  );
}

function PlaceLinks({ place }: { place: Place }) {
  const links: Array<{ href: string; label: string; icon: LucideIcon }> = [];
  const site = str(place.website);
  if (site) {
    let host = site;
    try { host = new URL(site).hostname.replace(/^www\./, ''); } catch {}
    links.push({ href: site, label: host, icon: Globe });
  }
  const maps = str(place.google_maps_url);
  if (maps) links.push({ href: maps, label: 'Maps', icon: MapPin });
  if (links.length === 0 && !str(place.phone)) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {str(place.phone) ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-theme-muted">
          <Phone style={{ width: 10, height: 10 }} />
          {place.phone}
        </span>
      ) : null}
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-80"
          style={{ color: 'color-mix(in srgb, var(--primary) 90%, var(--foreground))' }}
          title={l.href}
        >
          <l.icon style={{ width: 10, height: 10 }} />
          {l.label}
        </a>
      ))}
    </div>
  );
}

function PlaceSubline({ place }: { place: Place }) {
  const bits: string[] = [];
  const cat = str(place.category);
  if (cat) bits.push(cat);
  const price = priceLabel(place.price_level);
  if (price) bits.push(price);
  if (bits.length === 0) return null;
  return <span className="truncate text-[11px] text-theme-muted">{bits.join(' · ')}</span>;
}

function PlaceCard({ place, expanded = false }: { place: Place; expanded?: boolean }) {
  const name = str(place.name) || 'Unnamed place';
  const address = str(place.short_address) || str(place.address);
  const summary = str(place.summary);
  const hours = Array.isArray(place.opening_hours) ? place.opening_hours.filter((h) => str(h)) : [];
  const reviews = Array.isArray(place.reviews) ? place.reviews.filter((r) => str(r?.text)) : [];

  return (
    <div className="rounded-xl px-3 py-2.5" style={CARD_STYLE}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-semibold" style={{ color: 'var(--foreground)' }} title={name}>{name}</span>
            <OpenBadge open={place.open_now} />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <PlaceSubline place={place} />
          </div>
        </div>
        <Rating rating={place.rating} count={place.review_count} />
      </div>

      {address ? (
        <div className="mt-1 flex items-start gap-1 text-[11px] text-theme-muted">
          <MapPin style={{ width: 11, height: 11, flexShrink: 0, marginTop: 1, opacity: 0.7 }} />
          <span className="truncate" title={address}>{address}</span>
        </div>
      ) : null}

      {summary ? (
        <div className="mt-1.5 text-[11px] leading-relaxed" style={{ color: 'color-mix(in srgb, var(--foreground) 70%, transparent)' }}>
          {truncatePreviewText(summary, expanded ? 320 : 160)}
        </div>
      ) : null}

      <PlaceLinks place={place} />

      {expanded && hours.length > 0 ? (
        <div className="mt-2 rounded-lg px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, var(--sidebar-item-hover) 30%, transparent)' }}>
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-theme-muted">
            <Clock style={{ width: 10, height: 10 }} /> Hours
          </div>
          <div className="space-y-0.5">
            {hours.map((h, i) => (
              <div key={i} className="text-[10.5px]" style={{ color: 'color-mix(in srgb, var(--foreground) 68%, transparent)' }}>{h}</div>
            ))}
          </div>
        </div>
      ) : null}

      {expanded && reviews.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {reviews.slice(0, 2).map((rev, i) => (
            <div key={i} className="rounded-lg px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, var(--sidebar-item-hover) 30%, transparent)' }}>
              <div className="mb-0.5 flex items-center gap-2">
                <Rating rating={rev.rating} />
                {str(rev.author) ? <span className="truncate text-[10px] text-theme-muted">{rev.author}{str(rev.when) ? ` · ${rev.when}` : ''}</span> : null}
              </div>
              <div className="line-clamp-3 text-[11px] leading-relaxed" style={{ color: 'color-mix(in srgb, var(--foreground) 70%, transparent)' }}>
                {truncatePreviewText(String(rev.text), 260)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const PlacesSearchPreview: React.FC<{ places: Place[] }> = ({ places }) => {
  const list = Array.isArray(places) ? places.filter((p) => p && (str(p.name) || str(p.address))) : [];
  if (list.length === 0) return null;
  const LIMIT = 6;

  return (
    <div className="flex flex-col gap-2">
      {list.slice(0, LIMIT).map((p, i) => (
        <PlaceCard key={p.place_id || `${p.name}-${i}`} place={p} />
      ))}
      {list.length > LIMIT ? (
        <span className="text-[10px] text-theme-muted">+{list.length - LIMIT} more place{list.length - LIMIT === 1 ? '' : 's'}</span>
      ) : null}
    </div>
  );
};

export const PlaceDetailsPreview: React.FC<{ place: Place }> = ({ place }) => {
  if (!place || (!str(place.name) && !str(place.address))) return null;
  return <PlaceCard place={place} expanded />;
};
