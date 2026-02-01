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
      {researchAt && (
        <div className="px-6 pt-4 flex justify-end">
          <div className="flex items-center gap-1 text-text-secondary text-sm">
            <Clock className="w-4 h-4" />
            <span>Generated {formatRelativeTime(researchAt)} using OpenAI Deep Research</span>
          </div>
        </div>
      )}
      <div className={`px-6 pb-6 ${researchAt ? 'pt-2' : 'pt-6'} prose prose-sm prose-invert max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-strong:text-text-primary prose-li:text-text-secondary prose-a:text-accent prose-a:no-underline hover:prose-a:underline`}>
        <ReactMarkdown>{research}</ReactMarkdown>
      </div>
    </div>
  );
}
