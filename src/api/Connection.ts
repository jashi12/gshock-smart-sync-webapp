/// <reference types="web-bluetooth" />

import { CasioConstants } from '@api/CasioConstants';
import { progressEvents } from '@api/ProgressEvents';
import { watchInfo } from '@/api/WatchInfo';

export type BleDirection = 'TX' | 'RX' | 'INFO' | 'ERROR';

export interface BleLogEntry {
  id: number;
  timestamp: Date;
  direction: BleDirection;
  characteristic?: string;
  bytes?: number[];
  message?: string;
}

export interface BleCharacteristicInfo {
  uuid: string;
  serviceUuid?: string;
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
  label?: string;
  valueText?: string;
  valueBytes?: number[];
  potentialDfu?: boolean;
}

export interface BleGattServiceInfo {
  uuid: string;
  label?: string;
  potentialDfu: boolean;
  characteristics: BleCharacteristicInfo[];
}

export interface BleGattReconReport {
  deviceName: string;
  scannedAt: Date;
  services: BleGattServiceInfo[];
  firmwareRevision?: string;
  hardwareRevision?: string;
  softwareRevision?: string;
  modelNumber?: string;
  serialNumber?: string;
  manufacturerName?: string;
  batteryLevel?: number;
  dfuCandidates: string[];
}

const DEVICE_INFORMATION_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
const MODEL_NUMBER_CHARACTERISTIC = '00002a24-0000-1000-8000-00805f9b34fb';
const SERIAL_NUMBER_CHARACTERISTIC = '00002a25-0000-1000-8000-00805f9b34fb';
const FIRMWARE_REVISION_CHARACTERISTIC = '00002a26-0000-1000-8000-00805f9b34fb';
const HARDWARE_REVISION_CHARACTERISTIC = '00002a27-0000-1000-8000-00805f9b34fb';
const SOFTWARE_REVISION_CHARACTERISTIC = '00002a28-0000-1000-8000-00805f9b34fb';
const MANUFACTURER_NAME_CHARACTERISTIC = '00002a29-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL_CHARACTERISTIC = '00002a19-0000-1000-8000-00805f9b34fb';

// Common BLE firmware-update/bootloader services. Requesting them as optional
// services is read-only by itself; it simply allows Web Bluetooth to reveal
// them if the watch exposes one of these UUIDs.
const DFU_SERVICES: Record<string, string> = {
  '0000fe59-0000-1000-8000-00805f9b34fb': 'Nordic Secure DFU',
  '00001530-1212-efde-1523-785feabcd123': 'Nordic Legacy DFU',
  '8ec90001-f315-4f60-9fb8-838830daea50': 'Nordic Buttonless DFU',
  '8d53dc1d-1db7-4cd3-868b-8a527460aa84': 'Zephyr MCUboot / SMP',
  '1d14d6ee-fd63-4fa1-bfa4-8f47b42119f0': 'Silicon Labs OTA',
  'f000ffc0-0451-4000-b000-000000000000': 'TI OAD',
  '0000fef5-0000-1000-8000-00805f9b34fb': 'Dialog / SUOTA candidate',
};

const SERVICE_LABELS: Record<string, string> = {
  [DEVICE_INFORMATION_SERVICE]: 'Device Information',
  [BATTERY_SERVICE]: 'Battery',
  [CasioConstants.WATCH_FEATURES_SERVICE_UUID.toLowerCase()]: 'Casio Watch Features',
  ...DFU_SERVICES,
};

const CHARACTERISTIC_LABELS: Record<string, string> = {
  [MODEL_NUMBER_CHARACTERISTIC]: 'Model Number',
  [SERIAL_NUMBER_CHARACTERISTIC]: 'Serial Number',
  [FIRMWARE_REVISION_CHARACTERISTIC]: 'Firmware Revision',
  [HARDWARE_REVISION_CHARACTERISTIC]: 'Hardware Revision',
  [SOFTWARE_REVISION_CHARACTERISTIC]: 'Software Revision',
  [MANUFACTURER_NAME_CHARACTERISTIC]: 'Manufacturer Name',
  [BATTERY_LEVEL_CHARACTERISTIC]: 'Battery Level',
  '00001534-1212-efde-1523-785feabcd123': 'Nordic DFU Version',
  '8ec90003-f315-4f60-9fb8-838830daea50': 'Nordic Buttonless DFU Control',
  'da2e7828-fbce-4e01-ae9e-261174997c48': 'SMP Management',
  'f7bf3564-fb6d-4e53-88a4-5e37e0326063': 'Silicon Labs OTA Control',
  'f000ffc1-0451-4000-b000-000000000000': 'TI OAD Image Identify',
  'f000ffc2-0451-4000-b000-000000000000': 'TI OAD Image Block',
};

