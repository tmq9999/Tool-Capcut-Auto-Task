import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Bot,
  LayoutDashboard,
  Users,
  Settings as SettingsIcon,
  Terminal,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { clsx } from 'clsx';

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
          <div className="w-8 h-8 rounded bg-primary-container flex items-center justify-center text-white shadow-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              AutoManager
            </h1>
            <p className="font-label-xs text-label-xs text-on-surface-variant">Enterprise v2.4</p>
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
