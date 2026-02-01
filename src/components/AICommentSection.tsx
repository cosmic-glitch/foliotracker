import { MessageCircle, type LucideIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { formatRelativeTime } from '../utils/formatters';
import type { AIPersona } from '../types/portfolio';

interface AICommentSectionProps {
  persona: AIPersona;
  title: string;
  icon: LucideIcon;
  iconColor: string;
  comment: string | null;
  commentAt: string | null;
  onOpenChat: () => void;
}

export function AICommentSection({
  title,
  icon: Icon,
  iconColor,
  comment,
  commentAt,
  onOpenChat,
}: AICommentSectionProps) {
  if (!comment) return null;

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Icon className={`w-5 h-5 ${iconColor}`} />
            <span className="text-sm font-medium text-text-secondary">{title}</span>
          </div>
          <div className="text-text-primary prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-strong:text-text-primary">
            <ReactMarkdown>{comment}</ReactMarkdown>
          </div>
          {commentAt && (
            <p className="text-xs text-text-secondary mt-2">
              Generated {formatRelativeTime(commentAt)}
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
