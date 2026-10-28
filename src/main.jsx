import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/600.css';
import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
