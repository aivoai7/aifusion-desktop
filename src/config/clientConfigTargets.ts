import type { AppId } from "@/lib/api";

/**
 * 各客户端把模型与连接配置写进本机的哪个文件（详情页「配置落点」一行）。
 *
 * 目录本身由后端 `get_config_dir` 按当前设置解析（用户可能自定义过目录），
 * 这里只补上已知的文件名；没列出来的应用就只显示目录。不含任何地址或密钥。
 */
export const CLIENT_CONFIG_FILE: Partial<Record<AppId, string>> = {
  claude: "settings.json",
  codex: "config.toml",
  gemini: "settings.json",
  grokbuild: "config.toml",
  opencode: "opencode.json",
  pi: "models.json",
};
