/** @jsxImportSource react */
import { t } from "@/i18n";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Download, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  fetchOllamaModelCapabilities,
  fetchOllamaSyncInput,
  OLLAMA_PROVIDER_CONFIG,
  type LocalProviderInstallInput,
  type LocalProviderSyncInput,
} from "./openai-image-extension";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";

const ollamaConfigFactory = (ctx: ExtensionConfigContext) => (
  <OllamaConfig
    busy={ctx.localProvider.busy}
    status={ctx.localProvider.status}
    error={ctx.localProvider.error}
    onInstall={ctx.localProvider.onInstall}
    onSync={ctx.localProvider.onSync}
  />
);

registerExtensionConfig("openwork.ollama.settings", ollamaConfigFactory);
registerExtensionConfig("ollama", ollamaConfigFactory);

type OllamaModel = {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
};

type OllamaStatus = "checking" | "running" | "unreachable";

function useOllamaModels() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["ollama", "tags"],
    queryFn: async (): Promise<{ status: "running" | "unreachable"; models: OllamaModel[] }> => {
      try {
        const response = await fetch(`${OLLAMA_PROVIDER_CONFIG.baseURL.replace("/v1", "")}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });

        if (!response.ok) {
          return { status: "unreachable", models: [] };
        }

        const data = await response.json();

        return { status: "running", models: Array.isArray(data?.models) ? data.models : [] };
      } catch {
        return { status: "unreachable", models: [] };
      }
    },
    refetchOnWindowFocus: false,
  });

  const status: OllamaStatus = isFetching ? "checking" : (data?.status ?? "unreachable");

  return { data, isFetching, refetch, status };
}

type PullProgressUpdate = {
  status: string;
  completed?: number;
  total?: number;
};

type PullProgressState = PullProgressUpdate & {
  modelName: string;
};

async function pullOllamaModel(
  modelName: string,
  onProgress: (update: PullProgressUpdate) => void,
): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_PROVIDER_CONFIG.baseURL.replace("/v1", "")}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.status) {
            onProgress({
              status: parsed.status,
              completed: typeof parsed.completed === "number" ? parsed.completed : undefined,
              total: typeof parsed.total === "number" ? parsed.total : undefined,
            });
          }
          if (parsed.error) {
            onProgress({ status: t("settings_extra.error_error", { error: parsed.error }) });
            return false;
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
    return true;
  } catch (error) {
    onProgress({ status: t("settings_extra.pull_failed_error", { error: error instanceof Error ? error.message : String(error) }) });
    return false;
  }
}

function usePullOllamaModel(options: { onSuccess?: (model: string) => void } = {}) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PullProgressState | null>(null);

  const { mutateAsync: pullModel, isPending: isPulling } = useMutation({
    mutationFn: async (modelName: string) => {
      const model = modelName.trim();
      
      if (!model) {
        throw new Error(t("settings_extra.model_name_is_required"));
      }

      let latestProgress: PullProgressUpdate = { status: t("settings_extra.starting_pull") };
      const updateProgress = (update: PullProgressUpdate) => {
        latestProgress = update;
        setProgress((current) => ({
          modelName: model,
          status: update.status,
          completed: update.completed ?? current?.completed,
          total: update.total ?? current?.total,
        }));
      };

      updateProgress(latestProgress);
      const ok = await pullOllamaModel(model, updateProgress);

      if (!ok) {
        if (latestProgress.status === t("settings_extra.starting_pull")) {
          setProgress({ modelName: model, status: t("settings_extra.failed_to_pull_model", { model }) });
        }
        throw new Error(t("settings_extra.failed_to_pull_model", { model }));
      }

      return model;
    },
    onSuccess: async (model) => {
      await queryClient.invalidateQueries({ queryKey: ["ollama", "tags"] });
      setProgress(null);
      options.onSuccess?.(model);
    },
  });

  return { pullModel, isPulling, progress };
}

export type OllamaConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  onInstall: (input: LocalProviderInstallInput) => void | Promise<void>;
  onSync: (input: LocalProviderSyncInput) => void | Promise<void>;
};

export function OllamaConfig(props: OllamaConfigProps) {
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState(OLLAMA_PROVIDER_CONFIG.defaultModelId);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [setDefault, setSetDefault] = useState(true);
  const [checkingCapabilities, setCheckingCapabilities] = useState(false);
  const [lastAction, setLastAction] = useState<"install" | "sync" | null>(null);


  const { data, isFetching, refetch, status } = useOllamaModels();
  const { isPulling, pullModel, progress } = usePullOllamaModel({
    onSuccess: setSelectedModel,
  });

  const activeModelId = isPulling ? customModel.trim() : selectedModel;

  useEffect(() => {
    if (!selectedModel && data?.models?.[0]) {
      setSelectedModel(data.models[0].name);
    }
  }, [data, selectedModel]);

  const handlePull = async () => {
    const model = customModel.trim();

    if (!model) { 
      return; 
    }

    setPullDialogOpen(false);
    
    try {
      await pullModel(model);
    } catch {
      // The mutation hook owns error progress display.
    }
  };

  const handleInstall = () => {
    if (!activeModelId) { 
      return; 
    }

    setLastAction("install");
    void (async () => {
      setCheckingCapabilities(true);
      try {
        const { supportsVision, thinkingLevels } = await fetchOllamaModelCapabilities(activeModelId, OLLAMA_PROVIDER_CONFIG.baseURL);
        await props.onInstall({
          providerId: OLLAMA_PROVIDER_CONFIG.providerId,
          name: OLLAMA_PROVIDER_CONFIG.name,
          baseURL: OLLAMA_PROVIDER_CONFIG.baseURL,
          modelId: activeModelId,
          modelName: activeModelId,
          setDefault,
          supportsVision,
          thinkingLevels,
        });
      } finally {
        setCheckingCapabilities(false);
      }
    })();
  };

  const working = props.busy || checkingCapabilities;

  /** Makes OpenWork's Ollama models match what Ollama has now, with fresh capabilities. */
  const handleSync = () => {
    setLastAction("sync");
    void (async () => {
      setCheckingCapabilities(true);
      try {
        const input = await fetchOllamaSyncInput();
        // Show the list that was synced, including models pulled or removed outside OpenWork.
        void refetch();
        if (input) await props.onSync(input);
      } finally {
        setCheckingCapabilities(false);
      }
    })();
  };

  if (status === "unreachable") {
    return (
      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{t("interface.configuration")}</CardTitle>
          <CardDescription>{t("interface.connect_to_a_local_ollama_instance_and_choose_a_model")}</CardDescription>
          <CardAction>
            <Button variant="ghost" size="icon-sm" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.error ? (
            <Alert variant="destructive">
              <XCircle />
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          ) : null}

          <Empty className="flex-none p-6" variant="ghost">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Download />
              </EmptyMedia>
              <EmptyTitle>{t("interface.ollama_isn_t_installed_or_running")}</EmptyTitle>
              <EmptyDescription>{t("interface.download_and_start_ollama_to_use_open_source_models_in_your_workspace")} </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                render={
                  <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" />
                }
              >{t("interface.download_ollama")} </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>{t("interface.configuration")}</CardTitle>
        <CardDescription>{t("interface.connect_to_a_local_ollama_instance_and_choose_a_model")}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : ""} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.error ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        ) : null}

        <Alert>
          {status === "checking" ? (
            <Loader2 className="animate-spin" />
          ) : status === "running" ? (
            <CheckCircle2 className="text-green-11!" />
          ) : (
            <XCircle  />
          )}
          <AlertDescription>
            {status === "checking"
              ? t("interface.checking_ollama")
              : status === "running"
                ? t("settings_extra.ollama_running_count_models", { count: data?.models?.length ?? 0 })
                : t("interface.ollama_not_reachable")}
          </AlertDescription>
        </Alert>

        {/* Model selection */}
        {status === "running" && (data?.models?.length ?? 0) > 0 ? (
          <div className="flex flex-col gap-2">
            <FieldSet className="gap-3">
              <FieldLegend variant="label">{t("interface.available_models")}</FieldLegend>
              <FieldDescription>{t("interface.select_from_models_already_loaded_in_ollama")} </FieldDescription>
              <ModelList value={selectedModel} onValueChange={setSelectedModel}>
                {(data?.models ?? []).map((model) => (
                  <ModelListItem key={model.name} model={model} />
                ))}
              </ModelList>
            </FieldSet>
            {progress ? (
              <PullProgressRow progress={progress} isPulling={isPulling} />
            ) : null}
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="link"
                size="sm"
                onClick={() => setPullDialogOpen(true)}
              >{t("interface.add_a_custom_model")} </Button>
              <Button
                variant="link"
                size="sm"
                onClick={handleSync}
                disabled={working || isPulling}
                title={t("interface.add_every_ollama_model_to_openwork_remove_deleted_ones_and_refresh_their_capabilities")}
              >
                {working && lastAction === "sync" && <Loader2 className="size-4 animate-spin" />}{t("interface.sync_all_models")} </Button>
            </div>
          </div>
        ) : null}

        {/* No models */}
        {status === "running" && (data?.models?.length ?? 0) === 0 && !isPulling && !progress ? (
          <Empty className="flex-none p-6" variant="ghost">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Download />
              </EmptyMedia>
              <EmptyTitle>{t("interface.no_models_loaded")}</EmptyTitle>
              <EmptyDescription>{t("interface.pull_a_model_from_ollama_com_library_to_get_started")} </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setPullDialogOpen(true)}>{t("interface.pull_a_model")} </Button>
            </EmptyContent>
          </Empty>
        ) : status === "running" && (data?.models?.length ?? 0) === 0 && progress ? (
          <PullProgressRow progress={progress} isPulling={isPulling} />
        ) : null}

        <PullModelDialog
          open={pullDialogOpen}
          onOpenChange={setPullDialogOpen}
          model={customModel}
          onModelChange={setCustomModel}
          onPull={() => void handlePull()}
        />

        {props.status ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>{props.status}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="border-t border-border">
        <FieldGroup className="gap-3">
          <Field orientation="horizontal">
            <Checkbox
              id="ollama-set-default"
              name="ollama-set-default"
              checked={setDefault}
              onCheckedChange={setSetDefault}
              nativeButton
              render={<button type="button" />}
            />
            <FieldLabel htmlFor="ollama-set-default">{t("interface.use_as_default_model_in_workspace")}</FieldLabel>
          </Field>
        </FieldGroup>
        <Button
          onClick={handleInstall}
          disabled={props.busy || isPulling || checkingCapabilities || !activeModelId || status !== "running"}
        >
          {working && lastAction !== "sync" && <Loader2 className="size-4 animate-spin" />}{t("interface.add_to_workspace")} </Button>
      </CardFooter>
    </Card>
  );
}

interface ModelListProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

export function ModelList({ value, onValueChange, children }: ModelListProps) {
  return (
    <RadioGroup className="w-full gap-2" value={value} onValueChange={onValueChange}>
      {children}
    </RadioGroup>
  )
}

interface ModelListItemProps {
  model: OllamaModel;
}

function ModelListItem({ model }: ModelListItemProps) {
  return (
    <FieldLabel htmlFor={model.name}>
      <Field orientation="horizontal" size="sm">
        <RadioGroupItem value={model.name} id={model.name} />
        <FieldContent className="flex-row justify-between w-full">
          <FieldTitle>{model.name}</FieldTitle>
          <FieldDescription>{formatFileSize(model.size)}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  )
}

type PullProgressRowProps = {
  progress: PullProgressState;
  isPulling: boolean;
};

function PullProgressRow({ progress, isPulling }: PullProgressRowProps) {
  const progressLabel = progress.total && progress.completed != null
    ? `${progress.status} (${Math.round((progress.completed / progress.total) * 100)}%)`
    : progress.status;

  return (
    <FieldLabel>
      <Field orientation="horizontal" size="sm">
        <div className="relative flex aspect-square size-4 shrink-0 items-center justify-center">
          {isPulling ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>
        <FieldContent className="flex-row justify-between w-full">
          <FieldTitle>{progress.modelName}</FieldTitle>
          <FieldDescription>{progressLabel}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

type PullModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: string;
  onModelChange: (model: string) => void;
  onPull: () => void;
};

function PullModelDialog(props: PullModelDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-full max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("interface.pull_model")}</DialogTitle>
          <DialogDescription>{t("interface.download_a_model_from_ollama_com_library_to_your_local_ollama_instance")} </DialogDescription>
        </DialogHeader>
        <FieldSet className="w-full">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ollama-model-pull">{t("interface.model_to_pull")}</FieldLabel>
              <Input
                id="ollama-model-pull"
                type="text"
                value={props.model}
                onChange={(event) => props.onModelChange(event.currentTarget.value)}
                placeholder={OLLAMA_PROVIDER_CONFIG.defaultModelId}
              />
              <FieldDescription>{t("interface.enter_a_model_name_from_ollama_com_library")} </FieldDescription>
            </Field>
          </FieldGroup>
        </FieldSet>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("settings.environment.cancel")} </DialogClose>
          <Button onClick={props.onPull} disabled={!props.model.trim()}>
            <Download className="size-4" />{t("interface.pull")} {props.model.trim() || t("interface.model")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
