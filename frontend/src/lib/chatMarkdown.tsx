import { useMemo } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface PlaceRef {
  name: string;
  placeId: string;
}

/**
 * Unified chat markdown renderer.
 *
 * Replaces the three hand-rolled renderers (FormattedText,
 * FormattedTextWithPlaces, HighlightedText) with a single
 * react-markdown + remark-gfm pipeline. Place names are converted into
 * `place:<placeId>` link nodes by a small remark transform that runs on the
 * parsed mdast tree — because it operates on the AST (not raw strings), bold /
 * italic / list structure is preserved and emphasis markers can never leak as
 * literal `**` (the old split-on-name bug).
 */

const SKIP_TYPES = new Set([
  'link',
  'linkReference',
  'image',
  'imageReference',
  'definition',
  'code',
  'inlineCode',
  'html',
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a text node's value into text/link nodes, linking place names. */
function splitOnPlaceNames(
  value: string,
  refs: PlaceRef[],
  nameToId: Map<string, string>,
): any[] {
  if (refs.length === 0 || !value) {
    return [{ type: 'text', value }];
  }
  const pattern = new RegExp(refs.map((r) => escapeRegex(r.name)).join('|'), 'gi');
  const nodes: any[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const matched = match[0];
    const placeId = nameToId.get(matched.toLowerCase());
    if (!placeId) continue;
    if (match.index > last) {
      nodes.push({ type: 'text', value: value.slice(last, match.index) });
    }
    nodes.push({
      type: 'link',
      url: `place:${encodeURIComponent(placeId)}`,
      children: [{ type: 'text', value: matched }],
    });
    last = match.index + matched.length;
  }
  if (last < value.length) {
    nodes.push({ type: 'text', value: value.slice(last) });
  }
  return nodes.length > 0 ? nodes : [{ type: 'text', value }];
}

function transformNode(node: any, refs: PlaceRef[], nameToId: Map<string, string>) {
  if (!node || !Array.isArray(node.children)) return;
  const next: any[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitOnPlaceNames(child.value, refs, nameToId));
    } else {
      if (!SKIP_TYPES.has(child.type)) {
        transformNode(child, refs, nameToId);
      }
      next.push(child);
    }
  }
  node.children = next;
}

/** Remark plugin: convert PlaceRef names in text nodes to `place:` links. */
export function remarkPlaceRefs(options: { places?: PlaceRef[] } = {}) {
  const refs = (options.places || [])
    .filter((p) => p && p.name && p.placeId)
    // Longest-first so "Senso-ji Temple" wins over "Senso-ji".
    .sort((a, b) => b.name.length - a.name.length);
  const nameToId = new Map<string, string>();
  for (const r of refs) {
    const key = r.name.toLowerCase();
    if (!nameToId.has(key)) nameToId.set(key, r.placeId);
  }
  return (tree: any) => {
    if (refs.length === 0) return;
    transformNode(tree, refs, nameToId);
  };
}

const urlTransform = (url: string) =>
  url.startsWith('place:') ? url : defaultUrlTransform(url);

export function ChatMarkdown({
  text,
  places,
  onSelectPlace,
  className = '',
}: {
  text: string;
  places?: PlaceRef[];
  onSelectPlace?: (placeId: string) => void;
  className?: string;
}) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (href && href.startsWith('place:')) {
          const placeId = decodeURIComponent(href.slice('place:'.length));
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectPlace?.(placeId);
              }}
              className="font-medium text-[var(--ink)] underline decoration-[var(--peach)] decoration-2 underline-offset-2 hover:decoration-[var(--ink)] transition-colors cursor-pointer"
            >
              {children}
            </button>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ink)] underline decoration-[var(--peach)] decoration-2 underline-offset-2 hover:decoration-[var(--ink)] transition-colors"
          >
            {children}
          </a>
        );
      },
      p({ children }) {
        return <p className="leading-relaxed">{children}</p>;
      },
      ul({ children }) {
        return <ul className="list-disc list-outside ml-4 space-y-1">{children}</ul>;
      },
      ol({ children }) {
        return <ol className="list-decimal list-outside ml-4 space-y-1">{children}</ol>;
      },
      h1({ children }) {
        return <h1 className="text-base font-bold text-[var(--ink)] mt-2">{children}</h1>;
      },
      h2({ children }) {
        return <h2 className="text-[15px] font-bold text-[var(--ink)] mt-2">{children}</h2>;
      },
      h3({ children }) {
        return <h3 className="text-sm font-semibold text-[var(--ink)] mt-1.5">{children}</h3>;
      },
      h4({ children }) {
        return <h4 className="text-sm font-semibold text-[var(--ink)] mt-1">{children}</h4>;
      },
      strong({ children }) {
        return <strong className="font-semibold text-[var(--ink)]">{children}</strong>;
      },
      img({ src, alt }) {
        return (
          <img
            src={typeof src === 'string' ? src : ''}
            alt={alt || ''}
            className="rounded-lg max-w-full my-1"
            loading="lazy"
          />
        );
      },
      blockquote({ children }) {
        return (
          <blockquote className="border-l-2 border-[var(--border)] pl-3 text-[var(--muted)]">
            {children}
          </blockquote>
        );
      },
      code({ children, className: codeClass }) {
        // Inline code only — block code is wrapped in <pre>.
        if (codeClass) {
          return <code className={codeClass}>{children}</code>;
        }
        return (
          <code className="px-1 py-0.5 rounded bg-[var(--sage)] text-[0.85em] font-mono">
            {children}
          </code>
        );
      },
      pre({ children }) {
        return (
          <pre className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-2 overflow-x-auto text-xs">
            {children}
          </pre>
        );
      },
      table({ children }) {
        return (
          <div className="overflow-x-auto my-1">
            <table className="text-xs border-collapse">{children}</table>
          </div>
        );
      },
      th({ children }) {
        return (
          <th className="border border-[var(--border)] px-2 py-1 text-left font-semibold">
            {children}
          </th>
        );
      },
      td({ children }) {
        return <td className="border border-[var(--border)] px-2 py-1">{children}</td>;
      },
      hr() {
        return <hr className="border-[var(--border)] my-2" />;
      },
    }),
    [onSelectPlace],
  );

  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm, [remarkPlaceRefs, { places }]]}
        urlTransform={urlTransform}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
