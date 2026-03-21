import { ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import GradientBackground, { type GradientVariant } from '@/components/layout/GradientBackground';
import Footer from '@/components/layout/Footer';
import Navigation from '@/components/layout/Navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageLayoutProps {
  children: ReactNode;
  gradientVariant?: GradientVariant;
  title?: string;
  description?: string;
  /** Set to false to hide the footer (e.g. on full-screen tool pages). */
  showFooter?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PageLayout({
  children,
  gradientVariant = 'green',
  title = 'TrueBeast',
  description = 'Gaming, content creation, and community - TrueBeast by Kiernen Irons.',
  showFooter = true,
}: PageLayoutProps) {
  return (
    <div className="relative min-h-screen flex flex-col">
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
      </Helmet>

      <GradientBackground variant={gradientVariant} />

      <Navigation />

      {/* Main content -- pt-24 accounts for fixed navigation height */}
      <main className="flex-1 pt-24">{children}</main>

      {showFooter && <Footer />}
    </div>
  );
}
