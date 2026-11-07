import { createRoot } from 'react-dom/client';
import { Migrations } from './Migrations';
import '../index.css';
import './site.css';

createRoot(document.getElementById('root')!).render(<Migrations />);
