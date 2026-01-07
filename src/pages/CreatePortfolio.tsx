import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TrendingUp, ArrowLeft, Loader2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const EXAMPLE_HOLDINGS = `VUG: 4174.9
VGT: 3323.3
NVDA: 3110.2
META: 2452.0
GOOG: 1895.4
Real Estate: 1526.5
TSM: 893.0
VOO: 605.4
Cash: 187.3`;

export function CreatePortfolio() {
  const navigate = useNavigate();
  const [portfolioId, setPortfolioId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [holdings, setHoldings] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: portfolioId,
          displayName: displayName || undefined,
          password,
          holdings,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create portfolio');
      }

      // Redirect to the new portfolio
      navigate(`/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 hover:bg-card rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-text-secondary" />
            </Link>
            <div className="p-2 bg-accent/10 rounded-lg">
              <TrendingUp className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-xl font-semibold text-text-primary">
              Create Portfolio
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm">
              {error}
            </div>
          )}

          {/* Portfolio ID */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
              Portfolio ID *
            </label>
            <div className="flex items-center gap-2">
              <span className="text-text-secondary">foliotracker.vercel.app/</span>
              <input
                type="text"
                value={portfolioId}
                onChange={(e) => setPortfolioId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="john"
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
                required
                minLength={2}
                maxLength={20}
              />
            </div>
            <p className="text-xs text-text-secondary mt-2">
              2-20 characters, lowercase letters, numbers, and hyphens only
            </p>
          </div>

          {/* Display Name */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
              Display Name (optional)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="John's Portfolio"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              maxLength={50}
            />
          </div>

          {/* Password */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
              Password *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a password to edit later"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              required
              minLength={4}
            />
            <p className="text-xs text-text-secondary mt-2">
              You'll need this password to update your portfolio later
            </p>
          </div>

          {/* Holdings */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
              Holdings *
            </label>
            <textarea
              value={holdings}
              onChange={(e) => setHoldings(e.target.value)}
              placeholder={EXAMPLE_HOLDINGS}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent font-mono text-sm"
              rows={10}
              required
            />
            <p className="text-xs text-text-secondary mt-2">
              Enter each holding on a new line: TICKER: VALUE (in thousands USD)
              <br />
              Non-tradeable assets (like "Real Estate") will be treated as static values.
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating Portfolio...
              </>
            ) : (
              'Create Portfolio'
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
