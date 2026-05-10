import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Header,
  TotalValue,
  PerformanceChart,
  HoldingsTable,
  AllocationView,
  CapitalGains,
  NewsSection,
  NewsTicker,
  Footer,
  LoadingSkeleton,
  PermissionsModal,
  ShareModal,
  AIResearchSection,
} from './components';
import { PasswordModal } from './components/PasswordModal';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useUnlockedPortfolios } from './hooks/useUnlockedPortfolios';
import { useLoggedInPortfolio } from './hooks/useLoggedInPortfolio';
import { useViewAnalytics } from './hooks/useAnalytics';
import { loginToPortfolio } from './lib/auth';
import type { Holding } from './types/portfolio';

// Thought experiment: what would the portfolio be worth if every tradeable
// holding hit its 52-week high? Static holdings and holdings with missing
// 52w data contribute their current value unchanged.
function computePeakPotentialTotal(holdings: Holding[]): number {
  return holdings.reduce((sum, h) => {
    if (h.isStatic || h.week52High == null || h.week52High <= 0) {
      return sum + h.value;
    }
    return sum + h.shares * h.week52High;
  }, 0);
}

function App() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const { unlock, getToken } = useUnlockedPortfolios();
  const { loggedInAs, login, logout, getToken: getLoginToken } = useLoggedInPortfolio();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'holdings' | 'allocation' | 'research' | 'news'>('holdings');

  // Get stored token if portfolio was previously unlocked OR if logged in as this portfolio
  const storedToken = portfolioId
    ? (getToken(portfolioId) || (loggedInAs === portfolioId.toLowerCase() ? getLoginToken() : null))
    : null;

  // Share token from URL — set when someone visits /portfolioId?share=<token>
  const [searchParams] = useSearchParams();
  const shareToken = searchParams.get('share');

  const {
    data,
    isLoading,
    isHistoryLoading,
    isRefreshing,
    error,
    requiresAuth,
    chartView,
    setChartView,
    showExtendedHours,
    refresh,
  } = usePortfolioData(portfolioId || '', storedToken, loggedInAs, shareToken);

  // If the share token was rejected (server returned 401 → React Query threw "Invalid password"),
  // drop the share param from the URL so the normal visibility flow takes over instead of
  // showing the user a stuck "Invalid password" error banner.
  useEffect(() => {
    if (!shareToken) return;
    if (error === 'Invalid password') {
      const url = new URL(window.location.href);
      url.searchParams.delete('share');
      window.location.replace(url.toString());
    }
  }, [shareToken, error]);

  // Allocation-only share viewers see only the Allocation and News tabs.
  // Override the active tab when the stored value points to a hidden tab
  // (default `holdings`, or `research`) — derived rather than via setState
  // in an effect.
  const isAllocationOnly = data?.viewMode === 'allocation_only';
  const effectiveActiveTab = isAllocationOnly && activeTab !== 'allocation' && activeTab !== 'news'
    ? 'allocation'
    : activeTab;

  // Analytics hook - logs views on initial load, tab visibility, and manual refresh
  const { logView } = useViewAnalytics(portfolioId, storedToken, loggedInAs);

  const handleRefresh = () => {
    logView();
    refresh();
  };

  const handleUnlock = async (password: string) => {
    if (!portfolioId) return;

    // Verify password via login endpoint — get token back
    const result = await loginToPortfolio(portfolioId, password);

    // Token received, store it and the hook will refetch
    unlock(portfolioId, result.token, result.expiresAt);
    login(portfolioId, result.token, result.expiresAt);
  };

  const handleEdit = () => {
    if (!portfolioId) return;

    // If we already have a stored token, go directly to edit
    if (storedToken) {
      navigate(`/${portfolioId}/edit`, { state: { token: storedToken } });
    } else {
      // Show password modal
      setShowEditModal(true);
    }
  };

  const handleEditVerify = async (password: string) => {
    if (!portfolioId) return;

    // Verify password via login endpoint — get token back
    const result = await loginToPortfolio(portfolioId, password);

    // Token received, navigate to edit page
    navigate(`/${portfolioId}/edit`, { state: { token: result.token } });
  };

  const handlePermissions = () => {
    if (!portfolioId) return;
    // Only allow permissions if logged in as this portfolio
    if (loggedInAs === portfolioId.toLowerCase()) {
      setShowPermissionsModal(true);
    }
  };

  const handleShare = () => {
    if (!portfolioId) return;
    if (loggedInAs === portfolioId.toLowerCase()) {
      setShowShareModal(true);
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
      <Header
        marketStatus={data?.marketStatus}
        portfolioId={portfolioId}
        loggedInAs={loggedInAs}
        onEdit={handleEdit}
        onPermissions={handlePermissions}
        onShare={handleShare}
        onLogout={handleLogout}
        showEditAndPermissions={loggedInAs === portfolioId?.toLowerCase()}
      />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-3 md:py-6 space-y-3 md:space-y-6">
        {error && (
          <div className="bg-accent/10 border border-accent/20 rounded-lg px-4 py-3 text-accent text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <LoadingSkeleton />
        ) : data ? (
          <>
            {data.staleTickers.length > 0 && (
              <div className="mb-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                Some prices may be outdated — live data unavailable for: {data.staleTickers.join(', ')}
              </div>
            )}
            {isAllocationOnly && (
              <div className="mb-2 px-4 py-2.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-sm">
                This share link shows allocation only — dollar amounts and individual holdings are hidden.
              </div>
            )}
            {!isAllocationOnly && (
              <TotalValue
                totalValue={data.totalValue}
                dayChange={data.totalDayChange}
                dayChangePercent={data.totalDayChangePercent}
                totalGain={data.totalGain}
                totalGainPercent={data.totalGainPercent}
                peakPotentialValue={Math.max(
                  computePeakPotentialTotal(data.holdings),
                  data.totalValue,
                )}
              />
            )}
            <div className="mb-1 md:mb-3">
              <PerformanceChart
                data={data.historicalData}
                isLoading={isHistoryLoading}
                chartView={chartView}
                onViewChange={setChartView}
                currentValue={isAllocationOnly ? undefined : data.totalValue}
                showExtendedHours={showExtendedHours}
                indexed={isAllocationOnly}
              />
            </div>
            <NewsTicker holdings={data.holdings} />
            {/* Tab Navigation */}
            <div className="border-b border-border -mt-2 md:-mt-4">
              <nav className="flex gap-1">
                {!isAllocationOnly && (
                  <button
                    onClick={() => setActiveTab('holdings')}
                    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                      effectiveActiveTab === 'holdings'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                    }`}
                  >
                    Holdings
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('allocation')}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    effectiveActiveTab === 'allocation'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                  }`}
                >
                  Alloc %
                </button>
                {!isAllocationOnly && data.deepResearch && (
                  <button
                    onClick={() => setActiveTab('research')}
                    className={`hidden md:block px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                      effectiveActiveTab === 'research'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                    }`}
                  >
                    Research
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('news')}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    effectiveActiveTab === 'news'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                  }`}
                >
                  News
                </button>
              </nav>
            </div>

            {/* Tab Content */}
            {!isAllocationOnly && effectiveActiveTab === 'holdings' && (
              <div className="space-y-3 md:space-y-6">
                <HoldingsTable holdings={data.holdings} />
                <CapitalGains holdings={data.holdings} />
              </div>
            )}

            {effectiveActiveTab === 'allocation' && (
              <AllocationView holdings={data.holdings} hideValues={isAllocationOnly} />
            )}

            {!isAllocationOnly && effectiveActiveTab === 'research' && data.deepResearch && (
              <AIResearchSection
                research={data.deepResearch}
                researchAt={data.deepResearchAt}
              />
            )}

            {effectiveActiveTab === 'news' && (
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
          portfolioId={portfolioId}
          token={storedToken}
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
          token={getLoginToken() || ''}
          onClose={() => setShowPermissionsModal(false)}
        />
      )}

      {/* Share modal */}
      {showShareModal && portfolioId && loggedInAs === portfolioId.toLowerCase() && (
        <ShareModal
          portfolioId={portfolioId}
          ownerToken={getLoginToken() || ''}
          onClose={() => setShowShareModal(false)}
        />
      )}

    </div>
  );
}

export default App;
