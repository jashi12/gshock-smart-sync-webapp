import React, { useContext } from 'react';
import { useRouter } from '@/utils/router';
import {
    Box,
    Chip,
    Drawer,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
} from '@mui/material';
import TimeIcon from '@mui/icons-material/AccessTime';
import AlarmsIcon from '@mui/icons-material/Alarm';
import CalendarIcon from '@mui/icons-material/CalendarMonth';
import SettingsIcon from '@mui/icons-material/Settings';
import WatchIcon from '@mui/icons-material/Watch';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import { ConnectionContext } from '@/App';
import { watchInfo } from '@api/WatchInfo';

export const SIDEBAR_WIDTH = 272;

const NAV_ITEMS = [
    { label: 'Time', icon: TimeIcon, path: '/time/Time' },
    { label: 'Alarms', icon: AlarmsIcon, path: '/alarms/Alarms' },
    { label: 'Events', icon: CalendarIcon, path: '/reminders/Reminders' },
    { label: 'Settings', icon: SettingsIcon, path: '/settings/Settings' },
    { label: 'BLE Lab', icon: ScienceRoundedIcon, path: '/ble-lab', experimental: true },
];

const SideNavigation: React.FC = () => {
    const router = useRouter();
    const { isConnected } = useContext(ConnectionContext);
    const visibleItems = React.useMemo(() => {
        if (isConnected && !watchInfo.hasReminders) {
            return NAV_ITEMS.filter(item => item.label !== 'Events');
        }
        return NAV_ITEMS;
    }, [isConnected]);

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: SIDEBAR_WIDTH,
                flexShrink: 0,
                display: { xs: 'none', md: 'block' },
                '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' },
            }}
        >
            <Box sx={{ px: 2.5, pt: 3, pb: 2.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box
                        sx={{
                            width: 44,
                            height: 44,
                            borderRadius: 2.5,
                            background: 'linear-gradient(135deg, #7FDBFF 0%, #3E7CB1 100%)',
                            display: 'grid',
                            placeItems: 'center',
                            color: '#071018',
                            boxShadow: '0 0 30px rgba(127,219,255,0.16)',
                        }}
                    >
                        <WatchIcon />
                    </Box>
                    <Box>
                        <Typography fontWeight={800} lineHeight={1.15}>G-Shock Lab</Typography>
                        <Typography variant="caption" color="text.secondary">Smart Sync + protocol tools</Typography>
                    </Box>
                </Box>

                <Box sx={{ mt: 2.25, p: 1.5, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.035)', border: '1px solid', borderColor: 'divider' }}>
                    <StackStatus connected={isConnected} />
                </Box>
            </Box>

            <Box sx={{ px: 1.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, letterSpacing: '0.12em', fontSize: 10 }}>
                    Watch
                </Typography>
                <List disablePadding sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {visibleItems.map(item => {
                        const active = router.pathname === item.path;
                        return (
                            <ListItemButton
                                key={item.path}
                                onClick={() => isConnected && router.push(item.path)}
                                selected={active}
                                disabled={!isConnected}
                                sx={{
                                    minHeight: 48,
                                    borderRadius: 2.5,
                                    px: 1.5,
                                    '&.Mui-selected': {
                                        bgcolor: 'rgba(127,219,255,0.11)',
                                        color: 'primary.main',
                                        '&:hover': { bgcolor: 'rgba(127,219,255,0.14)' },
                                    },
                                }}
                            >
                                <ListItemIcon sx={{ minWidth: 38, color: active ? 'primary.main' : 'text.secondary' }}>
                                    <item.icon fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: active ? 700 : 550, fontSize: 14 }} />
                                {item.experimental && <Chip label="LAB" size="small" sx={{ height: 20, fontSize: 9, fontWeight: 800 }} />}
                            </ListItemButton>
                        );
                    })}
                </List>
            </Box>

            <Box sx={{ mt: 'auto', px: 2.5, py: 2.25, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">Web Bluetooth · local browser connection</Typography>
            </Box>
        </Drawer>
    );
};

function StackStatus({ connected }: { connected: boolean }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box>
                <Typography variant="caption" color="text.secondary">Connection</Typography>
                <Typography variant="body2" fontWeight={700}>{connected ? 'Watch online' : 'Not connected'}</Typography>
            </Box>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: connected ? 'success.main' : 'text.disabled', boxShadow: connected ? '0 0 12px rgba(102,187,106,.65)' : 'none' }} />
        </Box>
    );
}

export default SideNavigation;
