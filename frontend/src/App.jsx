import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useAuth } from './hooks/useAuth'
import AuthForm from './components/AuthForm'
import NotesList from './components/NotesList'
import DocumentsList from './components/DocumentsList'
import DocumentEditor from './components/DocumentEditor'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const { session, loading } = useAuth()

  // Derived during render — no extra useState needed
  // (rerender-derived-state-no-effect)
  const userId = session?.user?.id ?? null
  const userEmail = session?.user?.email ?? ''

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  if (loading) {
    return <div className="centered-status">Loading…</div>
  }

  // Explicit ternary — prevents falsy 0/NaN rendering (rendering-conditional-render)
  return session !== null ? (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/notes" replace />} />
        <Route path="/notes" element={<NotesList userId={userId} userEmail={userEmail} onSignOut={handleSignOut} />} />
        <Route path="/documents" element={<DocumentsList userId={userId} userEmail={userEmail} onSignOut={handleSignOut} />} />
        <Route path="/documents/:documentId" element={<DocumentEditor userId={userId} userEmail={userEmail} onSignOut={handleSignOut} />} />
        <Route path="*" element={<Navigate to="/notes" replace />} />
      </Routes>
    </BrowserRouter>
  ) : (
    <AuthForm />
  )
}

export default App
