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
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { ConnectionContext } from '@/App';
import { connection, BleGattReconReport } from '@api/Connection';
import { CasioConstants } from '@api/CasioConstants';
import { WATCH_MODEL, watchInfo } from '@api/WatchInfo';
import BleLabPage from './BleLab.page';

// CASIO_VERSION_INFORMATION is a logical Watch Features item (26eb0028 in
// Casio's Android enum), but GW-BX5600 does not expose 0x0028 as a physical
// GATT characteristic. The official app requests class 0x20 through the
// multiplexed All Features transport: request on 0x002c, response on 0x002d.
const VERSION_INFORMATION_LOGICAL_UUID = '26eb0028-b012-49a8-b1f8-394fb2032b0f';
const READ_REQUEST_UUID = CasioConstants.CASIO_READ_REQUEST_FOR_ALL_FEATURES_CHARACTERISTIC_UUID;
const ALL_FEATURES_UUID = CasioConstants.CASIO_ALL_FEATURES_CHARACTERISTIC_UUID;
const VERSION_INFORMATION_COMMAND = 0x20;
const BASIC_SET_UUID = ALL_FEATURES_UUID.toLowerCase();

interface VersionInfo {
  wirePacket: number[];
  data: number[];
  protectWatchSoft: number;
  rewritableWatchSoft: number;
  bleFirmVersion?: number;
  casioFirmVersion?: number;
}

interface ReconSummary {
  services: number;
  characteristics: number;
}

const toHexByte = (value?: number) =>
  value === undefined ? '—' : `0x${value.toString(16).padStart(2, '0').toUpperCase()}`;

const toRawHex = (bytes: number[]) =>
  bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');

const reconSummaryFromReport = (report: BleGattReconReport): ReconSummary => ({
  services: report.services.length,
  characteristics: report.services.reduce((sum, service) => sum + service.characteristics.length, 0),
});

