// Analog value with range and engineering units, modeled on OPC UA's AnalogItem.
// Used for both setpoints and process values:
//   Setpoint:      fMin/fMax = allowed entry range. The HMI rejects out-of-range entries, the PLC enforces it.
//   Process value: fMin/fMax = instrument range (for bar graphs, gauges, trend scaling).
// Whether the HMI can write it comes from {attribute 'hmi_write'}, not from this type.
// On a writable instance, the HMI may write fValue only. fMin, fMax and sEU stay PLC-owned.
TYPE ST_Analog :
STRUCT
    fValue : REAL;
    fMin   : REAL;
    fMax   : REAL;
    sEU    : WSTRING(15);   // Engineering units. WSTRING so °F, µS/cm, m³/h display correctly.
END_STRUCT
END_TYPE
