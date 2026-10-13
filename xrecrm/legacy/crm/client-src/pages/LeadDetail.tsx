import { useState } from "react";
import { useRoute } from "wouter";
import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { trpc } from "../lib/trpc";
import {
  Phone, Mail, MapPin, Calendar, MessageSquare, Plus, Edit2, Save, X,
  Building2, User, Tag, Clock, ArrowLeft, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { toast } from "sonner";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../components/ui/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { useLocation } from "wouter";

const activityFormSchema = z.object({
  type: z.enum(["note", "task", "call", "email", "meeting", "whatsapp", "sms", "form_submission"]),
  title: z.string().min(1, "Başlık gerekli"),
  description: z.string().optional(),
  dueDate: z.string().optional(),
});

type ActivityFormData = z.infer<typeof activityFormSchema>;

const activityTypeConfig: Record<string, { label: string; bg: string; color: string; icon: string }> = {
  note: { label: "Not", bg: "oklch(0.55 0.18 255 / 0.12)", color: "oklch(0.48 0.18 255)", icon: "📝" },
  task: { label: "Görev", bg: "oklch(0.65 0.18 85 / 0.12)", color: "oklch(0.55 0.18 85)", icon: "✅" },
  call: { label: "Arama", bg: "oklch(0.60 0.18 145 / 0.12)", color: "oklch(0.50 0.18 145)", icon: "📞" },
  email: { label: "E-posta", bg: "oklch(0.55 0.20 255 / 0.12)", color: "oklch(0.48 0.20 255)", icon: "✉️" },
  meeting: { label: "Toplantı", bg: "oklch(0.55 0.20 300 / 0.12)", color: "oklch(0.48 0.20 300)", icon: "🤝" },
  whatsapp: { label: "WhatsApp", bg: "oklch(0.60 0.18 145 / 0.12)", color: "oklch(0.50 0.18 145)", icon: "💬" },
  sms: { label: "SMS", bg: "oklch(0.65 0.18 85 / 0.12)", color: "oklch(0.55 0.18 85)", icon: "💬" },
  form_submission: { label: "Form", bg: "oklch(0.55 0.18 255 / 0.12)", color: "oklch(0.48 0.18 255)", icon: "📋" },
};

export default function LeadDetail() {
  const [, params] = useRoute("/leads/:id");
  const leadId = params?.id ? parseInt(params.id) : null;
  const [isEditingLead, setIsEditingLead] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [, navigate] = useLocation();

  if (!leadId) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-64 gap-4">
          <AlertCircle className="w-12 h-12" style={{ color: "var(--destructive)" }} />
          <p className="font-semibold">Lead bulunamadı</p>
        </div>
      </DashboardLayout>
    );
  }

  const { data: lead, isLoading } = trpc.leads.getById.useQuery({ id: leadId });
  const { data: activities = [] } = trpc.activities.getByLeadId.useQuery({ leadId });
  const { data: communications = [] } = trpc.communications.getByLeadId.useQuery({ leadId });
  const { data: meetings = [] } = trpc.meetings.getByLeadId.useQuery({ leadId });
  const { data: statuses = [] } = trpc.statuses.list.useQuery(undefined);
  const { data: users = [] } = trpc.users.list.useQuery(undefined);

  const updateLead = trpc.leads.update.useMutation();
  const createActivity = trpc.activities.create.useMutation();

  const leadForm = useForm({ defaultValues: lead || {} });
  const activityForm = useForm<ActivityFormData>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { type: "note" },
  });

  const onUpdateLead = async (data: any) => {
    try {
      await updateLead.mutateAsync({ id: leadId, ...data });
      toast.success("Lead güncellendi");
      setIsEditingLead(false);
    } catch {
      toast.error("Lead güncellenirken hata oluştu");
    }
  };

  const onAddActivity = async (data: ActivityFormData) => {
    try {
      await createActivity.mutateAsync({
        leadId,
        type: data.type,
        title: data.title,
        description: data.description,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      });
      toast.success("Aktivite eklendi");
      activityForm.reset();
      setIsActivityOpen(false);
    } catch {
      toast.error("Aktivite eklenirken hata oluştu");
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col gap-4 p-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: "80px", borderRadius: "1rem" }} />
          ))}
        </div>
      </DashboardLayout>
    );
  }

  if (!lead) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-64 gap-4">
          <AlertCircle className="w-12 h-12" style={{ color: "var(--destructive)" }} />
          <p className="font-semibold">Lead bulunamadı</p>
          <Button variant="outline" onClick={() => navigate("/leads")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Geri Dön
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const status = statuses.find(s => s.id === lead.statusId);
  const assignedUser = users.find(u => u.id === lead.assignedToId);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-5">
        {/* Back Button */}
        <button
          onClick={() => navigate("/leads")}
          className="flex items-center gap-2 w-fit rounded-lg px-3 py-1.5"
          style={{
            fontSize: "0.8125rem",
            fontWeight: 500,
            color: "var(--muted-foreground)",
            background: "var(--muted)",
            border: "1px solid var(--border)",
            transition: "all 0.15s ease",
            cursor: "pointer",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--foreground)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--primary)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--muted-foreground)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
          }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Leads'e Dön
        </button>

        {/* Hero Header */}
        <div
          className="lead-detail-header animate-slide-in-up"
        >
          <div className="flex items-start justify-between gap-4 relative z-10">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div
                className="flex items-center justify-center rounded-2xl font-bold text-white shrink-0"
                style={{
                  width: "64px",
                  height: "64px",
                  background: "oklch(1 0 0 / 0.15)",
                  backdropFilter: "blur(8px)",
                  border: "2px solid oklch(1 0 0 / 0.25)",
                  fontSize: "1.5rem",
                  letterSpacing: "-0.02em",
                }}
              >
                {lead.firstName.charAt(0)}
              </div>
              <div>
                <h1
                  className="font-bold text-white"
                  style={{ fontSize: "1.75rem", letterSpacing: "-0.04em", lineHeight: 1.1 }}
                >
                  {lead.firstName} {lead.lastName}
                </h1>
                <div className="flex flex-wrap gap-3 mt-2">
                  {lead.email && (
                    <div className="flex items-center gap-1.5" style={{ fontSize: "0.8125rem", color: "oklch(1 0 0 / 0.75)" }}>
                      <Mail className="w-3.5 h-3.5" />
                      {lead.email}
                    </div>
                  )}
                  {lead.phone && (
                    <div className="flex items-center gap-1.5" style={{ fontSize: "0.8125rem", color: "oklch(1 0 0 / 0.75)" }}>
                      <Phone className="w-3.5 h-3.5" />
                      {lead.phone}
                    </div>
                  )}
                  {lead.city && (
                    <div className="flex items-center gap-1.5" style={{ fontSize: "0.8125rem", color: "oklch(1 0 0 / 0.75)" }}>
                      <MapPin className="w-3.5 h-3.5" />
                      {lead.city}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <Button
              onClick={() => setIsEditingLead(!isEditingLead)}
              style={{
                background: isEditingLead ? "oklch(0.58 0.24 27 / 0.2)" : "oklch(1 0 0 / 0.15)",
                border: isEditingLead ? "1px solid oklch(0.58 0.24 27 / 0.4)" : "1px solid oklch(1 0 0 / 0.25)",
                color: "white",
                backdropFilter: "blur(8px)",
                fontWeight: 600,
                fontSize: "0.875rem",
                transition: "all 0.2s ease",
              }}
            >
              {isEditingLead ? (
                <>
                  <X className="w-4 h-4 mr-1.5" />
                  İptal
                </>
              ) : (
                <>
                  <Edit2 className="w-4 h-4 mr-1.5" />
                  Düzenle
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              icon: Tag,
              label: "Statü",
              value: status?.displayName || "—",
              color: status?.color,
              isStatus: true,
            },
            {
              icon: Building2,
              label: "Proje",
              value: lead.projectName || "—",
              color: "oklch(0.55 0.20 255)",
            },
            {
              icon: MessageSquare,
              label: "Kaynak",
              value: lead.source || "—",
              color: "oklch(0.55 0.20 300)",
            },
            {
              icon: User,
              label: "Atanmış",
              value: assignedUser?.name || "—",
              color: "oklch(0.55 0.18 145)",
            },
          ].map((item, i) => (
            <Card
              key={item.label}
              className="animate-slide-in-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <CardContent style={{ padding: "1rem 1.25rem" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      background: `${item.color || "oklch(0.48 0.20 255)"}18`,
                    }}
                  >
                    <item.icon
                      className="w-3.5 h-3.5"
                      style={{ color: item.color || "oklch(0.48 0.20 255)" }}
                    />
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    {item.label}
                  </span>
                </div>
                {item.isStatus && status ? (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white"
                    style={{
                      background: status.color,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      boxShadow: `0 2px 8px ${status.color}40`,
                    }}
                  >
                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "oklch(1 0 0 / 0.7)", flexShrink: 0 }} />
                    {status.displayName}
                  </span>
                ) : (
                  <p className="font-semibold" style={{ fontSize: "0.9375rem", letterSpacing: "-0.01em" }}>
                    {item.value}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Edit Form */}
        {isEditingLead && (
          <Card className="animate-slide-in-up">
            <CardHeader>
              <CardTitle>Lead Bilgilerini Düzenle</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={leadForm.handleSubmit(onUpdateLead)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Ad</label>
                    <Input {...leadForm.register("firstName")} defaultValue={lead.firstName} />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Soyad</label>
                    <Input {...leadForm.register("lastName")} defaultValue={lead.lastName} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium block mb-1.5">E-posta</label>
                    <Input type="email" {...leadForm.register("email")} defaultValue={lead.email || ""} />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Telefon</label>
                    <Input {...leadForm.register("phone")} defaultValue={lead.phone || ""} />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1.5">Notlar</label>
                  <Textarea {...leadForm.register("notes")} defaultValue={lead.notes || ""} rows={3} />
                </div>
                <div
                  className="flex gap-2 pt-2"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <Button
                    type="submit"
                    style={{
                      background: "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))",
                      border: "none",
                      fontWeight: 600,
                    }}
                  >
                    <Save className="w-4 h-4 mr-1.5" />
                    Kaydet
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsEditingLead(false)}>
                    <X className="w-4 h-4 mr-1.5" />
                    İptal
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="activities" className="w-full">
          <TabsList>
            <TabsTrigger value="activities">
              Aktiviteler
              {activities.length > 0 && (
                <span
                  className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold"
                  style={{ background: "var(--primary)", color: "white", fontSize: "0.625rem" }}
                >
                  {activities.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="communications">
              İletişim
              {communications.length > 0 && (
                <span
                  className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold"
                  style={{ background: "var(--primary)", color: "white", fontSize: "0.625rem" }}
                >
                  {communications.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="meetings">
              Randevular
              {meetings.length > 0 && (
                <span
                  className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold"
                  style={{ background: "var(--primary)", color: "white", fontSize: "0.625rem" }}
                >
                  {meetings.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Activities */}
          <TabsContent value="activities" className="mt-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold" style={{ fontSize: "0.9375rem", letterSpacing: "-0.01em" }}>
                Aktivite Geçmişi
              </h3>
              <Dialog open={isActivityOpen} onOpenChange={setIsActivityOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    style={{
                      background: "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))",
                      border: "none",
                      fontWeight: 600,
                      fontSize: "0.8125rem",
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Aktivite Ekle
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Yeni Aktivite</DialogTitle>
                  </DialogHeader>
                  <Form {...activityForm}>
                    <form onSubmit={activityForm.handleSubmit(onAddActivity)} className="space-y-4 mt-2">
                      <FormField
                        control={activityForm.control}
                        name="type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tür</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {Object.entries(activityTypeConfig).map(([val, cfg]) => (
                                  <SelectItem key={val} value={val}>
                                    <span className="flex items-center gap-2">
                                      <span>{cfg.icon}</span>
                                      {cfg.label}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={activityForm.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Başlık</FormLabel>
                            <FormControl>
                              <Input placeholder="Aktivite başlığı" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={activityForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Açıklama</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Detaylar..." {...field} rows={3} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full"
                        style={{
                          background: "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))",
                          border: "none",
                          fontWeight: 600,
                        }}
                      >
                        Aktivite Ekle
                      </Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="flex flex-col gap-3">
              {activities.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="font-semibold">Henüz aktivite yok</p>
                  <p style={{ fontSize: "0.875rem" }}>İlk aktiviteyi ekleyin</p>
                </div>
              ) : (
                activities.map((activity, i) => {
                  const cfg = activityTypeConfig[activity.type] || activityTypeConfig.note;
                  return (
                    <div
                      key={activity.id}
                      className="activity-item animate-slide-in-up"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <div className="activity-dot" />
                      <div
                        className="rounded-xl p-4"
                        style={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          transition: "all 0.2s ease",
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--primary)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-sm)";
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold" style={{ fontSize: "0.875rem", letterSpacing: "-0.01em" }}>
                              {activity.title}
                            </p>
                            {activity.description && (
                              <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>
                                {activity.description}
                              </p>
                            )}
                            <div className="flex items-center gap-1.5 mt-2" style={{ fontSize: "0.6875rem", color: "var(--muted-foreground)" }}>
                              <Clock className="w-3 h-3" />
                              {new Date(activity.createdAt).toLocaleString("tr-TR")}
                            </div>
                          </div>
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full shrink-0"
                            style={{
                              background: cfg.bg,
                              color: cfg.color,
                              fontSize: "0.6875rem",
                              fontWeight: 600,
                              letterSpacing: "0.03em",
                              border: `1px solid ${cfg.color}30`,
                            }}
                          >
                            {cfg.icon} {cfg.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* Communications */}
          <TabsContent value="communications" className="mt-4">
            <h3 className="font-semibold mb-4" style={{ fontSize: "0.9375rem", letterSpacing: "-0.01em" }}>
              İletişim Geçmişi
            </h3>
            <div className="flex flex-col gap-3">
              {communications.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <p className="font-semibold">Henüz iletişim kaydı yok</p>
                </div>
              ) : (
                communications.map((comm, i) => (
                  <div
                    key={comm.id}
                    className="comm-card animate-slide-in-up"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div
                      className="comm-icon"
                      style={{
                        background: "oklch(0.55 0.20 145 / 0.12)",
                        color: "oklch(0.50 0.18 145)",
                      }}
                    >
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold" style={{ fontSize: "0.875rem", letterSpacing: "-0.01em" }}>
                        {comm.subject || comm.type}
                      </p>
                      {comm.message && (
                        <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }} className="truncate">
                          {comm.message}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5" style={{ fontSize: "0.6875rem", color: "var(--muted-foreground)" }}>
                        <Clock className="w-3 h-3" />
                        {new Date(comm.createdAt).toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full shrink-0"
                      style={{
                        background: "oklch(0.55 0.20 145 / 0.12)",
                        color: "oklch(0.50 0.18 145)",
                        fontSize: "0.6875rem",
                        fontWeight: 600,
                        letterSpacing: "0.03em",
                        border: "1px solid oklch(0.55 0.20 145 / 0.25)",
                      }}
                    >
                      {comm.type}
                    </span>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Meetings */}
          <TabsContent value="meetings" className="mt-4">
            <h3 className="font-semibold mb-4" style={{ fontSize: "0.9375rem", letterSpacing: "-0.01em" }}>
              Randevular
            </h3>
            <div className="flex flex-col gap-3">
              {meetings.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <p className="font-semibold">Henüz randevu yok</p>
                </div>
              ) : (
                meetings.map((meeting, i) => (
                  <div
                    key={meeting.id}
                    className="rounded-xl p-4 animate-slide-in-up"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      transition: "all 0.2s ease",
                      animationDelay: `${i * 50}ms`,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "var(--primary)";
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-sm)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-semibold" style={{ fontSize: "0.875rem", letterSpacing: "-0.01em" }}>
                          {meeting.title}
                        </p>
                        {meeting.description && (
                          <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>
                            {meeting.description}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-2" style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(meeting.startTime).toLocaleString("tr-TR")}
                        </div>
                        {meeting.meetingLink && (
                          <a
                            href={meeting.meetingLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-2"
                            style={{
                              fontSize: "0.8125rem",
                              color: "var(--primary)",
                              fontWeight: 500,
                              textDecoration: "none",
                            }}
                          >
                            Toplantı Linkini Aç →
                          </a>
                        )}
                      </div>
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full shrink-0"
                        style={{
                          background: "oklch(0.55 0.20 300 / 0.12)",
                          color: "oklch(0.48 0.20 300)",
                          fontSize: "0.6875rem",
                          fontWeight: 600,
                          letterSpacing: "0.03em",
                          border: "1px solid oklch(0.55 0.20 300 / 0.25)",
                        }}
                      >
                        {meeting.meetingType}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
