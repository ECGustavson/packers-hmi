// Beckhoff TwinCAT driver (ADS).
// The tag list comes from the PLC itself: every variable under HMI_PREFIX, with writability set
// by {attribute 'hmi_write'}. The PLC pushes changes (ADS notifications), so there's no polling.

import { Client } from 'ads-client';
import { Driver, DriverEvents, TagInfo } from './driver';

export type AdsOptions = {
  netId: string;        // AMS Net ID, or localhost
  port: number;         // PLC runtime port, 851 for the first PLC
  subscribeMs: number;  // how often the PLC checks each tag for changes
  prefix: string;       // lowercase, e.g. gvl_hmi.
  writeAttr: string;    // lowercase attribute name, e.g. hmi_write
};

export class AdsDriver implements Driver {
  private ads: Client;
  private events!: DriverEvents;

  constructor(private opts: AdsOptions) {
    this.ads = new Client({ targetAmsNetId: opts.netId, targetAdsPort: opts.port });
  }

  async start(events: DriverEvents) {
    this.events = events;

    // ads-client reconnects and restores subscriptions on its own; just report the state
    this.ads.on('connectionLost', () => events.onStatus(false));
    this.ads.on('reconnect', () => events.onStatus(true));

    // PLC download or online change: variables may have been added, removed or retyped
    this.ads.on('plcSymbolVersionChange', async () => {
      console.log('PLC program changed, reloading tags...');
      try {
        await this.ads.unsubscribeAll();
        await this.discover();
      } catch (err) {
        console.error('Tag reload failed:', err);
      }
    });

    await this.ads.connect();   // throws if the PLC isn't reachable at startup
    events.onStatus(true);
    await this.discover();
  }

  async write(path: string, value: unknown) {
    await this.ads.writeValue(path, value);
  }

  // Read the PLC symbol table, keep everything under the prefix, subscribe to it
  private async discover() {
    const symbols = await this.ads.getSymbols();
    const tags: TagInfo[] = [];

    for (const sym of Object.values(symbols)) {
      if (!sym.name.toLowerCase().startsWith(this.opts.prefix)) continue;
      const writable = sym.attributes.some((a) => a.name.toLowerCase() === this.opts.writeAttr);
      const dataType = await this.ads.getDataType(sym.type);
      tags.push({ name: sym.name, writable, isStruct: dataType.subItems.length > 0 });
    }

    if (tags.length === 0) console.warn(`No PLC variables found under "${this.opts.prefix}". Check HMI_PREFIX.`);
    this.events.onTags(tags);

    for (const { name } of tags) {
      await this.ads.subscribeValue(name, (data) => this.events.onValue(name, data.value), this.opts.subscribeMs);
    }
  }
}