const OPTIONAL_RECON_SERVICES = [
  DEVICE_INFORMATION_SERVICE,
  BATTERY_SERVICE,
  ...Object.keys(DFU_SERVICES),
];

const normalizeUuid = (uuid: string): string => uuid.toLowerCase();

const decodeText = (bytes: number[]): string => {
  try {
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0+$/g, '').trim();
  } catch {
    return '';
  }
};

const isSafeAutoRead = (serviceUuid: string, characteristicUuid: string): boolean => {
  const service = normalizeUuid(serviceUuid);
  const characteristic = normalizeUuid(characteristicUuid);

  if (service === DEVICE_INFORMATION_SERVICE || service === BATTERY_SERVICE) return true;
  return characteristic === '00001534-1212-efde-1523-785feabcd123';
};

class Connection {
  name: string;
  device: BluetoothDevice | null;
  server: BluetoothRemoteGATTServer | null;
  service: BluetoothRemoteGATTService | null;

  public connecting: boolean = false;
  private characteristicCache: Map<string, BluetoothRemoteGATTCharacteristic>;
  private dataReceivedCallback: ((receivedData: DataView, characteristicUuid: string) => void) | null = null;
  private logListeners = new Set<(entry: BleLogEntry) => void>();
  private logHistory: BleLogEntry[] = [];
  private logId = 0;

