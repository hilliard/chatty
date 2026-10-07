import { defineMiddleware } from 'astro:middleware';
import { currentUser } from './server/chat.mjs';
export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (['/api/health', '/api/docs', '/api/docs/', '/api/docs/openapi.json'].includes(path) || path.startsWith('/_astro/') || path.startsWith('/@') || /\.(css|js|svg|ico|woff2)$/.test(path)) return next();
  if (context.request.method === 'POST') {
    const origin = context.request.headers.get('origin');
    if (origin && origin !== context.url.origin) return Response.json({ error: 'Request origin does not match.' }, { status: 403 });
  }
  try {
    context.locals.user = await currentUser(context.cookies);
    if (context.locals.user?.account_status === 'blocked') {
      context.locals.user = null;
      if (path === '/join' && context.url.searchParams.get('blocked') !== '1') return context.redirect('/join?blocked=1');
      if (path !== '/join' && path !== '/api/identity/restore' && path !== '/api/identity/forget') return context.redirect('/join?blocked=1');
    }
  }
  catch { return new Response('Chatty cannot reach its database. Please try again shortly.', { status: 503 }); }
  if (['/join', '/api/join', '/api/identity/restore', '/api/identity/forget'].includes(path)) {
    const response = await next(); response.headers.set('Cache-Control', 'no-store'); return response;
  }
  if (!context.locals.user) {
    if (path.startsWith('/api/')) return Response.json({ error: 'Please join again.' }, { status: 401 });
    return context.redirect('/join');
  }
  return next();
});
