import { Sparkles, MessageCircle } from 'lucide-react';
import { formatRelativeTime } from '../utils/formatters';

interface HotTakeSectionProps {
  hotTake: string | null;
  hotTakeAt: string | null;
  onOpenChat: () => void;
}

export function HotTakeSection({ hotTake, hotTakeAt, onOpenChat }: HotTakeSectionProps) {
  if (!hotTake) return null;

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <span className="text-sm font-medium text-text-secondary">AI Hot Take</span>
          </div>
          <p className="text-text-primary">{hotTake}</p>
          {hotTakeAt && (
            <p className="text-xs text-text-secondary mt-2">
              Generated {formatRelativeTime(hotTakeAt)}
            </p>
          )}
        </div>
        <button
          onClick={onOpenChat}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-xl transition-colors shrink-0"
        >
          <MessageCircle className="w-4 h-4" />
          Chat
        </button>
      </div>
    </div>
  );
}