  // Web Bluetooth only permits one active GATT operation at a time on many
  // Windows/Chrome stacks. Route reads, writes and enumeration through this
  // promise chain so BLE Lab cannot collide with the normal API.
  private gattQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.name = "";
    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristicCache = new Map();
  }

  private enqueueGatt = <T,>(operation: () => Promise<T>): Promise<T> => {
    const run = this.gattQueue.then(operation, operation);
    this.gattQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  private emitLog = (
    direction: BleDirection,
    characteristic?: string,
    bytes?: number[],
    message?: string,
  ) => {
    const entry: BleLogEntry = {
      id: ++this.logId,
      timestamp: new Date(),
      direction,
      characteristic,
      bytes,
      message,
    };

    this.logHistory.push(entry);
    if (this.logHistory.length > 500) {
      this.logHistory.splice(0, this.logHistory.length - 500);
    }

    this.logListeners.forEach(listener => listener(entry));
  };

  subscribeLogs = (listener: (entry: BleLogEntry) => void): (() => void) => {
    this.logHistory.forEach(entry => listener(entry));
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  };

  getLogs = (): BleLogEntry[] => [...this.logHistory];

  clearLogs = (): void => {
    this.logHistory = [];
  };

  waitForRx = (
    characteristicUuid: string,
    predicate: (bytes: number[]) => boolean = () => true,
    timeoutMs = 2500,
  ): Promise<number[]> => {
    return new Promise((resolve, reject) => {
      const wantedUuid = characteristicUuid.toLowerCase();

      const cleanup = () => {
        clearTimeout(timeout);
        this.logListeners.delete(listener);
      };

      const listener = (entry: BleLogEntry) => {
        if (
          entry.direction === 'RX' &&
          entry.characteristic?.toLowerCase() === wantedUuid &&
          entry.bytes &&
          predicate(entry.bytes)
        ) {
          cleanup();
          resolve([...entry.bytes]);
        }
      };

      const timeout = setTimeout(() => {
        this.logListeners.delete(listener);
        reject(new Error(`Timed out waiting for RX on ${characteristicUuid}`));
      }, timeoutMs);

      // Deliberately listen only for future traffic; unlike subscribeLogs(),
      // this does not replay history and therefore cannot match a stale packet.
      this.logListeners.add(listener);
    });
  };

  start = async (): Promise<void> => {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          {
            services: [CasioConstants.CASIO_SERVICE],
          },
        ],
        optionalServices: [
          CasioConstants.WATCH_FEATURES_SERVICE_UUID,
          CasioConstants.IMMEDIATE_ALERT_SERVICE_UUID,
          ...OPTIONAL_RECON_SERVICES,
        ],
      });

      await this.initDevice(device);
    } catch (error) {
      console.error('Bluetooth error:', error);
      this.emitLog('ERROR', undefined, undefined, String(error));
    }
  };

  private initDevice = async (device: BluetoothDevice): Promise<void> => {
    if (this.isConnected() || this.connecting) return;

    this.connecting = true;

    try {
      this.device = device;
      const server = await device.gatt!.connect();
      this.server = server;

      await new Promise(resolve => setTimeout(resolve, 1000));

      device.addEventListener('gattserverdisconnected', () => {
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristicCache.clear();
        this.gattQueue = Promise.resolve();
        this.emitLog('INFO', undefined, undefined, 'Watch disconnected');
        progressEvents.onNext("Disconnected");
      });

      watchInfo.setNameAndModel(device.name!);

      try {
        this.service = await server.getPrimaryService(CasioConstants.WATCH_FEATURES_SERVICE_UUID);

        const characteristics = await this.service.getCharacteristics();
        for (const char of characteristics) {
          this.characteristicCache.set(normalizeUuid(char.uuid), char);
          if (char.properties.notify || char.properties.indicate) {
            await char.startNotifications();
            char.addEventListener('characteristicvaluechanged', (event: Event) => {
              const target = event.target as BluetoothRemoteGATTCharacteristic;
              if (target.value) {
                const bytes = Array.from(new Uint8Array(
                  target.value.buffer,
                  target.value.byteOffset,
                  target.value.byteLength,
                ));
                this.emitLog('RX', target.uuid, bytes);
                if (this.dataReceivedCallback) {
                  this.dataReceivedCallback(target.value, target.uuid);
                }
              }
            });
          }
        }

        this.emitLog('INFO', undefined, undefined, `Connected to ${device.name ?? 'G-Shock'}`);
        progressEvents.onNext("Connected");
      } catch (e) {
        console.error("Failed to get services/characteristics", e);
        this.emitLog('ERROR', undefined, undefined, `Service discovery failed: ${String(e)}`);
        progressEvents.onNext("Connected");
      }
    } finally {
      this.connecting = false;
    }
  };

  stop = (): void => {
    if (this.device && this.device.gatt) {
      this.device.gatt.disconnect();
    }
    progressEvents.onNext("Disconnected");
  };

  private getCharacteristic = async (uuid: string): Promise<BluetoothRemoteGATTCharacteristic> => {
    const normalized = normalizeUuid(uuid);
    let characteristic = this.characteristicCache.get(normalized);
    if (characteristic) return characteristic;

    if (!this.service) {
      throw new Error('Watch features service is not available');
    }

    characteristic = await this.service.getCharacteristic(uuid);
    this.characteristicCache.set(normalized, characteristic);
    return characteristic;
  };

  write = async (handleOrUuid: string, value: any): Promise<void> => {
    return this.enqueueGatt(async () => {
      try {
        const characteristic = await this.getCharacteristic(handleOrUuid);
        const bytes = Array.from(new Uint8Array(value));
        await characteristic.writeValue(new Uint8Array(bytes));
        this.emitLog('TX', characteristic.uuid, bytes);
        console.log(`Write: ${handleOrUuid} | value: ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      } catch (e) {
        console.error(`Characteristic ${handleOrUuid} write failed`, e);
        this.emitLog('ERROR', handleOrUuid, undefined, String(e));
        throw e;
      }
    });
  };

  writeRaw = async (uuid: string, bytes: number[]): Promise<void> => {
    if (!bytes.length) throw new Error('Payload is empty');
    if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new Error('Payload contains an invalid byte');
    }
    await this.write(uuid, bytes);
  };

  readRaw = async (uuid: string): Promise<number[]> => {
    return this.enqueueGatt(async () => {
      const characteristic = await this.getCharacteristic(uuid);
      if (!characteristic.properties.read) {
        throw new Error('Characteristic is not readable');
      }
      const value = await characteristic.readValue();
      const bytes = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      this.emitLog('RX', characteristic.uuid, bytes, 'Read');
      return bytes;
    });
  };

  runGattReconnaissance = async (): Promise<BleGattReconReport> => {
    return this.enqueueGatt(async () => {
      if (!this.server || !this.isConnected()) {
        throw new Error('Watch is not connected');
      }

      const report: BleGattReconReport = {
        deviceName: this.device?.name ?? 'G-Shock',
        scannedAt: new Date(),
        services: [],
        dfuCandidates: [],
      };

      const services = await this.server.getPrimaryServices();
      let characteristicCount = 0;

      for (const service of services) {
        const serviceUuid = normalizeUuid(service.uuid);
        const dfuLabel = DFU_SERVICES[serviceUuid];
        const serviceInfo: BleGattServiceInfo = {
          uuid: service.uuid,
          label: SERVICE_LABELS[serviceUuid],
          potentialDfu: !!dfuLabel,
          characteristics: [],
        };

        if (dfuLabel) {
          report.dfuCandidates.push(`${dfuLabel}: ${service.uuid}`);
        }

        let characteristics: BluetoothRemoteGATTCharacteristic[] = [];
        try {
          characteristics = await service.getCharacteristics();
        } catch (e) {
          this.emitLog('ERROR', undefined, undefined, `Recon could not enumerate ${service.uuid}: ${String(e)}`);
          report.services.push(serviceInfo);
          continue;
        }

        for (const char of characteristics) {
          characteristicCount += 1;
          const charUuid = normalizeUuid(char.uuid);
          this.characteristicCache.set(charUuid, char);

          const info: BleCharacteristicInfo = {
            uuid: char.uuid,
            serviceUuid: service.uuid,
            read: char.properties.read,
            write: char.properties.write,
            writeWithoutResponse: char.properties.writeWithoutResponse,
            notify: char.properties.notify,
            indicate: char.properties.indicate,
            label: CHARACTERISTIC_LABELS[charUuid],
            potentialDfu: !!dfuLabel,
          };

          if (char.properties.read && isSafeAutoRead(serviceUuid, charUuid)) {
            try {
              const value = await char.readValue();
              const bytes = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
              info.valueBytes = bytes;

              if (charUuid === BATTERY_LEVEL_CHARACTERISTIC && bytes.length) {
                report.batteryLevel = bytes[0];
                info.valueText = `${bytes[0]}%`;
              } else {
                const text = decodeText(bytes);
                if (text) info.valueText = text;
              }

              const text = info.valueText;
              if (charUuid === MODEL_NUMBER_CHARACTERISTIC) report.modelNumber = text;
              if (charUuid === SERIAL_NUMBER_CHARACTERISTIC) report.serialNumber = text;
              if (charUuid === FIRMWARE_REVISION_CHARACTERISTIC) report.firmwareRevision = text;
              if (charUuid === HARDWARE_REVISION_CHARACTERISTIC) report.hardwareRevision = text;
              if (charUuid === SOFTWARE_REVISION_CHARACTERISTIC) report.softwareRevision = text;
              if (charUuid === MANUFACTURER_NAME_CHARACTERISTIC) report.manufacturerName = text;
            } catch (e) {
              // A readable property can still require security or reject reads.
              // Keep the characteristic in the map and report the failure only.
              this.emitLog('INFO', char.uuid, undefined, `Recon read blocked: ${String(e)}`);
            }
          }

          serviceInfo.characteristics.push(info);
        }

        report.services.push(serviceInfo);
      }

      this.emitLog(
        'INFO',
        undefined,
        undefined,
        `GATT recon: ${report.services.length} services, ${characteristicCount} characteristics`,
      );

      const deviceInfoPairs: Array<[string, string | number | undefined]> = [
        ['Model', report.modelNumber],
        ['Serial', report.serialNumber],
        ['Firmware', report.firmwareRevision],
        ['Hardware', report.hardwareRevision],
        ['Software', report.softwareRevision],
        ['Manufacturer', report.manufacturerName],
        ['Battery', report.batteryLevel === undefined ? undefined : `${report.batteryLevel}%`],
      ];
      deviceInfoPairs.forEach(([label, value]) => {
        if (value !== undefined && value !== '') {
          this.emitLog('INFO', undefined, undefined, `${label}: ${value}`);
        }
      });

      if (report.dfuCandidates.length) {
        report.dfuCandidates.forEach(candidate => {
          this.emitLog('INFO', undefined, undefined, `DFU candidate: ${candidate}`);
        });
      } else {
        this.emitLog('INFO', undefined, undefined, 'No known DFU/bootloader service detected in the permitted GATT set');
      }

      report.services.forEach(serviceInfo => {
        const label = serviceInfo.label ? ` (${serviceInfo.label})` : '';
        this.emitLog('INFO', undefined, undefined, `Service ${serviceInfo.uuid}${label}`);
      });

      return report;
    });
  };

  getCharacteristicInfo = async (): Promise<BleCharacteristicInfo[]> => {
    const report = await this.runGattReconnaissance();
    return report.services.flatMap(serviceInfo => serviceInfo.characteristics);
  };

  setDataReceivedCallback = (callback: (receivedData: DataView, characteristicUuid: string) => void): void => {
    this.dataReceivedCallback = callback;
  };

  sendMessage = async (_message: string): Promise<void> => {
    console.warn("Connection.sendMessage is deprecated. Use MessageDispatcher directly if needed.");
  };

  isConnected = (): boolean => {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  };
}

export const connection = new Connection();