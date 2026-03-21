import { useState, type FormEvent, type ReactNode } from 'react';
import {
  Headset,
  CheckCircle,
  Send,
  ArrowLeft,
  ExternalLink,
  Heart,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { SITE_CONFIG } from '@/config';

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
      <select className={INPUT_CLASSES} required={required} {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
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

    // Log for now; Firebase integration comes later
    console.log('Ticket submitted:', ticket);

    setSubmitting(false);
    setSubmittedId(ticketId);
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
// Page
// ---------------------------------------------------------------------------

export default function TechSupport() {
  return (
    <PageLayout title="Tech Support | TrueBeast" gradientVariant="green">
      <section className="py-16 sm:py-24">
        <div className="max-w-[48rem] mx-auto px-4 sm:px-6 space-y-12">
          {/* Hero */}
          <div className="text-center space-y-6">
            <span className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-sm text-green-400">
              <Headset className="w-4 h-4" />
              Free Tech Support
            </span>

            <h1 className="text-4xl sm:text-5xl font-bold text-white">
              Need <span className="text-gradient">Help?</span>
            </h1>

            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Submit a ticket and I'll get back to you within 24-48 hours. PC builds, networking,
              streaming, gaming performance, you name it.
            </p>
          </div>

          {/* Form */}
          <TicketForm />
        </div>
      </section>
    </PageLayout>
  );
}
