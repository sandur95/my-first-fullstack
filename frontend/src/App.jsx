import { useAuth } from './hooks/useAuth'
import AuthForm from './components/AuthForm'
import NotesList from './components/NotesList'
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
    <NotesList userId={userId} userEmail={userEmail} onSignOut={handleSignOut} />
  ) : (
    <AuthForm />
  )
}

export default App
