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
import { ConnectionContext } from '@/App';
import {
  connection,
  BleCharacteristicInfo,
  BleLogEntry,
} from '@api/Connection';
import { watchInfo } from '@api/WatchInfo';

const toHex = (bytes?: number[]) =>
  bytes?.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') ?? '';

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
          Raw writes bypass the normal app safeguards. Start by replaying captured, known-good packets and change one byte at a time.
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.4fr' }, gap: 3 }}>
          <Stack gap={3}>
            <Card sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2.5}>
                <Box>
                  <Typography fontWeight={700}>Raw command</Typography>
                  <Typography variant="body2" color="text.secondary">Send bytes directly to a watch characteristic.</Typography>
                </Box>
                <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={refreshCharacteristics} disabled={!isConnected}>
                  Refresh
                </Button>
              </Stack>

              <FormControl fullWidth size="small" disabled={!isConnected || !characteristics.length}>
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
                sx={{ mt: 2.5, '& textarea': { fontFamily: 'monospace', fontSize: 14 } }}
              />

              <Stack direction="row" gap={1.5} mt={2.5}>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<SendRoundedIcon />}
                  onClick={send}
                  disabled={!isConnected || busy || !(selected?.write || selected?.writeWithoutResponse)}
                >
                  Send
                </Button>
                <Button
                  variant="outlined"
                  onClick={read}
                  disabled={!isConnected || busy || !selected?.read}
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
                <Button size="small" startIcon={<DeleteSweepRoundedIcon />} onClick={() => setLogs([])} disabled={!logs.length}>Clear</Button>
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
