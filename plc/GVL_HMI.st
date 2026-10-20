// Everything the HMI can see. The server reads this list from the PLC at startup
// and again after every download or online change, so there is no tag list to maintain elsewhere.
//
// {attribute 'hmi_write'} on the line above a variable makes it writable from the HMI.
//   Plain variable (BOOL, REAL, ...): the HMI writes the variable itself.
//   ST_Analog:                        the HMI writes fValue only.
{attribute 'qualified_only'}
VAR_GLOBAL
    // --- Commands: HMI sets TRUE, PLC acts and clears ---
    {attribute 'hmi_write'}
    bStartCmd   : BOOL;
    {attribute 'hmi_write'}
    bStopCmd    : BOOL;

    // --- Status ---
    bRunning    : BOOL;
    nBatchCount : DINT;

    // --- Analog values ---
    {attribute 'hmi_write'}
    stSpeedSP   : ST_Analog := (fValue := 250, fMin := 0, fMax := 500, sEU := "ft/min");   // operator setpoint
    stSpeedPV   : ST_Analog := (fMin := 0, fMax := 600, sEU := "ft/min");                   // measured speed
END_VAR


// =====================================================================
// In MAIN (or the relevant program)
// =====================================================================

// Momentary commands. Stop wins if both arrive in the same scan.
IF GVL_HMI.bStopCmd THEN
    GVL_HMI.bRunning := FALSE;
    GVL_HMI.bStopCmd := FALSE;
ELSIF GVL_HMI.bStartCmd THEN
    GVL_HMI.bRunning := TRUE;
    GVL_HMI.bStartCmd := FALSE;
END_IF

// Enforce setpoint limits in the PLC. The HMI's range check is only a convenience for the operator.
GVL_HMI.stSpeedSP.fValue := LIMIT(GVL_HMI.stSpeedSP.fMin, GVL_HMI.stSpeedSP.fValue, GVL_HMI.stSpeedSP.fMax);
