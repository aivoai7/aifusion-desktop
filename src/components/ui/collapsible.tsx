import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

/**
 * 折叠区：直接把 Radix 的原语透出去（Root / Trigger / Content），
 * 高度动画由调用处用 data-[state] + --radix-collapsible-content-height 自己写，
 * 这里不预设样式，免得和卡片、表单行的间距打架。
 */
const Collapsible = CollapsiblePrimitive.Root;

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
