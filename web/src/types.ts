// TypeScript mirrors of the PLC data types. Keep in sync with plc/*.st.

// ST_Analog: value, range and engineering units
export interface Analog {
  fValue: number;
  fMin: number;
  fMax: number;
  sEU: string;
}

// Values arrive over the network, so check the shape before trusting it.
// A value that fails the check displays as "--" instead of breaking the screen.
export function isAnalog(v: unknown): v is Analog {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Analog;
  return typeof a.fValue === 'number' && typeof a.fMin === 'number'
    && typeof a.fMax === 'number' && typeof a.sEU === 'string';
}
