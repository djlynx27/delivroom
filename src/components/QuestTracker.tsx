import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

const PLATFORMS = ['lyft', 'uber', 'hypra', 'imoove', 'doordash', 'ubereats', 'skip'] as const;
type Platform = (typeof PLATFORMS)[number];

interface DriverQuest {
  id: string;
  platform: Platform;
  name: string;
  current_count: number;
  target_count: number;
  bonus_amount: number;
  deadline: string;
  status: 'active' | 'completed' | 'failed' | 'archived';
}

async function fetchActiveQuests(): Promise<DriverQuest[]> {
  const { data, error } = await supabase
    .from('driver_quests')
    .select('id, platform, name, current_count, target_count, bonus_amount, deadline, status')
    .eq('status', 'active')
    .order('deadline', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DriverQuest[];
}

export function QuestTracker() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: quests = [] } = useQuery({
    queryKey: ['driver-quests', 'active'],
    queryFn: fetchActiveQuests,
    refetchInterval: 60_000,
  });

  const incrementMutation = useMutation({
    mutationFn: async (id: string) => {
      const q = quests.find((x) => x.id === id);
      if (!q) throw new Error('Quest not found');
      const next = Math.min(q.current_count + 1, q.target_count);
      const updates: { current_count: number; status?: 'completed' } = { current_count: next };
      if (next >= q.target_count) updates.status = 'completed';
      const { error } = await supabase.from('driver_quests').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['driver-quests'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('driver_quests').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['driver-quests'] });
    },
  });

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> Bonus quests
          </span>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setCreating(true)}>
            <Plus className="w-3 h-3" /> Ajouter
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {quests.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Aucun bonus actif. Ajoute ton Quest Lyft / Uber pour le tracker.
          </p>
        )}
        {quests.map((q) => {
          const pct = Math.round((q.current_count / q.target_count) * 100);
          const remaining = q.target_count - q.current_count;
          const deadline = new Date(q.deadline);
          const hoursLeft = (deadline.getTime() - Date.now()) / 3_600_000;
          const urgent = hoursLeft < 24 && remaining > 0;
          return (
            <div key={q.id} className="space-y-1.5 bg-background rounded-md border border-border p-2">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{q.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[9px] uppercase">{q.platform}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      ${q.bonus_amount.toFixed(0)} bonus
                    </span>
                    <span className={`text-[10px] ${urgent ? 'text-amber-400 font-medium' : 'text-muted-foreground'}`}>
                      {hoursLeft > 24
                        ? `${Math.floor(hoursLeft / 24)}j restants`
                        : hoursLeft > 0
                          ? `${Math.floor(hoursLeft)}h restantes`
                          : 'expiré'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => incrementMutation.mutate(q.id)}
                    disabled={q.current_count >= q.target_count}
                  >
                    +1
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => deleteMutation.mutate(q.id)}
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Progress value={pct} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground flex justify-between">
                  <span>{q.current_count} / {q.target_count}</span>
                  {remaining > 0 && (
                    <span className={urgent ? 'text-amber-400 font-medium' : ''}>
                      {remaining} de plus = +${q.bonus_amount.toFixed(0)}
                    </span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>

      <CreateQuestDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void qc.invalidateQueries({ queryKey: ['driver-quests'] });
        }}
      />
    </Card>
  );
}

interface CreateQuestDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateQuestDialog({ open, onClose, onCreated }: CreateQuestDialogProps) {
  const [platform, setPlatform] = useState<Platform>('lyft');
  const [name, setName] = useState('Weekly Quest');
  const [target, setTarget] = useState('30');
  const [bonus, setBonus] = useState('80');
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);

  async function submit() {
    const targetNum = parseInt(target, 10);
    const bonusNum = parseFloat(bonus);
    if (!Number.isFinite(targetNum) || targetNum <= 0) {
      toast.error('Target invalide');
      return;
    }
    setSaving(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        toast.error('Auth requise');
        return;
      }
      const { error } = await supabase.from('driver_quests').insert({
        user_id: authData.user.id,
        platform,
        name,
        target_count: targetNum,
        bonus_amount: Number.isFinite(bonusNum) ? bonusNum : 0,
        deadline: new Date(deadline).toISOString(),
      });
      if (error) {
        toast.error(`Échec création : ${error.message}`);
        return;
      }
      toast.success('Quest ajouté');
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nouveau bonus quest</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Plateforme</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Rides cible</Label>
              <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bonus $</Label>
              <Input type="number" step="0.01" value={bonus} onChange={(e) => setBonus(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Deadline</Label>
            <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button onClick={submit} disabled={saving}>Créer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
