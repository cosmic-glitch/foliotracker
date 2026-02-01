import { FileSearch, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { formatRelativeTime } from '../utils/formatters';

interface AIResearchSectionProps {
  research: string | null;
  researchAt: string | null;
}

export function AIResearchSection({ research, researchAt }: AIResearchSectionProps) {
  if (!research) {
    return (
      <div className="bg-card rounded-2xl border border-border p-8 text-center">
        <FileSearch className="w-12 h-12 text-text-secondary mx-auto mb-4" />
        <h3 className="text-lg font-medium text-text mb-2">Research Report Not Yet Generated</h3>
        <p className="text-text-secondary text-sm">
          A comprehensive AI research report for this portfolio has not been generated yet.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-text">AI Research Report</h2>
        </div>
        {researchAt && (
          <div className="flex items-center gap-1 text-text-secondary text-sm">
            <Clock className="w-4 h-4" />
            <span>Generated {formatRelativeTime(researchAt)}</span>
          </div>
        )}
      </div>
      <div className="p-6 prose prose-sm prose-invert max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-strong:text-text-primary prose-li:text-text-secondary prose-a:text-accent prose-a:no-underline hover:prose-a:underline">
        <ReactMarkdown>{research}</ReactMarkdown>
      </div>
    </div>
  );
}
