"use client";

import type { CustomProviderModel, CustomProviderPublic } from "@uberskills/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@uberskills/ui";
import { Download, Eye, EyeOff, Loader2, Pencil, Plus, Server, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

/** A provider as edited in the UI. An empty `apiKey` means "keep the stored key". */
export interface ProviderDraft {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: CustomProviderModel[];
}

interface CustomProvidersCardProps {
  providers: CustomProviderPublic[];
  /** Persists the full provider list. Returns true on success. */
  onSave: (providers: ProviderDraft[]) => Promise<boolean>;
}

/** Converts a stored public provider into an editable draft (key blanked). */
function toDraft(p: CustomProviderPublic): ProviderDraft {
  return { id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: "", models: p.models };
}

/**
 * Manages custom OpenAI-compatible providers (MiniMax, DeepSeek, a local
 * Ollama, ...): list, add, edit, delete, and connectivity testing.
 */
export function CustomProvidersCard({ providers, onSave }: CustomProvidersCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderDraft | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openAdd = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((p: CustomProviderPublic) => {
    setEditing(toDraft(p));
    setDialogOpen(true);
  }, []);

  /** Builds the full list with `draft` inserted/replaced, then persists. */
  const handleSubmit = useCallback(
    async (draft: ProviderDraft) => {
      setBusy(true);
      try {
        const others = providers
          .filter((p) => p.id !== draft.id)
          .map<ProviderDraft>((p) => toDraft(p));
        const ok = await onSave([...others, draft]);
        if (ok) setDialogOpen(false);
      } finally {
        setBusy(false);
      }
    },
    [providers, onSave],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await onSave(providers.filter((p) => p.id !== id).map(toDraft));
      } finally {
        setBusy(false);
      }
    },
    [providers, onSave],
  );

  const handleTest = useCallback(async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/settings/test?provider=${encodeURIComponent(id)}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Connection test failed");
      }
      toast.success("Provider reachable");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTestingId(null);
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Server className="size-5" />
              Custom Providers
            </CardTitle>
            <CardDescription>
              Connect any OpenAI-compatible provider (MiniMax, DeepSeek, Moonshot, a local Ollama,
              …). Their models appear in the model picker alongside OpenRouter.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={openAdd} className="shrink-0">
            <Plus className="size-4" />
            Add Provider
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {providers.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No custom providers yet. Add one to use models outside OpenRouter.
          </p>
        ) : (
          providers.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  <Badge variant="secondary">{p.models.length} model(s)</Badge>
                  {p.apiKeySet ? (
                    <Badge variant="outline">key set</Badge>
                  ) : (
                    <Badge variant="outline">no key</Badge>
                  )}
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">{p.baseUrl}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleTest(p.id)}
                  disabled={testingId === p.id}
                  aria-label={`Test ${p.name}`}
                >
                  {testingId === p.id ? <Loader2 className="size-4 animate-spin" /> : "Test"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => openEdit(p)}
                  aria-label={`Edit ${p.name}`}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => handleDelete(p.id)}
                  disabled={busy}
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        busy={busy}
        onSubmit={handleSubmit}
      />
    </Card>
  );
}

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ProviderDraft | null;
  busy: boolean;
  onSubmit: (draft: ProviderDraft) => void | Promise<void>;
}

const EMPTY_MODEL: CustomProviderModel = { id: "", name: "" };