export default function BleLabEnhancedPage() {
  const { isConnected } = useContext(ConnectionContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanError, setScanError] = useState('');
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [recon, setRecon] = useState<ReconSummary | null>(null);
  const [baselineCaptured, setBaselineCaptured] = useState(false);

  useEffect(() => {
    const refreshDerivedState = () => {
      const history = connection.getLogs();

      const latestRecon = history
        .slice()
        .reverse()
        .find(entry => entry.direction === 'INFO' && entry.message?.startsWith('GATT recon:'));

      if (latestRecon?.message) {
        const match = latestRecon.message.match(/GATT recon:\s*(\d+)\s+services,\s*(\d+)\s+characteristics/i);
        if (match) {
          setRecon({ services: Number(match[1]), characteristics: Number(match[2]) });
        }
      }

      setBaselineCaptured(history.some(entry =>
        entry.direction === 'TX' &&
        entry.characteristic?.toLowerCase() === BASIC_SET_UUID &&
        entry.bytes?.length === 17 &&
        entry.bytes[0] === 0x13,
      ));
    };

    refreshDerivedState();
    return connection.subscribeLogs(() => refreshDerivedState());
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setInfo(null);
      setRecon(null);
      setError('');
      setScanError('');
      setBusy(false);
      setScanBusy(false);
      setBaselineCaptured(false);
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

      // Match only the future class-0x20 response. As with Basic Settings
      // (0x13), the first byte on 0x002d is the logical item/class ID and the
      // remaining bytes are the value exposed to VersionInformation.getVersion().
      const responsePromise = connection.waitForRx(
        ALL_FEATURES_UUID,
        bytes => bytes.length > 0 && bytes[0] === VERSION_INFORMATION_COMMAND,
        4000,
      );

      await connection.writeRaw(READ_REQUEST_UUID, [VERSION_INFORMATION_COMMAND]);
      const wirePacket = await responsePromise;
      const bytes = wirePacket.slice(1);

      if (bytes.length <= 3) {
        throw new Error(
          `Version Information response contained only ${bytes.length} data byte(s) after the 0x20 header; expected at least 4. Wire packet: ${toRawHex(wirePacket)}`,
        );
      }

      setInfo({
        wirePacket,
        data: bytes,
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

  const runVisibleGattScan = async () => {
    try {
      setScanBusy(true);
      setScanError('');
      const report = await connection.runGattReconnaissance();
      setRecon(reconSummaryFromReport(report));
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanBusy(false);
    }
  };

  const copyInfo = async () => {
    if (!info) return;

    const lines = [
      `CASIO_VERSION_INFORMATION logical item: ${VERSION_INFORMATION_LOGICAL_UUID}`,
      `Transport request: ${READ_REQUEST_UUID} <= 20`,
      `Transport response: ${ALL_FEATURES_UUID} => ${toRawHex(info.wirePacket)}`,
      `Version data (0x20 header removed): ${toRawHex(info.data)}`,
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

      <Stack
        direction="row"
        gap={1}
        alignItems="center"
        sx={{
          position: 'fixed',
          right: { xs: 16, sm: 24 },
          bottom: { xs: 92, sm: 24 },
          zIndex: 1200,
        }}
      >
        {recon && (
          <Chip
            label={`GATT ${recon.services} svc · ${recon.characteristics} chars`}
            color="success"
            variant="filled"
            sx={{ boxShadow: 4 }}
          />
        )}
        <Button
          variant="contained"
          startIcon={<MemoryRoundedIcon />}
          onClick={() => setOpen(true)}
          sx={{ boxShadow: 6 }}
        >
          Firmware tools
        </Button>
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Firmware / WatchSoft tools</DialogTitle>
        <DialogContent>
          <Stack gap={2.25} sx={{ pt: 0.5 }}>
            <Alert severity="info" variant="outlined">
              These controls perform read/query operations only. The Version Information query writes the class ID 0x20 to Casio's read-request characteristic; it does not modify settings, write firmware or enter update mode.
            </Alert>

            <Box>
              <Stack direction="row" justifyContent="space-between" gap={2} alignItems="center">
                <Box>
                  <Typography fontWeight={700}>GATT scan</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Enumerates the services and physical characteristics Web Bluetooth can access.
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  startIcon={<SearchRoundedIcon />}
                  onClick={runVisibleGattScan}
                  disabled={!isConnected || scanBusy || busy}
                >
                  {scanBusy ? 'Scanning…' : 'Scan'}
                </Button>
              </Stack>

              {scanError && <Alert severity="error" sx={{ mt: 1.5 }}>{scanError}</Alert>}
              {recon && (
                <Alert severity="success" variant="outlined" sx={{ mt: 1.5 }}>
                  Scan complete: {recon.services} permitted services and {recon.characteristics} physical characteristics discovered.
                </Alert>
              )}
            </Box>

            <Divider />

            <Box>
              <Stack direction="row" justifyContent="space-between" gap={2} alignItems="center">
                <Box>
                  <Typography fontWeight={700}>CASIO_VERSION_INFORMATION</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Queries logical item 0x0028 using Casio All Features class 0x20, then decodes WatchSoft and BLE firmware versions.
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  startIcon={<RefreshRoundedIcon />}
                  onClick={readVersionInfo}
                  disabled={!isConnected || busy || scanBusy}
                >
                  {busy ? 'Reading…' : 'Read versions'}
                </Button>
              </Stack>

              <Stack gap={0.5} mt={1}>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }} color="text.secondary">
                  logical: {VERSION_INFORMATION_LOGICAL_UUID}
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }} color="text.secondary">
                  TX 002c: 20 → RX 002d: 20 ...
                </Typography>
              </Stack>
            </Box>

            {error && <Alert severity="error">{error}</Alert>}

            {!info ? (
              <Typography variant="body2" color="text.secondary">
                Press Read versions. After removing the leading 0x20 transport byte, data byte 2 is PROTECT_WATCH_SOFT, byte 3 is the installed/rewriteable WatchSoft version, and byte 12 is BLE_FIRM_VER when present.
              </Typography>
            ) : (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25 }}>
                  {[
                    ['Protect WatchSoft', toHexByte(info.protectWatchSoft), 'data byte 2'],
                    ['Installed WatchSoft', toHexByte(info.rewritableWatchSoft), 'data byte 3'],
                    ['BLE firmware', toHexByte(info.bleFirmVersion), 'data byte 12'],
                  ].map(([label, value, detail]) => (
                    <Box key={label} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">{label}</Typography>
                      <Typography sx={{ mt: 0.25, fontFamily: 'monospace', fontWeight: 700 }}>{value}</Typography>
                      <Typography variant="caption" color="text.secondary">{detail}</Typography>
                    </Box>
                  ))}
                </Box>

                <Box>
                  <Typography variant="body2" fontWeight={700} mb={0.75}>Wire response (0x002d)</Typography>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
                      {toRawHex(info.wirePacket)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" fontWeight={700} mt={1.5} mb={0.75}>Decoded Version Information data</Typography>
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
                      {toRawHex(info.data)}
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
                    Automatic 3575 server-path derivation is enabled only for GW-BX5600 / GMW-BZ5000 models.
                  </Alert>
                )}
              </>
            )}

            <Divider />

            <Alert severity={baselineCaptured ? 'success' : 'warning'} variant="outlined">
              {baselineCaptured
                ? 'A 17-byte 0x13 Basic Settings TX is now present in the BLE log, so “Use latest 0x13 TX” should work.'
                : 'The “No 17-byte 0x13 settings write” message belongs to the separate Basic Settings bit-probe tool, not this firmware reader. Change a normal setting first, or use the existing known-good baseline already shown in that probe.'}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          {info && (
            <Button startIcon={<ContentCopyRoundedIcon />} onClick={copyInfo}>
              Copy firmware info
            </Button>
          )}
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
