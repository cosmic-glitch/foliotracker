import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './pages/LandingPage.tsx'
import { CreatePortfolio } from './pages/CreatePortfolio.tsx'
import { EditPortfolio } from './pages/EditPortfolio.tsx'
import { AnalyticsDashboard } from './pages/AnalyticsDashboard.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/create" element={<CreatePortfolio />} />
              <Route path="/analytics" element={<AnalyticsDashboard />} />
              <Route path="/:portfolioId/edit" element={<EditPortfolio />} />
              <Route path="/:portfolioId" element={<App />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
)
