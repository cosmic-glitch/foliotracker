import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Eye,
  Users,
  CalendarDays,
  Globe,
  ArrowLeft,
  Loader2,
  Lock,
  Monitor,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Footer } from '../components/Footer';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const ADMIN_PASSWORD_STORAGE_KEY = 'foliotracker_analytics_admin_password';

function readStoredAdminPassword(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

interface LocationEntry {
  city: string | null;
  region: string | null;
  country: string | null;
  displayCity: string;
  displayRegion: string;
  displayCountry: string;
}

interface ViewerLocationOccurrence extends LocationEntry {
  count: number;
  lastSeenAt: string;
}

interface ViewerLocationGroup {
  viewer_id: string;
  locations: ViewerLocationOccurrence[];
}

interface LocationDistributionEntry extends LocationEntry {
  uniqueIdentities: number;
  totalViews: number;
}

interface AnalyticsData {
  totalViews: number;
  totalLogins: number;
  uniqueVisitors: number;
  todayViews: number;
  todayLogins: number;
  eventsByDay: { date: string; views: number; logins: number }[];
  viewerLocations: ViewerLocationGroup[];
  anonymousLocations: LocationDistributionEntry[];
  viewerActivityByDay: {
    viewer_id: string;
    portfolio_id: string;
    dailyCounts: Record<string, number>;
  }[];
  anonymousActivityByDay: {
    identity: string;
    label: string;
    portfolio_id: string;
    dailyCounts: Record<string, number>;
  }[];
  deviceTypes: { device: string; count: number }[];
  viewerDeviceBreakdown: { viewer_id: string; desktop: number; mobile: number }[];
}

type LocationGranularity = 'country' | 'region' | 'city';

function granularityKey(entry: LocationEntry, granularity: LocationGranularity): string {
  if (granularity === 'country') return entry.displayCountry;
  if (granularity === 'region') return entry.displayRegion;
  return entry.displayCity;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const sec = diff / 1000;
  if (sec < 60) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.floor(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)}h ago`;
  const day = hr / 24;
  if (day < 7) return `${Math.floor(day)}d ago`;
  const wk = day / 7;
  if (wk < 4) return `${Math.floor(wk)}w ago`;
  const mo = day / 30;
  return `${Math.floor(mo)}mo ago`;
}

async function fetchAnalytics(password: string, days: number): Promise<AnalyticsData> {
  const url = new URL(`${API_BASE_URL}/api/portfolios`, window.location.origin);
  url.searchParams.set('action', 'analytics');
  url.searchParams.set('password', password);
  url.searchParams.set('days', days.toString());

  const response = await fetch(url.toString());
  if (response.status === 401) {
    throw new Error('Invalid admin password');
  }
  if (!response.ok) {
    throw new Error('Failed to fetch analytics');
  }
  return response.json();
}

function StatCard({
  icon: Icon,
  label,
  value,
  iconColor,
}: {
  icon: typeof Eye;
  label: string;
  value: number;
  iconColor: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${iconColor}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-text-primary">{value.toLocaleString()}</p>
          <p className="text-sm text-text-secondary">{label}</p>
        </div>
      </div>
    </div>
  );
}

// Mirrors api/_lib/db.ts: sentinels used when the underlying column is null.
const ANONYMOUS_VIEWER = '(anonymous)';
const LANDING_PORTFOLIO = '(landing)';

function ViewerActivityTable({
  data,
}: {
  data: { viewer_id: string; portfolio_id: string; dailyCounts: Record<string, number> }[];
}) {
  // Generate last 5 days in Pacific timezone (YYYY-MM-DD format for lookup, MMM D for display)
  const last5Days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const displayStr = d.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric'
    });
    return { dateStr, displayStr };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-secondary border-b border-border">
            <th className="pb-2 font-medium">Viewer</th>
            <th className="pb-2 font-medium">Portfolio</th>
            {last5Days.map(({ dateStr, displayStr }) => (
              <th key={dateStr} className="pb-2 font-medium text-center min-w-[60px]">
                {displayStr}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const isAnon = row.viewer_id === ANONYMOUS_VIEWER;
            const isLanding = row.portfolio_id === LANDING_PORTFOLIO;
            return (
              <tr key={`${row.viewer_id}-${row.portfolio_id}`} className="border-b border-border last:border-0">
                <td className="py-2 text-text-primary">
                  {isAnon ? row.viewer_id : row.viewer_id.toUpperCase()}
                </td>
                <td className="py-2">
                  <Link
                    to={isLanding ? '/' : `/${row.portfolio_id}`}
                    className="text-accent hover:underline"
                  >
                    {isLanding ? '/' : `/${row.portfolio_id}`}
                  </Link>
                </td>
                {last5Days.map(({ dateStr }) => (
                  <td key={dateStr} className="py-2 text-text-secondary text-center">
                    {row.dailyCounts[dateStr] || '-'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnonymousActivityTable({
  data,
}: {
  data: { identity: string; label: string; portfolio_id: string; dailyCounts: Record<string, number> }[];
}) {
  const last5Days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const displayStr = d.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
    });
    return { dateStr, displayStr };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-secondary border-b border-border">
            <th className="pb-2 font-medium">Identity</th>
            <th className="pb-2 font-medium">Portfolio</th>
            {last5Days.map(({ dateStr, displayStr }) => (
              <th key={dateStr} className="pb-2 font-medium text-center min-w-[60px]">
                {displayStr}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const isLanding = row.portfolio_id === LANDING_PORTFOLIO;
            return (
              <tr key={`${row.identity}-${row.portfolio_id}`} className="border-b border-border last:border-0">
                <td className="py-2 text-text-primary">{row.label}</td>
                <td className="py-2">
                  <Link
                    to={isLanding ? '/' : `/${row.portfolio_id}`}
                    className="text-accent hover:underline"
                  >
                    {isLanding ? '/' : `/${row.portfolio_id}`}
                  </Link>
                </td>
                {last5Days.map(({ dateStr }) => (
                  <td key={dateStr} className="py-2 text-text-secondary text-center">
                    {row.dailyCounts[dateStr] || '-'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: LocationGranularity;
  onChange: (g: LocationGranularity) => void;
}) {
  const options: { key: LocationGranularity; label: string }[] = [
    { key: 'country', label: 'Country' },
    { key: 'region', label: 'Region' },
    { key: 'city', label: 'City' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 transition-colors ${
            value === opt.key
              ? 'bg-accent text-white'
              : 'bg-background text-text-secondary hover:text-text-primary'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface RolledViewerLocation {
  key: string;
  count: number;
  lastSeenAt: string;
}

interface RolledViewer {
  viewer_id: string;
  locations: RolledViewerLocation[]; // sorted by lastSeenAt desc
  mostRecentLocation: string;
  mostRecentSeenAt: string;
  totalEvents: number;
}

function rollupViewerLocations(
  groups: ViewerLocationGroup[],
  granularity: LocationGranularity
): RolledViewer[] {
  return groups
    .map((group) => {
      const byKey = new Map<string, RolledViewerLocation>();
      for (const loc of group.locations) {
        const key = granularityKey(loc, granularity);
        const existing = byKey.get(key);
        if (existing) {
          existing.count += loc.count;
          if (loc.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = loc.lastSeenAt;
        } else {
          byKey.set(key, { key, count: loc.count, lastSeenAt: loc.lastSeenAt });
        }
      }
      const locations = Array.from(byKey.values()).sort((a, b) =>
        b.lastSeenAt.localeCompare(a.lastSeenAt)
      );
      const totalEvents = locations.reduce((sum, l) => sum + l.count, 0);
      return {
        viewer_id: group.viewer_id,
        locations,
        mostRecentLocation: locations[0]?.key || 'Unknown',
        mostRecentSeenAt: locations[0]?.lastSeenAt || '',
        totalEvents,
      };
    })
    .sort((a, b) => b.mostRecentSeenAt.localeCompare(a.mostRecentSeenAt));
}

function ViewerLocationsTable({ data }: { data: RolledViewer[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (viewerId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(viewerId)) next.delete(viewerId);
      else next.add(viewerId);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-secondary border-b border-border">
            <th className="pb-2 font-medium w-8"></th>
            <th className="pb-2 font-medium">Viewer</th>
            <th className="pb-2 font-medium">Most Recent</th>
            <th className="pb-2 font-medium">Last Seen</th>
            <th className="pb-2 font-medium text-right">Locations</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const isOpen = expanded.has(row.viewer_id);
            const hasMultiple = row.locations.length > 1;
            return (
              <Fragment key={row.viewer_id}>
                <tr
                  className={`border-b border-border last:border-0 ${hasMultiple ? 'cursor-pointer hover:bg-background/50' : ''}`}
                  onClick={() => hasMultiple && toggle(row.viewer_id)}
                >
                  <td className="py-2 text-text-secondary">
                    {hasMultiple ? (
                      isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )
                    ) : null}
                  </td>
                  <td className="py-2 text-text-primary font-medium">
                    {row.viewer_id.toUpperCase()}
                  </td>
                  <td className="py-2 text-text-primary">{row.mostRecentLocation}</td>
                  <td className="py-2 text-text-secondary">
                    {row.mostRecentSeenAt ? formatRelativeTime(row.mostRecentSeenAt) : '—'}
                  </td>
                  <td className="py-2 text-text-secondary text-right">
                    {row.locations.length === 1 ? (
                      <span>1</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs">
                        {row.locations.length}
                      </span>
                    )}
                  </td>
                </tr>
                {isOpen && hasMultiple ? (
                  <tr className="border-b border-border last:border-0 bg-background/30">
                    <td></td>
                    <td colSpan={4} className="py-2 pr-2">
                      <ul className="space-y-1">
                        {row.locations.map((loc) => (
                          <li
                            key={loc.key}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-text-primary">{loc.key}</span>
                            <span className="text-text-secondary">
                              {loc.count} {loc.count === 1 ? 'event' : 'events'} · last{' '}
                              {formatRelativeTime(loc.lastSeenAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RolledAnonLocation {
  key: string;
  uniqueIdentities: number;
  totalViews: number;
}

function rollupAnonymousLocations(
  entries: LocationDistributionEntry[],
  granularity: LocationGranularity
): RolledAnonLocation[] {
  const byKey = new Map<string, RolledAnonLocation>();
  for (const entry of entries) {
    const key = granularityKey(entry, granularity);
    const existing = byKey.get(key);
    if (existing) {
      existing.uniqueIdentities += entry.uniqueIdentities;
      existing.totalViews += entry.totalViews;
    } else {
      byKey.set(key, {
        key,
        uniqueIdentities: entry.uniqueIdentities,
        totalViews: entry.totalViews,
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.uniqueIdentities - a.uniqueIdentities || b.totalViews - a.totalViews
  );
}

const ANON_BAR_PALETTE = [
  'bg-accent',
  'bg-blue-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
];

function AnonymousLocationsPanel({ data }: { data: RolledAnonLocation[] }) {
  const totalIdentities = data.reduce((sum, r) => sum + r.uniqueIdentities, 0);
  const totalViews = data.reduce((sum, r) => sum + r.totalViews, 0);

  // Stacked bar: top 5 locations + "Other" bucket, weighted by uniqueIdentities.
  const top = data.slice(0, 5);
  const otherCount = data.slice(5).reduce((sum, r) => sum + r.uniqueIdentities, 0);
  const barSegments = [
    ...top.map((r, i) => ({
      key: r.key,
      count: r.uniqueIdentities,
      color: ANON_BAR_PALETTE[i % ANON_BAR_PALETTE.length],
    })),
    ...(otherCount > 0
      ? [{ key: 'Other', count: otherCount, color: 'bg-text-secondary/30' }]
      : []),
  ];

  return (
    <div>
      {barSegments.length > 0 && totalIdentities > 0 ? (
        <div className="mb-4">
          <div className="flex h-2 rounded-full overflow-hidden bg-background">
            {barSegments.map((seg) => (
              <div
                key={seg.key}
                className={seg.color}
                style={{ width: `${(seg.count / totalIdentities) * 100}%` }}
                title={`${seg.key}: ${seg.count}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {barSegments.map((seg) => (
              <span key={seg.key} className="inline-flex items-center gap-1.5 text-text-secondary">
                <span className={`w-2 h-2 rounded-sm ${seg.color}`} />
                {seg.key}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-secondary border-b border-border">
              <th className="pb-2 font-medium">Location</th>
              <th className="pb-2 font-medium text-right">Identities</th>
              <th className="pb-2 font-medium text-right">Views</th>
              <th className="pb-2 font-medium text-right">% Identities</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const pct = totalIdentities > 0
                ? Math.round((row.uniqueIdentities / totalIdentities) * 100)
                : 0;
              return (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="py-2 text-text-primary">{row.key}</td>
                  <td className="py-2 text-text-secondary text-right">{row.uniqueIdentities}</td>
                  <td className="py-2 text-text-secondary text-right">{row.totalViews}</td>
                  <td className="py-2 text-text-secondary text-right">{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.length === 0 ? (
          <p className="text-text-secondary text-sm py-4">No anonymous visitors yet</p>
        ) : (
          <p className="text-text-secondary text-xs mt-2">
            {totalIdentities} unique anonymous {totalIdentities === 1 ? 'identity' : 'identities'} ·{' '}
            {totalViews} total {totalViews === 1 ? 'event' : 'events'}
          </p>
        )}
      </div>
    </div>
  );
}

function getDeviceIcon(device: string): string {
  const icons: Record<string, string> = {
    'Desktop': '\u{1F5A5}',
    'Mobile': '\u{1F4F1}',
    'Tablet': '\u{1F4F1}',
    'Unknown': '\u{2753}',
  };
  return icons[device] || '\u{2753}';
}

export function AnalyticsDashboard() {
  const [password, setPassword] = useState('');
  const [storedPassword, setStoredPassword] = useState(() => readStoredAdminPassword());
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!readStoredAdminPassword());
  const [authError, setAuthError] = useState<string | null>(null);
  const [days] = useState(30);
  const [locationGranularity, setLocationGranularity] = useState<LocationGranularity>('country');

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', storedPassword, days],
    queryFn: () => fetchAnalytics(storedPassword, days),
    enabled: isAuthenticated && !!storedPassword,
    refetchInterval: 60000, // Refresh every minute
    retry: false,
  });

  const rolledViewers = useMemo(
    () => (data ? rollupViewerLocations(data.viewerLocations, locationGranularity) : []),
    [data, locationGranularity]
  );
  const rolledAnon = useMemo(
    () => (data ? rollupAnonymousLocations(data.anonymousLocations, locationGranularity) : []),
    [data, locationGranularity]
  );

  // If a persisted password becomes invalid (e.g., ADMIN_PASSWORD changed server-side),
  // drop it and surface the login screen with the error.
  useEffect(() => {
    if (error instanceof Error && error.message === 'Invalid admin password') {
      try { window.localStorage.removeItem(ADMIN_PASSWORD_STORAGE_KEY); } catch { /* ignore */ }
      setStoredPassword('');
      setIsAuthenticated(false);
      setAuthError('Saved password no longer works. Please log in again.');
    }
  }, [error]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    try {
      await fetchAnalytics(password, days);
      try { window.localStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, password); } catch { /* ignore */ }
      setStoredPassword(password);
      setIsAuthenticated(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const handleLogout = () => {
    try { window.localStorage.removeItem(ADMIN_PASSWORD_STORAGE_KEY); } catch { /* ignore */ }
    setIsAuthenticated(false);
    setStoredPassword('');
    setPassword('');
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Lock className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-xl font-semibold text-text-primary">Analytics Dashboard</h1>
          </div>

          <p className="text-text-secondary text-sm mb-6">
            Enter the admin password to view analytics.
          </p>

          <form onSubmit={handleLogin}>
            {authError && (
              <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm mb-4">
                {authError}
              </div>
            )}

            <div className="mb-6">
              <label className="block text-sm font-medium text-text-primary mb-2">
                Admin Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
                required
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <Link
                to="/"
                className="flex-1 bg-background hover:bg-card-hover border border-border text-text-primary font-medium py-2 px-4 rounded-xl transition-colors text-center"
              >
                Back
              </Link>
              <button
                type="submit"
                disabled={!password}
                className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-xl transition-colors"
              >
                Login
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="p-2 hover:bg-background rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-text-secondary" />
              </Link>
              <div className="p-2 bg-accent/10 rounded-lg">
                <TrendingUp className="w-6 h-6 text-accent" />
              </div>
              <h1 className="text-xl font-semibold text-text-primary">Analytics Dashboard</h1>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-text-secondary hover:text-negative transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        ) : error ? (
          <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm">
            {error instanceof Error ? error.message : 'Failed to load analytics'}
          </div>
        ) : data ? (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <StatCard
                icon={Eye}
                label="Total Views"
                value={data.totalViews}
                iconColor="bg-blue-500/10 text-blue-500"
              />
              <StatCard
                icon={Users}
                label="Unique Visitors"
                value={data.uniqueVisitors}
                iconColor="bg-purple-500/10 text-purple-500"
              />
              <StatCard
                icon={CalendarDays}
                label="Views Today"
                value={data.todayViews}
                iconColor="bg-amber-500/10 text-amber-500"
              />
            </div>

            {/* Viewer Activity (Logged In) */}
            <div className="bg-card rounded-2xl border border-border p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-text-secondary" />
                <h2 className="text-lg font-semibold text-text-primary">Viewer Activity (Logged In)</h2>
              </div>
              {data.viewerActivityByDay.length > 0 ? (
                <ViewerActivityTable data={data.viewerActivityByDay} />
              ) : (
                <p className="text-text-secondary text-sm">No logged-in viewer activity yet</p>
              )}
            </div>

            {/* Viewer Activity (Anonymous) */}
            <div className="bg-card rounded-2xl border border-border p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-text-secondary" />
                <h2 className="text-lg font-semibold text-text-primary">Viewer Activity (Anonymous)</h2>
              </div>
              {data.anonymousActivityByDay.length > 0 ? (
                <AnonymousActivityTable data={data.anonymousActivityByDay} />
              ) : (
                <p className="text-text-secondary text-sm">No anonymous viewer activity yet</p>
              )}
            </div>

            {/* Visitor Locations */}
            <div className="bg-card rounded-2xl border border-border p-6 mb-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-text-secondary" />
                  <h2 className="text-lg font-semibold text-text-primary">Visitor Locations</h2>
                </div>
                <GranularityToggle value={locationGranularity} onChange={setLocationGranularity} />
              </div>

              <div className="space-y-8">
                {/* Logged-in viewer locations */}
                <section>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Logged-In Viewers</h3>
                  {rolledViewers.length > 0 ? (
                    <ViewerLocationsTable data={rolledViewers} />
                  ) : (
                    <p className="text-text-secondary text-sm">No logged-in viewer locations yet</p>
                  )}
                </section>

                {/* Anonymous visitor distribution */}
                <section>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Anonymous Visitors</h3>
                  <AnonymousLocationsPanel data={rolledAnon} />
                </section>
              </div>
            </div>

            {/* Device Types */}
            <div className="bg-card rounded-2xl border border-border p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Monitor className="w-5 h-5 text-text-secondary" />
                <h2 className="text-lg font-semibold text-text-primary">Device Types</h2>
              </div>
              {data.deviceTypes.length > 0 ? (
                <div className="space-y-3">
                  {data.deviceTypes.map((item) => {
                    const percentage = Math.round(
                      (item.count / (data.totalViews + data.totalLogins)) * 100
                    );
                    return (
                      <div key={item.device} className="flex items-center gap-3">
                        <span className="text-lg">{getDeviceIcon(item.device)}</span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-text-primary">{item.device}</span>
                            <span className="text-sm text-text-secondary">{percentage}%</span>
                          </div>
                          <div className="h-1.5 bg-background rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent rounded-full"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-text-secondary text-sm">No device data yet</p>
              )}
            </div>

            {/* Viewer Device Breakdown */}
            <div className="bg-card rounded-2xl border border-border p-6 mt-8">
              <div className="flex items-center gap-2 mb-4">
                <Monitor className="w-5 h-5 text-text-secondary" />
                <h2 className="text-lg font-semibold text-text-primary">Viewer Devices</h2>
              </div>
              {data.viewerDeviceBreakdown && data.viewerDeviceBreakdown.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 text-text-secondary font-medium">Viewer</th>
                        <th className="text-right py-2 px-4 text-text-secondary font-medium">🖥️ Desktop</th>
                        <th className="text-right py-2 pl-4 text-text-secondary font-medium">📱 Mobile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.viewerDeviceBreakdown.map((row) => {
                        const isAnon = row.viewer_id === ANONYMOUS_VIEWER;
                        return (
                          <tr key={row.viewer_id} className="border-b border-border last:border-0">
                            <td className="py-2 pr-4 text-text-primary">
                              {isAnon ? row.viewer_id : row.viewer_id.toUpperCase()}
                            </td>
                            <td className="text-right py-2 px-4 text-text-secondary">{row.desktop}</td>
                            <td className="text-right py-2 pl-4 text-text-secondary">{row.mobile}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-text-secondary text-sm">No viewer device data yet</p>
              )}
            </div>

          </>
        ) : null}
      </main>

      <Footer lastUpdated={new Date()} />
    </div>
  );
}
