// Discrepancy reports: "this doesn't match", sent from field mode or from a panel's public page
// (by whoever scanned the QR code on the door), and resolved by an editor.

import {
  atLeast,
  circuitLabel,
  effectiveRole,
  publicReportSchema,
  reportInputSchema,
  resolveReportSchema,
  type ReportDto,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import type { Config } from '../config';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import { changePanel } from '../panelChange';
import { allPanels, breakersOf, canViewPanel, getBreaker, getPanel, type BreakerRow, type PanelRow } from '../panels';
import { AccessData } from '../repo';

interface ReportRow {
  id: number;
  panel_id: number;
  breaker_id: number | null;
  circuit: string;
  message: string;
  reporter: string;
  user_id: number | null;
  source: 'app' | 'public';
  client_id: string | null;
  status: 'open' | 'resolved';
  resolution: string;
  resolved_by: string;
  resolved_at: string | null;
  created_at: string;
}

/** "5 + 7 Lab lights", as the circuit read when it was reported. */
const circuitText = (panel: PanelRow, b: BreakerRow) => `${circuitLabel(panel, b)}${b.label ? ` ${b.label}` : ''}`;

export function reportRoutes(app: FastifyInstance, db: DB, config: Config): void {
  const canEdit = (actor: ReturnType<typeof actorOf>, access: AccessData, panel: PanelRow) =>
    atLeast(effectiveRole(actor, access.node(panel.location_id)!, access.grants), 'editor');

  const shape = (r: ReportRow, panel: PanelRow, access: AccessData, editable: boolean): ReportDto => ({
    id: r.id,
    panelId: panel.id,
    panelName: panel.name,
    locationPath: access.pathLabel(panel.location_id),
    breakerId: r.breaker_id,
    circuit: r.circuit,
    message: r.message,
    reporter: r.reporter,
    source: r.source,
    status: r.status,
    resolution: r.resolution,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    canResolve: editable,
  });

  /** Report from field mode. Anyone who can see the panel may report; editors may also mark it wrong. */
  app.post('/api/panels/:id/reports', async (req): Promise<ReportDto> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = getPanel(db, idParam((req.params as { id: string }).id));
    if (!panel || !canViewPanel(actor, access, panel)) throw notFound('Panel not found.');
    if (auth.readOnly) throw forbidden('Viewing as someone else: read-only.');
    const body = parse(reportInputSchema, req.body);
    const editable = canEdit(actor, access, panel);
    // Sent again after being offline: the first one stands.
    if (body.clientId) {
      const seen = db.prepare('SELECT * FROM reports WHERE client_id = ?').get(body.clientId) as ReportRow | undefined;
      if (seen) {
        if (seen.panel_id !== panel.id) throw badRequest('That report belongs to another panel.');
        return shape(seen, panel, access, editable);
      }
    }
    const breaker = body.breakerId ? getBreaker(db, body.breakerId) : undefined;
    if (body.breakerId && breaker?.panel_id !== panel.id) throw badRequest('That circuit is not in this panel.');
    if (body.markWrong && !editable) throw forbidden('You need Editor access here to mark a circuit wrong.');
    const id = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO reports (panel_id, breaker_id, circuit, message, reporter, user_id, source, client_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'app', ?, ?)`,
        )
        .run(
          panel.id,
          breaker?.id ?? null,
          breaker ? circuitText(panel, breaker) : '',
          body.message,
          auth.user.display_name,
          auth.user.id,
          body.clientId ?? null,
          now(),
        );
      if (breaker && body.markWrong && breaker.verify_status !== 'wrong') {
        changePanel(db, auth, access, panel, 'Reported a circuit that does not match', () => {
          db.prepare("UPDATE breakers SET verify_status = 'wrong', verified_by = ?, verified_at = ? WHERE id = ?").run(
            auth.user.display_name,
            now(),
            breaker.id,
          );
        });
      }
      audit(
        db,
        auth,
        {
          action: 'report.create',
          entity: 'panel',
          entityId: panel.id,
          locationId: panel.location_id,
          summary: `Reported a problem on ${panel.name}${breaker ? ` circuit ${circuitLabel(panel, breaker)}` : ''}: ${body.message.slice(0, 120)}`,
        },
        access,
      );
      return Number(r.lastInsertRowid);
    })();
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow;
    return shape(row, getPanel(db, panel.id)!, access, editable);
  });

  /** Report from a panel's public page, by whoever scanned the door label. No sign-in. */
  app.post(
    '/api/public/panels/:token/reports',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req) => {
      const { token } = req.params as { token: string };
      const panel =
        config.settings.get('publicPanels') && /^[A-Za-z0-9_-]{16,64}$/.test(token)
          ? (db.prepare('SELECT * FROM panels WHERE public_token = ?').get(token) as PanelRow | undefined)
          : undefined;
      if (!panel) throw notFound('This panel is not shared, or its link has changed.');
      const body = parse(publicReportSchema, req.body);
      // A filled-in hidden field means a bot: say thanks and keep nothing.
      if (body.website) return { ok: true };
      const open = (
        db
          .prepare("SELECT COUNT(*) AS n FROM reports WHERE panel_id = ? AND status = 'open' AND source = 'public'")
          .get(panel.id) as { n: number }
      ).n;
      if (open >= 50)
        throw badRequest('This panel already has many open reports. Please tell the facilities team directly.');
      const breaker =
        body.position !== null
          ? breakersOf(db, panel.id).find(
              (b) => (b.section ?? 1) === (body.section ?? 1) && b.position === body.position && b.slot === body.slot,
            )
          : undefined;
      if (body.position !== null && !breaker) throw badRequest('That circuit is not in this panel.');
      const access = new AccessData(db);
      db.prepare(
        `INSERT INTO reports (panel_id, breaker_id, circuit, message, reporter, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'public', ?)`,
      ).run(panel.id, breaker?.id ?? null, breaker ? circuitText(panel, breaker) : '', body.message, body.name, now());
      audit(
        db,
        null,
        {
          action: 'report.create',
          entity: 'panel',
          entityId: panel.id,
          locationId: panel.location_id,
          summary: `Problem reported from the public page of ${panel.name}${body.name ? ` by ${body.name}` : ''}${breaker ? `, circuit ${circuitLabel(panel, breaker)}` : ''}: ${body.message.slice(0, 120)}`,
        },
        access,
      );
      return { ok: true };
    },
  );

  /** One panel's reports, open first. */
  app.get('/api/panels/:id/reports', async (req): Promise<ReportDto[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = getPanel(db, idParam((req.params as { id: string }).id));
    if (!panel || !canViewPanel(actor, access, panel)) throw notFound('Panel not found.');
    const editable = canEdit(actor, access, panel) && !auth.readOnly;
    const rows = db
      .prepare("SELECT * FROM reports WHERE panel_id = ? ORDER BY status = 'resolved', created_at DESC LIMIT 200")
      .all(panel.id) as ReportRow[];
    return rows.map((r) => shape(r, panel, access, editable));
  });

  /** Reports across every panel the person can see: open ones, or all. */
  app.get('/api/reports', async (req): Promise<ReportDto[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const all = (req.query as { status?: string }).status === 'all';
    const panels = new Map(
      allPanels(db)
        .filter((p) => canViewPanel(actor, access, p))
        .map((p) => [p.id, p]),
    );
    const rows = db
      .prepare(
        `SELECT * FROM reports ${all ? '' : "WHERE status = 'open'"} ORDER BY status = 'resolved', created_at DESC LIMIT 2000`,
      )
      .all() as ReportRow[];
    return rows.flatMap((r) => {
      const p = panels.get(r.panel_id);
      return p ? [shape(r, p, access, canEdit(actor, access, p) && !auth.readOnly)] : [];
    });
  });

  /** Resolve a report (or open it again), with a note on what was done. */
  app.patch('/api/reports/:id', async (req): Promise<ReportDto> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(idParam((req.params as { id: string }).id)) as
      ReportRow | undefined;
    const panel = row ? getPanel(db, row.panel_id) : undefined;
    if (!row || !panel || !canViewPanel(actor, access, panel)) throw notFound('Report not found.');
    if (auth.readOnly || !canEdit(actor, access, panel)) {
      throw forbidden('You need Editor access here to resolve reports.');
    }
    const body = parse(resolveReportSchema, req.body);
    const resolved = body.status === 'resolved';
    db.prepare('UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(
      body.status,
      body.resolution,
      resolved ? auth.user.display_name : '',
      resolved ? now() : null,
      row.id,
    );
    if (row.status !== body.status) {
      audit(
        db,
        auth,
        {
          action: resolved ? 'report.resolve' : 'report.reopen',
          entity: 'panel',
          entityId: panel.id,
          locationId: panel.location_id,
          summary: `${resolved ? 'Resolved' : 'Reopened'} a report on ${panel.name}${row.circuit ? ` (${row.circuit})` : ''}${body.resolution ? `: ${body.resolution.slice(0, 120)}` : ''}`,
        },
        access,
      );
    }
    const after = db.prepare('SELECT * FROM reports WHERE id = ?').get(row.id) as ReportRow;
    return shape(after, panel, access, true);
  });
}
