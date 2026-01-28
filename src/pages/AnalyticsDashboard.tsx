import { useState } from 'react';
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
} from 'lucide-react';
import { Footer } from '../components/Footer';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface AnalyticsData {
  totalViews: number;
  totalLogins: number;
  uniqueVisitors: number;
  todayViews: number;
  todayLogins: number;
  eventsByDay: { date: string; views: number; logins: number }[];
  topLocations: { location: string; count: number }[];
  viewerActivityByDay: {
    viewer_id: string;
    portfolio_id: string;
    dailyCounts: Record<string, number>;
  }[];
  deviceTypes: { device: string; count: number }[];
  viewerDeviceBreakdown: { viewer_id: string; desktop: number; mobile: number }[];
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
          {data.map((row) => (
            <tr key={`${row.viewer_id}-${row.portfolio_id}`} className="border-b border-border last:border-0">
              <td className="py-2 text-text-primary">{row.viewer_id.toUpperCase()}</td>
              <td className="py-2">
                <Link to={`/${row.portfolio_id}`} className="text-accent hover:underline">
                  {row.portfolio_id.toUpperCase()}
                </Link>
              </td>
              {last5Days.map(({ dateStr }) => (
                <td key={dateStr} className="py-2 text-text-secondary text-center">
                  {row.dailyCounts[dateStr] || '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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

function getCountryFlag(country: string): string {
  const flags: Record<string, string> = {
    'United States': '\u{1F1FA}\u{1F1F8}',
    'India': '\u{1F1EE}\u{1F1F3}',
    'United Kingdom': '\u{1F1EC}\u{1F1E7}',
    'Canada': '\u{1F1E8}\u{1F1E6}',
    'Australia': '\u{1F1E6}\u{1F1FA}',
    'Germany': '\u{1F1E9}\u{1F1EA}',
    'France': '\u{1F1EB}\u{1F1F7}',
    'Japan': '\u{1F1EF}\u{1F1F5}',
    'Singapore': '\u{1F1F8}\u{1F1EC}',
    'Brazil': '\u{1F1E7}\u{1F1F7}',
  };
  return flags[country] || '\u{1F310}';
}

export function AnalyticsDashboard() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [days] = useState(30);
  const [storedPassword, setStoredPassword] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', storedPassword, days],
    queryFn: () => fetchAnalytics(storedPassword, days),
    enabled: isAuthenticated && !!storedPassword,
    refetchInterval: 60000, // Refresh every minute
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    try {
      await fetchAnalytics(password, days);
      setStoredPassword(password);
      setIsAuthenticated(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const handleLogout = () => {
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
                label="Total Events"
                value={data.totalViews + data.totalLogins}
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
                label="Events Today"
                value={data.todayViews + data.todayLogins}
                iconColor="bg-amber-500/10 text-amber-500"
              />
            </div>

            {/* Two Column Layout */}
            <div className="grid md:grid-cols-2 gap-8">
              {/* Top Locations */}
              <div className="bg-card rounded-2xl border border-border p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="w-5 h-5 text-text-secondary" />
                  <h2 className="text-lg font-semibold text-text-primary">Top Locations</h2>
                </div>
                {data.topLocations.length > 0 ? (
                  <div className="space-y-3">
                    {data.topLocations.map((loc) => {
                      const percentage = Math.round(
                        (loc.count / (data.totalViews + data.totalLogins)) * 100
                      );
                      // Extract country from "City, Country" format for flag lookup
                      const country = loc.location.split(', ').pop() || '';
                      return (
                        <div key={loc.location} className="flex items-center gap-3">
                          <span className="text-lg">{getCountryFlag(country)}</span>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-text-primary">{loc.location}</span>
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
                  <p className="text-text-secondary text-sm">No location data yet</p>
                )}
              </div>

              {/* Device Types */}
              <div className="bg-card rounded-2xl border border-border p-6">
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
                      {data.viewerDeviceBreakdown.map((row) => (
                        <tr key={row.viewer_id} className="border-b border-border last:border-0">
                          <td className="py-2 pr-4 text-text-primary">{row.viewer_id.toUpperCase()}</td>
                          <td className="text-right py-2 px-4 text-text-secondary">{row.desktop}</td>
                          <td className="text-right py-2 pl-4 text-text-secondary">{row.mobile}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-text-secondary text-sm">No viewer device data yet</p>
              )}
            </div>

            {/* Viewer Activity */}
            <div className="bg-card rounded-2xl border border-border p-6 mt-8">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-text-secondary" />
                <h2 className="text-lg font-semibold text-text-primary">Viewer Activity</h2>
              </div>
              {data.viewerActivityByDay.length > 0 ? (
                <ViewerActivityTable data={data.viewerActivityByDay} />
              ) : (
                <p className="text-text-secondary text-sm">No viewer activity yet</p>
              )}
            </div>
          </>
        ) : null}
      </main>

      <Footer lastUpdated={new Date()} />
    </div>
  );
}