/** Add/edit form for a single custom provider, with manual + fetched models. */
function ProviderDialog({ open, onOpenChange, initial, busy, onSubmit }: ProviderDialogProps) {
  const isEdit = initial !== null;
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<CustomProviderModel[]>([{ ...EMPTY_MODEL }]);
  const [fetching, setFetching] = useState(false);

  // Reset the form whenever the dialog opens (for add or a specific edit).
  const syncFromInitial = useCallback(() => {
    setName(initial?.name ?? "");
    setBaseUrl(initial?.baseUrl ?? "");
    setApiKey("");
    setShowKey(false);
    setModels(
      initial && initial.models.length > 0
        ? initial.models.map((m) => ({ ...m }))
        : [{ ...EMPTY_MODEL }],
    );
  }, [initial]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) syncFromInitial();
      onOpenChange(next);
    },
    [onOpenChange, syncFromInitial],
  );

  const updateModel = (index: number, patch: Partial<CustomProviderModel>) => {
    setModels((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };
  const addModelRow = () => setModels((prev) => [...prev, { ...EMPTY_MODEL }]);
  const removeModelRow = (index: number) =>
    setModels((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const handleFetchModels = useCallback(async () => {
    if (!baseUrl.trim()) {
      toast.error("Enter a base URL first");
      return;
    }
    setFetching(true);
    try {
      const res = await fetch("/api/settings/providers/fetch-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey || undefined,
          providerId: initial?.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        models?: CustomProviderModel[];
        error?: string;
      };
      if (!res.ok || !data.models) {
        throw new Error(data.error ?? "Could not fetch models");
      }
      if (data.models.length === 0) {
        toast.message("No models returned — enter them manually");
        return;
      }
      setModels(data.models);
      toast.success(`Loaded ${data.models.length} model(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fetch models");
    } finally {
      setFetching(false);
    }
  }, [baseUrl, apiKey, initial?.id]);

  const handleSave = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedBase = baseUrl.trim();
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }
    if (!trimmedBase) {
      toast.error("Base URL is required");
      return;
    }
    const cleanedModels = models
      .map((m) => ({ id: m.id.trim(), name: m.name.trim() || m.id.trim() }))
      .filter((m) => m.id !== "");
    if (cleanedModels.length === 0) {
      toast.error("Add at least one model");
      return;
    }
    onSubmit({
      id: initial?.id,
      name: trimmedName,
      baseUrl: trimmedBase,
      apiKey,
      models: cleanedModels,
    });
  }, [name, baseUrl, apiKey, models, initial?.id, onSubmit]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Provider" : "Add Provider"}</DialogTitle>
          <DialogDescription>
            Configure an OpenAI-compatible endpoint. Models are resolved against{" "}
            <span className="font-mono text-xs">{"{baseUrl}/chat/completions"}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <div className="space-y-1.5">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MiniMax"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-base-url">Base URL</Label>
            <Input
              id="provider-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.minimaxi.com/v1"
              className="font-mono"
              list="provider-base-url-presets"
            />
            <datalist id="provider-base-url-presets">
              <option value="https://api.minimaxi.com/v1" />
              <option value="https://api.deepseek.com/v1" />
              <option value="https://api.moonshot.cn/v1" />
              <option value="https://open.bigmodel.cn/api/paas/v4" />
              <option value="http://localhost:11434/v1" />
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-api-key">API Key</Label>
            <div className="relative">
              <Input
                id="provider-api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  isEdit
                    ? "Leave blank to keep the current key"
                    : "Provider API key (blank for keyless endpoints)"
                }
                className="pr-10 font-mono"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute top-1/2 right-1 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? (
                  <EyeOff className="size-4 text-muted-foreground" />
                ) : (
                  <Eye className="size-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Models</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchModels}
                disabled={fetching}
              >
                {fetching ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Fetch models
              </Button>
            </div>
            <div className="space-y-2">
              {models.map((model, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={model.id}
                    onChange={(e) => updateModel(index, { id: e.target.value })}
                    placeholder="model-id (e.g. MiniMax-Text-01)"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={model.name}
                    onChange={(e) => updateModel(index, { name: e.target.value })}
                    placeholder="display name (optional)"
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 shrink-0 p-0"
                    onClick={() => removeModelRow(index)}
                    aria-label="Remove model"
                  >
                    <X className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={addModelRow}>
              <Plus className="size-4" />
              Add model
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? "Save Provider" : "Add Provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
