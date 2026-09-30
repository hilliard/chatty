import { openapi } from '../../../server/api-contract.mjs';
export function GET() {
  return Response.json(openapi, { headers: { 'Cache-Control': 'no-cache' } });
}
