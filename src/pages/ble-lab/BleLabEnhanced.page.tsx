import { useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { ConnectionContext } from '@/App';
import { connection } from '@api/Connection';
import { WATCH_MODEL, watchInfo } from '@api/WatchInfo';
import BleLabPage from './BleLab.page';

const CASIO_VERSION_INFORMATION_UUID = '26eb0028-b012-49a8-b1f8-394fb2032b0f';

interface VersionInfo {
  raw: number[];
  protectWatchSoft: number;
  rewritableWatchSoft: number;
  bleFirmVersion?: number;
  casioFirmVersion?: number;
}

const toHexByte = (value?: number) =>
  value === undefined ? '—' : `0x${value.toString(16).padStart(2, '0').toUpperCase()}`;

const toRawHex = (bytes: number[]) =>
  bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');

export default function BleLabEnhancedPage() {
  const { isConnected } = useContext(ConnectionContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    if (!isConnected) {
      setInfo(null);
      setError('');
      setBusy(false);
    }
  }, [isConnected]);

  const is3575Family =
    watchInfo.model === WATCH_MODEL.GW_BX5600 ||
    watchInfo.model === WATCH_MODEL.GMW_BZ5000;

  const serverInfo = useMemo(() => {
    if (!info || !is3575Family) return null;
    const protect = info.protectWatchSoft.toString(16).padStart(2, '0').toLowerCase();
    const folder = `3575-${protect}`;
    return {
      folder,
      versionKey: `watchsoft/${folder}/AR3575-${protect}-version.txt`,
      settingKey: `watchsoft/${folder}/AR3575-${protect}-setting.txt`,
    };
  }, [info, is3575Family]);

  const readVersionInfo = async () => {
    try {
      setBusy(true);
      setError('');
      const bytes = await connection.readRaw(CASIO_VERSION_INFORMATION_UUID);

      if (bytes.length <= 3) {
        throw new Error(`CASIO_VERSION_INFORMATION returned only ${bytes.length} byte(s); expected at least 4.`);
      }

      setInfo({
        raw: bytes,
        protectWatchSoft: bytes[2],
        rewritableWatchSoft: bytes[3],
        casioFirmVersion: bytes.length > 9 ? bytes[9] : undefined,
        bleFirmVersion: bytes.length > 12 ? bytes[12] : undefined,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyInfo = async () => {
    if (!info) return;

    const lines = [
      `CASIO_VERSION_INFORMATION: ${toRawHex(info.raw)}`,
      `PROTECT_WATCH_SOFT [2]: ${toHexByte(info.protectWatchSoft)} (${info.protectWatchSoft})`,
      `REWRITABLE_WATCH_SOFT [3]: ${toHexByte(info.rewritableWatchSoft)} (${info.rewritableWatchSoft})`,
      `CASIO_FIRM [9]: ${toHexByte(info.casioFirmVersion)}`,
      `BLE_FIRM_VER [12]: ${toHexByte(info.bleFirmVersion)}`,
    ];

    if (serverInfo) {
      lines.push(
        `WatchSoft folder: ${serverInfo.folder}`,
        `Version key: ${serverInfo.versionKey}`,
        `Setting key: ${serverInfo.settingKey}`,
      );
    }

    await navigator.clipboard.writeText(lines.join('\n'));
  };

  return (
    <>
      <BleLabPage />

      <Button
        variant="contained"
        startIcon={<MemoryRoundedIcon />}
        onClick={() => setOpen(true)}
        sx={{
          position: 'fixed',
          right: { xs: 16, sm: 24 },
          bottom: { xs: 92, sm: 24 },
          zIndex: 1200,
          boxShadow: 6,
        }}
      >
        Watch software
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Watch software / firmware info</DialogTitle>
        <DialogContent>
          <Stack gap={2.25} sx={{ pt: 0.5 }}>
            <Alert severity="info" variant="outlined">
              Read-only: this reads CASIO_VERSION_INFORMATION (0x0028). It does not write to the watch or start an update.
            </Alert>

            <Box>
              <Typography variant="body2" color="text.secondary">Characteristic</Typography>
              <Typography sx={{ mt: 0.5, fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
                {CASIO_VERSION_INFORMATION_UUID}
              </Typography>
            </Box>

            {error && <Alert severity="error">{error}</Alert>}

            {!info ? (
              <Typography variant="body2" color="text.secondary">
                Read the characteristic to decode the WatchSoft protection byte, installed WatchSoft version and BLE firmware version.
              </Typography>
            ) : (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25 }}>
                  {[
                    ['Protect WatchSoft', toHexByte(info.protectWatchSoft), 'byte 2'],
                    ['Installed WatchSoft', toHexByte(info.rewritableWatchSoft), 'byte 3'],
                    ['BLE firmware', toHexByte(info.bleFirmVersion), 'byte 12'],
                  ].map(([label, value, detail]) => (
                    <Box key={label} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">{label}</Typography>
                      <Typography sx={{ mt: 0.25, fontFamily: 'monospace', fontWeight: 700 }}>{value}</Typography>
                      <Typography variant="caption" color="text.secondary">{detail}</Typography>
                    </Box>
                  ))}
                </Box>

                <Box>
                  <Typography variant="body2" fontWeight={700} mb={0.75}>Raw 0x0028 value</Typography>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
                      {toRawHex(info.raw)}
                    </Typography>
                  </Box>
                </Box>

                {serverInfo ? (
                  <>
                    <Divider />
                    <Box>
                      <Stack direction="row" gap={1} alignItems="center" mb={1}>
                        <Typography fontWeight={700}>3575 WatchSoft server mapping</Typography>
                        <Chip size="small" label={serverInfo.folder} color="primary" variant="outlined" />
                      </Stack>
                      <Stack gap={1}>
                        <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                          <Typography variant="caption" color="text.secondary">Version metadata key</Typography>
                          <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
                            {serverInfo.versionKey}
                          </Typography>
                        </Box>
                        <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                          <Typography variant="caption" color="text.secondary">Setting metadata key</Typography>
                          <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
                            {serverInfo.settingKey}
                          </Typography>
                        </Box>
                      </Stack>
                    </Box>
                  </>
                ) : (
                  <Alert severity="warning" variant="outlined">
                    The automatic 3575 server-path derivation is enabled only for GW-BX5600 / GMW-BZ5000 models.
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          {info && (
            <Button startIcon={<ContentCopyRoundedIcon />} onClick={copyInfo}>
              Copy
            </Button>
          )}
          <Button onClick={() => setOpen(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<RefreshRoundedIcon />}
            onClick={readVersionInfo}
            disabled={!isConnected || busy}
          >
            {busy ? 'Reading…' : 'Read 0x0028'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
