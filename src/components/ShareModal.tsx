import { useCallback, useEffect, useState } from 'react';
import { X, Link2, Copy, Trash2, Loader2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// New links are always 'full'. 'allocation_only' links can no longer be
// created — with allocation_public always true, anyone without access already
// gets the allocation-only view from the plain portfolio URL, so the mode added
// nothing — but older ones still exist and keep their badge below.
type ShareLinkMode = 'full' | 'allocation_only';

interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  // Null for every link made since links stopped expiring; a date survives
  // only on legacy rows (see DbShareLink in api/_lib/db.ts).
  expiresAt: string | null;
  revokedAt: string | null;
  mode: ShareLinkMode;
}

interface Props {
  portfolioId: string;
  ownerToken: string;
  // Drives the plain-link hint: only non-public portfolios hide dollar values
  // from visitors without access. Undefined while portfolio data loads.
  visibility?: 'public' | 'private' | 'selective';
  onClose: () => void;
}

function shareUrl(portfolioId: string, token: string): string {
  return `${window.location.origin}/${portfolioId}?share=${token}`;
}

function isActive(link: ShareLink): boolean {
  if (link.revokedAt) return false;
  return !link.expiresAt || new Date(link.expiresAt) > new Date();
}

// "Created Nov 6", with the year only when it isn't the current one.
function createdText(createdAt: string): string {
  const d = new Date(createdAt);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return `Created ${d.toLocaleDateString('en-US', opts)}`;
}

export function ShareModal({ portfolioId, ownerToken, visibility, onClose }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [labelInput, setLabelInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [plainCopied, setPlainCopied] = useState(false);
  const plainUrl = `${window.location.origin}/${portfolioId}`;
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const flash = useCallback((message: string) => {
    setFlashMessage(message);
    setTimeout(() => setFlashMessage(null), 2000);
  }, []);

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

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleCreate = async () => {
    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE_URL}/api/share-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId,
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
        flash('Link copied to clipboard');
      } catch {
        flash('Link generated (clipboard unavailable)');
      }
      setLabelInput('');
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
      flash('Link copied to clipboard');
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  const handleCopyPlain = async () => {
    try {
      await navigator.clipboard.writeText(plainUrl);
      setPlainCopied(true);
      setTimeout(() => setPlainCopied(false), 2000);
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
        throw new Error(body.error || 'Failed to delete');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete share link');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card rounded-2xl border border-border max-w-md w-full p-6 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Link2 className="w-5 h-5 text-text-secondary" />
            Share
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-card-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* visibility arrives with the portfolio data; until then only the
            dollar-value section renders, since the plain URL's behavior
            depends on it. */}
        {visibility && (
          <>
            <p className="text-sm text-text-secondary mb-5">
              Share this portfolio in one of two ways:
            </p>

            {/* Percentages only needs no generated link: visitors without
                access to a private/selective portfolio get the allocation-only
                view from the plain URL (api/portfolio.ts). */}
            <section className="mb-5">
              <h4 className="text-sm font-semibold text-text-primary mb-1">1. Percentages only</h4>
              {visibility === 'public' ? (
                <p className="text-sm text-text-secondary">
                  Your portfolio is public, so its link shows dollar values to everyone. To share percentages only, switch it to Private or Selective in Permissions.
                </p>
              ) : (
                <>
                  <p className="text-sm text-text-secondary mb-2">
                    Send your portfolio link. Visitors see allocation percentages, not dollar values, and the link never expires.
                    {visibility === 'selective' && ' Viewers you\'ve invited still see dollar values.'}
                  </p>
                  <div className="flex items-center gap-2 bg-background rounded-lg border border-border px-3 py-2">
                    <a
                      href={plainUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 truncate text-sm text-accent hover:underline"
                    >
                      {plainUrl.replace(/^https?:\/\//, '')}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyPlain}
                      title="Copy URL"
                      className="p-1 hover:bg-card-hover rounded transition-colors"
                    >
                      <Copy className={`w-4 h-4 ${plainCopied ? 'text-accent' : 'text-text-secondary'}`} />
                    </button>
                  </div>
                  <p className="text-xs text-text-secondary mt-1.5">
                    You'll see dollar values because you're logged in; visitors see percentages only.
                  </p>
                </>
              )}
            </section>

            <div className="border-t border-border my-5" />
          </>
        )}

        <section>
          <h4 className="text-sm font-semibold text-text-primary mb-1">
            {visibility ? '2. With dollar values' : 'With dollar values'}
          </h4>
          <p className="text-sm text-text-secondary mb-3">
            Create a read-only link that works until you delete it.
          </p>

          <div className="flex gap-2 items-center relative mb-5">
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Label (optional)"
              className="flex-1 min-w-0 bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting}
              className="bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-2 whitespace-nowrap"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Generate link
            </button>
            {flashMessage && (
              <div className="absolute right-0 top-full mt-1.5 z-10 bg-card border border-accent/40 text-accent text-xs px-3 py-1.5 rounded-lg shadow-lg animate-fade-in pointer-events-none whitespace-nowrap">
                {flashMessage}
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-negative mb-3">{error}</p>
          )}

          <h5 className="text-xs font-medium uppercase tracking-wide text-text-secondary mb-2">Active links</h5>

        {loading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (() => {
          const activeLinks = links.filter(isActive);
          if (activeLinks.length === 0) {
            return <p className="text-sm text-text-secondary">No active links.</p>;
          }
          return (
            <div className="bg-background rounded-lg border border-border divide-y divide-border">
              {activeLinks.map((link) => {
                return (
                  <div key={link.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm text-text-primary truncate">
                          {link.label || 'Untitled link'}
                        </p>
                        {link.mode === 'allocation_only' && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                            Alloc only
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary">{createdText(link.createdAt)}</p>
                    </div>
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
                      title="Delete"
                      className="p-1 hover:bg-negative/10 hover:text-negative rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-text-secondary hover:text-negative" />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}
        </section>
      </div>
    </div>
  );
}
