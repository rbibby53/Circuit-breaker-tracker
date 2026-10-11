import { randomBytes } from 'node:crypto';
import { atLeast, circuitLabel, effectiveRole, sharePanelSchema, type PublicPanel } from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import type { Config } from '../config';
import { actorOf, requireAuth } from '../context';
import type { DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import { breakersOf, canViewPanel, getBreaker, getPanel, servesOf, tagsOf, type PanelRow } from '../panels';
import { AccessData } from '../repo';

const newPublicToken = () => randomBytes(18).toString('base64url');

/** The read-only directory anyone with the link sees. Names only; no ids beyond the panel's own. */
export function publicPanel(db: DB, access: AccessData, panel: PanelRow): PublicPanel {
  const breakers = breakersOf(db, panel.id);
  const serves = servesOf(
    db,
    breakers.map((b) => b.id),
  );
  const tags = tagsOf(
    db,
    breakers.map((b) => b.id),
  );
  const feeder = panel.fed_from_breaker_id ? getBreaker(db, panel.fed_from_breaker_id) : undefined;
  const feederPanel = feeder ? getPanel(db, feeder.panel_id) : undefined;
  const placeName = (id: number) => {
    const l = access.byId.get(id);
    if (!l) return null;
    return l.kind === 'room' ? l.name : `All of ${l.name}`;
  };
  return {
    id: panel.id,
    name: panel.name,
    locationPath: access.pathLabel(panel.location_id),
    layout: panel.layout,
    spaces: panel.spaces,
    mainAmps: panel.main_amps,
    mainType: panel.main_type,
    voltage: panel.voltage,
    notes: panel.notes,
    updatedAt: panel.updated_at,
    fedFrom: feeder && feederPanel ? { panelName: feederPanel.name, circuit: circuitLabel(feederPanel, feeder) } : null,
    breakers: breakers.map((b) => ({
      position: b.position,
      slot: b.slot,
      poles: b.poles,
      amps: b.amps,
      device: b.device,
      protection: b.protection,
      label: b.label,
      notes: b.notes,
      isSpare: !!b.is_spare,
      critical: !!b.critical,
      backup: b.backup,
      serves: serves
        .filter((s) => s.breaker_id === b.id)
        .flatMap((s) => {
          const name = placeName(s.location_id);
          return name ? [s.note ? `${name} (${s.note})` : name] : [];
        }),
      tags: tags.filter((t) => t.breaker_id === b.id).map((t) => t.tag),
    })),
  };
}

export function publicRoutes(app: FastifyInstance, db: DB, config: Config): void {
  /** No sign-in: anyone with the link. Rate limited so links cannot be guessed by brute force. */
  app.get(
    '/api/public/panels/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req): Promise<PublicPanel> => {
      const { token } = req.params as { token: string };
      const panel =
        config.settings.get('publicPanels') && /^[A-Za-z0-9_-]{16,64}$/.test(token)
          ? (db.prepare('SELECT * FROM panels WHERE public_token = ?').get(token) as PanelRow | undefined)
          : undefined;
      if (!panel) throw notFound('This panel is not shared, or its link has changed.');
      return publicPanel(db, new AccessData(db), panel);
    },
  );

  /** Turn the public page on or off, or replace its link. Managers decide what is shared. */
  app.put('/api/panels/:id/public', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = getPanel(db, idParam((req.params as { id: string }).id));
    if (!panel || !canViewPanel(actor, access, panel)) throw notFound('Panel not found.');
    if (!atLeast(effectiveRole(actor, access.node(panel.location_id)!, access.grants), 'manager')) {
      throw forbidden('You need Manager access here to share a panel publicly.');
    }
    const body = parse(sharePanelSchema, req.body);
    if (body.enabled && !config.settings.get('publicPanels')) {
      throw badRequest('An admin has turned off public panel pages in Settings.');
    }
    const token = body.enabled ? (body.renew || !panel.public_token ? newPublicToken() : panel.public_token) : null;
    db.prepare('UPDATE panels SET public_token = ? WHERE id = ?').run(token, panel.id);
    const summary = !body.enabled
      ? `Turned off the public page of panel ${panel.name}`
      : panel.public_token && body.renew
        ? `Made a new public link for panel ${panel.name}; the old link and its QR codes stopped working`
        : `Turned on a public page for panel ${panel.name}`;
    if (token !== panel.public_token) {
      audit(
        db,
        auth,
        { action: 'panel.public', entity: 'panel', entityId: panel.id, locationId: panel.location_id, summary },
        access,
      );
    }
    return { publicPath: token ? `/p/${token}` : null };
  });
}
