import "@/styles/globals.css";

import { ThemeProvider as MUIThemeProvider, createTheme, responsiveFontSizes } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import MainLayout from '@components/MainLayout';
import { useRouter } from '@/utils/router';
import { useEffect, useState, createContext, Suspense } from 'react';
import { progressEvents, EventAction } from '@api/ProgressEvents';
import { ComponentRouter } from '@/utils/componentRouter';

let theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: { main: '#7FDBFF', contrastText: '#071018' },
    secondary: { main: '#9BE564' },
    background: { default: '#0B0F14', paper: '#121820' },
    text: { primary: '#F4F7FA', secondary: '#97A6B5' },
    divider: 'rgba(255,255,255,0.08)',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '2.25rem', fontWeight: 700 },
    h2: { fontSize: '1.75rem', fontWeight: 700 },
    h3: { fontSize: '1.5rem', fontWeight: 700 },
    h4: { fontSize: '1.25rem', fontWeight: 700 },
    body1: { fontSize: '1rem' },
    button: { textTransform: 'none' as const, fontWeight: 650 },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(127,219,255,0.08), transparent 32%), radial-gradient(circle at 90% 10%, rgba(155,229,100,0.05), transparent 28%)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10, textTransform: 'none', minHeight: 40 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 18,
          backgroundColor: '#121820',
          backgroundImage: 'none',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: 'linear-gradient(180deg, #10161D 0%, #0B1016 100%)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: { backgroundColor: '#10161D', height: 76 },
      },
    },
  },
});

theme = responsiveFontSizes(theme);

export const ConnectionContext = createContext({
  isConnected: false,
  setIsConnected: (_status: boolean) => { },
});

export default function App() {
  const router = useRouter();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const connectionActions: EventAction[] = [
      { label: "Connected", action: () => setIsConnected(true) },
      { label: "Disconnected", action: () => setIsConnected(false) },
    ];

    progressEvents.runEventActions("AppRoot", connectionActions);
    return () => progressEvents.stop("AppRoot");
  }, []);

  useEffect(() => {
    const restrictedPaths = ['/time', '/alarms', '/events', '/settings', '/reminders', '/ble-lab'];
    if (!isConnected && restrictedPaths.some(path => router.pathname.startsWith(path))) {
      router.push('/');
    }
  }, [isConnected, router]);

  return (
    <ConnectionContext.Provider value={{ isConnected, setIsConnected }}>
      <MUIThemeProvider theme={theme}>
        <CssBaseline />
        <MainLayout>
          <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>}>
            <ComponentRouter pathname={router.pathname} fallback={<div>Page not found</div>} />
          </Suspense>
        </MainLayout>
      </MUIThemeProvider>
    </ConnectionContext.Provider>
  );
}
