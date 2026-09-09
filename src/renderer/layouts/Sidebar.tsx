import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Settings as SettingsIcon,
  Terminal,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { clsx } from 'clsx';

export const CapCutLogo: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24.19 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M24.189 6.442V2.671l-4.535 2.383V4.91c.002-1.505-1.078-2.411-2.638-2.411H2.64C.993 2.5 0 3.407 0 4.91V8.72L6.354 12 0 15.316v3.8C0 20.595 1 21.5 2.64 21.5h14.373c1.56 0 2.639-.907 2.639-2.382v-.197l4.536 2.409v-3.828L13.64 12 24.19 6.443zM9.982 13.873l7.797 4.083H2.157l7.825-4.083zm7.741-7.828l-7.742 4.057-7.825-4.057h15.567z" />
  </svg>
);

export const Sidebar: React.FC = () => {
  const mainNavItems = [
    { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
    { to: '/accounts', label: 'Accounts', icon: <Users className="w-[18px] h-[18px]" /> },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon className="w-[18px] h-[18px]" /> },
    { to: '/logs', label: 'Logs', icon: <Terminal className="w-[18px] h-[18px]" /> },
  ];

  const footerNavItems = [
    { to: '#support', label: 'Support', icon: <HelpCircle className="w-[18px] h-[18px]" /> },
    { to: '#docs', label: 'Documentation', icon: <FileText className="w-[18px] h-[18px]" /> },
  ];

  return (
    <aside className="w-sidebar h-screen fixed left-0 top-0 border-r border-panel-border bg-panel flex flex-col justify-between py-xl z-50 select-none">
      {/* Brand Header */}
      <div>
        <div className="px-lg mb-8 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20 shrink-0">
            <CapCutLogo className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-headline-md text-[15px] leading-tight text-on-surface font-semibold tracking-tight">
              CapCut Automation
            </h1>
            <p className="font-label-xs text-[11px] text-on-surface-variant font-medium">Auto Task v3.0</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex flex-col gap-1 px-sm">
          {mainNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-md px-lg py-sm rounded-lg active:scale-95 duration-150 font-body-sm transition-all',
                  isActive
                    ? 'bg-secondary-container text-on-secondary-container font-semibold shadow-xs'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Sidebar Footer */}
      <div className="px-sm mt-auto border-t border-panel-border pt-md">
        <nav className="flex flex-col gap-1">
          {footerNavItems.map((item) => (
            <a
              key={item.label}
              href={item.to}
              onClick={(e) => e.preventDefault()}
              className="flex items-center gap-md px-lg py-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors rounded-lg active:scale-95 duration-150 font-body-sm"
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
};
