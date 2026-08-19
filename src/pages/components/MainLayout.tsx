import React, { ReactNode, useContext } from 'react';
import { useRouter } from '@/utils/router';
import {
    Box,
    BottomNavigation,
    BottomNavigationAction,
    Paper,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import TimeIcon from '@mui/icons-material/AccessTime';
import AlarmsIcon from '@mui/icons-material/Alarm';
import CalendarIcon from '@mui/icons-material/CalendarMonth';
import SettingsIcon from '@mui/icons-material/Settings';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import SideNavigation, { SIDEBAR_WIDTH } from './SideNavigation';
import { ConnectionContext } from '@/App';
import { watchInfo } from '@api/WatchInfo';
import pkg from '../../../package.json';

interface MainLayoutProps { children: ReactNode; }

const NAV_ITEMS = [
    { label: 'Time', icon: <TimeIcon />, path: '/time/Time' },
    { label: 'Alarms', icon: <AlarmsIcon />, path: '/alarms/Alarms' },
    { label: 'Events', icon: <CalendarIcon />, path: '/reminders/Reminders' },
    { label: 'Settings', icon: <SettingsIcon />, path: '/settings/Settings' },
    { label: 'BLE Lab', icon: <ScienceRoundedIcon />, path: '/ble-lab' },
];

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    const router = useRouter();
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
    const { isConnected } = useContext(ConnectionContext);
    const visibleItems = React.useMemo(() => {
        if (isConnected && !watchInfo.hasReminders) {
            return NAV_ITEMS.filter(item => item.label !== 'Events');
        }
        return NAV_ITEMS;
    }, [isConnected]);

    const currentTabIndex = Math.max(0, visibleItems.findIndex(item => item.path === router.pathname));

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
            {isDesktop && <SideNavigation />}

            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    height: { xs: '100dvh', md: '100vh' },
                    ml: { xs: 0, md: `${SIDEBAR_WIDTH}px` },
                    pb: { xs: '84px', md: 0 },
                    overflow: 'hidden',
                    minHeight: 0,
                }}
            >
                {children}
            </Box>

            {!isDesktop && (
                <Paper
                    elevation={0}
                    sx={{
                        position: 'fixed',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        zIndex: 1200,
                        borderRadius: 0,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                    }}
                >
                    <BottomNavigation
                        showLabels
                        value={currentTabIndex}
                        onChange={(_, newValue) => {
                            if (isConnected && visibleItems[newValue]) router.push(visibleItems[newValue].path);
                        }}
                    >
                        {visibleItems.map(item => (
                            <BottomNavigationAction
                                key={item.path}
                                label={item.label}
                                disabled={!isConnected}
                                icon={item.icon}
                                sx={{
                                    minWidth: 0,
                                    '& .MuiBottomNavigationAction-label': { fontSize: '0.68rem' },
                                }}
                            />
                        ))}
                    </BottomNavigation>
                </Paper>
            )}

            <Typography
                variant="caption"
                sx={{
                    position: 'fixed',
                    bottom: { xs: 82, md: 12 },
                    right: 14,
                    color: 'text.disabled',
                    fontSize: '0.62rem',
                    zIndex: 2000,
                    pointerEvents: 'none',
                }}
            >
                v{pkg.version}
            </Typography>
        </Box>
    );
};

export default MainLayout;
