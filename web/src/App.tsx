// The screens. Edit this file per project; each item is one line with a PLC tag name.

import { useState } from 'react';
import { useHmi, useSession, useTag } from './connection';
import { AnalogReadout, CommandButton, Readout, SetpointEntry } from './components';
import { LoginDialog, SessionButton } from './session';
import { UsersScreen } from './UsersScreen';

export default function App() {
  const { serverConnected, connected, loginOpen } = useHmi();
  const { can } = useSession();
  const [screen, setScreen] = useState<'main' | 'users'>('main');

  // Leaves the users screen by itself if the Admin logs out or times out
  const showUsers = screen === 'users' && can('admin');

  return (
    <>
      {showUsers ? (
        <UsersScreen onBack={() => setScreen('main')} />
      ) : (
        <main className="hmi">
          <header>
            <h1>Line 1</h1>
            <div className="header-right">
              <span className={connected ? 'conn ok' : 'conn bad'}>
                {connected ? 'PLC connected' : serverConnected ? 'PLC disconnected' : 'HMI server offline'}
              </span>
              <SessionButton onManageUsers={() => setScreen('users')} />
            </div>
          </header>
          <MainScreen />
        </main>
      )}

      {loginOpen && <LoginDialog />}
    </>
  );
}

function MainScreen() {
  const { value, connected } = useTag('GVL_HMI.bRunning');
  const running = value === true;

  return (
    <>
      {/* With the PLC disconnected the state is unknown, so don't show a stale green lamp */}
      <div className="state">
        <span className={connected && running ? 'lamp on' : 'lamp'} />
        {!connected ? 'Unknown' : running ? 'Running' : 'Stopped'}
      </div>

      <div className="buttons">
        <CommandButton tag="GVL_HMI.bStartCmd" className="start" disabled={running}>Start</CommandButton>
        <CommandButton tag="GVL_HMI.bStopCmd" className="stop">Stop</CommandButton>
      </div>

      <AnalogReadout label="Speed" tag="GVL_HMI.stSpeedPV" />
      <Readout label="Batch count" tag="GVL_HMI.nBatchCount" />
      <SetpointEntry label="Speed setpoint" tag="GVL_HMI.stSpeedSP" minRole="supervisor" />
    </>
  );
}
