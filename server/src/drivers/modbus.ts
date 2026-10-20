// Modbus TCP driver, for PLCs without a symbol table (AutomationDirect CLICK, Productivity, etc.).
//
// The tag list comes from a JSON map (MODBUS_TAGS, default modbus-tags.json). Each entry names a tag
// the screens use and gives its Modbus address and data type. Values are read by polling:
// tags next to each other are read in one request, and only changed values are sent to the screens.
//
// Addresses use the 6-digit (or 5-digit) Modbus notation shown in most PLC software:
//   0xxxxx  coil              BOOL, writable
//   1xxxxx  discrete input    BOOL, read-only
//   3xxxxx  input register    numbers, read-only
//   4xxxxx  holding register  numbers, writable
// The remaining digits are 1-based: 400001 is the first holding register.

import ModbusRTU from 'modbus-serial';
import { readFileSync } from 'fs';
import { Driver, DriverEvents } from './driver';

export type ModbusOptions = {
  host: string;
  port: number;
  unitId: number;
  pollMs: number;          // time between polls
  timeoutMs: number;       // per request
  lowWordFirst: boolean;   // 32-bit word order. AutomationDirect PLCs put the low word first.
  tagsFile: string;
};

type Table = 'coil' | 'input' | 'inputRegister' | 'holding';
type DataType = 'BOOL' | 'INT' | 'UINT' | 'DINT' | 'UDINT' | 'REAL';

type ModbusTag = {
  name: string;
  address: string;     // as written in the map, for error messages
  table: Table;
  offset: number;      // 0-based protocol address
  type: DataType;
  words: number;       // registers (or bits) used
  writable: boolean;
  analog?: { min: number; max: number; eu: string };   // presented to screens as ST_Analog
};

type Block = { table: Table; start: number; count: number; tags: ModbusTag[] };

const TABLES: Record<string, Table> = { '0': 'coil', '1': 'input', '3': 'inputRegister', '4': 'holding' };
const WORDS: Record<DataType, number> = { BOOL: 1, INT: 1, UINT: 1, DINT: 2, UDINT: 2, REAL: 2 };
const RANGES: Partial<Record<DataType, [number, number]>> = {
  INT: [-32768, 32767], UINT: [0, 65535], DINT: [-2147483648, 2147483647], UDINT: [0, 4294967295],
};

const MAX_REGISTERS = 120;   // per read request (protocol limit is 125)
const MAX_BITS = 2000;       // per read request
const MAX_GAP = 8;           // read through gaps this small rather than send another request
const RECONNECT_MS = 2000;

export class ModbusDriver implements Driver {
  private client = new ModbusRTU();
  private events!: DriverEvents;
  private tags = new Map<string, ModbusTag>();   // keyed by lowercase name
  private blocks: Block[] = [];
  private lastSent = new Map<string, string>();  // last value sent per tag, to send changes only
  private connected = false;
  private queue: Promise<unknown> = Promise.resolve();
  private reportedBlocks = new Set<string>();    // read errors already logged, so the log isn't flooded

  constructor(private opts: ModbusOptions) {}

  async start(events: DriverEvents) {
    this.events = events;

    const list = loadTags(this.opts.tagsFile);   // throws on a bad map, so mistakes show at startup
    for (const tag of list) this.tags.set(tag.name.toLowerCase(), tag);
    this.blocks = buildBlocks(list);

    console.log(`Modbus: ${list.length} tags in ${this.blocks.length} read requests, ` +
      `${this.opts.host}:${this.opts.port} unit ${this.opts.unitId}`);
    events.onTags(list.map((t) => ({ name: t.name, writable: t.writable, isStruct: !!t.analog })));

    this.pollLoop();   // keeps trying until the PLC answers, so the server starts even if it's off
  }

