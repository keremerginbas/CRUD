import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { User, Users, Check } from "lucide-react";
import { toast } from "sonner";

interface AssignedToSelectorProps {
  currentAssignedToId?: number | null;
  onAssign: (userId: number | null) => Promise<void>;
  showLabel?: boolean;
  compact?: boolean;
}

const ROLE_COLORS = {
  admin: "bg-red-500",
  sales_manager: "bg-blue-500",
  sales_rep: "bg-green-500",
  accountant: "bg-purple-500",
  user: "bg-gray-500",
};

/**
 * Sorumlu Atama Seçici
 * Lead veya Activity'ye sorumlu kişi atamak için kullanılır
 */
export function AssignedToSelector({
  currentAssignedToId,
  onAssign,
  showLabel = true,
  compact = false,
}: AssignedToSelectorProps) {
  const usersQuery = trpc.users.list.useQuery();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const currentUser = usersQuery.data?.find((u) => u.id === currentAssignedToId);

  const handleAssign = async (userId: number | null) => {
    setIsLoading(true);
    try {
      await onAssign(userId);
      toast.success(userId ? "Sorumlu atandı" : "Sorumlu kaldırıldı");
      setIsOpen(false);
    } catch (error) {
      toast.error("İşlem başarısız");
    } finally {
      setIsLoading(false);
    }
  };

  if (compact) {
    return (
      <Select
        value={currentAssignedToId?.toString() || ""}
        onValueChange={(value) => handleAssign(value ? parseInt(value) : null)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Sorumlu Seç" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Atanmamış</SelectItem>
          {usersQuery.data?.map((user) => (
            <SelectItem key={user.id} value={user.id.toString()}>
              {user.name || "Adsız"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 hover:bg-blue-50 border-blue-200"
        >
          <User className="w-4 h-4" />
          {currentUser ? currentUser.name || "Adsız" : "Sorumlu Seç"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sorumlu Kişi Seç</DialogTitle>
        </DialogHeader>

        {usersQuery.isLoading ? (
          <p className="text-slate-500">Kullanıcılar yükleniyor...</p>
        ) : (
          <div className="space-y-4">
            {/* Atanmamış Seçeneği */}
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 border-slate-200 hover:border-slate-300"
              onClick={() => handleAssign(null)}
              disabled={isLoading}
            >
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                <Users className="w-5 h-5 text-gray-600" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-slate-900">Atanmamış</p>
                <p className="text-sm text-slate-500">Hiç kimseye atanmamış</p>
              </div>
              {currentAssignedToId === null && (
                <Check className="w-5 h-5 text-green-500 ml-auto" />
              )}
            </Button>

            {/* Kullanıcı Listesi */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {usersQuery.data?.map((user) => (
                <Button
                  key={user.id}
                  variant="outline"
                  className="w-full justify-start gap-3 h-auto py-3 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
                  onClick={() => handleAssign(user.id)}
                  disabled={isLoading}
                >
                  <div
                    className={`w-10 h-10 rounded-full ${ROLE_COLORS[user.role as keyof typeof ROLE_COLORS] || "bg-gray-500"} flex items-center justify-center text-white font-bold`}
                  >
                    {user.name?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-semibold text-slate-900">{user.name || "Adsız Kullanıcı"}</p>
                    <p className="text-sm text-slate-500">{user.email}</p>
                  </div>
                  {user.isActive ? (
                    <Badge className="bg-green-100 text-green-700">Aktif</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-700">İnaktif</Badge>
                  )}
                  {currentAssignedToId === user.id && (
                    <Check className="w-5 h-5 text-green-500" />
                  )}
                </Button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sorumlu Kişi Gösterici
 * Atanmış kişiyi göstermek için kullanılır
 */
export function AssignedToDisplay({ userId }: { userId?: number | null }) {
  const usersQuery = trpc.users.list.useQuery();
  const user = usersQuery.data?.find((u) => u.id === userId);

  if (!userId || !user) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Users className="w-4 h-4" />
        <span>Atanmamış</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full ${ROLE_COLORS[user.role as keyof typeof ROLE_COLORS] || "bg-gray-500"} flex items-center justify-center text-white text-xs font-bold`}
      >
        {user.name?.charAt(0).toUpperCase() || "U"}
      </div>
      <span className="font-medium text-slate-900">{user.name || "Adsız"}</span>
    </div>
  );
}