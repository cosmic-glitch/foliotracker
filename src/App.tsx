import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Sparkles, TrendingUp, Brain } from 'lucide-react';
import {
  Header,
  TotalValue,
  PerformanceChart,
  HoldingsTable,
  HoldingsByType,
  NewsSection,
  Footer,
  LoadingSkeleton,
  PermissionsModal,
  AICommentSection,
  ChatModal,
} from './components';
import { PasswordModal } from './components/PasswordModal';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useUnlockedPortfolios } from './hooks/useUnlockedPortfolios';
import { useLoggedInPortfolio } from './hooks/useLoggedInPortfolio';
import { useViewAnalytics } from './hooks/useAnalytics';
import type { AIPersona } from './types/portfolio';

function App() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const { unlock, getPassword } = useUnlockedPortfolios();
  const { loggedInAs, login, logout, getPassword: getLoginPassword } = useLoggedInPortfolio();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [chatModalPersona, setChatModalPersona] = useState<AIPersona | null>(null);
  const [activeTab, setActiveTab] = useState<'holdings' | 'ai' | 'news'>('holdings');

  // Get stored password if portfolio was previously unlocked OR if logged in as this portfolio
  const storedPassword = portfolioId
    ? (getPassword(portfolioId) || (loggedInAs === portfolioId.toLowerCase() ? getLoginPassword() : null))
    : null;

  const {
    data,
    isLoading,
    isHistoryLoading,
    isRefreshing,
    error,
    requiresAuth,
    chartView,
    setChartView,
    refresh,
  } = usePortfolioData(portfolioId || '', storedPassword, loggedInAs);

  // Analytics hook - logs views on initial load, tab visibility, and manual refresh
  const { logView } = useViewAnalytics(portfolioId, storedPassword, loggedInAs);

  const handleRefresh = () => {
    logView();
    refresh();
  };

  const handleUnlock = async (password: string) => {
    if (!portfolioId) return;

    // Verify password by trying to fetch with it
    const API_BASE_URL = import.meta.env.VITE_API_URL || '';
    const url = new URL(`${API_BASE_URL}/api/portfolio`, window.location.origin);
    url.searchParams.set('id', portfolioId);
    url.searchParams.set('password', password);

    const response = await fetch(url.toString());
    if (response.status === 401) {
      throw new Error('Invalid password');
    }
    if (!response.ok) {
      throw new Error('Failed to verify password');
    }

    // Password is valid, store it and the hook will refetch
    unlock(portfolioId, password);
    login(portfolioId, password);
  };

  const handleEdit = () => {
    if (!portfolioId) return;

    // If we already have a stored password, go directly to edit
    if (storedPassword) {
      navigate(`/${portfolioId}/edit`, { state: { password: storedPassword } });
    } else {
      // Show password modal
      setShowEditModal(true);
    }
  };

  const handleEditVerify = async (password: string) => {
    if (!portfolioId) return;

    // Verify password
    const API_BASE_URL = import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: portfolioId, password, holdings: '' }),
    });

    if (response.status === 401) {
      throw new Error('Invalid password');
    }

    // Password verified, navigate to edit page
    navigate(`/${portfolioId}/edit`, { state: { password } });
  };

  const handlePermissions = () => {
    if (!portfolioId) return;
    // Only allow permissions if logged in as this portfolio
    if (loggedInAs === portfolioId.toLowerCase()) {
      setShowPermissionsModal(true);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (!portfolioId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-text-secondary mb-4">No portfolio specified</p>
          <Link to="/" className="text-accent hover:underline">Go to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header marketStatus={data?.marketStatus} portfolioId={portfolioId} loggedInAs={loggedInAs} onEdit={handleEdit} onPermissions={handlePermissions} onLogout={handleLogout} />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 space-y-6">
        {error && (
          <div className="bg-accent/10 border border-accent/20 rounded-lg px-4 py-3 text-accent text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <LoadingSkeleton />
        ) : data ? (
          <>
            <TotalValue
              totalValue={data.totalValue}
              dayChange={data.totalDayChange}
              dayChangePercent={data.totalDayChangePercent}
              totalGain={data.totalGain}
              totalGainPercent={data.totalGainPercent}
              lastUpdated={data.lastUpdated}
            />
            <PerformanceChart
              data={data.historicalData}
              isLoading={isHistoryLoading}
              chartView={chartView}
              onViewChange={setChartView}
              currentValue={data.totalValue}
            />
            {/* Tab Navigation */}
            <div className="border-b border-border">
              <nav className="flex gap-1">
                <button
                  onClick={() => setActiveTab('holdings')}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === 'holdings'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                  }`}
                >
                  Holdings
                </button>
                <button
                  onClick={() => setActiveTab('ai')}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === 'ai'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                  }`}
                >
                  AI Insights
                </button>
                <button
                  onClick={() => setActiveTab('news')}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === 'news'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                  }`}
                >
                  News
                </button>
              </nav>
            </div>

            {/* Tab Content */}
            {activeTab === 'holdings' && (
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 min-w-0">
                  <HoldingsTable holdings={data.holdings} />
                </div>
                <div className="lg:w-72 lg:shrink-0">
                  <HoldingsByType holdings={data.holdings} />
                </div>
              </div>
            )}

            {activeTab === 'ai' && (
              <div className="space-y-4">
                <AICommentSection
                  persona="buffett"
                  title="Buffett AI"
                  icon={TrendingUp}
                  iconColor="text-amber-500"
                  comment={data.buffettComment}
                  commentAt={data.buffettCommentAt}
                  onOpenChat={() => setChatModalPersona('buffett')}
                />
                <AICommentSection
                  persona="munger"
                  title="Munger AI"
                  icon={Brain}
                  iconColor="text-purple-500"
                  comment={data.mungerComment}
                  commentAt={data.mungerCommentAt}
                  onOpenChat={() => setChatModalPersona('munger')}
                />
                <AICommentSection
                  persona="hot-take"
                  title="AI Hot Take"
                  icon={Sparkles}
                  iconColor="text-accent"
                  comment={data.hotTake}
                  commentAt={data.hotTakeAt}
                  onOpenChat={() => setChatModalPersona('hot-take')}
                />
              </div>
            )}

            {activeTab === 'news' && (
              <NewsSection holdings={data.holdings} />
            )}
          </>
        ) : null}
      </main>

      {data && (
        <Footer
          lastUpdated={data.lastUpdated}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
      )}

      {/* Password modal for private portfolios */}
      {requiresAuth && (
        <PasswordModal
          title="Private Portfolio"
          description={`"${portfolioId.toUpperCase()}" is a private portfolio. Enter the password to view details.`}
          confirmLabel="Unlock"
          onConfirm={handleUnlock}
          onCancel={() => navigate('/')}
        />
      )}

      {/* Password modal for editing */}
      {showEditModal && (
        <PasswordModal
          title="Edit Portfolio"
          description="Enter your password to edit this portfolio."
          confirmLabel="Continue"
          onConfirm={handleEditVerify}
          onCancel={() => setShowEditModal(false)}
        />
      )}

      {/* Permissions modal */}
      {showPermissionsModal && portfolioId && loggedInAs === portfolioId.toLowerCase() && (
        <PermissionsModal
          portfolioId={portfolioId}
          password={getLoginPassword() || ''}
          onClose={() => setShowPermissionsModal(false)}
        />
      )}

      {/* Chat modal */}
      {chatModalPersona && portfolioId && (() => {
        const commentMap = {
          'hot-take': data?.hotTake,
          'buffett': data?.buffettComment,
          'munger': data?.mungerComment,
        };
        const comment = commentMap[chatModalPersona];
        if (!comment) return null;
        return (
          <ChatModal
            portfolioId={portfolioId}
            password={storedPassword}
            initialComment={comment}
            persona={chatModalPersona}
            onClose={() => setChatModalPersona(null)}
          />
        );
      })()}
    </div>
  );
}

export default App;
