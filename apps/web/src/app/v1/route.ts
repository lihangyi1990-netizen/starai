export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    name: "tuna Large Model API",
    base_url: "/v1",
    models: "/v1/models",
    chat_completions: "/v1/chat/completions",
    message: "Use your API Key to call a specific endpoint. This base address is not a regular web page.",
  });
}
