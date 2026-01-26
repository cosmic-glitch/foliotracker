import { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface ChatModalProps {
  portfolioId: string;
  password: string | null;
  hotTake: string;
  onClose: () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export function ChatModal({ portfolioId, password, hotTake, onClose }: ChatModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remainingMessages, setRemainingMessages] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch chat history on mount
  useEffect(() => {
    fetchChatHistory();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    if (!isFetching) {
      inputRef.current?.focus();
    }
  }, [isFetching]);

  const fetchChatHistory = async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/portfolio?id=${portfolioId}&action=chat`
      );
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Failed to fetch chat history:', err);
    } finally {
      setIsFetching(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMessage, created_at: new Date().toISOString() },
    ]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/portfolio?id=${portfolioId}&action=chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMessage, password }),
        }
      );

      if (response.status === 429) {
        const data = await response.json();
        setError(data.message);
        // Remove the user message we just added since it wasn't actually sent
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to send message');
      }

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response, created_at: new Date().toISOString() },
      ]);
      setRemainingMessages(data.remainingMessages);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
      setError(errorMsg);
      // Remove the user message we just added
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const resetChat = async () => {
    if (!password) {
      setError('Password required to reset chat');
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/portfolio?id=${portfolioId}&action=chat`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        }
      );

      if (response.ok) {
        setMessages([]);
        setError(null);
        setRemainingMessages(null);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to reset chat');
      }
    } catch (err) {
      setError('Failed to reset chat');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-lg h-[600px] max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-text-primary">Chat with AI</h2>
          <div className="flex items-center gap-2">
            {password && (
              <button
                onClick={resetChat}
                className="flex items-center gap-1 text-sm text-text-secondary hover:text-negative transition-colors"
                title="Reset chat"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 hover:bg-background rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Show hot take as first message */}
          <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
            <p className="text-xs text-accent font-medium mb-1">AI Hot Take</p>
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-strong:text-text-primary">
              <ReactMarkdown>{hotTake}</ReactMarkdown>
            </div>
          </div>

          {isFetching ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-text-secondary" />
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.role === 'user'
                        ? 'bg-accent text-white'
                        : 'bg-background border border-border text-text-primary'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-strong:text-text-primary">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-background border border-border rounded-lg p-3">
                    <Loader2 className="w-4 h-4 animate-spin text-text-secondary" />
                  </div>
                </div>
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Rate limit warning */}
        {remainingMessages !== null && remainingMessages <= 3 && (
          <div className="mx-4 mb-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-yellow-600 dark:text-yellow-400 text-xs">
            {remainingMessages === 0
              ? 'Daily limit reached. Try again tomorrow!'
              : `${remainingMessages} message${remainingMessages === 1 ? '' : 's'} remaining today`}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 bg-negative/10 border border-negative/20 rounded-lg px-3 py-2 text-negative text-sm">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this portfolio..."
              disabled={isLoading || remainingMessages === 0}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading || remainingMessages === 0}
              className="bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
