import { useState, useEffect, useRef } from 'react';
import { AuthService } from '@/lib/firebase/authService';
import { Icon } from '@iconify/react';
import "@/styles/login-modal.css";
import "@/styles/modal.css";

// Simplified error mapping for Passwordless
const getFriendlyErrorMessage = (errorCode: string): string => {
  switch (errorCode) {
    case 'auth/invalid-email':
      return "Please enter a valid email address.";
    case 'auth/too-many-requests':
      return "Too many attempts. Please try again later.";
    case 'auth/network-request-failed':
      return "Network error. Please check your connection.";
    case 'auth/quota-exceeded':
      return "Service temporarily unavailable.";
    default:
      return "An unexpected error occurred. Please try again.";
  }
};

export default function LoginModal() {
  const [isOpen, setIsOpen] = useState(false);

  // UI State
  const [email, setEmail] = useState('');
  const [isEmailSent, setIsEmailSent] = useState(false); // New state to track if link was sent
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Refs
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setError('');
      setIsEmailSent(false); // Reset on open
      setTimeout(() => emailInputRef.current?.focus(), 100);
    };
    window.addEventListener('open-login-modal', handleOpen);
    return () => window.removeEventListener('open-login-modal', handleOpen);
  }, []);

  const onClose = () => {
    setIsOpen(false);
    setError('');
    setIsEmailSent(false);
  };

  // Used for Google Auth only in this file
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
    window.location.href = '/profile';
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const cleanEmail = email.trim();

    try {
      // Send the link
      await AuthService.sendMagicLink(cleanEmail);
      setIsEmailSent(true); // Switch UI to success state
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(getFriendlyErrorMessage(err.code || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setLoading(true);
    try {
      await AuthService.signInWithGoogle();
      await createSession(); // Google login happens immediately, so we create session here
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content auth-modal-content" onClick={(e) => e.stopPropagation()}>

        {/* Mobile Drag Handle */}
        <div className="modal-handle-bar">
          <div className="modal-handle-pill"></div>
        </div>

        <div className="modal-header">
          <div className="modal-title-group">
            <Icon icon="lucide:sparkles" width={20} height={20} style={{ color: 'var(--orange-9)' }} />
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon icon="lucide:x" width={20} height={20} />
          </button>
        </div>

        <div className="modal-body">

          {/* VIEW 1: Success / Email Sent */}
          {isEmailSent ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{
                background: 'var(--green-3)',
                color: 'var(--green-11)',
                width: '60px', height: '60px',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}>
                <Icon icon="lucide:mail-check" width={32} height={32} />
              </div>
              <h2 className="welcome-text" style={{ marginBottom: '8px' }}>Check your email</h2>
              <p style={{ color: 'var(--slate-11)', marginBottom: '24px', fontSize: '15px' }}>
                We sent a sign-in link to <span style={{ color: 'var(--slate-12)', fontWeight: 500 }}>{email}</span>.
                <br />Click the link to complete your login.
              </p>
              <button
                className="btn btn-secondary btn-full"
                onClick={onClose}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setIsEmailSent(false)}
                className="link-button"
                style={{ marginTop: '16px', fontSize: '14px' }}
              >
                Use a different email
              </button>
            </div>
          ) : (

            /* VIEW 2: Input Form */
            <>
              <h2 className="welcome-text">
                Welcome
                <br />
                <span className="highlight">Sign in or create account</span>
              </h2>

              <form onSubmit={handleMagicLinkSubmit} className="auth-form">
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

                {/* Error Messages */}
                {error && (
                  <div className="error-message" role="alert">
                    <Icon icon="lucide:alert-circle" width={16} height={16} style={{ marginRight: 8, flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                  {loading ? (
                    <Icon icon="lucide:loader-2" className="animate-spin" width={20} height={20} />
                  ) : (
                    <>
                      <Icon icon="lucide:mail" width={18} height={18} style={{ marginRight: 8 }} />
                      Continue with Email
                    </>
                  )}
                </button>
              </form>

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
            </>
          )}

        </div>
      </div>
    </div>
  );
}