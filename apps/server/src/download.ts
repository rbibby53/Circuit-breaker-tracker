/** A Content-Disposition value that is safe in a header and keeps the readable name where supported. */
export function disposition(name: string, ext: string, download: boolean): string {
  const base = name.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || 'export';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_');
  const type = download ? 'attachment' : 'inline';
  return `${type}; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(base)}.${ext}`;
}
