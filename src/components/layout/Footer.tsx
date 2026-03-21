import { SITE_CONFIG } from '@/config';

export default function Footer() {
  return (
    <footer className="glass mt-auto border-t border-white/[0.06]">
      <div className="mx-auto max-w-[72rem] px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/50">
        {/* Copyright */}
        <p>&copy; 2026 TrueBeast - Built by Kiernen Irons</p>

        {/* Links */}
        <div className="flex items-center gap-5">
          {SITE_CONFIG.social.discord && (
            <a
              href={SITE_CONFIG.social.discord}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white/80"
            >
              Discord
            </a>
          )}
          {SITE_CONFIG.social.youtube && (
            <a
              href={SITE_CONFIG.social.youtube}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white/80"
            >
              YouTube
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
