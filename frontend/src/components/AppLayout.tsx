import { ReactNode } from 'react';
import Sidebar, { MobileNav } from './Sidebar';

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[var(--bg)]">
      <MobileNav />
      <div className="flex flex-1 min-w-0">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}
