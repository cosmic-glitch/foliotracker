import { useState } from 'react';
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

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
    chartView,
    setChartView,
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

  const handleDelete = () => {
    if (!portfolioId) return;

    // If we already have a stored password, show delete modal directly
    // Otherwise show password modal first
    if (storedPassword) {
      setShowDeleteModal(true);
    } else {
      setShowDeleteModal(true);
    }
  };

  const handleDeleteVerify = async (password: string) => {
    if (!portfolioId) return;

    const API_BASE_URL = import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: portfolioId, password }),
    });

    const json = await response.json();

    if (response.status === 401) {
      throw new Error('Invalid password');
    }
    if (!response.ok) {
      throw new Error(json.error || 'Failed to delete portfolio');
    }

    // Successfully deleted, navigate to home
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
      <Header marketStatus={data?.marketStatus} portfolioId={portfolioId} displayName={data?.displayName} onEdit={handleEdit} onDelete={handleDelete} />

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
              isLoading={isHistoryLoading}
              chartView={chartView}
              onViewChange={setChartView}
              currentValue={data.totalValue}
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

      {/* Password modal for deleting */}
      {showDeleteModal && (
        <PasswordModal
          title="Delete Portfolio"
          description={`Are you sure you want to delete "${data?.displayName || portfolioId}"? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDeleteVerify}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}

export default App;
