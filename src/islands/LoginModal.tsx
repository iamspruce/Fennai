import { useState, useEffect } from 'react';
import { AuthService } from '@/lib/firebase/authService';
import { Icon } from '@iconify/react';
import "@/styles/login-modal.css";

export default function LoginModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-login-modal', handleOpen);
    return () => window.removeEventListener('open-login-modal', handleOpen);
  }, []);

  const onClose = () => {
    setIsOpen(false);
    setError('');
  };

  if (!isOpen) return null;

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let userCredential;
      
      if (mode === 'signin') {
        userCredential = await AuthService.signInWithEmail(email, password);
      } else {
        userCredential = await AuthService.signUpWithEmail(email, password);
      }

      // Get ID token from Firebase
      const idToken = await AuthService.getIdToken();
      
      if (!idToken) {
        throw new Error('Failed to get authentication token');
      }

      // Create session cookie on server
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create session');
      }
      
      window.location.href = '/profile';
    } catch (err: any) {
      console.error('Authentication error:', err);
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setLoading(true);

    try {
      const userCredential = await AuthService.signInWithGoogle();
      
      // Get ID token from Firebase
      const idToken = await AuthService.getIdToken();
      
      if (!idToken) {
        throw new Error('Failed to get authentication token');
      }

      // Create session cookie on server
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create session');
      }
      
      window.location.href = '/profile';

    } catch (err: any) {
      console.error('Google sign-in error:', err);
      setError(err.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content auth-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <Icon icon="lucide:sparkles" width={24} height={24} style={{ color: 'var(--pink-9)' }} />
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon icon="lucide:x" width={20} height={20} />
          </button>
        </div>

        <div className="modal-body">
          <h2 className="welcome-text">
            {mode === 'signin' ? 'Welcome back' : 'Get started'}
            <br />
            <span className="highlight">{mode === 'signin' ? 'Sign in to account' : 'Create an account'}</span>
          </h2>

          <form onSubmit={handleEmailAuth} className="auth-form">
            <div className="input-group">
              <label htmlFor="email">Email address</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                disabled={loading}
              />
            </div>

            <div className="input-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                minLength={6}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="error-message">
                <Icon icon="lucide:alert-circle" width={16} height={16} style={{ marginRight: 8 }} />
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? (
                <Icon icon="lucide:loader-2" className="animate-spin" width={20} height={20} />
              ) : (
                mode === 'signin' ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>

          <div className="divider">
            <span>or continue with</span>
          </div>

          <button
            type="button"
            className="btn btn-full btn-social" 
            onClick={handleGoogleAuth}
            disabled={loading}
          >
            <Icon icon="logos:google-icon" width={20} height={20} />
            <span>Google</span>
          </button>

          <p className="toggle-mode">
            {mode === 'signin' ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
              }}
            >
              {mode === 'signin' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}