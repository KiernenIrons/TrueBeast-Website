import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'

// Lazy-load all pages for code-splitting
const Home = lazy(() => import('./pages/Home'))
const Tools = lazy(() => import('./pages/Tools'))
const TechSupport = lazy(() => import('./pages/TechSupport'))
const Ticket = lazy(() => import('./pages/Ticket'))
const MyTickets = lazy(() => import('./pages/MyTickets'))
const Giveaways = lazy(() => import('./pages/Giveaways'))
const Games = lazy(() => import('./pages/Games'))
const Admin = lazy(() => import('./pages/Admin'))
const ResumeBuilder = lazy(() => import('./pages/tools/ResumeBuilder'))
const MultiChat = lazy(() => import('./pages/tools/MultiChat'))
const ButtonBoard = lazy(() => import('./pages/tools/ButtonBoard'))
const QRGenerator = lazy(() => import('./pages/tools/QRGenerator'))
const Ripple = lazy(() => import('./pages/tools/Ripple'))
const SocialsRotator = lazy(() => import('./pages/tools/SocialsRotator'))
const CloutClicker = lazy(() => import('./pages/games/CloutClicker'))
const SubmitReview = lazy(() => import('./pages/SubmitReview'))

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="animate-pulse text-white/40 text-lg font-light tracking-wide">
        Loading...
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/tools/resume-builder" element={<ResumeBuilder />} />
        <Route path="/tools/multichat" element={<MultiChat />} />
        <Route path="/tools/buttonboard" element={<ButtonBoard />} />
        <Route path="/tools/qr-generator" element={<QRGenerator />} />
        <Route path="/tools/ripple" element={<Ripple />} />
        <Route path="/tools/socials-rotator" element={<SocialsRotator />} />
        <Route path="/tech-support" element={<TechSupport />} />
        <Route path="/ticket" element={<Ticket />} />
        <Route path="/my-tickets" element={<MyTickets />} />
        <Route path="/submit-review" element={<SubmitReview />} />
        <Route path="/giveaways" element={<Giveaways />} />
        <Route path="/games" element={<Games />} />
        <Route path="/games/clout-clicker" element={<CloutClicker />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Suspense>
  )
}
