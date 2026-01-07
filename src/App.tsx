import { useParams, Link } from 'react-router-dom';
import {
  Header,
  TotalValue,
  PerformanceChart,
  HoldingsTable,
  HoldingsByType,
  Footer,
  LoadingSkeleton,
} from './components';
import { usePortfolioData } from './hooks/usePortfolioData';

function App() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { data, isLoading, isHistoryLoading, isRefreshing, error, timeRange, changeTimeRange, refresh } = usePortfolioData(portfolioId || '');

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
    </div>
  );
}

export default App;
