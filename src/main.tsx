import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { armFirstInteraction } from './lib/firstInteraction';
import { startPwaRegister } from './lib/pwaRegister';

armFirstInteraction();
startPwaRegister();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
