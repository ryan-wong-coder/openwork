import './app/zeno-csp-init';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { bootstrapTheme } from './app/theme';
import { initLocale } from './i18n';
import { ZenoPersonalPage } from './react-app/domains/zeno/personal-page';
import { AppErrorBoundary } from './react-app/shell/app-error-boundary';
import './app/index.css';

document.documentElement.dataset.zenoInterface = 'true';
bootstrapTheme(); initLocale();
const root = document.getElementById('root'); if (!root) throw new Error('无法加载泽诺。');
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
createRoot(root).render(<StrictMode><AppErrorBoundary><QueryClientProvider client={client}><TooltipProvider><ZenoPersonalPage apiBaseUrl="" initialSection={location.pathname.endsWith('/fitness') ? 'fitness' : location.pathname.endsWith('/tasks') ? 'tasks' : location.pathname.endsWith('/account') || location.pathname.endsWith('/device') ? 'account' : 'calendar'} /><Toaster /></TooltipProvider></QueryClientProvider></AppErrorBoundary></StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/app/personal-sw.js', { scope: '/app/' }).catch(() => {});
