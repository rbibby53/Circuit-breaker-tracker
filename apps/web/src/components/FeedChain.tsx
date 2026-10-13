import type { FeedLink, TopologyKind } from '@cbt/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { NodeIcon } from './PowerIcon';

/**
 * A feed chain as a strip of chips, from the top down to `here`: each panel with the circuit it
 * is on, and transformers, disconnects and UPSs with their rating.
 */
export function FeedChainStrip({
  chain,
  here,
  hereKind,
  empty = 'Fed from: not set yet',
}: {
  /** Nearest first, as the API returns it. */
  chain: FeedLink[];
  here: ReactNode;
  hereKind: TopologyKind | 'equipment';
  empty?: string;
}) {
  const top = [...chain].reverse();
  return (
    <div className="power-strip">
      <ol className="ps-chain" aria-label="Fed from">
        {top.length === 0 ? (
          <li className="ps-chip ps-warn">{empty}</li>
        ) : (
          top.map((f) =>
            f.kind === 'device' ? (
              <li key={`d${f.deviceId}`} className={`ps-chip ps-${f.deviceKind}`}>
                <NodeIcon kind={f.deviceKind} size={16} />
                {f.canView ? <Link to={`/devices/${f.deviceId}`}>{f.name}</Link> : <strong>{f.name}</strong>}
                {f.rating && <span className="ps-ckt">{f.rating}</span>}
                {f.way && <span className="ps-ckt">{f.way}</span>}
              </li>
            ) : (
              <li key={f.breakerId} className="ps-chip">
                <NodeIcon kind={f.canView ? 'panel' : 'hidden'} size={16} />
                {f.canView ? <Link to={`/panels/${f.panelId}`}>{f.panelName}</Link> : <strong>{f.panelName}</strong>}
                <span className="ps-ckt" title={f.label}>
                  {f.circuit} · {f.amps}A
                </span>
              </li>
            ),
          )
        )}
        <li className="ps-chip ps-here" aria-current="true">
          <NodeIcon kind={hereKind} size={16} />
          {here}
        </li>
      </ol>
    </div>
  );
}
