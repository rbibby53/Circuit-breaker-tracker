import { canView } from '@cbt/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { actorOf, requireAuth } from '../context';
import { BREAKER_COLUMNS, breakerRows, toCsv } from '../csv';
import type { DB } from '../db';
import { disposition } from '../download';
import { idParam, notFound } from '../errors';
import { canViewPanel, getPanel, panelDetail } from '../panels';
import { AccessData } from '../repo';
import { panelsUnder } from '../roomIndex';

/** Spreadsheet exports. They follow the same visibility rules as the app and the PDFs. */
export function exportRoutes(app: FastifyInstance, db: DB): void {
  const send = (reply: FastifyReply, csv: string, name: string) =>
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', disposition(name, 'csv', true))
      .send(csv);

  app.get('/api/panels/:id/csv', async (req, reply) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = getPanel(db, idParam((req.params as { id: string }).id));
    if (!panel || !canViewPanel(actor, access, panel)) throw notFound('Panel not found.');
    const detail = panelDetail(db, actor, access, panel);
    return send(reply, toCsv([BREAKER_COLUMNS, ...breakerRows(detail)]), `${detail.name} breakers`);
  });

  app.get('/api/locations/:id/csv', async (req, reply) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const id = idParam((req.params as { id: string }).id);
    const root = access.byId.get(id);
    if (!root || !canView(actor, access.node(id)!, access.grants)) throw notFound();
    const rows = panelsUnder(db, actor, access, root).flatMap((p) => breakerRows(panelDetail(db, actor, access, p)));
    return send(reply, toCsv([BREAKER_COLUMNS, ...rows]), `${root.name} breakers`);
  });
}
