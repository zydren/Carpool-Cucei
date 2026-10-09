import type { ReactNode } from 'react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import { SectionHeader } from '../ui/PageBlocks';

export function AppShell({
  children,
  narrow = false,
}: {
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className={`mx-auto px-4 sm:px-6 lg:px-8 ${narrow ? 'max-w-3xl' : 'max-w-7xl'}`}>
          {children}
        </div>
      </div>
      <Footer />
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  back,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-8 sm:mb-10">
      {back && <div className="mb-5">{back}</div>}
      <SectionHeader eyebrow={eyebrow} title={title} description={description} action={action} />
    </div>
  );
}
