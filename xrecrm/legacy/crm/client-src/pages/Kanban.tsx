import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { trpc } from "../lib/trpc";
import { 
  Plus, 
  GripVertical, 
  Phone, 
  MessageCircle, 
  Mail, 
  Calendar, 
  Loader2,
  Check
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import LeadDetailModal from "../components/LeadDetailModal";

// 1. Tip Tanımlamaları
interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  projectName?: string;
  location?: string;
  source?: string;
  statusId: number;
  assignedToId?: number | null;
}

interface Status {
  id: number;
  name: string;
  displayName: string;
  color: string;
  order: number;
}

// Hazır Renk Paleti (Yeni Statü İçin)
const PRESET_COLORS = [
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#14b8a6", // Teal
  "#64748b"  // Slate
];

export default function Kanban() {
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusColor, setNewStatusColor] = useState("#3b82f6");

  const utils = trpc.useUtils();
  
  // 2. Veri Çekme ve Loading Durumları
  const { data: rawLeads = [], isLoading: isLoadingLeads } = trpc.leads.list.useQuery(undefined);
  const { data: rawStatuses = [], isLoading: isLoadingStatuses } = trpc.statuses.list.useQuery(undefined);
  const { data: users = [] } = trpc.users.list.useQuery(undefined);
  const userMap = new Map<number, string>();
  (users as any[]).forEach((u) => userMap.set(u.id, u.name || u.email || `#${u.id}`));
  
  const leads = rawLeads as Lead[];
  const statuses = rawStatuses as Status[];
  const isLoading = isLoadingLeads || isLoadingStatuses;

  const createStatus = trpc.statuses.create.useMutation();

  // Optimistic Update ile Lead Taşıma
  const updateLead = trpc.leads.update.useMutation({
    onMutate: async (vars) => {
      await utils.leads.list.cancel();
      const prev = utils.leads.list.getData(undefined);
      utils.leads.list.setData(undefined, (old: any) =>
        Array.isArray(old) ? old.map((l: Lead) => (l.id === vars.id ? { ...l, statusId: vars.statusId } : l)) : old
      );
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) utils.leads.list.setData(undefined, ctx.prev);
      toast.error(e?.message || "Müşteri adayı taşınırken hata oluştu");
    },
    onSettled: () => { 
      utils.leads.list.invalidate(); 
    },
  });

  // 3. Gelişmiş Drag & Drop İşleyicileri
  const handleDragStart = (e: React.DragEvent, leadId: number) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("leadId", leadId.toString());
  };

  const handleDragOver = (e: React.DragEvent, statusId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCol !== statusId) {
      setDragOverCol(statusId); // Üzerine gelinen sütunu vurgula
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCol(null); // Vurguyu kaldır
  };

  const handleDrop = (e: React.DragEvent, statusId: number) => {
    e.preventDefault();
    setDragOverCol(null); // Vurguyu kaldır
    const leadId = parseInt(e.dataTransfer.getData("leadId"));
    if (!leadId) return;
    updateLead.mutate({ id: leadId, statusId });
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) || ""}${lastName?.charAt(0) || ""}`.toUpperCase();
  };

  const handleActionClick = (e: React.MouseEvent, actionName: string, leadName: string) => {
    e.stopPropagation();
    toast.info(`${leadName} için ${actionName} başlatılıyor...`);
  };

  const handleCreateStatus = async () => {
    if (!newStatusName.trim()) {
      toast.error("Lütfen bir statü adı girin");
      return;
    }
    try {
      await createStatus.mutateAsync({
        name: newStatusName.toLowerCase().replace(/\s+/g, "_"),
        displayName: newStatusName,
        color: newStatusColor,
        order: statuses.length,
      });
      toast.success("Statü başarıyla oluşturuldu");
      setNewStatusName("");
      setNewStatusColor("#3b82f6");
      setIsOpen(false);
      utils.statuses.list.invalidate();
    } catch (error) {
      toast.error("Statü oluşturulurken hata oluştu");
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-6 h-[calc(100vh-4rem)]">
        
        {/* Üst Kısım: Başlık ve Buton */}
        <div className="flex justify-between items-center shrink-0">
          <h1 className="text-3xl font-bold text-slate-800">CRM</h1>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4" />
                Yeni Statü
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Yeni Statü Oluştur</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-2">
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-slate-700">Statü Adı</label>
                  <Input
                    value={newStatusName}
                    onChange={(e) => setNewStatusName(e.target.value)}
                    placeholder="örn: Sözleşme Bekleniyor..."
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block text-slate-700">Renk Seçimi</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {PRESET_COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => setNewStatusColor(color)}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                        style={{ backgroundColor: color }}
                      >
                        {newStatusColor === color && <Check className="w-4 h-4 text-white" />}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">Veya özel renk:</span>
                    <input
                      type="color"
                      value={newStatusColor}
                      onChange={(e) => setNewStatusColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                    />
                  </div>
                </div>
                <Button 
                  className="w-full mt-2" 
                  onClick={handleCreateStatus}
                  disabled={createStatus.isPending}
                >
                  {createStatus.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Oluştur"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Loading Durumu */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
              <p className="font-medium">Pipeline Yükleniyor...</p>
            </div>
          </div>
        ) : (
          /* Kanban Board Alanı - Kaydırılabilir Yapı */
          <div className="flex gap-4 overflow-x-auto pb-4 flex-1 items-start min-h-0 custom-scrollbar">
            {statuses.map((status) => {
              const statusLeads = leads.filter((l) => l.statusId === status.id);
              const isDragOver = dragOverCol === status.id;

              return (
                <div
                  key={status.id}
                  className={`flex-shrink-0 w-80 h-full flex flex-col rounded-xl border transition-colors duration-200 ${
                    isDragOver 
                      ? "bg-blue-50/50 border-blue-300 shadow-inner" 
                      : "bg-slate-100/60 border-slate-200"
                  }`}
                  onDragOver={(e) => handleDragOver(e, status.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, status.id)}
                >
                  {/* Sütun Başlığı */}
                  <div className={`p-4 border-b rounded-t-xl shrink-0 transition-colors ${isDragOver ? "border-blue-200 bg-blue-50/80" : "border-slate-200 bg-slate-50"}`}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shadow-sm"
                        style={{ backgroundColor: status.color }}
                      />
                      <h3 className="font-semibold text-slate-700 text-base">{status.displayName}</h3>
                      <span className="ml-auto text-xs font-medium bg-white border border-slate-200 text-slate-600 px-2.5 py-0.5 rounded-full shadow-sm">
                        {statusLeads.length}
                      </span>
                    </div>
                  </div>

                  {/* Sütun İçi Kaydırılabilir Kart Alanı */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-300">
                    {statusLeads.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, lead.id)}
                        onDoubleClick={() => setSelectedLeadId(lead.id)}
                        className="group bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:border-blue-300 transition-all relative overflow-hidden"
                      >
                        {/* Sol taraftaki ince renkli çizgi (Statü Rengi) */}
                        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: status.color }} />

                        {/* Kart Üst Kısım: Avatar, İsim ve Seçenekler */}
                        <div className="flex justify-between items-start mb-3 pl-1">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-sm shrink-0">
                              {getInitials(lead.firstName, lead.lastName)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-slate-800 text-sm truncate">
                                {lead.firstName} {lead.lastName}
                              </h4>
                              <p className="text-xs text-slate-500 truncate">{lead.email}</p>
                            </div>
                          </div>
                          <button className="text-slate-400 hover:text-slate-600 transition-colors opacity-0 group-hover:opacity-100">
                            <GripVertical className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Kart Orta Kısım: Detay Bilgiler */}
                        <div className="bg-slate-50 rounded-lg p-2.5 mb-4 text-xs text-slate-600 space-y-1.5 border border-slate-100 ml-1">
                          {lead.projectName && (
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-500 w-12">Proje:</span>
                              <span className="truncate">{lead.projectName}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-500 w-12">Şehir:</span>
                            <span className="truncate">{lead.location || "Belirtilmemiş"}</span>
                          </div>
                          {lead.source && (
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-500 w-12">Kaynak:</span>
                              <span className="truncate">{lead.source}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-slate-200">
                            <span className="font-medium text-slate-500 w-12">Sorumlu:</span>
                            {lead.assignedToId && userMap.get(lead.assignedToId) ? (
                              <span className="inline-flex items-center gap-1.5 font-semibold text-blue-600 truncate">
                                <span className="inline-grid place-items-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 text-[8px] font-bold flex-shrink-0">
                                  {userMap.get(lead.assignedToId)!.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                                </span>
                                <span className="truncate">{userMap.get(lead.assignedToId)}</span>
                              </span>
                            ) : (
                              <span className="text-amber-500 font-medium">Atanmamış</span>
                            )}
                          </div>
                        </div>

                        {/* Kart Alt Kısım: Öncelik ve Aksiyon Butonları */}
                        <div className="flex justify-between items-center pt-1 ml-1">
                          <div className="flex items-center gap-1.5 bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-[10px] font-semibold border border-slate-200">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                            Standart
                          </div>

                          {/* Aksiyon Butonları */}
                          <div className="flex gap-1">
                            <button 
                              onClick={(e) => handleActionClick(e, "Arama", lead.firstName)}
                              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                              title="Ara"
                            >
                              <Phone className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => handleActionClick(e, "WhatsApp", lead.firstName)}
                              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-green-50 hover:text-green-600 transition-colors"
                              title="WhatsApp"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => handleActionClick(e, "E-Posta", lead.firstName)}
                              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                              title="E-posta Gönder"
                            >
                              <Mail className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => handleActionClick(e, "Randevu", lead.firstName)}
                              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                              title="Etkinlik Ekle"
                            >
                              <Calendar className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Sütun Boş Durumu */}
                    {statusLeads.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-32 text-slate-400 border-2 border-dashed border-slate-200/60 rounded-xl bg-white/50">
                        <p className="text-xs font-medium">Sürükleyip Bırakın</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <LeadDetailModal leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
    </DashboardLayout>
  );
}