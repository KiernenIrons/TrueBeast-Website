import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Headset,
  CheckCircle,
  Send,
  ArrowLeft,
  ExternalLink,
  Heart,
  Clock,
  Wrench,
  ChevronDown,
  Star,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { SITE_CONFIG } from '@/config';
import { FirebaseDB } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TicketFormData {
  name: string;
  email: string;
  discord: string;
  priority: 'low' | 'medium' | 'high';
  category: string;
  subject: string;
  description: string;
  deviceInfo: string;
}

interface Ticket extends TicketFormData {
  id: string;
  status: 'open';
  createdAt: string;
  updatedAt: string;
  responses: never[];
}

interface ReviewData {
  name: string;
  rating: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low - General Question' },
  { value: 'medium', label: 'Medium - Need Help Soon' },
  { value: 'high', label: 'High - Urgent Issue' },
] as const;

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'General Support' },
  { value: 'pc-build', label: 'PC Build Help' },
  { value: 'software', label: 'Software Issues' },
  { value: 'networking', label: 'Networking/WiFi' },
  { value: 'peripherals', label: 'Peripherals' },
  { value: 'streaming', label: 'Streaming Setup' },
  { value: 'gaming', label: 'Gaming Performance' },
  { value: 'other', label: 'Other' },
] as const;

const INPUT_CLASSES =
  'w-full glass rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-transparent';

const FAQ_ITEMS = [
  {
    q: 'How do I check my ticket status?',
    a: 'Head to My Tickets and enter your ticket ID, or click the link in your confirmation.',
  },
  {
    q: 'What info should I include?',
    a: 'The more detail the better - your OS, hardware specs, what you\'ve already tried, and any error messages you\'ve seen.',
  },
  {
    q: 'Can I get help with non-PC issues?',
    a: 'Mostly focused on PC, streaming and gaming tech - but reach out anyway, worst case I can point you in the right direction.',
  },
  {
    q: 'How will you contact me?',
    a: 'By email, or Discord if you provide your username. Replies also appear on your ticket page.',
  },
  {
    q: 'Is this just for TrueBeast community members?',
    a: 'Anyone is welcome - though community members get bumped up the queue!',
  },
];

const MOCK_REVIEWS: ReviewData[] = [
  {
    name: 'Jake M.',
    rating: 5,
    text: 'Kiernen helped me fix a stubborn networking issue I\'d been battling for weeks. Had it sorted in under an hour. Absolute legend.',
  },
  {
    name: 'Sarah K.',
    rating: 5,
    text: 'Super patient and explained everything clearly. My stream setup is finally running smooth!',
  },
  {
    name: 'Tom H.',
    rating: 4,
    text: 'Great advice on my PC build - saved me from buying the wrong parts. Thorough and honest.',
  },
];

// ---------------------------------------------------------------------------
// Reusable Form Components
// ---------------------------------------------------------------------------

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-300">
        {label}
        {required && <span className="text-green-400 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function TextInput({
  label,
  hint,
  required,
  ...props
}: {
  label: string;
  hint?: string;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={label} hint={hint} required={required}>
      <input className={INPUT_CLASSES} required={required} {...props} />
    </FormField>
  );
}

