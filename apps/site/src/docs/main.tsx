import { createRoot } from 'react-dom/client';
import { DocsPage } from './DocsPage';
import '../index.css';
import '../site/site.css';

createRoot(document.getElementById('root')!).render(<DocsPage />);
