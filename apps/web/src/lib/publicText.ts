/**
 * Keep infrastructure details out of customer-facing labels and errors.
 * Internal routing metadata can still travel through the API; this helper is
 * only applied at presentation boundaries.
 */
const INTERNAL_DETAIL_PATTERN = /sub2api|new[\s_-]*api|账号池|号池|上游|网关|gateway|upstream|account[\s_-]*pool/i;

// Translate known capability/configuration failures into actionable customer
// messages before the generic infrastructure-detail filter is applied.
const CUSTOMER_ERROR_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /image generation is not enabled for this group/i,
    message: "当前生图服务尚未开通，请联系管理员启用该模型。",
  },
];

export function publicText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  const customerMessage = CUSTOMER_ERROR_MESSAGES.find(({ pattern }) => pattern.test(text));
  if (customerMessage) return customerMessage.message;
  return !INTERNAL_DETAIL_PATTERN.test(text) ? text : fallback;
}

export function publicError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return publicText(message, fallback);
}
