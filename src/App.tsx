import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { t } from './core/strings.de'
import { isConfigured } from './core/supabase'
import { GameLandingPage } from './pages/GameLandingPage'
import { HubPage } from './pages/HubPage'
import { JoinPage } from './pages/JoinPage'
import { RoomPage } from './pages/RoomPage'

export function App() {
  return (
    // Hash routing, so that deep links and QR links work on GitHub Pages.
    <HashRouter>
      {!isConfigured && <p className="banner setup-warning">{t.setupMissing}</p>}
      <Routes>
        <Route path="/" element={<HubPage />} />
        <Route path="/join/:roomCode" element={<JoinPage />} />
        <Route path="/:gameId" element={<GameLandingPage />} />
        <Route path="/:gameId/:roomCode" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
