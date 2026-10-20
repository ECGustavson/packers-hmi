// The interface every PLC driver implements. The server only talks to drivers through this,
// so the screens, logins and write rules work the same for every PLC type.

export type TagInfo = {
  name: string;       // tag name the screens use, e.g. GVL_HMI.stSpeedSP
  writable: boolean;  // the HMI may write it (subject to the struct rule below)
  isStruct: boolean;  // struct values (ST_Analog) only allow writes to their value member
};

export interface DriverEvents {
  onTags(tags: TagInfo[]): void;                 // tag list loaded or changed; values arrive after this
  onValue(name: string, value: unknown): void;   // a tag's value changed
  onStatus(connected: boolean): void;            // PLC connection came up or went down
}

export interface Driver {
  // Connect and start delivering tags and values through `events`
  start(events: DriverEvents): Promise<void>;
  // Write one value. `path` is a tag name, or `<struct tag>.<value member>`. The server checks
  // permissions and the write rule before calling this; the driver checks the value fits the type.
  write(path: string, value: unknown): Promise<void>;
}
