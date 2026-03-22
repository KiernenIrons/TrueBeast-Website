import { useState, type FormEvent } from 'react';
import { Star, Send, CheckCircle } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { GlassCard } from '@/components/shared/GlassCard';
import { FirebaseDB } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARS = 500;

const INPUT_CLASSES =
  'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SubmitReview() {
  const [name, setName] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const displayRating = hoverRating || rating;

  function resetForm() {
    setName('');
    setRating(0);
    setHoverRating(0);
    setText('');
    setSubmitted(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (rating === 0) return;

    setSubmitting(true);
    try {
      const id = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await FirebaseDB.saveReview({
        id,
        name: name.trim(),
        rating,
        text: text.trim(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit review:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageLayout gradientVariant="green" title="Leave a Review | TrueBeast">
      <section className="py-16 sm:py-24">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">

          {/* Header */}
          <div className="text-center space-y-4 mb-12">
            <h1 className="text-4xl sm:text-5xl font-bold font-display text-white">
              Leave a <span className="text-gradient">Review</span>
            </h1>
            <p className="text-gray-400 max-w-md mx-auto leading-relaxed">
              Had a great experience? Let others know — your feedback means a lot.
            </p>
          </div>

          {/* Success State */}
          {submitted ? (
            <GlassCard strong className="rounded-3xl p-8 sm:p-12 text-center space-y-6">
              <div className="flex justify-center">
                <CheckCircle className="w-16 h-16 text-green-400" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white">
                Thanks for your review!
              </h2>
              <p className="text-gray-400">
                It's been submitted for approval.
              </p>
              <button
                onClick={resetForm}
                className="glass-strong rounded-xl px-6 py-3 text-green-400 font-semibold hover:bg-white/10 transition-colors"
              >
                Submit Another
              </button>
            </GlassCard>
          ) : (
            /* Review Form */
            <GlassCard strong className="rounded-3xl p-8 sm:p-12">
              <form onSubmit={handleSubmit} className="space-y-6">

                {/* Name */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-300">
                    Name <span className="text-green-400 ml-1">*</span>
                  </label>
                  <input
                    className={INPUT_CLASSES}
                    type="text"
                    required
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                {/* Star Rating */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-300">
                    Rating <span className="text-green-400 ml-1">*</span>
                  </label>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }, (_, i) => {
                      const val = i + 1;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setRating(val)}
                          onMouseEnter={() => setHoverRating(val)}
                          onMouseLeave={() => setHoverRating(0)}
                          className="transition-transform hover:scale-110 focus:outline-none"
                          aria-label={`Rate ${val} star${val !== 1 ? 's' : ''}`}
                        >
                          <Star
                            className={`w-8 h-8 transition-colors ${
                              val <= displayRating
                                ? 'text-yellow-400 fill-current'
                                : 'text-gray-600'
                            }`}
                          />
                        </button>
                      );
                    })}
                    {rating > 0 && (
                      <span className="ml-3 text-sm text-gray-400">
                        {rating}/5
                      </span>
                    )}
                  </div>
                </div>

                {/* Review Text */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-300">
                    Review <span className="text-green-400 ml-1">*</span>
                  </label>
                  <textarea
                    className={`${INPUT_CLASSES} resize-none`}
                    required
                    rows={5}
                    maxLength={MAX_CHARS}
                    placeholder="Share your experience..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 text-right">
                    {text.length}/{MAX_CHARS}
                  </p>
                </div>

                {/* Submit */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting || rating === 0}
                    className="glass-strong rounded-xl px-8 py-4 font-semibold text-green-400 flex items-center gap-2 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-5 h-5" />
                    {submitting ? 'Submitting...' : 'Submit Review'}
                  </button>
                </div>
              </form>
            </GlassCard>
          )}

        </div>
      </section>
    </PageLayout>
  );
}
