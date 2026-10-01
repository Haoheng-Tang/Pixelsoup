import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, createDemoDocument } from '../core';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const editor = new Editor(createDemoDocument());

createRoot(container).render(
  <StrictMode>
    <App editor={editor} />
  </StrictMode>,
);
