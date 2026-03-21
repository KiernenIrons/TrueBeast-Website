import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Plus,
  Loader2,
  Trash2,
  ArrowRight,
  Clock,
  AlertCircle,
  MessageSquare,
  Search,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TicketResponse {
  text: string;
  from: string;
  timestamp: string;
}

interface Ticket {
  id: string;
  name: string;
  subject: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in-progress' | 'resolved' | 'urgent';
  description: string;
  createdAt: string;
  updatedAt: string;
  responses: TicketResponse[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'tb_my_ticket_ids';

const MOCK_TICKETS: Ticket[] = [
  {
    id: 'TB-DEMO123',
    name: 'Demo User',
    subject: "PC won't boot after update",
    category: 'Software Issues',
    priority: 'high',
    status: 'in-progress',
    description:
      'After a Windows update my PC gets stuck on the loading screen and never reaches the desktop. I have tried restarting multiple times but the issue persists.',
    createdAt: '2026-03-18T10:00:00Z',
    updatedAt: '2026-03-19T15:00:00Z',
    responses: [
      {
        text: 'Try booting in safe mode.',
        from: 'support',
        timestamp: '2026-03-19T15:00:00Z',
      },
    ],
  },
  {
    id: 'TB-DEMO456',
    name: 'Demo User',
    subject: 'Best GPU for 1440p gaming?',
    category: 'PC Build Help',
    priority: 'low',
    status: 'open',
    description:
      'Looking for recommendations on a GPU upgrade for 1440p gaming at high refresh rates. Currently running an older card and want to know what offers the best value.',
    createdAt: '2026-03-20T08:00:00Z',
    updatedAt: '2026-03-20T08:00:00Z',
    responses: [],
  },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'OPEN' },
  'in-progress': { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'IN PROGRESS' },
  resolved: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'RESOLVED' },
  urgent: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'URGENT' },
};

const PRIORITY_STYLES: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
};

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function getSavedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getTicketById(id: string): Ticket | undefined {
  return MOCK_TICKETS.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.open;
  return (
    <span
      className={`${style.bg} ${style.text} text-[11px] font-bold tracking-wider px-2.5 py-1 rounded-full uppercase`}
    >
      {style.label}
    </span>
  );
}

