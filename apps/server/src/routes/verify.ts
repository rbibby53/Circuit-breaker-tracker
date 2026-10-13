// Field verification: marking circuits checked (or wrong) outside the editor, and how far the
// checking has got by site, building and panel.

import {
  atLeast,
  canView,
  effectiveRole,
  isRelayPanel,
  isWithin,
  isSurgeOnly,
  pathIds,
  verifyBreakersSchema,
  circuitLabel,
  type ProgressReport,
  type VerificationItem,
  type VerificationLog,
  type VerifyProgress,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import { changePanel } from '../panelChange';
import { allPanels, breakersOf, canViewPanel, getPanel, type BreakerRow } from '../panels';
import type { MeterRow } from '../meters';
import { AccessData } from '../repo';

/** Circuits worth checking: not spares, not surge protectors without breakers. */
const checkable = (b: BreakerRow) => !b.is_spare && !isSurgeOnly({ device: b.device, amps: b.amps });

export function verifyRoutes(app: FastifyInstance, db: DB): void {
  /** Set the check on some of a panel's circuits, recorded in its history. */
  app.post('/api/panels/:id/verify', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = getPanel(db, idParam((req.params as { id: string }).id));
    if (!panel || !canViewPanel(actor, access, panel)) throw notFound('Panel not found.');
    if (!atLeast(effectiveRole(actor, access.node(panel.location_id)!, access.grants), 'editor')) {
      throw forbidden('You need Editor access here to check circuits.');
    }
    const body = parse(verifyBreakersSchema, req.body);
    const ids = new Set(breakersOf(db, panel.id).map((b) => b.id));
    if (body.breakers.some((b) => !ids.has(b.breakerId))) throw badRequest('A breaker does not belong to this panel.');
    const set = db.prepare(
      `UPDATE breakers SET verify_status = ?, verified_by = ?, verified_at = ?
        WHERE id = ? AND verify_status != ?`,
    );
    const t = now();
    let changed = 0;
    changePanel(db, auth, access, panel, 'Checked circuits', () => {
      for (const b of body.breakers) {
        changed += set.run(
          b.status,
          b.status ? auth.user.display_name : '',
          b.status ? t : null,
          b.breakerId,
          b.status,
        ).changes;
      }
    });
    return { changed, version: getPanel(db, panel.id)!.version };
  });

  /** Verification progress at and under a location: by site and building, and per panel. */
  app.get('/api/locations/:id/progress', async (req): Promise<ProgressReport> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const id = idParam((req.params as { id: string }).id);
    const root = access.node(id);
    if (!root || !canView(actor, root, access.grants)) throw notFound();

    const blank = (locationId: number): VerifyProgress => {
      const l = access.byId.get(locationId)!;
      return {
        locationId,
        name: l.name,
        kind: l.kind,
        path: access.pathLabel(locationId),
        circuits: 0,
        verified: 0,
        wrong: 0,
        panels: 0,
        panelsDone: 0,
      };
    };
    const total = blank(id);
    const parts = new Map<number, VerifyProgress>();
    const panels: ProgressReport['panels'] = [];
    for (const p of allPanels(db)) {
      const node = access.node(p.location_id);
      if (!node || !isWithin(node, id) || !canViewPanel(actor, access, p) || isRelayPanel(p)) continue;
      const list = breakersOf(db, p.id).filter(checkable);
      const verified = list.filter((b) => b.verify_status === 'verified').length;
      const wrong = list.filter((b) => b.verify_status === 'wrong').length;
      const done = list.length > 0 && verified === list.length ? 1 : 0;
      panels.push({
        id: p.id,
        name: p.name,
        path: access.pathLabel(p.location_id),
        circuits: list.length,
        verified,
        wrong,
      });
      // Count it toward the location asked about and each site or building under it on its path.
      const groups = [total];
      for (const n of pathIds(access.byId.get(p.location_id)!.path)) {
        const l = access.byId.get(n);
        if (!l || n === id || (l.kind !== 'site' && l.kind !== 'building') || access.hiddenBuildings.has(n)) continue;
        if (!isWithin(access.node(n)!, id)) continue;
        if (!parts.has(n)) parts.set(n, blank(n));
        groups.push(parts.get(n)!);
      }
      for (const g of groups) {
        g.circuits += list.length;
        g.verified += verified;
        g.wrong += wrong;
        g.panels++;
        g.panelsDone += done;
      }
    }
    const share = (x: { circuits: number; verified: number }) => (x.circuits ? x.verified / x.circuits : 1);
    panels.sort((a, b) => share(a) - share(b) || a.name.localeCompare(b.name));
    return {
      total,
      parts: [...parts.values()].sort((a, b) => a.path.localeCompare(b.path)),
      panels,
    };
  });

  /**
   * Who checked what: every circuit and meter marked verified or wrong, newest first, at and
   * under a location (or everywhere the person can see), with a count per person.
   */
  app.get('/api/verifications', async (req): Promise<VerificationLog> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const q = req.query as { loc?: string; by?: string; status?: string; limit?: string };
    const loc = q.loc ? idParam(q.loc) : null;
    if (loc !== null) {
      const node = access.node(loc);
      if (!node || !canView(actor, node, access.grants)) throw notFound();
    }
    const inside = (locationId: number) => {
      const node = access.node(locationId);
      return !!node && (loc === null || node.id === loc || isWithin(node, loc));
    };
    const all: VerificationItem[] = [];
    const panels = new Map(allPanels(db).map((p) => [p.id, p]));
    for (const p of panels.values()) {
      if (!inside(p.location_id) || !canViewPanel(actor, access, p)) continue;
      for (const b of breakersOf(db, p.id)) {
        if (!b.verify_status) continue;
        all.push({
          kind: 'breaker',
          id: b.id,
          status: b.verify_status,
          by: b.verified_by,
          at: b.verified_at,
          panelId: p.id,
          panelName: p.name,
          what: `${isRelayPanel(p) ? 'Relay' : 'Circuit'} ${circuitLabel(p, b)}`,
          label: b.label,
          path: access.pathLabel(p.location_id),
        });
      }
    }
    for (const m of db.prepare("SELECT * FROM meters WHERE verify_status != ''").all() as MeterRow[]) {
      const node = access.node(m.location_id);
      if (!inside(m.location_id) || !node || !canView(actor, node, access.grants)) continue;
      const breakerPanel = m.breaker_id
        ? (
            db.prepare('SELECT panel_id FROM breakers WHERE id = ?').get(m.breaker_id) as
              { panel_id: number } | undefined
          )?.panel_id
        : undefined;
      const panel = panels.get(m.panel_id ?? breakerPanel ?? -1);
      all.push({
        kind: 'meter',
        id: m.id,
        status: m.verify_status as VerificationItem['status'],
        by: m.verified_by,
        at: m.verified_at,
        panelId: panel && canViewPanel(actor, access, panel) ? panel.id : null,
        panelName: panel?.name ?? '',
        what: `Meter ${m.name}`,
        label: m.meter_number ? `#${m.meter_number}` : '',
        path: access.pathLabel(m.location_id),
      });
    }
    const people = new Map<string, VerificationLog['people'][number]>();
    for (const i of all) {
      const name = i.by || 'Unknown';
      const p = people.get(name) ?? { name, verified: 0, wrong: 0, last: null };
      if (i.status === 'verified') p.verified++;
      else p.wrong++;
      if (i.at && (!p.last || i.at > p.last)) p.last = i.at;
      people.set(name, p);
    }
    const shown = all
      .filter((i) => !q.by || (i.by || 'Unknown') === q.by)
      .filter((i) => !q.status || i.status === q.status)
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    const limit = Math.min(2000, Math.max(1, Number(q.limit) || 500));
    return {
      people: [...people.values()].sort(
        (a, b) => b.verified + b.wrong - (a.verified + a.wrong) || a.name.localeCompare(b.name),
      ),
      items: shown.slice(0, limit),
      total: shown.length,
    };
  });
}
