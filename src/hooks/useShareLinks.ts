import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  // Null for every link made since links stopped expiring; a date survives
  // only on legacy rows (see DbShareLink in api/_lib/db.ts).
  expiresAt: string | null;
  revokedAt: string | null;
  // New links are always 'full'. 'allocation_only' links can no longer be
  // created — with allocation_public always true, the plain portfolio URL
  // already gives visitors that view — but older ones still exist.
  mode: 'full' | 'allocation_only';
}

const keyFor = (portfolioId: string) => ['shareLinks', portfolioId.toLowerCase()] as const;

async function fetchShareLinks(portfolioId: string, token: string): Promise<ShareLink[]> {
  const url = new URL(`${API_BASE_URL}/api/share-links`, window.location.origin);
  url.searchParams.set('portfolioId', portfolioId);
  url.searchParams.set('token', token);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error("Couldn't load your links. Close and reopen to try again.");
  const body = (await res.json()) as { links?: ShareLink[] };
  return body.links || [];
}

// The owner's share links. The portfolio page calls this as soon as the owner
// is logged in, so the Share dialog opens with its list already loaded rather
// than growing once the fetch lands.
export function useShareLinks(portfolioId: string | undefined, token: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keyFor(portfolioId ?? ''),
    queryFn: () => fetchShareLinks(portfolioId!, token!),
    enabled: !!portfolioId && !!token && enabled,
    staleTime: 60_000,
    retry: false,
  });
}

// Mutations patch the cached list in place before re-syncing, so the dialog
// never drops back to a loading state after a create or delete.
export function useCreateShareLink(portfolioId: string, token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (label: string | undefined): Promise<ShareLink> => {
      const res = await fetch(`${API_BASE_URL}/api/share-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioId, label, token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Couldn't create the link. Try again.");
      }
      return (await res.json()) as ShareLink;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<ShareLink[]>(keyFor(portfolioId), (old) => [created, ...(old ?? [])]);
      void queryClient.invalidateQueries({ queryKey: keyFor(portfolioId) });
    },
  });
}

export function useDeleteShareLink(portfolioId: string, token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const url = new URL(`${API_BASE_URL}/api/share-links`, window.location.origin);
      url.searchParams.set('id', id);
      url.searchParams.set('portfolioId', portfolioId);
      url.searchParams.set('token', token);
      const res = await fetch(url.toString(), { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Couldn't delete the link. Try again.");
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: keyFor(portfolioId) });
      queryClient.setQueryData<ShareLink[]>(keyFor(portfolioId), (old) => old?.filter((l) => l.id !== id));
    },
    // On failure the refetch brings the link back.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keyFor(portfolioId) });
    },
  });
}
