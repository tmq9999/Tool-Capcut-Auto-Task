import React from 'react';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

export interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="bg-background text-on-surface h-screen overflow-hidden flex font-body-md antialiased selection:bg-primary selection:text-on-primary">
      {/* Fixed Sidebar */}
      <Sidebar />

      {/* Main Viewport */}
      <main className="ml-sidebar flex-1 flex flex-col h-screen relative pb-control_height_sm overflow-hidden">
        {children}

        {/* Global Fixed Status Bar */}
        <StatusBar />
      </main>
    </div>
  );
};
