export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { clientId: process.env.SPOTIFY_CLIENT_ID || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
