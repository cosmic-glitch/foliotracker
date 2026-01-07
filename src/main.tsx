import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './pages/LandingPage.tsx'
import { CreatePortfolio } from './pages/CreatePortfolio.tsx'
import { EditPortfolio } from './pages/EditPortfolio.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/create" element={<CreatePortfolio />} />
        <Route path="/:portfolioId/edit" element={<EditPortfolio />} />
        <Route path="/:portfolioId" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
