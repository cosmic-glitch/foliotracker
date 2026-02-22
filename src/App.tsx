import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Header,
  TotalValue,
  PerformanceChart,
  HoldingsTable,
  HoldingsByType,
  CapitalGains,
  NewsSection,
  Footer,
  LoadingSkeleton,
  PermissionsModal,
  AIResearchSection,
} from './components';
import { PasswordModal } from './components/PasswordModal';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useUnlockedPortfolios } from './hooks/useUnlockedPortfolios';
import { useLoggedInPortfolio } from './hooks/useLoggedInPortfolio';
import { useViewAnalytics } from './hooks/useAnalytics';
import { loginToPortfolio } from './lib/auth';

function App() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const { unlock, getToken } = useUnlockedPortfolios();
  const { loggedInAs, login, logout, getToken: getLoginToken } = useLoggedInPortfolio();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'holdings' | 'research' | 'news'>('holdings');

  // Get stored token if portfolio was previously unlocked OR if logged in as this portfolio
  const storedToken = portfolioId
    ? (getToken(portfolioId) || (loggedInAs === portfolioId.toLowerCase() ? getLoginToken() : null))
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
  } = usePortfolioData(portfolioId || '', storedToken, loggedInAs);

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
            <TotalValue
              totalValue={data.totalValue}
              dayChange={data.totalDayChange}
              dayChangePercent={data.totalDayChangePercent}
              totalGain={data.totalGain}
              totalGainPercent={data.totalGainPercent}
            />
            <div className="mb-2 md:mb-3">
              <PerformanceChart
                data={data.historicalData}
                isLoading={isHistoryLoading}
                chartView={chartView}
                onViewChange={setChartView}
                currentValue={data.totalValue}
              />
            </div>
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
                {data.deepResearch && (
                  <button
                    onClick={() => setActiveTab('research')}
                    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                      activeTab === 'research'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-text-secondary hover:text-text hover:border-border'
                    }`}
                  >
                    AI Research
                  </button>
                )}
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
              <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-6">
                <div className="flex-1 min-w-0">
                  <HoldingsTable holdings={data.holdings} />
                </div>
                <div className="flex flex-col gap-3 lg:gap-6 lg:w-72 lg:shrink-0">
                  <CapitalGains holdings={data.holdings} />
                  <HoldingsByType holdings={data.holdings} />
                </div>
              </div>
            )}

            {activeTab === 'research' && data.deepResearch && (
              <AIResearchSection
                research={data.deepResearch}
                researchAt={data.deepResearchAt}
              />
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
          token={getLoginToken() || ''}
          onClose={() => setShowPermissionsModal(false)}
        />
      )}

    </div>
  );
}

export default App;