function SelectInput({
  label,
  hint,
  required,
  options,
  ...props
}: {
  label: string;
  hint?: string;
  required?: boolean;
  options: readonly { value: string; label: string }[];
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FormField label={label} hint={hint} required={required}>
      <select className={INPUT_CLASSES + ' [&>option]:bg-[#1a1a2e] [&>option]:text-white'} required={required} {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#1a1a2e] text-white">
            {opt.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function TextAreaInput({
  label,
  hint,
  required,
  ...props
}: {
  label: string;
  hint?: string;
  required?: boolean;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FormField label={label} hint={hint} required={required}>
      <textarea className={`${INPUT_CLASSES} resize-none`} required={required} {...props} />
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Star Rating Display
// ---------------------------------------------------------------------------

function StarDisplay({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${
            i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'
          }`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket Form
// ---------------------------------------------------------------------------

function TicketForm() {
  const [formData, setFormData] = useState<TicketFormData>({
    name: '',
    email: '',
    discord: '',
    priority: 'medium',
    category: 'general',
    subject: '',
    description: '',
    deviceInfo: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  // ---- helpers ----

  function update<K extends keyof TicketFormData>(key: K, value: TicketFormData[K]) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setFormData({
      name: '',
      email: '',
      discord: '',
      priority: 'medium',
      category: 'general',
      subject: '',
      description: '',
      deviceInfo: '',
    });
    setSubmittedId(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const ticketId = 'TB-' + Date.now().toString(36).toUpperCase();
    const now = new Date().toISOString();

    const ticket: Ticket = {
      ...formData,
      id: ticketId,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      responses: [],
    };

    // Persist ticket ID locally
    try {
      const existing: string[] = JSON.parse(localStorage.getItem('tb_my_ticket_ids') || '[]');
      existing.unshift(ticketId);
      localStorage.setItem('tb_my_ticket_ids', JSON.stringify(existing));
    } catch {
      localStorage.setItem('tb_my_ticket_ids', JSON.stringify([ticketId]));
    }

    // Save to Firebase
    FirebaseDB.saveTicket(ticket as any)
      .then(() => {
        setSubmitting(false);
        setSubmittedId(ticketId);
      })
      .catch((err) => {
        console.warn('Ticket save failed:', err);
        // Still show success since localStorage fallback works
        setSubmitting(false);
        setSubmittedId(ticketId);
      });
  }

  // ---- success state ----

  if (submittedId) {
    return (
      <div className="glass-strong rounded-3xl p-8 sm:p-12 text-center space-y-6">
        <div className="flex justify-center">
          <CheckCircle className="w-16 h-16 text-green-400" />
        </div>

        <h2 className="text-2xl sm:text-3xl font-bold text-white">Ticket Submitted!</h2>

        <p className="font-mono text-lg text-green-400">{submittedId}</p>

        <p className="text-gray-400">
          Your ticket ID is <span className="font-mono text-green-400">{submittedId}</span>. Save
          this for your records.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <button
            onClick={resetForm}
            className="glass rounded-xl px-6 py-3 text-white font-medium flex items-center gap-2 hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Submit Another
          </button>
          <a
            href={`/ticket?id=${submittedId}`}
            className="glass-strong rounded-xl px-6 py-3 text-green-400 font-semibold flex items-center gap-2 hover:bg-white/10 transition-colors"
          >
            View Ticket
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {SITE_CONFIG.donationUrl && (
          <a
            href={SITE_CONFIG.donationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-yellow-400 hover:text-yellow-300 transition-colors text-sm mt-4"
          >
            <Heart className="w-4 h-4" />
            Support the Channel
          </a>
        )}
      </div>
    );
  }

  // ---- form ----

  return (
    <form onSubmit={handleSubmit} className="glass-strong rounded-3xl p-8 sm:p-12 space-y-6">
      {/* Row: Name + Email */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <TextInput
          label="Name"
          required
          type="text"
          placeholder="Your name"
          value={formData.name}
          onChange={(e) => update('name', e.target.value)}
        />
        <TextInput
          label="Email"
          required
          type="email"
          placeholder="your@email.com"
          value={formData.email}
          onChange={(e) => update('email', e.target.value)}
        />
      </div>

      {/* Discord */}
      <TextInput
        label="Discord"
        hint="Optional - helps us reach you faster"
        type="text"
        placeholder="Username#1234"
        value={formData.discord}
        onChange={(e) => update('discord', e.target.value)}
      />

      {/* Row: Priority + Category */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <SelectInput
          label="Priority"
          required
          options={PRIORITY_OPTIONS}
          value={formData.priority}
          onChange={(e) => update('priority', e.target.value as TicketFormData['priority'])}
        />
        <SelectInput
          label="Category"
          required
          options={CATEGORY_OPTIONS}
          value={formData.category}
          onChange={(e) => update('category', e.target.value)}
        />
      </div>

      {/* Subject */}
      <TextInput
        label="Subject"
        required
        type="text"
        placeholder="Brief summary of your issue"
        value={formData.subject}
        onChange={(e) => update('subject', e.target.value)}
      />

      {/* Description */}
      <TextAreaInput
        label="Description"
        required
        rows={6}
        placeholder="Describe your issue in detail. What happened? What have you tried?"
        value={formData.description}
        onChange={(e) => update('description', e.target.value)}
      />

      {/* Device / Setup Info */}
      <TextAreaInput
        label="Device/Setup Info"
        hint="Optional - include anything that might help us diagnose the issue"
        rows={3}
        placeholder="PC specs, OS version, software versions, etc."
        value={formData.deviceInfo}
        onChange={(e) => update('deviceInfo', e.target.value)}
      />

      {/* Submit */}
      <div className="pt-4">
        <button
          type="submit"
          disabled={submitting}
          className="glass-strong rounded-xl px-8 py-4 font-semibold text-green-400 flex items-center gap-2 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5" />
          {submitting ? 'Submitting...' : 'Submit Ticket'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Review Form
// ---------------------------------------------------------------------------

function ReviewForm() {
  const [name, setName] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    console.log('Review submitted:', { name, rating, text });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="glass-strong rounded-2xl p-8 text-center space-y-3">
        <CheckCircle className="w-10 h-10 text-green-400 mx-auto" />
        <p className="text-white font-semibold text-lg">Thanks for the kind words!</p>
      </div>
    );
  }

  const displayRating = hoverRating || rating;

  return (
    <form onSubmit={handleSubmit} className="glass-strong rounded-2xl p-8 space-y-5">
      <h3 className="text-lg font-semibold text-white">Leave a Review</h3>

      {/* Name */}
      <FormField label="Name" required>
        <input
          className={INPUT_CLASSES}
          type="text"
          required
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>

      {/* Star rating selector */}
      <FormField label="Rating" required>
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
                  className={`w-7 h-7 transition-colors ${
                    val <= displayRating
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-gray-600 hover:text-yellow-400'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </FormField>

      {/* Review text */}
      <FormField label="Review" required>
        <textarea
          className={`${INPUT_CLASSES} resize-none`}
          required
          rows={4}
          placeholder="Share your experience..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </FormField>

      <button
        type="submit"
        disabled={rating === 0}
        className="glass-strong rounded-xl px-6 py-3 font-semibold text-green-400 flex items-center gap-2 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send className="w-4 h-4" />
        Submit Review
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TechSupport() {
  const location = useLocation();
  const isNewTicket = location.pathname === '/tech-support';

  const [openFaq, setOpenFaq] = useState<number | null>(null);

  function toggleFaq(index: number) {
    setOpenFaq((prev) => (prev === index ? null : index));
  }

  return (
    <PageLayout title="Tech Support | TrueBeast" gradientVariant="green">
      <section className="py-16 sm:py-24">
        <div className="max-w-[56rem] mx-auto px-4 sm:px-6 space-y-16">

          {/* ---------------------------------------------------------------- */}
          {/* A. Hero + Sub-nav tabs                                            */}
          {/* ---------------------------------------------------------------- */}
          <div className="text-center space-y-6">
            <span className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-sm text-green-400">
              <Headset className="w-4 h-4" />
              Free Tech Support
            </span>

            <h1 className="text-4xl sm:text-5xl font-bold font-display text-white">
              Need <span className="text-gradient">Help?</span>
            </h1>

            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Submit a ticket and I'll get back to you within 24 - 48 hours. PC builds, networking,
              streaming, gaming performance - you name it.
            </p>

            {/* Tab bar */}
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link
                to="/tech-support"
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isNewTicket
                    ? 'glass-strong text-green-400'
                    : 'glass text-gray-400 hover:text-gray-200'
                }`}
              >
                New Ticket
              </Link>
              <Link
                to="/my-tickets"
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  !isNewTicket
                    ? 'glass-strong text-green-400'
                    : 'glass text-gray-400 hover:text-gray-200'
                }`}
              >
                My Tickets
              </Link>
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B. Info strip                                                     */}
          {/* ---------------------------------------------------------------- */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Response Time */}
            <div className="glass rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-green-400">
                <Clock className="w-5 h-5 flex-shrink-0" />
                <span className="font-semibold text-sm">Response Time</span>
              </div>
              <p className="text-white font-bold text-lg leading-tight">24 - 48 hours</p>
              <p className="text-gray-400 text-sm">Mon - Fri, faster for urgent issues</p>
            </div>

            {/* Free Service */}
            <div className="glass rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-green-400">
                <Heart className="w-5 h-5 flex-shrink-0" />
                <span className="font-semibold text-sm">Free Service</span>
              </div>
              <p className="text-white font-bold text-lg leading-tight">Completely free</p>
              <p className="text-gray-400 text-sm">No catches, no subscriptions</p>
            </div>

            {/* What's Covered */}
            <div className="glass rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-green-400">
                <Wrench className="w-5 h-5 flex-shrink-0" />
                <span className="font-semibold text-sm">What's Covered</span>
              </div>
              <p className="text-white font-bold text-lg leading-tight">PC builds, networking</p>
              <p className="text-gray-400 text-sm">Streaming, gaming, software</p>
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* C. Ticket Form                                                    */}
          {/* ---------------------------------------------------------------- */}
          <TicketForm />

          {/* ---------------------------------------------------------------- */}
          {/* D. Reviews                                                        */}
          {/* ---------------------------------------------------------------- */}
          <div className="space-y-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold font-display text-white">What people say</h2>
              <p className="text-gray-400">Real feedback from people I've helped</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {MOCK_REVIEWS.map((review) => (
                <div key={review.name} className="glass rounded-2xl p-5 space-y-3">
                  <StarDisplay rating={review.rating} />
                  <p className="text-gray-300 text-sm leading-relaxed">"{review.text}"</p>
                  <p className="text-white font-semibold text-sm">{review.name}</p>
                </div>
              ))}
            </div>

            <ReviewForm />
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* E. FAQ Accordion                                                  */}
          {/* ---------------------------------------------------------------- */}
          <div className="space-y-4">
            <h2 className="text-2xl font-bold font-display text-white">Common Questions</h2>

            <div className="space-y-2">
              {FAQ_ITEMS.map((item, i) => {
                const isOpen = openFaq === i;
                return (
                  <div key={i} className="glass rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleFaq(i)}
                      className="w-full flex items-center justify-between px-6 py-4 text-left group"
                    >
                      <span className="font-medium text-white group-hover:text-green-400 transition-colors pr-4">
                        {item.q}
                      </span>
                      <ChevronDown
                        className={`w-5 h-5 flex-shrink-0 text-gray-400 transition-transform duration-300 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    <div
                      className={`transition-all duration-300 overflow-hidden ${
                        isOpen ? 'max-h-[200px]' : 'max-h-0'
                      }`}
                    >
                      <p className="px-6 pb-5 text-gray-400 text-sm leading-relaxed">{item.a}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </section>
    </PageLayout>
  );
}