  async write(path: string, value: unknown) {
    if (!this.connected) throw new Error('PLC not connected');

    // A plain tag, or <analog tag>.fValue (the server has already checked which member)
    const p = path.toLowerCase();
    const tag = this.tags.get(p) ?? this.tags.get(p.slice(0, p.lastIndexOf('.')));
    if (!tag) throw new Error(`Unknown tag: ${path}`);

    await this.exclusive(async () => {
      if (tag.table === 'coil') {
        if (typeof value !== 'boolean') throw new Error(`${tag.name} needs TRUE or FALSE`);
        await this.client.writeCoil(tag.offset, value);
        return;
      }
      const registers = encode(tag, value, this.opts.lowWordFirst);
      if (registers.length === 1) await this.client.writeRegister(tag.offset, registers[0]);
      else await this.client.writeRegisters(tag.offset, registers);
    });
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private async pollLoop() {
    const started = Date.now();
    try {
      await this.exclusive(() => this.poll());
      this.setConnected(true);
    } catch (err) {
      this.setConnected(false, err);
    }
    const wait = this.connected ? Math.max(0, this.opts.pollMs - (Date.now() - started)) : RECONNECT_MS;
    setTimeout(() => this.pollLoop(), wait);
  }

  private async poll() {
    if (!this.client.isOpen) {
      await this.client.connectTCP(this.opts.host, { port: this.opts.port });
      this.client.setID(this.opts.unitId);
      this.client.setTimeout(this.opts.timeoutMs);
    }

    for (const block of this.blocks) {
      let data: (number | boolean)[];
      try {
        data = await this.read(block);
      } catch (err: any) {
        // No modbusCode means a timeout or socket error: a connection problem, so give up this poll
        if (err?.modbusCode === undefined) throw err;
        // A Modbus exception (e.g. illegal address) is a mapping problem in this block; read the rest
        this.reportBlockError(block, err);
        continue;
      }
      for (const tag of block.tags) {
        this.publish(tag, decode(tag, data, tag.offset - block.start, this.opts.lowWordFirst));
      }
    }
  }

  private async read(block: Block): Promise<(number | boolean)[]> {
    switch (block.table) {
      case 'coil': return (await this.client.readCoils(block.start, block.count)).data;
      case 'input': return (await this.client.readDiscreteInputs(block.start, block.count)).data;
      case 'inputRegister': return (await this.client.readInputRegisters(block.start, block.count)).data;
      case 'holding': return (await this.client.readHoldingRegisters(block.start, block.count)).data;
    }
  }

  private publish(tag: ModbusTag, value: unknown) {
    const text = JSON.stringify(value);
    if (this.lastSent.get(tag.name) === text) return;
    this.lastSent.set(tag.name, text);
    this.events.onValue(tag.name, value);
  }

  private setConnected(connected: boolean, err?: unknown) {
    if (!connected) this.client.close(() => {});   // drop a stale socket; the next poll reconnects
    if (connected === this.connected) return;
    this.connected = connected;
    if (connected) console.log('Modbus: connected');
    else console.warn(`Modbus: connection lost (${err instanceof Error ? err.message : err}). Retrying...`);
    this.events.onStatus(connected);
  }

  private reportBlockError(block: Block, err: Error) {
    const key = `${block.table}:${block.start}`;
    if (this.reportedBlocks.has(key)) return;
    this.reportedBlocks.add(key);
    const names = block.tags.map((t) => `${t.name} (${t.address})`).join(', ');
    console.error(`Modbus: the PLC rejected a read of ${names}: ${err.message}. Check these addresses.`);
  }

  // One request at a time on the socket: writes wait for the current poll and vice versa
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
}

// ---------------------------------------------------------------------------
// Tag map
// ---------------------------------------------------------------------------

type TagEntry = { address?: unknown; type?: unknown; writable?: unknown; min?: unknown; max?: unknown; eu?: unknown };

function loadTags(file: string): ModbusTag[] {
  const map: Record<string, TagEntry> = JSON.parse(readFileSync(file, 'utf8'));
  return Object.entries(map)
    .filter(([name]) => !name.startsWith('//'))   // keys starting with // are comments
    .map(([name, entry]) => parseTag(name, entry));
}

function parseTag(name: string, e: TagEntry): ModbusTag {
  const fail = (msg: string): never => { throw new Error(`modbus-tags: ${name}: ${msg}`); };

  // Address: "400001" style. Strings, because coil addresses start with 0.
  if (typeof e.address !== 'string' || !/^[0134]\d{4,5}$/.test(e.address)) {
    fail('address must be a 5- or 6-digit string starting with 0, 1, 3 or 4, e.g. "400001"');
  }
  const address = e.address as string;
  const table = TABLES[address[0]];
  const offset = Number(address.slice(1)) - 1;
  if (offset < 0 || offset > 65535) fail(`address ${address} is out of range`);

  const bitTable = table === 'coil' || table === 'input';
  const type = (e.type ?? (bitTable ? 'BOOL' : 'INT')) as DataType;
  if (!(type in WORDS)) fail(`type must be one of ${Object.keys(WORDS).join(', ')}`);
  if (bitTable && type !== 'BOOL') fail('coils and discrete inputs are BOOL');
  if (!bitTable && type === 'BOOL') fail('BOOL needs a coil (0xxxxx) or discrete input (1xxxxx) address');

  const writable = e.writable === true;
  if (writable && (table === 'input' || table === 'inputRegister')) fail('inputs are read-only');

  // min, max or eu makes it an analog value, shown to the screens as an ST_Analog
  let analog: ModbusTag['analog'];
  if (e.min !== undefined || e.max !== undefined || e.eu !== undefined) {
    if (type === 'BOOL') fail('min, max and eu are for numbers');
    if (typeof e.min !== 'number' || typeof e.max !== 'number' || e.min > e.max) {
      fail('analog values need numeric min and max, with min <= max');
    }
    analog = { min: e.min as number, max: e.max as number, eu: typeof e.eu === 'string' ? e.eu : '' };
  }

  return { name, address, table, offset, type, words: WORDS[type], writable, analog };
}

// Group tags into as few read requests as possible
function buildBlocks(tags: ModbusTag[]): Block[] {
  const blocks: Block[] = [];
  const sorted = [...tags].sort((a, b) => a.table.localeCompare(b.table) || a.offset - b.offset);

  for (const tag of sorted) {
    const limit = tag.type === 'BOOL' ? MAX_BITS : MAX_REGISTERS;
    const block = blocks[blocks.length - 1];
    const end = tag.offset + tag.words;
    if (block && block.table === tag.table
      && tag.offset - (block.start + block.count) <= MAX_GAP
      && end - block.start <= limit) {
      block.count = Math.max(block.count, end - block.start);
      block.tags.push(tag);
    } else {
      blocks.push({ table: tag.table, start: tag.offset, count: tag.words, tags: [tag] });
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Value conversion
// ---------------------------------------------------------------------------

function decode(tag: ModbusTag, data: (number | boolean)[], i: number, lowWordFirst: boolean): unknown {
  let value: number | boolean;

  if (tag.type === 'BOOL') {
    value = data[i] === true;
  } else if (tag.words === 1) {
    const word = data[i] as number;
    value = tag.type === 'INT' ? (word << 16) >> 16 : word;   // INT is signed
  } else {
    const [hi, lo] = lowWordFirst ? [data[i + 1], data[i]] : [data[i], data[i + 1]];
    const buf = Buffer.alloc(4);
    buf.writeUInt16BE(hi as number, 0);
    buf.writeUInt16BE(lo as number, 2);
    value = tag.type === 'REAL' ? buf.readFloatBE(0)
      : tag.type === 'DINT' ? buf.readInt32BE(0) : buf.readUInt32BE(0);
  }

  return tag.analog
    ? { fValue: value, fMin: tag.analog.min, fMax: tag.analog.max, sEU: tag.analog.eu }
    : value;
}

function encode(tag: ModbusTag, value: unknown, lowWordFirst: boolean): number[] {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${tag.name} needs a number`);

  const range = RANGES[tag.type];
  if (range && (!Number.isInteger(value) || value < range[0] || value > range[1])) {
    throw new Error(`${tag.name} needs a whole number from ${range[0]} to ${range[1]}`);
  }
  if (tag.words === 1) return [value & 0xffff];

  const buf = Buffer.alloc(4);
  if (tag.type === 'REAL') buf.writeFloatBE(value, 0);
  else if (tag.type === 'DINT') buf.writeInt32BE(value, 0);
  else buf.writeUInt32BE(value, 0);
  const hi = buf.readUInt16BE(0);
  const lo = buf.readUInt16BE(2);
  return lowWordFirst ? [lo, hi] : [hi, lo];
}
