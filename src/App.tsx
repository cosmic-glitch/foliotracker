import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Header,
  TotalValue,
  PerformanceChart,
  HoldingsTable,
  HoldingsByType,
  Footer,
  LoadingSkeleton,
} from './components';
import { PasswordModal } from './components/PasswordModal';
import { usePortfolioData } from './hooks/usePortfolioData';
import { useUnlockedPortfolios } from './hooks/useUnlockedPortfolios';

function App() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const { unlock, getPassword } = useUnlockedPortfolios();

  // Get stored password if portfolio was previously unlocked
  const storedPassword = portfolioId ? getPassword(portfolioId) : null;

  const {
    data,
    isLoading,
    isHistoryLoading,
    isRefreshing,
    error,
    requiresAuth,
    privateDisplayName,
    timeRange,
    changeTimeRange,
    refresh,
  } = usePortfolioData(portfolioId || '', storedPassword);

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
      <Header marketStatus={data?.marketStatus} portfolioId={portfolioId} displayName={data?.displayName} />

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
              benchmark={data.benchmark}
            />
            <PerformanceChart
              data={data.historicalData}
              benchmarkData={data.benchmarkHistory}
              isLoading={isHistoryLoading}
              timeRange={timeRange}
              onTimeRangeChange={changeTimeRange}
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <HoldingsTable holdings={data.holdings} />
              </div>
              <div className="lg:col-span-1">
                <HoldingsByType holdings={data.holdings} />
              </div>
            </div>
          </>
        ) : null}
      </main>

      {data && (
        <Footer
          lastUpdated={data.lastUpdated}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />
      )}

      {/* Password modal for private portfolios */}
      {requiresAuth && (
        <PasswordModal
          title="Private Portfolio"
          description={`"${privateDisplayName || portfolioId}" is a private portfolio. Enter the password to view details.`}
          confirmLabel="Unlock"
          onConfirm={handleUnlock}
          onCancel={() => navigate('/')}
        />
      )}
    </div>
  );
}

export default App;
