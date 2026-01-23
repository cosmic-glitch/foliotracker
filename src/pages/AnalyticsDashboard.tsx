import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Eye,
  LogIn,
  Users,
  CalendarDays,
  Globe,
  ArrowLeft,
  Loader2,
  Lock,
} from 'lucide-react';
import { Footer } from '../components/Footer';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface AnalyticsData {
  totalViews: number;
  totalLogins: number;
  uniqueVisitors: number;
  todayViews: number;
  eventsByDay: { date: string; views: number; logins: number }[];
  topPortfolios: { portfolio_id: string; views: number }[];
  topCountries: { country: string; count: number }[];
  recentEvents: {
    event_type: string;
    portfolio_id: string | null;
    viewer_id: string | null;
    country: string | null;
    city: string | null;
    created_at: string;
  }[];
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

function SimpleBarChart({
  data,
  days,
}: {
  data: { date: string; views: number; logins: number }[];
  days: number;
}) {
  // Get last N days of data
  const chartData = data.slice(-days);
  const maxViews = Math.max(...chartData.map((d) => d.views), 1);

  return (
    <div className="h-40 flex items-end gap-1">
      {chartData.map((day) => {
        const height = (day.views / maxViews) * 100;
        const date = new Date(day.date + 'T00:00:00');
        const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        return (
          <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="w-full relative">
              <div
                className="w-full bg-accent/80 rounded-t transition-all hover:bg-accent"
                style={{ height: `${Math.max(height, 4)}%`, minHeight: '4px' }}
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-card border border-border rounded text-xs text-text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                {day.views} views
              </div>
            </div>
            {chartData.length <= 14 && (
              <span className="text-[10px] text-text-secondary truncate w-full text-center">
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
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
  const [days, setDays] = useState(30);
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={Eye}
                label="Total Views"
                value={data.totalViews}
                iconColor="bg-blue-500/10 text-blue-500"
              />
              <StatCard
                icon={LogIn}
                label="Total Logins"
                value={data.totalLogins}
                iconColor="bg-emerald-500/10 text-emerald-500"
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

            {/* Chart */}
            <div className="bg-card rounded-2xl border border-border p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">Views Over Time</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDays(7)}
                    className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                      days === 7
                        ? 'bg-accent text-white'
                        : 'bg-background text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    7D
                  </button>
                  <button
                    onClick={() => setDays(30)}
                    className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                      days === 30
                        ? 'bg-accent text-white'
                        : 'bg-background text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    30D
                  </button>
                </div>
              </div>
              {data.eventsByDay.length > 0 ? (
                <SimpleBarChart data={data.eventsByDay} days={days} />
              ) : (
                <div className="h-40 flex items-center justify-center text-text-secondary">
                  No data available
                </div>
              )}
            </div>

            {/* Two Column Layout */}
            <div className="grid md:grid-cols-2 gap-8">
              {/* Top Locations */}
              <div className="bg-card rounded-2xl border border-border p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="w-5 h-5 text-text-secondary" />
                  <h2 className="text-lg font-semibold text-text-primary">Top Locations</h2>
                </div>
                {data.topCountries.length > 0 ? (
                  <div className="space-y-3">
                    {data.topCountries.map((country) => {
                      const percentage = Math.round(
                        (country.count / (data.totalViews + data.totalLogins)) * 100
                      );
                      return (
                        <div key={country.country} className="flex items-center gap-3">
                          <span className="text-lg">{getCountryFlag(country.country)}</span>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-text-primary">{country.country}</span>
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

              {/* Top Portfolios */}
              <div className="bg-card rounded-2xl border border-border p-6">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-text-secondary" />
                  <h2 className="text-lg font-semibold text-text-primary">Top Portfolios</h2>
                </div>
                {data.topPortfolios.length > 0 ? (
                  <div className="space-y-2">
                    {data.topPortfolios.map((portfolio) => (
                      <div
                        key={portfolio.portfolio_id}
                        className="flex items-center justify-between py-2 border-b border-border last:border-0"
                      >
                        <Link
                          to={`/${portfolio.portfolio_id}`}
                          className="text-accent hover:underline font-medium"
                        >
                          {portfolio.portfolio_id.toUpperCase()}
                        </Link>
                        <span className="text-text-secondary text-sm">
                          {portfolio.views} views
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm">No portfolio data yet</p>
                )}
              </div>
            </div>

            {/* Recent Events */}
            <div className="bg-card rounded-2xl border border-border p-6 mt-8">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Recent Events</h2>
              {data.recentEvents.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-text-secondary border-b border-border">
                        <th className="pb-3 font-medium">Type</th>
                        <th className="pb-3 font-medium">Portfolio</th>
                        <th className="pb-3 font-medium">Viewer</th>
                        <th className="pb-3 font-medium">Location</th>
                        <th className="pb-3 font-medium text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentEvents.map((event, index) => (
                        <tr key={index} className="border-b border-border last:border-0">
                          <td className="py-3">
                            <span
                              className={`px-2 py-1 text-xs rounded-full ${
                                event.event_type === 'login'
                                  ? 'bg-emerald-500/20 text-emerald-500'
                                  : 'bg-blue-500/20 text-blue-500'
                              }`}
                            >
                              {event.event_type}
                            </span>
                          </td>
                          <td className="py-3 text-text-primary">
                            {event.portfolio_id ? (
                              <Link
                                to={`/${event.portfolio_id}`}
                                className="text-accent hover:underline"
                              >
                                {event.portfolio_id.toUpperCase()}
                              </Link>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="py-3 text-text-secondary">
                            {event.viewer_id?.toUpperCase() || '-'}
                          </td>
                          <td className="py-3 text-text-secondary">
                            {event.city && event.country
                              ? `${event.city}, ${event.country}`
                              : event.country || '-'}
                          </td>
                          <td className="py-3 text-text-secondary text-right">
                            {formatTimeAgo(event.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-text-secondary text-sm">No events recorded yet</p>
              )}
            </div>
          </>
        ) : null}
      </main>

      <Footer lastUpdated={new Date()} />
    </div>
  );
}
