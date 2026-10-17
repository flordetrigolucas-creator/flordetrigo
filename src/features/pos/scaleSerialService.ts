/**
 * Serviço Hardware Bridge para Balanças de Checkout (Web Serial API — `navigator.serial`)
 * Compatível com protocolo Toledo Prix / Filizola (9600 bps, 8N1, frames STX 0x02 ... ETX 0x03)
 * e com Simulador Determinístico integrado para ambiente de desenvolvimento.
 */

export type ScaleConnectionState = 'DISCONNECTED' | 'CONNECTED_SERIAL' | 'SIMULATED';

export interface ScaleReading {
  weightGrams: number;
  weightKg: number;
  stable: boolean;
  source: 'WEB_SERIAL' | 'SIMULATOR';
  timestamp: string;
}

type ReadingListener = (reading: ScaleReading) => void;

class ScaleSerialServiceImpl {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private state: ScaleConnectionState = 'DISCONNECTED';
  private lastReading: ScaleReading = {
    weightGrams: 0,
    weightKg: 0,
    stable: true,
    source: 'SIMULATOR',
    timestamp: new Date().toISOString(),
  };
  private listeners = new Set<ReadingListener>();

  public isWebSerialSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  public getState(): ScaleConnectionState {
    return this.state;
  }

  public getLastReading(): ScaleReading {
    return this.lastReading;
  }

  public subscribe(listener: ReadingListener): () => void {
    this.listeners.add(listener);
    listener(this.lastReading);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(reading: ScaleReading): void {
    this.lastReading = reading;
    for (const listener of this.listeners) {
      listener(reading);
    }
  }

  /**
   * Abre porta serial física via Web Serial API (`navigator.serial.requestPort`)
   * e inicia leitura contínua do prato da balança.
   */
  public async connectHardwareScale(baudRate = 9600): Promise<void> {
    if (!this.isWebSerialSupported()) {
      throw new Error('Web Serial API não suportada neste navegador (utilize Chrome/Edge ou o botão Simular).');
    }

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none' });
    this.port = port;
    this.state = 'CONNECTED_SERIAL';

    this.readLoop().catch(() => {
      this.state = 'DISCONNECTED';
    });
  }

  private async readLoop(): Promise<void> {
    if (!this.port?.readable) return;
    const reader = this.port.readable.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          // Protocolo Toledo Prix envia 5 dígitos em gramas entre STX (\x02) e ETX (\x03) ou CR
          const match = buffer.match(/(\d{5})/);
          if (match?.[1]) {
            const grams = Number(match[1]);
            buffer = '';
            this.emit({
              weightGrams: grams,
              weightKg: Number((grams / 1000).toFixed(3)),
              stable: true,
              source: 'WEB_SERIAL',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.reader?.cancel();
      await this.port?.close();
    } catch {
      // ignora erro de fechamento
    } finally {
      this.reader = null;
      this.port = null;
      this.state = 'DISCONNECTED';
    }
  }

  /**
   * Simula a leitura física da balança para desenvolvimento e homologação rápida no PDV.
   */
  public simulateWeightReading(weightGrams?: number): ScaleReading {
    this.state = 'SIMULATED';
    // Se não informado, sorteia pesos típicos de padaria (ex.: 6 pães franceses ~ 310g a 680g)
    const sampleWeights = [215, 310, 365, 420, 515, 640, 850];
    const chosenGrams =
      weightGrams ?? sampleWeights[Math.floor(Math.random() * sampleWeights.length)] ?? 350;

    const reading: ScaleReading = {
      weightGrams: chosenGrams,
      weightKg: Number((chosenGrams / 1000).toFixed(3)),
      stable: true,
      source: 'SIMULATOR',
      timestamp: new Date().toISOString(),
    };
    this.emit(reading);
    return reading;
  }
}

export const ScaleSerialService = new ScaleSerialServiceImpl();

