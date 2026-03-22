import { useState, useEffect, FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search,
  Loader2,
  AlertCircle,
  Clock,
  User,
  Mail,
  MessageSquare,
  Send,
  Monitor,
  ArrowLeft,
  TicketCheck,
  ExternalLink,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { FirebaseDB } from '@/lib/firebase';
import { SITE_CONFIG } from '@/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TicketResponse {
  text: string;
  from: 'support' | 'user';
  timestamp: string;
}

interface TicketData {
  id: string;
  name: string;
  email: string;
  discord: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  subject: string;
  description: string;
  deviceInfo?: string;
  status: 'open' | 'in-progress' | 'resolved' | 'urgent';
  createdAt: string;
  updatedAt: string;
  responses: TicketResponse[];
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_TICKET: TicketData = {
  id: 'TB-DEMO123',
  name: 'Demo User',
  email: 'demo@example.com',
  discord: 'DemoUser#1234',
  category: 'General Support',
  priority: 'medium',
  subject: 'Example Support Ticket',
  description: 'This is a demo ticket to show how the ticket viewer works.',
  deviceInfo: 'Windows 11, Chrome 120',
  status: 'open',
  createdAt: '2026-03-20T10:00:00Z',
  updatedAt: '2026-03-20T14:30:00Z',
  responses: [
    {
      text: 'Thanks for reaching out! I will look into this for you.',
      from: 'support',
      timestamp: '2026-03-20T12:00:00Z',
    },
    {
      text: 'Any update on this?',
      from: 'user',
      timestamp: '2026-03-20T14:30:00Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const STATUS_STYLES: Record<TicketData['status'], { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'OPEN' },
  'in-progress': { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'IN PROGRESS' },
  resolved: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'RESOLVED' },
  urgent: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'URGENT' },
};

const PRIORITY_STYLES: Record<TicketData['priority'], { bg: string; text: string }> = {
  high: { bg: 'bg-red-500/20', text: 'text-red-400' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  low: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UserAvatar({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-green-500/30 border border-green-500/40 flex items-center justify-center shrink-0">
      <span className="text-green-400 font-bold text-sm">{initial}</span>
    </div>
  );
}

function SupportAvatar() {
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-green-500 flex items-center justify-center shrink-0">
      <span className="text-white font-bold text-xs">TB</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Form (no ticket ID)
// ---------------------------------------------------------------------------

function TicketSearchForm() {
  const [, setSearchParams] = useSearchParams();
  const [input, setInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (trimmed) {
      setSearchParams({ id: trimmed });
    }
  };

  return (
    <div className="max-w-[48rem] mx-auto px-4 py-20">
      <div className="glass-strong rounded-2xl p-8 sm:p-10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto mb-5">
            <TicketCheck className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold font-display text-white mb-3">
            Find Your Ticket
          </h1>
          <p className="text-gray-400">
            Enter your ticket ID to view its status and conversation history.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. TB-2QK1Z9"
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 font-mono uppercase focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30 transition-colors"
          />
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-green-500 hover:bg-green-600 text-white font-semibold transition-colors"
          >
            <Search className="w-4 h-4" />
            Look Up Ticket
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-5">
          Your ticket ID is in the confirmation email you received.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading State
// ---------------------------------------------------------------------------

function TicketLoading() {
  return (
    <div className="max-w-[48rem] mx-auto px-4 py-20 flex flex-col items-center gap-4">
      <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
      <p className="text-gray-400">Loading ticket...</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not Found State
// ---------------------------------------------------------------------------

function TicketNotFound() {
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="max-w-[48rem] mx-auto px-4 py-20">
      <div className="glass-strong rounded-2xl p-8 sm:p-10 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Ticket Not Found</h2>
        <p className="text-gray-400 mb-6">
          Ticket not found. Check the ID and try again.
        </p>
        <button
          onClick={() => setSearchParams({})}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Search
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket View (main)
// ---------------------------------------------------------------------------

function TicketView({ ticket: initialTicket }: { ticket: TicketData }) {
  const [ticket, setLocalTicket] = useState(initialTicket);
  const [replyText, setReplyText] = useState('');
  const statusStyle = STATUS_STYLES[ticket.status];
  const priorityStyle = PRIORITY_STYLES[ticket.priority];

  const handleReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    const newResponse = { from: 'user' as const, text: replyText.trim(), message: replyText.trim(), timestamp: new Date().toISOString(), createdAt: new Date().toISOString() };
    const updatedResponses = [...ticket.responses, newResponse];
    try {
      await FirebaseDB.updateTicket(ticket.id, { responses: updatedResponses as any });
      setLocalTicket({ ...ticket, responses: updatedResponses as any, updatedAt: new Date().toISOString() });

      // Notify admin of user reply
      const threadId = ticket.id.toLowerCase().replace(/[^a-z0-9]/g, '') + '@truebeast.io';
      const replyHtml = `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:#0a0a1a;color:#fff;padding:32px;border-radius:16px">
        <h2 style="color:#22c55e;margin-bottom:16px">New reply on ticket ${ticket.id}</h2>
        <p style="color:#9ca3af;margin-bottom:12px"><strong style="color:#fff">${ticket.name}</strong> replied to their ticket:</p>
        <div style="border-left:3px solid #22c55e;padding:12px 16px;margin:16px 0;background:#1a1a2e;border-radius:0 8px 8px 0">
          <div style="color:#d1d5db;font-size:14px;white-space:pre-wrap">${replyText.trim().replace(/</g, '&lt;')}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="color:#9ca3af;padding:4px 8px">Ticket</td><td style="color:#22c55e;font-family:monospace;padding:4px 8px">${ticket.id}</td></tr>
          <tr><td style="color:#9ca3af;padding:4px 8px">Subject</td><td style="color:#fff;padding:4px 8px">${ticket.subject}</td></tr>
          <tr><td style="color:#9ca3af;padding:4px 8px">From</td><td style="color:#fff;padding:4px 8px">${ticket.name} (${ticket.email})</td></tr>
        </table>
        <div style="margin-top:20px">
          <a href="${SITE_CONFIG.siteUrl}/admin" style="background:#8b5cf6;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open Admin Panel</a>
        </div>
      </div>`;
      fetch(SITE_CONFIG.email.workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: SITE_CONFIG.email.adminEmail,
          toName: 'TrueBeast Admin',
          subject: `[TrueBeast Support] ${ticket.name} replied to ticket ${ticket.id}`,
          html: replyHtml,
          senderName: SITE_CONFIG.email.senderName,
          senderEmail: SITE_CONFIG.email.senderEmail,
          references: `<${threadId}>`,
          inReplyTo: `<${threadId}>`,
        }),
      }).then((r) => {
        console.log('[Email] Admin reply notification:', r.status, r.ok ? 'OK' : 'FAILED');
      }).catch((e) => console.warn('[Email] Send error:', e));

      setReplyText('');
    } catch (err) {
      console.warn('Reply failed:', err);
    }
  };

  return (
    <div className="max-w-[56rem] mx-auto px-4 py-12 space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="font-mono font-bold text-green-400 text-lg">
            {ticket.id}
          </span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusStyle.bg} ${statusStyle.text}`}
          >
            {statusStyle.label}
          </span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${priorityStyle.bg} ${priorityStyle.text}`}
          >
            {ticket.priority.toUpperCase()} PRIORITY
          </span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
          {ticket.subject}
        </h2>
        <p className="text-gray-500 text-sm">
          Submitted {formatShortDate(ticket.createdAt)} in {ticket.category}
        </p>
      </div>

      {/* ── Info Grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* From */}
        <div className="glass rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">From</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-gray-500" />
              <span className="text-white">{ticket.name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-gray-500" />
              <span className="text-gray-300 truncate">{ticket.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MessageSquare className="w-4 h-4 text-gray-500" />
              <span className="text-gray-300">{ticket.discord}</span>
            </div>
          </div>
        </div>

        {/* Category & Priority */}
        <div className="glass rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Details</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Category</span>
              <span className="text-white">{ticket.category}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Priority</span>
              <span className={priorityStyle.text + ' capitalize'}>{ticket.priority}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <span className={statusStyle.text + ' capitalize'}>{statusStyle.label.toLowerCase()}</span>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="glass rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Timeline</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Created</span>
              <span className="text-gray-300">{formatShortDate(ticket.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Updated</span>
              <span className="text-gray-300">{formatShortDate(ticket.updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Conversation Thread ─────────────────────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 sm:p-8 space-y-6">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-green-400" />
          Conversation
        </h3>

        {/* Original message */}
        <div className="space-y-4">
          <div className="flex gap-3">
            <UserAvatar name={ticket.name} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-2 mb-1">
                <span className="text-white font-semibold text-sm">{ticket.name}</span>
                <span className="text-gray-500 text-xs flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(ticket.createdAt)}
                </span>
              </div>
              <div className="glass rounded-xl p-4">
                <p className="text-gray-300 text-sm whitespace-pre-wrap">
                  {ticket.description}
                </p>
                {ticket.deviceInfo && (
                  <>
                    <div className="border-t border-white/10 my-3" />
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Monitor className="w-3.5 h-3.5" />
                      {ticket.deviceInfo}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Responses */}
          {ticket.responses.map((response, i) => {
            const isSupport = response.from === 'support';
            return (
              <div key={i} className="flex gap-3">
                {isSupport ? <SupportAvatar /> : <UserAvatar name={ticket.name} />}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <span className="text-white font-semibold text-sm">
                      {isSupport ? 'TrueBeast Support' : ticket.name}
                    </span>
                    <span className="text-gray-500 text-xs flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(response.timestamp)}
                    </span>
                  </div>
                  <div
                    className={`rounded-xl p-4 ${
                      isSupport
                        ? 'glass border-l-2 border-l-green-500/50 bg-green-500/5'
                        : 'glass'
                    }`}
                  >
                    <p className="text-gray-300 text-sm whitespace-pre-wrap">
                      {response.text}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Reply Form / Resolved Banner ────────────────────────────────── */}
      {ticket.status === 'resolved' ? (
        <div className="glass rounded-2xl p-6 text-center">
          <p className="text-gray-400 text-sm">
            This ticket has been marked as resolved. Need more help?{' '}
            <Link to="/tech-support" className="text-green-400 hover:text-green-300 underline">
              Submit a new ticket
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="glass-strong rounded-2xl p-6 sm:p-8">
          <p className="text-gray-400 text-sm mb-4">
            Your ticket is open. I'll respond as soon as I can.
          </p>
          <form onSubmit={handleReply} className="space-y-4">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Add a message to your ticket..."
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30 transition-colors resize-none"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white font-semibold transition-colors"
            >
              <Send className="w-4 h-4" />
              Send
            </button>
          </form>
        </div>
      )}

      {/* ── Bottom CTAs ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
        <Link
          to="/tech-support"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl glass hover:bg-white/10 text-white font-medium transition-colors"
        >
          <TicketCheck className="w-4 h-4 text-green-400" />
          Submit New Ticket
        </Link>
        <a
          href="https://discord.gg/Nk8vekY"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl glass hover:bg-white/10 text-white font-medium transition-colors"
        >
          <ExternalLink className="w-4 h-4 text-green-400" />
          Join Discord
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function Ticket() {
  const [searchParams] = useSearchParams();
  const ticketId = searchParams.get('id');

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!ticketId) {
      setTicket(null);
      setNotFound(false);
      return;
    }

    setLoading(true);
    setNotFound(false);
    setTicket(null);

    FirebaseDB.getTicket(ticketId)
      .then((t) => {
        if (t) {
          setTicket(t as unknown as TicketData);
          setNotFound(false);
        } else {
          setTicket(null);
          setNotFound(true);
        }
      })
      .catch(() => {
        setTicket(null);
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [ticketId]);

  // Determine which state to render
  let content: React.ReactNode;
  if (!ticketId) {
    content = <TicketSearchForm />;
  } else if (loading) {
    content = <TicketLoading />;
  } else if (notFound || !ticket) {
    content = <TicketNotFound />;
  } else {
    content = <TicketView ticket={ticket} />;
  }

  return (
    <PageLayout title="View Ticket | TrueBeast Support" gradientVariant="green">
      {content}
    </PageLayout>
  );
}
