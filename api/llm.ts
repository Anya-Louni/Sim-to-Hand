import { handleLLM } from '../server/handler.ts';

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > 600_000) return Response.json({ error: 'request too large' }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* handled by the handler */
  }
  const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const out = await handleLLM(body, process.env, ip);
  return Response.json(out.json, { status: out.status });
}
