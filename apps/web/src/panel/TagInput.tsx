import { SUGGESTED_TAGS, type TagCount } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type KeyboardEvent } from 'react';
import { api } from '../api';

const MAX_TAGS = 10;

/** Tags in use on breakers this person can see, most used first. */
export const useTags = () =>
  useQuery({ queryKey: ['tags'], queryFn: () => api.get<TagCount[]>('/api/tags'), staleTime: 30_000 });

/** Chips for what a breaker powers. Enter or comma adds; suggestions come from tags already in use. */
export function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const known = useTags();
  const [text, setText] = useState('');
  const listId = useId();
  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const suggestions = [...(known.data ?? []).map((t) => t.tag), ...SUGGESTED_TAGS].filter(
    (t, i, all) => !has(t) && all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i,
  );

  const add = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (t && !has(t) && tags.length < MAX_TAGS) onChange([...tags, t]);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && text === '' && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={listId + '-input'}>
        Tags
      </label>
      <div className="tag-input">
        {tags.map((t) => (
          <span key={t} className="tag tag-removable">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        {tags.length < MAX_TAGS && (
          <input
            id={listId + '-input'}
            list={listId}
            value={text}
            placeholder={tags.length ? 'Add another' : 'Lights, Outlets, Servers…'}
            onChange={(e) => {
              // Picking a suggestion from the list fills the box in one go: add it straight away.
              const v = e.target.value;
              if (suggestions.some((s) => s === v)) add(v);
              else if (v.endsWith(',')) add(v.slice(0, -1));
              else setText(v);
            }}
            onKeyDown={onKey}
            onBlur={() => text.trim() && add(text)}
          />
        )}
        <datalist id={listId}>
          {suggestions.slice(0, 30).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <span className="field-hint">What it powers, for search and for highlighting on the panel.</span>
    </div>
  );
}
