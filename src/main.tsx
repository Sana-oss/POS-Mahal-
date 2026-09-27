import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './components/auth/AuthProvider.tsx';

// Guard against third-party camera scanner lifecycle race conditions
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reasonStr = String(event?.reason || '');
    if (reasonStr.includes('already under transition') || reasonStr.includes('transition to a new state')) {
      event.preventDefault();
      console.debug('Safely suppressed camera transition race condition:', event.reason);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);