function TicketCard({
  ticket,
  onRemove,
}: {
  ticket: Ticket;
  onRemove: (id: string) => void;
}) {
  const replyCount = ticket.responses.length;

  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-green-400 font-mono text-sm">{ticket.id}</span>
        <StatusBadge status={ticket.status} />
      </div>

      {/* Subject */}
      <h3 className="text-white font-semibold text-lg leading-snug">{ticket.subject}</h3>

      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`${PRIORITY_STYLES[ticket.priority] ?? 'text-gray-400'} font-medium capitalize`}>
          {ticket.priority}
        </span>
        <span className="text-white/20">|</span>
        <span className="text-gray-400 flex items-center gap-1.5">
          <Clock size={13} />
          {formatDate(ticket.createdAt)}
        </span>
        {replyCount > 0 && (
          <>
            <span className="text-white/20">|</span>
            <span className="text-blue-400 flex items-center gap-1.5">
              <MessageSquare size={13} />
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </>
        )}
      </div>

      {/* Description preview */}
      <p className="text-gray-400 text-sm leading-relaxed line-clamp-2">
        {ticket.description}
      </p>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <Link
          to={`/ticket?id=${ticket.id}`}
          className="inline-flex items-center gap-2 text-green-400 hover:text-green-300 text-sm font-medium transition-colors"
        >
          View Ticket
          <ArrowRight size={14} />
        </Link>
        <button
          onClick={() => onRemove(ticket.id)}
          className="inline-flex items-center gap-1.5 text-gray-500 hover:text-red-400 text-sm transition-colors"
          aria-label={`Remove ticket ${ticket.id}`}
        >
          <Trash2 size={14} />
          Remove
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MyTickets() {
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState('');

  // Seed mock data on first visit, then load tickets
  useEffect(() => {
    const ids = getSavedIds();

    if (ids.length === 0) {
      const demoIds = MOCK_TICKETS.map((t) => t.id);
      saveIds(demoIds);
      setTicketIds(demoIds);
    } else {
      setTicketIds(ids);
    }

    // Simulate async load
    const timer = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);

  // Resolve ticket objects whenever IDs change
  useEffect(() => {
    if (loading) return;
    const resolved = ticketIds
      .map((id) => getTicketById(id))
      .filter((t): t is Ticket => t !== undefined);
    setTickets(resolved);
  }, [ticketIds, loading]);

  const handleRemove = useCallback(
    (id: string) => {
      const next = ticketIds.filter((tid) => tid !== id);
      saveIds(next);
      setTicketIds(next);
    },
    [ticketIds],
  );

  const handleAdd = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setAddError('');

      const value = addInput.trim().toUpperCase();
      if (!value) return;

      // Check if it matches a known ticket
      const found = MOCK_TICKETS.find((t) => t.id === value);
      if (!found) {
        setAddError('Ticket not found. Check the ID.');
        return;
      }

      if (ticketIds.includes(value)) {
        setAddInput('');
        return;
      }

      const next = [...ticketIds, value];
      saveIds(next);
      setTicketIds(next);
      setAddInput('');
    },
    [addInput, ticketIds],
  );

  return (
    <PageLayout title="My Tickets | TrueBeast Support" gradientVariant="green">
      <section className="py-20 sm:py-28">
        <div className="max-w-[56rem] mx-auto px-4 sm:px-6">
          {/* ---- Hero ---- */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5 mb-6">
              <FileText size={16} className="text-green-400" />
              <span className="text-sm text-gray-300 font-medium">Your Tickets</span>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold mb-5">
              My <span className="text-gradient">Tickets</span>
            </h1>

            <p className="text-gray-400 text-lg max-w-[36rem] mx-auto leading-relaxed">
              Track all your support tickets in one place. Only tickets submitted from this
              browser are shown.
            </p>
          </div>

          {/* ---- Add Ticket Form ---- */}
          <form
            onSubmit={handleAdd}
            className="glass rounded-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-10"
          >
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
              />
              <input
                type="text"
                value={addInput}
                onChange={(e) => {
                  setAddInput(e.target.value);
                  setAddError('');
                }}
                placeholder="Add a ticket ID (e.g. TB-ABC123)"
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white font-mono uppercase placeholder:text-gray-500 placeholder:normal-case focus:outline-none focus:border-green-500/50 transition-colors text-sm"
              />
            </div>
            <button
              type="submit"
              className="glass-strong rounded-xl px-6 py-3 flex items-center justify-center gap-2 text-green-400 hover:text-green-300 font-medium text-sm transition-colors shrink-0"
            >
              <Plus size={16} />
              Add
            </button>
          </form>

          {addError && (
            <div className="flex items-center gap-2 text-red-400 text-sm mb-8 -mt-6 pl-1">
              <AlertCircle size={15} />
              {addError}
            </div>
          )}

          {/* ---- Loading State ---- */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-400">
              <Loader2 size={28} className="animate-spin text-green-400" />
              <span className="text-sm">Loading your tickets...</span>
            </div>
          )}

          {/* ---- Empty State ---- */}
          {!loading && tickets.length === 0 && (
            <div className="glass rounded-2xl p-12 text-center flex flex-col items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                <FileText size={28} className="text-gray-500" />
              </div>
              <h2 className="text-xl font-semibold text-white">No tickets yet</h2>
              <p className="text-gray-400 text-sm max-w-[28rem] leading-relaxed">
                You haven't submitted any support tickets from this browser. Submit one and
                it'll appear here automatically.
              </p>
              <Link
                to="/tech-support"
                className="glass-strong rounded-xl px-6 py-3 inline-flex items-center gap-2 text-green-400 hover:text-green-300 font-medium text-sm transition-colors mt-2"
              >
                Submit a Ticket
                <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* ---- Ticket List ---- */}
          {!loading && tickets.length > 0 && (
            <>
              <p className="text-gray-400 text-sm mb-5">
                {tickets.length} ticket{tickets.length === 1 ? '' : 's'} found
              </p>

              <div className="grid gap-4">
                {tickets.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} onRemove={handleRemove} />
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </PageLayout>
  );
}
