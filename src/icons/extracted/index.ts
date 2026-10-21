// AIFusion 图标索引：把字形表、着色表和图片资源文件名拼成 ProviderIcon 用的查找接口。
//
// 三条来源：
//   GLYPHS     —— 内联 SVG（可被 currentColor 着色），见 glyphs.ts
//   BRAND_TINT —— 品牌默认色，见 tint.ts
//   BITMAPS    —— 光栅图 / 不能着色的大 SVG，静态 import 进来（逐个点名，
//                不用 import.meta.glob：glob 会把目录里上百个没人用的 logo 也打进包里）
//
// icon 名和文件名常常对不上（xycai-icon.png -> xycai），所以这里显式登记一次。
// 所有查询都按小写键，兼容数据库里大小写混写的 icon 字段。

import { GLYPHS } from "./glyphs";
import { BRAND_TINT } from "./tint";

import mark_88api from "./88api.png";
import markA6api from "./a6-icon.png";
import markAlltokens from "./alltokens.png";
import markApikeyfun from "./apikeyfun.png";
import markApinebula from "./apinebula_icon.png";
import markAstron from "./astron.png";
import markAtlascloud from "./atlascloud_icon.png";
import markBailing from "./bailing.png";
import markByteplus from "./byteplus.png";
import markCcsub from "./ccsub.svg?url";
import markCherryin from "./cherryin.png";
import markClaudeapi from "./ClaudeApi.png";
import markClaudecn from "./claudecn.png";
import markCode0 from "./code0.png";
import markDmxapi from "./dmxapi.png";
import markEflowcode from "./eflowcode.png";
import markEtok from "./etok.png";
import markEveryapi from "./everyapi.svg?url";
import markFenno from "./fenno-icon.png";
import markFluxa from "./fluxa.png";
import markGrooroute from "./grooroute.jpg";
import markHermes from "./hermes.png";
import markHuoshan from "./huoshan.png";
import markIkuncode from "./ikuncode.jpg";
import markModelflare from "./modelflare.jpg";
import markNekocode from "./nekocode-icon.png";
import markOpenmodel from "./openmodel.jpg";
import markPateway from "./pateway.jpg";
import markPipellm from "./pipellm.png";
import markQiniu from "./qiniu.png";
import markRelaxcode from "./relaxcode.png";
import markRunapi from "./runapi.jpg";
import markRuntoken from "./runtoken.jpg";
import markShengsuanyun from "./shengsuanyun.svg?url";
import markSoruxgpt from "./soruxgpt.jpg";
import markSoshow from "./soshow.png";
import markStreamlake from "./streamlake.svg?url";
import markSub2api from "./sub2api.svg?url";
import markSubrouter from "./subrouter.svg?url";
import markSudocode from "./sudocode.png";
import markSudocodeus from "./sudocode-us.png";
import markTeamorouter from "./TeamoRouter-icon-dark.png";
import markTokenflux from "./tokenflux.jpg";
import markTuzi from "./tuzi.png";
import markUnity2 from "./unity2.png";
import markXycai from "./xycai-icon.png";
import markZetaapi from "./zetaapi-icon.png";
const BITMAPS: Record<string, string> = {
  "88api": mark_88api,
  "a6api": markA6api,
  "alltokens": markAlltokens,
  "apikeyfun": markApikeyfun,
  "apinebula": markApinebula,
  "astron": markAstron,
  "atlascloud": markAtlascloud,
  "bailing": markBailing,
  "byteplus": markByteplus,
  "ccsub": markCcsub,
  "cherryin": markCherryin,
  "claudeapi": markClaudeapi,
  "claudecn": markClaudecn,
  "code0": markCode0,
  "dmxapi": markDmxapi,
  "eflowcode": markEflowcode,
  "etok": markEtok,
  "everyapi": markEveryapi,
  "fenno": markFenno,
  "fluxa": markFluxa,
  "grooroute": markGrooroute,
  "hermes": markHermes,
  "huoshan": markHuoshan,
  "ikuncode": markIkuncode,
  "modelflare": markModelflare,
  "nekocode": markNekocode,
  "openmodel": markOpenmodel,
  "pateway": markPateway,
  "pipellm": markPipellm,
  "qiniu": markQiniu,
  "relaxcode": markRelaxcode,
  "runapi": markRunapi,
  "runtoken": markRuntoken,
  "shengsuanyun": markShengsuanyun,
  "soruxgpt": markSoruxgpt,
  "soshow": markSoshow,
  "streamlake": markStreamlake,
  "sub2api": markSub2api,
  "subrouter": markSubrouter,
  "sudocode": markSudocode,
  "sudocode-us": markSudocodeus,
  "teamorouter": markTeamorouter,
  "tokenflux": markTokenflux,
  "tuzi": markTuzi,
  "unity2": markUnity2,
  "xycai": markXycai,
  "zetaapi": markZetaapi,
};

const key = (name: string) => name.toLowerCase();

/** 内联 SVG 字符串；没有则空串。 */
export function getIcon(name: string): string {
  return GLYPHS[key(name)] ?? "";
}

/** 图片资源的 URL；没有则空串。 */
export function getIconUrl(name: string): string {
  return BITMAPS[key(name)] ?? "";
}

export function isUrlIcon(name: string): boolean {
  return key(name) in BITMAPS;
}

export function hasIcon(name: string): boolean {
  const k = key(name);
  return k in GLYPHS || k in BITMAPS;
}

/** 品牌默认色（调用方没给 color 时兜底）；没登记过返回 undefined。 */
export function getIconMetadata(name: string) {
  const color = BRAND_TINT[key(name)];
  return color ? { name: key(name), defaultColor: color } : undefined;
}

/** 全部可用图标名，给搜索 / 校验用。 */
export const iconList = [
  ...new Set([...Object.keys(GLYPHS), ...Object.keys(BITMAPS)]),
].sort();
