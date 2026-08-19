import { useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import { ConnectionContext } from '@/App';
import {
  connection,
  BleCharacteristicInfo,
  BleLogEntry,
} from '@api/Connection';
import { CasioConstants } from '@api/CasioConstants';
import { watchInfo } from '@api/WatchInfo';

const BASIC_GET_UUID = CasioConstants.CASIO_READ_REQUEST_FOR_ALL_FEATURES_CHARACTERISTIC_UUID;
const BASIC_SET_UUID = CasioConstants.CASIO_ALL_FEATURES_CHARACTERISTIC_UUID;
const PROBE_BYTES = [3, 6, 7, 8, 9, 10, 11];
const BIT_MASKS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
const DEFAULT_BASELINE = '13 11 01 00 01 00 00 00 00 00 00 00 04 00 00 00 00';

interface BitProbeResult {
  mask: number;
  requested: number;
  readBack?: number;
  accepted?: boolean;
  response?: number[];
  error?: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const toHex = (bytes?: number[]) =>
  bytes?.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') ?? '';

const byteHex = (value?: number) =>
  value === undefined ? '—' : value.toString(16).padStart(2, '0').toUpperCase();

const shortUuid = (uuid?: string) => {
  if (!uuid) return '—';
  return uuid.length > 20 ? `${uuid.slice(0, 8)}…${uuid.slice(-4)}` : uuid;
};

const parseHex = (value: string): number[] => {
  const cleaned = value.replace(/0x/gi, '').replace(/[,;:\n\t-]+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).map(token => {
    if (!/^[0-9a-fA-F]{1,2}$/.test(token)) {
      throw new Error(`Invalid byte: ${token}`);
    }
    return parseInt(token, 16);
  });
};

export default function BleLabPage() {
  const { isConnected } = useContext(ConnectionContext);
  const [characteristics, setCharacteristics] = useState<BleCharacteristicInfo[]>([]);
  const [selectedUuid, setSelectedUuid] = useState('');
  const [payload, setPayload] = useState('');
  const [logs, setLogs] = useState<BleLogEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [probeBaseline, setProbeBaseline] = useState(DEFAULT_BASELINE);
  const [probeByte, setProbeByte] = useState(8);
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeProgress, setProbeProgress] = useState('');
  const [probeResults, setProbeResults] = useState<BitProbeResult[]>([]);

  useEffect(() => connection.subscribeLogs(entry => {
    setLogs(current => [entry, ...current].slice(0, 500));
  }), []);

  const refreshCharacteristics = async () => {
    if (!isConnected) return;
    try {
      setError('');
      const result = await connection.getCharacteristicInfo();
      setCharacteristics(result);
      if (!selectedUuid && result.length) {
        const writable = result.find(item => item.write || item.writeWithoutResponse);
        setSelectedUuid((writable ?? result[0]).uuid);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    if (isConnected) refreshCharacteristics();
    else {
      setCharacteristics([]);
      setSelectedUuid('');
    }
  }, [isConnected]);

  const selected = useMemo(
    () => characteristics.find(item => item.uuid === selectedUuid),
    [characteristics, selectedUuid],
  );

  const send = async () => {
    try {
      setBusy(true);
      setError('');
      const bytes = parseHex(payload);
      if (!selectedUuid) throw new Error('Select a characteristic first');
      if (!bytes.length) throw new Error('Enter at least one hex byte');
      await connection.writeRaw(selectedUuid, bytes);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const read = async () => {
    try {
      setBusy(true);
      setError('');
      if (!selectedUuid) throw new Error('Select a characteristic first');
      await connection.readRaw(selectedUuid);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const requestBasicSettings = async (): Promise<number[]> => {
    const response = connection.waitForRx(
      BASIC_SET_UUID,
      bytes => bytes.length > 0 && bytes[0] === 0x13,
      3000,
    );
    await connection.writeRaw(BASIC_GET_UUID, [0x13]);
    return response;
  };

  const loadLatestBaseline = () => {
    const latest = connection.getLogs()
      .slice()
      .reverse()
      .find(entry =>
        entry.direction === 'TX' &&
        entry.characteristic?.toLowerCase() === BASIC_SET_UUID.toLowerCase() &&
        entry.bytes?.length === 17 &&
        entry.bytes[0] === 0x13,
      );

    if (!latest?.bytes) {
      setError('No 17-byte 0x13 settings write has been captured yet. Change one setting normally, then try again.');
      return;
    }

    setProbeBaseline(toHex(latest.bytes));
    setError('');
  };

  const runBitProbe = async () => {
    let baseline: number[] | null = null;

    try {
      setProbeRunning(true);
      setProbeResults([]);
      setProbeProgress('Validating baseline…');
      setError('');

      baseline = parseHex(probeBaseline);
      if (baseline.length !== 17) {
        throw new Error(`Baseline must contain exactly 17 bytes; found ${baseline.length}`);
      }
      if (baseline[0] !== 0x13) {
        throw new Error('Baseline must be a Basic Settings packet beginning with 13');
      }
      if (!PROBE_BYTES.includes(probeByte)) {
        throw new Error('Select one of the reserved/unknown candidate bytes');
      }

      const masks = BIT_MASKS.filter(mask => !(probeByte === 8 && mask === 0x20));

      for (let index = 0; index < masks.length; index += 1) {
        const mask = masks[index];
        const packet = [...baseline];
        packet[probeByte] = baseline[probeByte] ^ mask;

        setProbeProgress(
          `Testing byte ${probeByte}, mask 0x${byteHex(mask)} (${index + 1}/${masks.length})…`,
        );

        try {
          await connection.writeRaw(BASIC_SET_UUID, packet);
          await sleep(350);

          const response = await requestBasicSettings();
          const readBack = response[probeByte];
          const accepted = readBack === undefined
            ? undefined
            : (readBack & mask) === (packet[probeByte] & mask);

          setProbeResults(current => [...current, {
            mask,
            requested: packet[probeByte],
            readBack,
            accepted,
            response,
          }]);
        } catch (probeError) {
          setProbeResults(current => [...current, {
            mask,
            requested: packet[probeByte],
            error: String(probeError),
          }]);
        }

        // Return to the known baseline after every individual bit test so
        // effects cannot accumulate across probe cases.
        await connection.writeRaw(BASIC_SET_UUID, baseline);
        await sleep(350);
      }

      setProbeProgress('Probe complete; baseline restored.');
    } catch (e) {
      setError(String(e));
      setProbeProgress('Probe stopped.');
    } finally {
      if (baseline?.length === 17 && connection.isConnected()) {
        try {
          await connection.writeRaw(BASIC_SET_UUID, baseline);
        } catch (restoreError) {
          setError(`Probe finished but baseline restore failed: ${String(restoreError)}`);
        }
      }
      setProbeRunning(false);
    }
  };

  const copyLogs = async () => {
    const text = logs
      .slice()
      .reverse()
      .map(log => [
        log.timestamp.toISOString(),
        log.direction,
        log.characteristic ?? '',
        toHex(log.bytes),
        log.message ?? '',
      ].join('\t'))
      .join('\n');
    await navigator.clipboard.writeText(text);
  };

  const copyProbeResults = async () => {
    const text = probeResults.map(result => [
      `byte=${probeByte}`,
      `mask=0x${byteHex(result.mask)}`,
      `requested=0x${byteHex(result.requested)}`,
      `readback=0x${byteHex(result.readBack)}`,
      result.error ? `ERROR ${result.error}` : result.accepted ? 'RETAINED' : result.accepted === false ? 'CLEARED/REJECTED' : 'NO READBACK',
      result.response ? toHex(result.response) : '',
    ].join('\t')).join('\n');
    await navigator.clipboard.writeText(text);
  };

  const clearTraffic = () => {
    connection.clearLogs();
    setLogs([]);
  };

  return (
    <Box sx={{ overflowY: 'auto', height: '100%', p: { xs: 2, sm: 3, lg: 4 } }}>
      <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mb={3}>
          <Box>
            <Stack direction="row" alignItems="center" gap={1.25}>
              <ScienceRoundedIcon color="primary" />
              <Typography variant="h4" fontWeight={700}>BLE Lab</Typography>
            </Stack>
            <Typography color="text.secondary" mt={0.75}>
              Inspect GATT traffic, replay known commands and probe the GW-BX5600 protocol.
            </Typography>
          </Box>
          <Chip
            label={isConnected ? `${watchInfo.model || 'G-Shock'} connected` : 'Watch disconnected'}
            color={isConnected ? 'success' : 'default'}
            variant={isConnected ? 'filled' : 'outlined'}
            sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
          />
        </Stack>

        <Alert severity="warning" variant="outlined" sx={{ mb: 3 }}>
          Raw writes bypass the normal app safeguards. The automated probe is deliberately restricted to the known 0x13 Basic Settings packet and restores its baseline between tests.
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}

        <Card sx={{ p: 3, mb: 3 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2} mb={2.5}>
            <Box>
              <Typography fontWeight={700}>Automated Basic Settings bit probe</Typography>
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                Flips one bit at a time, reads command 0x13 back from the watch, records whether the bit survived, then restores the baseline before continuing.
              </Typography>
            </Box>
            <Stack direction="row" gap={1} alignItems="flex-start">
              <Button
                size="small"
                variant="outlined"
                startIcon={<RestoreRoundedIcon />}
                onClick={loadLatestBaseline}
                disabled={!isConnected || probeRunning}
              >
                Use latest 0x13 TX
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayArrowRoundedIcon />}
                onClick={runBitProbe}
                disabled={!isConnected || probeRunning || busy}
              >
                Run probe
              </Button>
            </Stack>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 0.7fr' }, gap: 2 }}>
            <TextField
              fullWidth
              value={probeBaseline}
              onChange={event => setProbeBaseline(event.target.value)}
              label="17-byte baseline packet"
              helperText="Use a known-good 0x13 SET packet. The tester restores this after every bit."
              disabled={probeRunning}
              sx={{ '& input': { fontFamily: 'monospace', fontSize: 13 } }}
            />

            <FormControl fullWidth disabled={probeRunning}>
              <InputLabel>Byte to probe</InputLabel>
              <Select
                label="Byte to probe"
                value={probeByte}
                onChange={event => setProbeByte(Number(event.target.value))}
              >
                {PROBE_BYTES.map(index => (
                  <MenuItem key={index} value={index}>Byte {index}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {probeRunning && <LinearProgress sx={{ mt: 2.5 }} />}
          {probeProgress && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, fontFamily: 'monospace' }}>
              {probeProgress}
            </Typography>
          )}

          {probeResults.length > 0 && (
            <Box mt={2.5}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.25}>
                <Typography fontWeight={700}>Results</Typography>
                <Button size="small" startIcon={<ContentCopyRoundedIcon />} onClick={copyProbeResults}>Copy results</Button>
              </Stack>
              <Box sx={{ display: 'grid', gap: 1 }}>
                {probeResults.map(result => (
                  <Box
                    key={result.mask}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr 1fr', sm: '100px 130px 130px 1fr' },
                      gap: 1,
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: 'action.hover',
                      alignItems: 'center',
                    }}
                  >
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 13 }}>mask 0x{byteHex(result.mask)}</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 13 }}>sent 0x{byteHex(result.requested)}</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 13 }}>RX 0x{byteHex(result.readBack)}</Typography>
                    <Chip
                      size="small"
                      label={result.error ? 'ERROR' : result.accepted ? 'RETAINED' : result.accepted === false ? 'CLEARED / REJECTED' : 'NO READBACK'}
                      color={result.error ? 'error' : result.accepted ? 'success' : result.accepted === false ? 'default' : 'warning'}
                      variant={result.accepted ? 'filled' : 'outlined'}
                      sx={{ justifySelf: 'start' }}
                    />
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Card>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.4fr' }, gap: 3 }}>
          <Stack gap={3}>
            <Card sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2.5}>
                <Box>
                  <Typography fontWeight={700}>Raw command</Typography>
                  <Typography variant="body2" color="text.secondary">Send bytes directly to a watch characteristic.</Typography>
                </Box>
                <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={refreshCharacteristics} disabled={!isConnected || probeRunning}>
                  Refresh
                </Button>
              </Stack>

              <FormControl fullWidth size="small" disabled={!isConnected || !characteristics.length || probeRunning}>
                <InputLabel>Characteristic</InputLabel>
                <Select
                  label="Characteristic"
                  value={selectedUuid}
                  onChange={event => setSelectedUuid(event.target.value)}
                  sx={{ fontFamily: 'monospace' }}
                >
                  {characteristics.map(item => (
                    <MenuItem key={item.uuid} value={item.uuid} sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {shortUuid(item.uuid)} · {[
                        item.read && 'R',
                        (item.write || item.writeWithoutResponse) && 'W',
                        (item.notify || item.indicate) && 'N',
                      ].filter(Boolean).join('/') || '—'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {selected && (
                <Stack direction="row" gap={1} flexWrap="wrap" mt={1.5}>
                  {selected.read && <Chip size="small" label="Readable" />}
                  {(selected.write || selected.writeWithoutResponse) && <Chip size="small" label="Writable" />}
                  {(selected.notify || selected.indicate) && <Chip size="small" label="Notifies" />}
                </Stack>
              )}

              <TextField
                fullWidth
                multiline
                minRows={4}
                value={payload}
                onChange={event => setPayload(event.target.value)}
                placeholder="01 02 0A FF"
                label="Hex payload"
                disabled={probeRunning}
                sx={{ mt: 2.5, '& textarea': { fontFamily: 'monospace', fontSize: 14 } }}
              />

              <Stack direction="row" gap={1.5} mt={2.5}>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<SendRoundedIcon />}
                  onClick={send}
                  disabled={!isConnected || busy || probeRunning || !(selected?.write || selected?.writeWithoutResponse)}
                >
                  Send
                </Button>
                <Button
                  variant="outlined"
                  onClick={read}
                  disabled={!isConnected || busy || probeRunning || !selected?.read}
                >
                  Read
                </Button>
              </Stack>
            </Card>

            <Card sx={{ p: 3 }}>
              <Typography fontWeight={700}>Characteristic map</Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                GATT characteristics discovered from the active Casio watch-features service.
              </Typography>
              <Stack gap={1}>
                {characteristics.length ? characteristics.map(item => (
                  <Box key={item.uuid} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{item.uuid}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[item.read && 'READ', (item.write || item.writeWithoutResponse) && 'WRITE', (item.notify || item.indicate) && 'NOTIFY'].filter(Boolean).join(' · ') || 'No exposed operations'}
                    </Typography>
                  </Box>
                )) : (
                  <Typography variant="body2" color="text.secondary">Connect the watch to enumerate characteristics.</Typography>
                )}
              </Stack>
            </Card>
          </Stack>

          <Card sx={{ minHeight: 620, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ px: 3, py: 2.25, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
              <Box>
                <Typography fontWeight={700}>Live traffic</Typography>
                <Typography variant="body2" color="text.secondary">TX writes and RX notifications from the existing API appear here automatically.</Typography>
              </Box>
              <Stack direction="row" gap={1}>
                <Button size="small" startIcon={<ContentCopyRoundedIcon />} onClick={copyLogs} disabled={!logs.length}>Copy</Button>
                <Button size="small" startIcon={<DeleteSweepRoundedIcon />} onClick={clearTraffic} disabled={!logs.length || probeRunning}>Clear</Button>
              </Stack>
            </Box>
            <Divider />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: '#090d12', color: '#d8e2ec', p: 2 }}>
              {logs.length === 0 ? (
                <Typography sx={{ fontFamily: 'monospace', fontSize: 13, color: '#72808f' }}>
                  Waiting for BLE traffic… Try changing the font or light duration in Settings.
                </Typography>
              ) : logs.map(log => (
                <Box key={log.id} sx={{ display: 'grid', gridTemplateColumns: '86px 46px minmax(90px, 150px) 1fr', gap: 1.25, mb: 0.85, fontFamily: 'monospace', fontSize: 12.5 }}>
                  <Box sx={{ color: '#72808f' }}>{log.timestamp.toLocaleTimeString([], { hour12: false })}.{String(log.timestamp.getMilliseconds()).padStart(3, '0')}</Box>
                  <Box sx={{ color: log.direction === 'TX' ? '#70d6ff' : log.direction === 'RX' ? '#9be564' : log.direction === 'ERROR' ? '#ff7b7b' : '#e8c66a', fontWeight: 700 }}>{log.direction}</Box>
                  <Box title={log.characteristic} sx={{ color: '#8fa4b8' }}>{shortUuid(log.characteristic)}</Box>
                  <Box sx={{ wordBreak: 'break-all' }}>{log.bytes?.length ? toHex(log.bytes) : log.message}</Box>
                </Box>
              ))}
            </Box>
          </Card>
        </Box>
      </Box>
    </Box>
  );
}
