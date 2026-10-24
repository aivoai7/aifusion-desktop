import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { HoverTip } from "@/components/ui/hover-tip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchField } from "@/components/ui/search-field";
import {
  CHECKBOX_CLASS,
  RADIO_CLASS,
  V7Dialog,
} from "@/components/mcp/formBits";
import { platformKeyApi, type PlatformModelOption } from "@/lib/api/platformKey";
import { visibleModelId } from "@/lib/modelId";
import { getAppLabel } from "@/config/appConfig";
import type { AppId } from "@/lib/api";
import { cn } from "@/lib/utils";

const UNSET = "__aifusion_unset__";

interface PlatformModelDialogProps {
  app: AppId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 平台模型选择弹窗。
 *
 * 这个构建不展示渠道，模型只能在这里改：列表来自平台实时接口，
 * 后端按每个客户端自己的配置形状落库（角色环境变量 / TOML / 模型表），
 * 界面只看得到模型名，不出现网关地址或密钥。
 */
export function PlatformModelDialog({
  app,
  open,
  onOpenChange,
}: PlatformModelDialogProps) {
  return (
    <V7Dialog open={open} width={620} onOpenChange={onOpenChange}>
      {open && (
        <PlatformModelDialogBody app={app} onClose={() => onOpenChange(false)} />
      )}
    </V7Dialog>
  );
}

function PlatformModelDialogBody({
  app,
  onClose,
}: {
  app: AppId;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draftDefault, setDraftDefault] = useState<string>(UNSET);
  const [draftLight, setDraftLight] = useState<string>(UNSET);
  const [draftModels, setDraftModels] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  // V7Dialog 只在打开时挂载正文，这里无需再判 enabled。
  const modelsQuery = useQuery({
    queryKey: ["platformModels"],
    queryFn: () => platformKeyApi.models(),
    staleTime: 30_000,
  });
  const configQuery = useQuery({
    queryKey: ["platformModelConfig", app],
    queryFn: () => platformKeyApi.modelConfig(app),
  });

  const config = configQuery.data;
  const models = modelsQuery.data ?? [];

  // 每次拿到（或刷新）当前配置都按它重新起草，避免带着上一次的改动。
  const draftKey = config
    ? `${config.defaultModel ?? ""}|${config.lightModel ?? ""}|${config.models.join(",")}`
    : "";
  useEffect(() => {
    if (!config) return;
    // 占位符（__AIFUSION_MODEL__）不是可选模型，当作未选择，逼用户挑一个真模型。
    setDraftDefault(visibleModelId(config.defaultModel) ?? UNSET);
    setDraftLight(visibleModelId(config.lightModel) ?? UNSET);
    // 占位符不是可选模型：草稿列表里也滤掉，免得被计入数量或原样保存回去。
    setDraftModels(
      config.models.filter((id): id is string => visibleModelId(id) != null),
    );
    setQuery("");
  }, [draftKey, config]);

  const save = useMutation({
    mutationFn: () =>
      platformKeyApi.saveModel(app, {
        defaultModel: config?.supportsDefault
          ? draftDefault === UNSET
            ? null
            : draftDefault
          : null,
        lightModel: config?.supportsLight
          ? draftLight === UNSET
            ? null
            : draftLight
          : null,
        models: config?.supportsList ? draftModels : null,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["platformModelConfig"] });
      void queryClient.invalidateQueries({ queryKey: ["providers"] });
      void queryClient.invalidateQueries({ queryKey: ["currentProvider"] });
      if (result.synced) {
        toast.success(t("platformModel.savedLive"));
      } else {
        toast.success(result.message ?? t("platformModel.saved"));
      }
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  // 平台已下架、但本机配置里还留着的模型：单独标记出来
  const retiredIds = useMemo(() => {
    const onPlatform = new Set(models.map((model) => model.id));
    return new Set(
      [
        config?.defaultModel,
        config?.lightModel,
        ...(config?.models ?? []),
      ].filter((id): id is string => {
        const visible = visibleModelId(id);
        return visible != null && !onPlatform.has(visible);
      }),
    );
  }, [config, models]);

  const options = useMemo(() => {
    const seen = new Set<string>();
    const list: PlatformModelOption[] = [];
    for (const model of models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      list.push(model);
    }
    // 本机配置里可能还留着平台已经下架的模型：保留成选项，用户能看到并换掉。
    for (const id of retiredIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, provider: "" });
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }, [config?.defaultModel, config?.lightModel, config?.models, models, retiredIds]);

  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? options.filter((model) => model.id.toLowerCase().includes(normalized))
    : options;
  const visibleIds = visible.map((model) => model.id);
  const selectedSet = new Set(draftModels);

  const loading = modelsQuery.isLoading || configQuery.isLoading;
  const cannotApply =
    loading ||
    options.length === 0 ||
    !config ||
    (config.supportsDefault && draftDefault === UNSET) ||
    (config.supportsList && draftModels.length === 0);

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <DialogTitle className="text-section">
            {t("platformModel.title", { app: getAppLabel(app) })}
          </DialogTitle>
          <DialogDescription className="text-caption text-fg-2">
            {config?.usingPlatform
              ? t("platformModel.leadLive")
              : t("platformModel.leadLater")}
          </DialogDescription>
        </div>
        <HoverTip content={t("platformModel.refresh")}>
          <Button
            type="button"
            variant="quiet"
            size="icon-compact"
            aria-label={t("platformModel.refresh")}
            disabled={modelsQuery.isFetching}
            onClick={() => {
              void modelsQuery.refetch();
              void configQuery.refetch();
            }}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                (modelsQuery.isFetching || configQuery.isFetching) &&
                  "animate-spin",
              )}
            />
          </Button>
        </HoverTip>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-body text-fg-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("platformModel.loading")}
        </div>
      ) : options.length === 0 ? (
        <p className="flex h-40 items-center justify-center text-center text-body text-fg-2">
          {t("platformModel.empty")}
        </p>
      ) : (
        <>
          {config?.supportsDefault && (
            <div className="grid shrink-0 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-caption text-fg-3">
                {t("platformModel.mainModel")}
                <Select value={draftDefault} onValueChange={setDraftDefault}>
                  <SelectTrigger className="font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {config.supportsLight && (
                <label className="flex flex-col gap-1.5 text-caption text-fg-3">
                  {t("platformModel.lightModel")}
                  <Select value={draftLight} onValueChange={setDraftLight}>
                    <SelectTrigger className="font-mono text-xs">
                      <SelectValue placeholder={t("platformModel.useMain")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>
                        {t("platformModel.useMain")}
                      </SelectItem>
                      {options.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
            </div>
          )}

          {config?.supportsList && (
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                <SearchField
                  containerClassName="flex-1"
                  value={query}
                  onValueChange={setQuery}
                  clearLabel={t("common.clear")}
                  placeholder={t("platformModel.search")}
                  aria-label={t("platformModel.search")}
                  autoComplete="off"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  disabled={visibleIds.length === 0}
                  onClick={() =>
                    setDraftModels((prev) => [
                      ...new Set([...prev, ...visibleIds]),
                    ])
                  }
                >
                  {t("platformModel.addAll")}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  disabled={draftModels.length === 0}
                  onClick={() => setDraftModels([])}
                >
                  {t("platformModel.clearAll")}
                </Button>
              </div>
              <span role="status" className="text-caption text-fg-2">
                {t("platformModel.selectedCount", {
                  selected: draftModels.length,
                  total: options.length,
                })}
              </span>
            </div>
          )}

          <div className="max-h-[45vh] min-h-0 overflow-y-auto rounded-panel border border-border">
            {visible.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-body text-fg-2">
                {t("platformModel.noMatch")}
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {visible.map((model) => (
                  <li
                    key={model.id}
                    className="border-t border-border first:border-t-0"
                  >
                    <label className="flex cursor-pointer items-center gap-2.5 py-2 pe-3 ps-3.5 hover:bg-subtle">
                      {config?.supportsList ? (
                        <input
                          type="checkbox"
                          className={CHECKBOX_CLASS}
                          aria-label={model.id}
                          checked={selectedSet.has(model.id)}
                          onChange={(event) =>
                            setDraftModels((prev) =>
                              event.target.checked
                                ? [...prev, model.id]
                                : prev.filter((id) => id !== model.id),
                            )
                          }
                        />
                      ) : (
                        <input
                          type="radio"
                          className={RADIO_CLASS}
                          name="platform-model-main"
                          aria-label={model.id}
                          checked={draftDefault === model.id}
                          onChange={() => setDraftDefault(model.id)}
                        />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-body"
                        title={model.id}
                      >
                        {model.id}
                      </span>
                      {retiredIds.has(model.id) && (
                        <span className="shrink-0 text-caption text-fg-3">
                          {t("platformModel.retired")}
                        </span>
                      )}
                      {config?.supportsLight && draftLight === model.id && (
                        <span className="shrink-0 text-caption text-fg-3">
                          {t("platformModel.lightBadge")}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="flex shrink-0 justify-end gap-2 pt-1">
        <Button type="button" variant="neutral" size="regular" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="solid"
          size="regular"
          disabled={cannotApply || save.isPending}
          onClick={() => void save.mutate()}
        >
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("platformModel.apply")}
        </Button>
      </div>
    </>
  );
}
