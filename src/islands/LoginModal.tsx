import { useState, useEffect, useRef } from 'react';
import { AuthService } from '@/lib/firebase/authService';
import { Icon } from '@iconify/react';
import "@/styles/login-modal.css";
import "@/styles/modal.css";

// Production-grade error mapping
const getFriendlyErrorMessage = (errorCode: string): string => {
  switch (errorCode) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return "Invalid email or password.";
    case 'auth/email-already-in-use':
      return "This email is already associated with an account.";
    case 'auth/invalid-email':
      return "Please enter a valid email address.";
    case 'auth/weak-password':
      return "Password should be at least 6 characters.";
    case 'auth/too-many-requests':
      return "Too many failed attempts. Please try again later.";
    case 'auth/network-request-failed':
      return "Network error. Please check your connection.";
    default:
      return "An unexpected error occurred. Please try again.";
  }
};

type AuthMode = 'signin' | 'signup' | 'reset';

export default function LoginModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('signin');

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // UI State
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Refs for focus management
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      // Reset state on open
      setError('');
      setSuccessMessage('');
      setMode('signin');
      setTimeout(() => emailInputRef.current?.focus(), 100);
    };
    window.addEventListener('open-login-modal', handleOpen);
    return () => window.removeEventListener('open-login-modal', handleOpen);
  }, []);

  const onClose = () => {
    setIsOpen(false);
    setError('');
    setSuccessMessage('');
    setPassword('');
    // Don't clear email immediately in case they accidentally closed it
  };

  // Centralized session creation
  const createSession = async () => {
    const idToken = await AuthService.getIdToken();
    if (!idToken) throw new Error('Failed to get authentication token');

    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to create session');
    }

    // Force a hard reload to ensure all server-side session data is recognized
    window.location.href = '/profile';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    const cleanEmail = email.trim(); // Sanitize input

    try {
      if (mode === 'signin') {
        await AuthService.signInWithEmail(cleanEmail, password);
        await createSession();
      } else if (mode === 'signup') {
        await AuthService.signUpWithEmail(cleanEmail, password);
        await createSession();
      } else if (mode === 'reset') {
        await AuthService.sendPasswordResetEmail(cleanEmail);
        setSuccessMessage('Password reset email sent! Check your inbox.');
        setLoading(false); // Stop loading, stay on screen to show success
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      // Use the friendly error mapper
      setError(getFriendlyErrorMessage(err.code || err.message));
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setLoading(true);
    try {
      await AuthService.signInWithGoogle();
      await createSession();
    } catch (err: any) {
      console.error('Google sign-in error:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(getFriendlyErrorMessage(err.code));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Dynamic Title Logic
  const getTitle = () => {
    if (mode === 'reset') return 'Reset Password';
    return mode === 'signin' ? 'Welcome back' : 'Get started';
  };

  const getSubtitle = () => {
    if (mode === 'reset') return 'Enter your email to receive a reset link';
    return mode === 'signin' ? 'Sign in to account' : 'Create an account';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content auth-modal-content" onClick={(e) => e.stopPropagation()}>

        {/* Mobile Drag Handle */}
        <div className="modal-handle-bar">
          <div className="modal-handle-pill"></div>
        </div>

        <div className="modal-header">
          <div className="modal-title-group">
            <Icon icon="lucide:sparkles" width={20} height={20} style={{ color: 'var(--pink-9)' }} />
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon icon="lucide:x" width={20} height={20} />
          </button>
        </div>

        <div className="modal-body">
          <h2 className="welcome-text">
            {getTitle()}
            <br />
            <span className="highlight">{getSubtitle()}</span>
          </h2>

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="input-group">
              <label htmlFor="email">Email address</label>
              <input
                ref={emailInputRef}
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                disabled={loading}
                autoComplete="email"
                style={{ fontSize: '16px' }}
              />
            </div>

            {/* Password input - hidden in reset mode */}
            {mode !== 'reset' && (
              <div className="input-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="password">Password</label>
                  {/* Forgot Password Link */}
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => { setMode('reset'); setError(''); }}
                      style={{
                        background: 'none', border: 'none', color: 'var(--slate-11)',
                        fontSize: '12px', cursor: 'pointer', padding: 0
                      }}
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    minLength={6}
                    disabled={loading}
                    autoComplete={mode === 'signin' ? "current-password" : "new-password"}
                    style={{ fontSize: '16px', paddingRight: '40px' }} // Make room for eye icon
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--slate-9)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <Icon icon={showPassword ? "lucide:eye-off" : "lucide:eye"} width={18} height={18} />
                  </button>
                </div>
              </div>
            )}

            {/* Error & Success Messages */}
            {error && (
              <div className="error-message" role="alert">
                <Icon icon="lucide:alert-circle" width={16} height={16} style={{ marginRight: 8, flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {successMessage && (
              <div className="success-message" role="alert" style={{
                color: 'var(--green-11)', background: 'var(--green-3)',
                padding: '10px', borderRadius: 'var(--radius-sm)',
                fontSize: '14px', display: 'flex', alignItems: 'center', marginBottom: '16px'
              }}>
                <Icon icon="lucide:check-circle" width={16} height={16} style={{ marginRight: 8 }} />
                {successMessage}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? (
                <Icon icon="lucide:loader-2" className="animate-spin" width={20} height={20} />
              ) : (
                // Dynamic Button Label
                mode === 'signin' ? 'Sign In' : (mode === 'signup' ? 'Create Account' : 'Send Reset Link')
              )}
            </button>
          </form>

          {/* Social Auth & Toggles - Hidden during reset to reduce noise */}
          {mode !== 'reset' && (
            <>
              <div className="divider">
                <span>or</span>
              </div>

              <button
                type="button"
                className="btn btn-full btn-social"
                onClick={handleGoogleAuth}
                disabled={loading}
              >
                <Icon icon="logos:google-icon" width={20} height={20} style={{ marginRight: '8px' }} />
                <span>Continue with Google</span>
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
            </>
          )}

          {/* Back button for Reset Mode */}
          {mode === 'reset' && (
            <p className="toggle-mode">
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setMode('signin');
                  setError('');
                  setSuccessMessage('');
                }}
              >
                Back to Sign In
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}