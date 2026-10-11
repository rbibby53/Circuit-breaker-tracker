import { KIND_LABELS, PAPER_SIZES, canView } from '@cbt/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config';
import { actorOf, requireAuth } from '../context';
import type { DB } from '../db';
import { idParam, notFound, parse } from '../errors';
import { disposition } from '../download';
import { canViewPanel, getPanel, panelDetail } from '../panels';
import { drawBook, drawRoomIndex } from '../pdf/book';
import { Pdf, safeTimeZone, type PrintContext } from '../pdf/document';
import { drawDoorCard, drawPanelSheet } from '../pdf/panel';
import { AccessData } from '../repo';
import { panelsUnder, roomIndex } from '../roomIndex';

const common = {
  paper: z.enum(PAPER_SIZES).optional(),
  tz: z.string().max(64).optional(),
  download: z.enum(['0', '1']).optional(),
};
const panelQuery = z.object({ ...common, style: z.enum(['sheet', 'door']).default('sheet') });
const locationQuery = z.object({ ...common, style: z.enum(['book', 'index']).default('book') });

export function pdfRoutes(app: FastifyInstance, db: DB, config: Config): void {
  const context = (tz: string | undefined): PrintContext => {
    const wantQr = config.settings.get('printQr');
    const base = config.publicUrl;
    return {
      appName: config.settings.get('appName'),
      note: config.settings.get('printNote'),
      qrBase: wantQr && base ? base : null,
      qrHint:
        wantQr && !base
          ? 'An admin can set the public address under Settings to add a QR code that opens this panel in the app.'
          : null,
      timeZone: safeTimeZone(tz),
      now: new Date(),
    };
  };

  const send = (reply: FastifyReply, pdf: Buffer, name: string, download: boolean) =>
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', disposition(name, 'pdf', download))
      .send(pdf);

  app.get('/api/panels/:id/pdf', async (req, reply) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const q = parse(panelQuery, req.query);
    const access = new AccessData(db);
    const panel = getPanel(db, idParam((req.params as { id: string }).id));
    if (!panel || !canViewPanel(actor, access, panel)) throw notFound('Panel not found.');
    const detail = panelDetail(db, actor, access, panel);

    const ctx = context(q.tz);
    const pdf = new Pdf(q.paper ?? config.settings.get('paperSize'), detail.name, ctx);
    if (q.style === 'door') drawDoorCard(pdf, detail);
    else drawPanelSheet(pdf, detail);
    const name = q.style === 'door' ? `${detail.name} door card` : detail.name;
    return send(reply, await pdf.finish(), name, q.download === '1');
  });

  app.get('/api/locations/:id/pdf', async (req, reply) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const q = parse(locationQuery, req.query);
    const access = new AccessData(db);
    const id = idParam((req.params as { id: string }).id);
    const root = access.byId.get(id);
    if (!root || !canView(actor, access.node(id)!, access.grants)) throw notFound();

    const ctx = context(q.tz);
    const index = roomIndex(db, actor, access, id);
    const kindLabel = KIND_LABELS[root.kind];
    const pdf = new Pdf(q.paper ?? config.settings.get('paperSize'), `${root.name} panel directory`, ctx);

    if (q.style === 'index') {
      drawRoomIndex(pdf, index);
      return send(reply, await pdf.finish(), `${root.name} room index`, q.download === '1');
    }

    const panels = panelsUnder(db, actor, access, root).map((p) => panelDetail(db, actor, access, p));
    const hasIndex = index.sections.length > 0 || index.above.length > 0;
    drawBook(pdf, { name: root.name, path: access.pathLabel(id), kindLabel }, panels, hasIndex ? index : null);
    return send(reply, await pdf.finish(), `${root.name} panel directory`, q.download === '1');
  });
}
