import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import AuthForm from './components/AuthForm'
import NotesList from './components/NotesList'
import DocumentsList from './components/DocumentsList'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const { session, loading } = useAuth()

  // 'notes' | 'documents' — which top-level section is active
  const [section, setSection] = useState('notes')

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
    section === 'notes' ? (
      <NotesList
        userId={userId}
        userEmail={userEmail}
        section={section}
        onSectionChange={setSection}
        onSignOut={handleSignOut}
      />
    ) : (
      <DocumentsList
        userId={userId}
        userEmail={userEmail}
        section={section}
        onSectionChange={setSection}
        onSignOut={handleSignOut}
      />
    )
  ) : (
    <AuthForm />
  )
}

export default App
