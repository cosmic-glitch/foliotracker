import { useCallback, useEffect, useState } from 'react';
import { Link2, Copy, Trash2, Loader2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface Props {
  portfolioId: string;
  ownerToken: string;
}

function shareUrl(portfolioId: string, token: string): string {
  return `${window.location.origin}/${portfolioId}?share=${token}`;
}

function statusFor(link: ShareLink): { text: string; tone: 'active' | 'revoked' | 'expired' } {
  if (link.revokedAt) return { text: 'Revoked', tone: 'revoked' };
  if (new Date(link.expiresAt) <= new Date()) return { text: 'Expired', tone: 'expired' };
  const ms = new Date(link.expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return { text: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'active' };
}

export function SharePanel({ portfolioId, ownerToken }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [labelInput, setLabelInput] = useState('');
  const [daysInput, setDaysInput] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const url = new URL(`${API_BASE_URL}/api/share-links`, window.location.origin);
      url.searchParams.set('portfolioId', portfolioId);
      url.searchParams.set('token', ownerToken);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load share links');
      const body = await res.json();
      setLinks(body.links || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load share links');
    } finally {
      setLoading(false);
    }
  }, [portfolioId, ownerToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    const days = parseInt(daysInput, 10);
    if (!Number.isInteger(days) || days < 1) {
      setError('Duration must be a positive whole number of days');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE_URL}/api/share-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId,
          durationDays: days,
          label: labelInput.trim() || undefined,
          token: ownerToken,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create share link');
      }
      const created = (await res.json()) as ShareLink;
      const url = shareUrl(portfolioId, created.token);
      try {
        await navigator.clipboard.writeText(url);
        setCopiedId(created.id);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        // Clipboard may be unavailable; ignore.
      }
      setLabelInput('');
      setDaysInput('1');
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(shareUrl(portfolioId, link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  const handleRevoke = async (link: ShareLink) => {
    try {
      const url = new URL(`${API_BASE_URL}/api/share-links`, window.location.origin);
      url.searchParams.set('id', link.id);
      url.searchParams.set('portfolioId', portfolioId);
      url.searchParams.set('token', ownerToken);
      const res = await fetch(url.toString(), { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to revoke');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke share link');
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-4 h-4 text-text-secondary" />
        <h3 className="text-sm font-medium text-text-primary">Share via link</h3>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        Anyone with the link can view this portfolio (read-only) until it expires.
      </p>

      {/* Create form */}
      <div className="space-y-2 mb-4">
        <input
          type="text"
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          placeholder="Label (optional)"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value)}
            className="w-24 bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
          />
          <span className="text-sm text-text-secondary self-center">days</span>
          <button
            type="button"
            onClick={handleCreate}
            disabled={submitting}
            className="ml-auto bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Generate link
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-negative mb-3">{error}</p>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-text-secondary">No share links yet.</p>
      ) : (
        <div className="bg-background rounded-lg border border-border divide-y divide-border">
          {links.map((link) => {
            const status = statusFor(link);
            const isActive = status.tone === 'active';
            return (
              <div key={link.id} className={`flex items-center gap-3 px-3 py-2 ${isActive ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">
                    {link.label || 'Untitled link'}
                  </p>
                  <p className="text-xs text-text-secondary">{status.text}</p>
                </div>
                {isActive && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopy(link)}
                      title="Copy URL"
                      className="p-1 hover:bg-card-hover rounded transition-colors"
                    >
                      <Copy className={`w-4 h-4 ${copiedId === link.id ? 'text-accent' : 'text-text-secondary'}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(link)}
                      title="Revoke"
                      className="p-1 hover:bg-negative/10 hover:text-negative rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-text-secondary hover:text-negative" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
