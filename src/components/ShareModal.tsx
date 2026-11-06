import { useCallback, useEffect, useState } from 'react';
import { X, Link2, Copy, Trash2, Loader2 } from 'lucide-react';
import { useCreateShareLink, useDeleteShareLink, useShareLinks, type ShareLink } from '../hooks/useShareLinks';

interface Props {
  portfolioId: string;
  ownerToken: string;
  // Drives section 1: only non-public portfolios hide dollar values from
  // visitors without access. Undefined while portfolio data loads.
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
  // Same query the portfolio page warms for the owner, so this is normally
  // already populated when the dialog opens.
  const linksQuery = useShareLinks(portfolioId, ownerToken, true);
  const createLink = useCreateShareLink(portfolioId, ownerToken);
  const deleteLink = useDeleteShareLink(portfolioId, ownerToken);

  const [error, setError] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [plainCopied, setPlainCopied] = useState(false);
  const plainUrl = `${window.location.origin}/${portfolioId}`;
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const flash = useCallback((message: string) => {
    setFlashMessage(message);
    setTimeout(() => setFlashMessage(null), 2000);
  }, []);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleCreate = async () => {
    try {
      const created = await createLink.mutateAsync(labelInput.trim() || undefined);
      try {
        await navigator.clipboard.writeText(shareUrl(portfolioId, created.token));
        setCopiedId(created.id);
        setTimeout(() => setCopiedId(null), 2000);
        flash('Link copied to clipboard');
      } catch {
        flash('Link created. Copy it from the list below.');
      }
      setLabelInput('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the link. Try again.");
    }
  };

  const handleCopy = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(shareUrl(portfolioId, link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
      flash('Link copied to clipboard');
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  };

  const handleCopyPlain = async () => {
    try {
      await navigator.clipboard.writeText(plainUrl);
      setPlainCopied(true);
      setTimeout(() => setPlainCopied(false), 2000);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  };

  const handleDelete = async (link: ShareLink) => {
    try {
      await deleteLink.mutateAsync(link.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the link. Try again.");
    }
  };

  const shownError = error ?? (linksQuery.error instanceof Error ? linksQuery.error.message : null);

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

            {/* Sharing without dollar values needs no generated link: visitors
                without access to a private/selective portfolio get the
                allocation-only view from the plain URL (api/portfolio.ts). */}
            <section className="mb-5">
              <h4 className="text-sm font-semibold text-text-primary mb-1">1. Without dollar values</h4>
              {visibility === 'public' ? (
                <p className="text-sm text-text-secondary">
                  Your portfolio is public, so anyone with its address sees dollar values. To share without them, make it Private or Selective in Permissions.
                </p>
              ) : (
                <>
                  <p className="text-sm text-text-secondary mb-2">
                    Send your portfolio's address. Anyone who opens it sees allocation percentages only.
                    {visibility === 'selective' && ' People you\'ve invited in Permissions still see dollar values.'}
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
                      title="Copy link"
                      className="p-1 hover:bg-card-hover rounded transition-colors"
                    >
                      <Copy className={`w-4 h-4 ${plainCopied ? 'text-accent' : 'text-text-secondary'}`} />
                    </button>
                  </div>
                  <p className="text-xs text-text-secondary mt-1.5">
                    Opening it yourself shows dollar values, because you're logged in.
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
            Create a separate link for each person. Anyone with it sees dollar values until you delete it.
          </p>

          <div className="flex gap-2 items-center relative mb-5">
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Who it's for (optional)"
              className="flex-1 min-w-0 bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={createLink.isPending}
              className="bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-2 whitespace-nowrap"
            >
              {createLink.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create link
            </button>
            {flashMessage && (
              <div className="absolute right-0 top-full mt-1.5 z-10 bg-card border border-accent/40 text-accent text-xs px-3 py-1.5 rounded-lg shadow-lg animate-fade-in pointer-events-none whitespace-nowrap">
                {flashMessage}
              </div>
            )}
          </div>

          {shownError && (
            <p className="text-xs text-negative mb-3">{shownError}</p>
          )}

          <h5 className="text-xs font-medium uppercase tracking-wide text-text-secondary mb-2">Your links</h5>

          {linksQuery.isPending && !linksQuery.isError ? (
            // Rare (the page prefetches): two row-height placeholders keep the
            // dialog close to its loaded size so the list doesn't push it open.
            <div className="bg-background rounded-lg border border-border divide-y divide-border" aria-busy="true">
              {[0, 1].map((i) => (
                <div key={i} className="px-3 py-2 space-y-1.5">
                  <div className="h-3.5 w-28 rounded bg-card-hover animate-pulse" />
                  <div className="h-3 w-20 rounded bg-card-hover animate-pulse" />
                </div>
              ))}
            </div>
          ) : (() => {
            const activeLinks = (linksQuery.data ?? []).filter(isActive);
            if (activeLinks.length === 0) {
              return <p className="text-sm text-text-secondary">No links yet.</p>;
            }
            return (
              <div className="bg-background rounded-lg border border-border divide-y divide-border">
                {activeLinks.map((link) => (
                  <div key={link.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm text-text-primary truncate">
                          {link.label || 'Unnamed link'}
                        </p>
                        {link.mode === 'allocation_only' && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                            No dollar values
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary">{createdText(link.createdAt)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(link)}
                      title="Copy link"
                      className="p-1 hover:bg-card-hover rounded transition-colors"
                    >
                      <Copy className={`w-4 h-4 ${copiedId === link.id ? 'text-accent' : 'text-text-secondary'}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(link)}
                      title="Delete"
                      className="p-1 hover:bg-negative/10 hover:text-negative rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-text-secondary hover:text-negative" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </section>
      </div>
    </div>
  );
}
