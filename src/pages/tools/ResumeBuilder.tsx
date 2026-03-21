import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, FlaskConical } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

export default function ResumeBuilder() {
  return (
    <PageLayout title="Resume Builder | TrueBeast Tools" gradientVariant="purple">
      <section className="py-20 sm:py-28">
        <div className="max-w-[56rem] mx-auto px-4 sm:px-6">

          <Link
            to="/tools"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors mb-10"
          >
            <ArrowLeft size={14} />
            Back to Tools
          </Link>

          <div className="text-center mb-10 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <FileText size={16} className="text-amber-400" />
              <span className="text-sm text-gray-300 font-medium">Productivity</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">Resume Builder</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Build a polished resume in minutes and export it as a PDF. Free forever.
            </p>
          </div>

          {/* Beta disclaimer */}
          <div className="glass rounded-2xl p-4 flex items-start gap-3 border border-yellow-500/20 bg-yellow-500/5">
            <FlaskConical size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-semibold mb-0.5">Work in Progress</p>
              <p className="text-yellow-200/60 text-sm leading-relaxed">
                Resume Builder is still being built. Check back soon or follow along in the Discord for updates.
              </p>
            </div>
          </div>

        </div>
      </section>
    </PageLayout>
  );
}
