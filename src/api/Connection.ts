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
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}

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
    return () => this.logListeners.delete(listener);
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
          'battery_service',
          'device_information'
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
          this.characteristicCache.set(char.uuid, char);
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
    if (!this.service) {
      throw new Error('Watch features service is not available');
    }

    let characteristic = this.characteristicCache.get(uuid);
    if (!characteristic) {
      characteristic = await this.service.getCharacteristic(uuid);
      this.characteristicCache.set(uuid, characteristic);
    }
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

  getCharacteristicInfo = async (): Promise<BleCharacteristicInfo[]> => {
    return this.enqueueGatt(async () => {
      if (!this.service) return [];
      const characteristics = await this.service.getCharacteristics();
      characteristics.forEach(char => this.characteristicCache.set(char.uuid, char));
      return characteristics.map(char => ({
        uuid: char.uuid,
        read: char.properties.read,
        write: char.properties.write,
        writeWithoutResponse: char.properties.writeWithoutResponse,
        notify: char.properties.notify,
        indicate: char.properties.indicate,
      }));
    });
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