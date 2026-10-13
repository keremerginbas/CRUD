import { useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  Check,
  MessageCircle,
  Plus,
  Send,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, Empty, PageTitle } from "../components/ui";
import { useStore } from "../store";
import type { Lead } from "../data";
import type { FeedPost } from "../suite";
import "../suite-pages.css";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const readableDate = (value: string) =>
  new Date(value).toLocaleString("tr-TR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

function LeadPicker({
  value,
  onChange,
  leads,
}: {
  value: string;
  onChange: (value: string) => void;
  leads: Lead[];
}) {
  return (
    <label className="sx-field sx-feed-lead">
      İlgili CRM fırsatı
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Fırsat seçmeden paylaş</option>
        {leads.map((lead) => (
          <option key={lead.id} value={lead.id}>
            {lead.name} · {lead.company}
          </option>
        ))}
      </select>
    </label>
  );
}

function FeedCard({
  post,
  onLead,
}: {
  post: FeedPost;
  onLead: (lead: Lead) => void;
}) {
  const { data, saveRecord, user } = useStore();
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const actor = user?.name || "XRE Ekibi";
  const liked = post.likes.includes(actor);
  const lead = post.leadId
    ? data.leads.find((item) => item.id === post.leadId)
    : undefined;
  const toggleLike = async () => {
    try {
      await saveRecord("feed", {
        ...post,
        likes: liked
          ? post.likes.filter((name) => name !== actor)
          : [...post.likes, actor],
        updatedAt: now(),
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const addComment = async () => {
    const text = comment.trim();
    if (!text) return;
    try {
      await saveRecord("feed", {
        ...post,
        comments: [
          ...post.comments,
          { id: id(), author: actor, text, createdAt: now() },
        ],
        updatedAt: now(),
      });
      setComment("");
      setCommentOpen(true);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  return (
    <article className="sx-feed-card">
      <header className="sx-feed-head">
        <Avatar name={post.author || "XRE Ekibi"} size={38} />
        <div>
          <strong>{post.author || "XRE Ekibi"}</strong>
          <time dateTime={post.createdAt}>{readableDate(post.createdAt)}</time>
        </div>
      </header>
      <p className="sx-feed-text">{post.text}</p>
      {lead && (
        <button className="sx-feed-lead-link" onClick={() => onLead(lead)}>
          <Badge tone="blue">CRM fırsatı</Badge>
          <span>
            {lead.name} · {lead.company}
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      )}
      <footer className="sx-feed-actions">
        <button
          className={liked ? "selected" : ""}
          onClick={toggleLike}
          aria-pressed={liked}
        >
          <ThumbsUp size={15} />{" "}
          {post.likes.length ? post.likes.length : "Beğen"}
        </button>
        <button
          className={commentOpen ? "selected" : ""}
          onClick={() => setCommentOpen(!commentOpen)}
          aria-expanded={commentOpen}
        >
          <MessageCircle size={15} /> {post.comments.length || "Yorum"}
        </button>
      </footer>
      {commentOpen && (
        <div className="sx-comments">
          <div className="sx-comment-list">
            {post.comments.map((item) => (
              <div className="sx-comment" key={item.id}>
                <Avatar name={item.author} size={25} />
                <div>
                  <strong>{item.author}</strong>
                  <p>{item.text}</p>
                  <time>{readableDate(item.createdAt)}</time>
                </div>
              </div>
            ))}
          </div>
          <div className="sx-comment-composer">
            <input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addComment();
              }}
              placeholder="Yorum ekle…"
              aria-label={`${post.author} gönderisine yorum ekle`}
            />
            <button
              className="sx-icon-button"
              onClick={addComment}
              disabled={!comment.trim()}
              aria-label="Yorumu gönder"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function Feed({
  membersOnly = false,
  onLead,
}: {
  membersOnly?: boolean;
  onLead: (lead: Lead) => void;
}) {
  const { data, saveRecord, user } = useStore();
  const [text, setText] = useState("");
  const [leadId, setLeadId] = useState("");
  const [posting, setPosting] = useState(false);
  const actor = user?.name || "XRE Ekibi";
  const posts = useMemo(
    () => [...data.feed].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.feed],
  );
  const publish = async () => {
    const value = text.trim();
    if (!value) {
      toast.error("Paylaşım metni boş olamaz.");
      return;
    }
    setPosting(true);
    const stamp = now();
    const post: FeedPost = {
      id: id(),
      author: actor,
      text: value,
      leadId,
      likes: [],
      comments: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    try {
      await saveRecord("feed", post);
      setText("");
      setLeadId("");
      toast.success("Akışta paylaşıldı.");
    } catch (error) {
      toast.error((error as Error).message || "Paylaşım yapılamadı.");
    } finally {
      setPosting(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="ÇALIŞMA ALANI"
        title="Ekip akışı"
        description={
          membersOnly
            ? "Ekip içi güncellemeleri ve CRM bağlantılarını takip edin."
            : "Güncellemeleri paylaşın, müşteri bağlamını ekipçe görünür tutun."
        }
        actions={
          <Badge tone="blue">
            <UsersLabel /> {data.members.length} ekip üyesi
          </Badge>
        }
      />
      <div className="sx-feed-layout">
        <main>
          <section className="panel sx-composer">
            <div className="sx-composer-top">
              <Avatar name={actor} size={38} />
              <div>
                <strong>{actor}</strong>
                <span>Çalışma alanına güncelleme paylaş</span>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Neler oluyor? Bir ziyaret, teklif veya ekip notu paylaşın…"
              aria-label="Akış paylaşımı"
              rows={4}
            />
            <div className="sx-composer-footer">
              <LeadPicker
                value={leadId}
                onChange={setLeadId}
                leads={data.leads}
              />
              <button
                className="btn primary"
                onClick={publish}
                disabled={posting || !text.trim()}
              >
                <Send size={15} /> {posting ? "Paylaşılıyor…" : "Paylaş"}
              </button>
            </div>
          </section>
          {posts.length ? (
            posts.map((post) => (
              <FeedCard key={post.id} post={post} onLead={onLead} />
            ))
          ) : (
            <section className="panel">
              <Empty
                title="Akış henüz boş"
                description="İlk ekip güncellemesini siz paylaşın."
              />
            </section>
          )}
        </main>
        <aside className="sx-feed-sidebar">
          <section className="panel">
            <div className="sx-section-heading">
              <div>
                <span className="sx-eyebrow">ÇALIŞMA ALANI</span>
                <h2>Son hareketler</h2>
              </div>
              <Activity size={17} />
            </div>
            {data.events.length ? (
              <div className="sx-event-list">
                {data.events.slice(0, 8).map((event) => (
                  <div className="sx-event-item" key={event.id}>
                    <span className="sx-event-icon">
                      <Activity size={14} />
                    </span>
                    <div>
                      <strong>{event.title}</strong>
                      <span>{event.detail || "CRM çalışma alanı"}</span>
                      <time>{readableDate(event.createdAt)}</time>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="sx-muted sx-side-empty">Henüz etkinlik yok.</p>
            )}
          </section>
          <section className="panel sx-feed-note">
            <CalendarDays size={18} />
            <div>
              <strong>Planlama notu</strong>
              <p>
                Takvimdeki arama kayıtları yalnızca planlamadır; buradan
                otomatik arama yapılmaz.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function UsersLabel() {
  return <span aria-hidden="true">•</span>;
}
