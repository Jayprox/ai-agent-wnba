import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './wnba-prop-scout.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
