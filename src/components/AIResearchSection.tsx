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
    <div className="bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
      {researchAt && (
        <div className="px-6 pt-4 flex justify-end">
          <div className="flex items-center gap-1 text-slate-500 text-sm">
            <Clock className="w-4 h-4" />
            <span>Generated {formatRelativeTime(researchAt)} using OpenAI Deep Research</span>
          </div>
        </div>
      )}
      <div className={`px-6 pb-6 ${researchAt ? 'pt-2' : 'pt-6'} prose prose-sm max-w-none prose-headings:text-slate-900 prose-p:text-slate-700 prose-strong:text-slate-900 prose-li:text-slate-700 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline`}>
        <ReactMarkdown>{research}</ReactMarkdown>
      </div>
    </div>
  );
}
