import { useState } from 'react'
import { supabase } from '../lib/supabase'
import ThemeToggle from './ThemeToggle'

/**
 * Combined login / sign-up form.
 *
 * `isSignup` is derived during render from `mode` state — no useEffect or
 * extra useState needed. (rerender-derived-state-no-effect)
 *
 * All conditionals use explicit ternaries to prevent rendering falsy 0/NaN
 * as text. (rendering-conditional-render)
 */
export default function AuthForm() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  // Derived during render — no state/effect needed
  const isSignup = mode === 'signup'

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    const { error } = isSignup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)

    if (error) {
      setError(error.message)
    } else if (isSignup) {
      setMessage('Check your email to confirm your account.')
    }
    // On successful login, onAuthStateChange in useAuth automatically updates
    // the session — no manual navigation required.
  }

  function toggleMode() {
    setMode(prev => (prev === 'login' ? 'signup' : 'login'))
    setError(null)
    setMessage(null)
  }

  return (
    <div className="auth-container">
      <ThemeToggle className="btn-theme-corner" />
      <div className="auth-card">
        <h1>{isSignup ? 'Create account' : 'Sign in'}</h1>

        {error !== null ? (
          <p className="form-error" role="alert">{error}</p>
        ) : null}

        {message !== null ? (
          <p className="form-message" role="status">{message}</p>
        ) : null}

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            minLength={6}
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button type="button" className="auth-toggle" onClick={toggleMode}>
          {isSignup
            ? 'Already have an account? Sign in'
            : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  )
}
